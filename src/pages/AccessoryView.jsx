import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, SlidersHorizontal, Barcode, ShoppingCart, History } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi, useConfirm } from '../components/ui';
import MoreMenu from '../components/MoreMenu';
import AccessoryForm, { AdjustStock } from '../components/AccessoryForm';
import { AccessoryLabels } from './Accessories';
import { deleteAccessory, deleteAdjustment } from '../lib/db';
import { TRACK_LABEL, accLines, cleanSerial, lineQty, warrantyEnd } from '../lib/accessories';
import { money, num, fmtDate, today } from '../lib/format';

export default function AccessoryView() {
  const { id } = useParams();
  const data = useData();
  const { accessories, accStock, purchases, sales, returns, stockAdjustments, can } = data;
  const showCost = can('viewProfit');
  const canDelete = can('deleteRecords');
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [labels, setLabels] = useState(false);

  const a = accessories.find((x) => x.id === id);
  const st = a ? accStock.get(a.id) : null;

  // every movement of this item, oldest first
  const moves = useMemo(() => {
    if (!a) return [];
    const out = [];
    if (num(a.openingQty) > 0) out.push({ key: 'open', date: a.openingDate || '', type: 'Opening stock', in: num(a.openingQty), rate: num(a.openingCost), serials: a.openingSerials || [] });
    for (const p of purchases) for (const l of accLines(p)) if (l.accessoryId === a.id) out.push({ key: `p${p.id}`, date: p.date, type: 'Purchase', ref: p.purchaseNo, to: `/purchases/${p.id}`, party: p.partyName, in: lineQty(l), rate: num(l.rate), serials: l.serials || [] });
    for (const s of sales) for (const l of accLines(s)) if (l.accessoryId === a.id) out.push({ key: `s${s.id}`, date: s.date, type: 'Sale', ref: s.invoiceNo, to: `/sales/${s.id}`, party: s.customerName, out: lineQty(l), rate: num(l.rate), serials: l.serials || [], warranty: l.warranty });
    for (const x of returns) for (const l of accLines(x)) if (l.accessoryId === a.id) {
      const sale = x.kind === 'sale';
      out.push({ key: `r${x.id}`, date: x.date, type: sale ? 'Sales return' : 'Purchase return', ref: x.returnNo, to: `/returns/${x.id}`, party: x.partyName, [sale ? 'in' : 'out']: lineQty(l), rate: lineQty(l) ? num(l.value) / lineQty(l) : 0, serials: l.serials || [] });
    }
    for (const adj of stockAdjustments) if (adj.accessoryId === a.id) {
      const n = Math.round(num(adj.qty));
      out.push({ key: `a${adj.id}`, date: adj.date, type: 'Adjustment', ref: adj.reason, party: adj.note, [n > 0 ? 'in' : 'out']: Math.abs(n), rate: num(adj.cost), serials: adj.serials || [], adj });
    }
    const order = { 'Opening stock': 0, Purchase: 1, Adjustment: 2, Sale: 3, 'Sales return': 4, 'Purchase return': 5 };
    return out.sort((x, y) => (x.date || '').localeCompare(y.date || '') || order[x.type] - order[y.type]);
  }, [a, purchases, sales, returns, stockAdjustments]);

  // where each serial is now (its last movement)
  const serialRows = useMemo(() => {
    if (!a || a.track !== 'serial') return [];
    const last = new Map();
    for (const m of moves) for (const s of m.serials) {
      const k = cleanSerial(s);
      const cur = last.get(k) || {};
      if (m.type === 'Purchase' || m.type === 'Opening stock') cur.bought = m;
      if (m.type === 'Sale') cur.sold = m;
      cur.last = m;
      last.set(k, cur);
    }
    return [...last.entries()]
      .map(([serial, v]) => ({ serial, ...v, inStock: st?.serials.get(serial)?.count > 0 }))
      .sort((x, y) => Number(y.inStock) - Number(x.inStock) || x.serial.localeCompare(y.serial));
  }, [a, moves, st]);

  if (!a) {
    return (
      <div className="page">
        <PageHeader title="Accessory" />
        <div className="card"><Empty title="Accessory not found" action={<Link className="btn" to="/accessories">Back to accessories</Link>} /></div>
      </div>
    );
  }

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${a.name}?`, message: 'The item is removed from the catalogue. This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteAccessory(a, data.raw);
      toast(`${a.name} deleted`);
      navigate('/accessories');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const removeAdj = async (adj) => {
    const ok = await confirm({ title: 'Delete this adjustment?', message: `${adj.reason || 'Adjustment'} · ${num(adj.qty) > 0 ? '+' : ''}${adj.qty}. The stock goes back to what it was before.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteAdjustment(adj, { accStock: data.rawAccStock });
      toast('Adjustment deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const status = (r) => {
    if (r.inStock) return <span className="chip success">In stock</span>;
    if (r.last?.type === 'Sale') return <span className="chip">Sold</span>;
    if (r.last?.type === 'Purchase return') return <span className="chip urgent">Returned to supplier</span>;
    if (r.last?.type === 'Adjustment') return <span className="chip urgent">Removed</span>;
    return <span className="chip plain">{r.last?.type}</span>;
  };

  return (
    <div className="page">
      <PageHeader
        title={a.name}
        subtitle={[a.brand, a.category, a.code, TRACK_LABEL[a.track === 'serial' ? 'serial' : 'qty']].filter(Boolean).join(' · ')}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</button>
            <button className="btn" onClick={() => setAdjust(true)}><SlidersHorizontal size={16} /> Adjust stock</button>
            <MoreMenu
              items={[
                { label: 'Print labels', icon: Barcode, onClick: () => setLabels(true) },
                { label: 'Delete accessory', icon: Trash2, onClick: remove, danger: true, hidden: !canDelete },
              ]}
            />
            {st?.qty > 0 && (
              <Link className="btn btn-primary" to={`/sales/new?accessory=${a.id}`}><ShoppingCart size={16} /> Sell</Link>
            )}
          </>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse label="In stock" value={st?.qty ?? 0} sub={st?.qty <= 0 ? 'Out of stock' : st?.low ? `Low - alert at ${a.lowStock}` : a.lowStock ? `Alert at ${a.lowStock}` : 'Pieces'} />
          <Kpi label="Selling price" value={num(a.salePrice) ? money(a.salePrice) : '—'} sub={a.warranty ? `Warranty ${a.warranty}` : 'No default warranty'} />
          {showCost && <Kpi label="Stock value" value={money(st?.value || 0)} sub={`Average cost ${money(st?.avgCost || 0)}`} />}
          <Kpi label="Sold" value={st?.soldQty ?? 0} sub={`Bought ${st?.purchasedQty ?? 0} · HSN ${a.hsn || '—'}`} />
        </div>

        {a.track === 'serial' && (
          <section className="card card-lg">
            <div className="card-head"><h2>Serial numbers ({serialRows.length})</h2><span className="muted small">{st?.qty || 0} in stock</span></div>
            {serialRows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Serial</th><th>Status</th><th>Bought</th><th>Sold</th><th>Warranty till</th><th className="actions">Actions</th></tr></thead>
                  <tbody>
                    {serialRows.map((r) => {
                      const end = r.sold && !r.inStock ? warrantyEnd(r.sold.date, r.sold.warranty) : '';
                      return (
                        <tr key={r.serial}>
                          <td className="mono">{r.serial}</td>
                          <td>{status(r)}</td>
                          <td className="small">{r.bought ? <>{r.bought.to ? <Link to={r.bought.to}>{r.bought.ref}</Link> : r.bought.type} · {fmtDate(r.bought.date)}</> : '—'}</td>
                          <td className="small">{r.sold && !r.inStock ? <><Link to={r.sold.to}>{r.sold.ref}</Link> · {r.sold.party}<div className="cell-sub">{fmtDate(r.sold.date)}</div></> : '—'}</td>
                          <td className="small">
                            {end ? <>{fmtDate(end)} {end >= today() ? <span className="chip success">Active</span> : <span className="chip plain">Expired</span>}</> : r.sold && !r.inStock ? r.sold.warranty || '—' : '—'}
                          </td>
                          <td className="actions">
                            <Link className="btn btn-sm btn-icon" to={`/timeline/${encodeURIComponent(r.serial)}`} aria-label="Serial history" title="History"><History size={14} /></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No serial numbers yet">Buy stock or add opening stock with serial numbers.</Empty>
            )}
          </section>
        )}

        <section className="card card-lg">
          <div className="card-head"><h2>Stock history</h2></div>
          {moves.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Ref.</th><th>Party / note</th><th className="num">In</th><th className="num">Out</th>{showCost && <th className="num">Rate</th>}<th className="actions">Actions</th></tr>
                </thead>
                <tbody>
                  {[...moves].reverse().map((m) => (
                    <tr key={m.key}>
                      <td className="tnum">{fmtDate(m.date)}</td>
                      <td>{m.type}</td>
                      <td>{m.to ? <Link to={m.to}>{m.ref}</Link> : m.ref || '—'}{m.serials.length > 0 && <div className="cell-sub mono">{m.serials.join(', ')}</div>}</td>
                      <td className="small">{m.party || '—'}</td>
                      <td className="num pos">{m.in ? `+${m.in}` : ''}</td>
                      <td className="num neg">{m.out ? `−${m.out}` : ''}</td>
                      {showCost && <td className="num">{m.rate ? money(m.rate) : '—'}</td>}
                      <td className="actions">
                        {m.adj && canDelete && (
                          <button className="btn btn-sm btn-icon btn-danger" onClick={() => removeAdj(m.adj)} aria-label="Delete adjustment" title="Delete adjustment"><Trash2 size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No movement yet" />
          )}
          {a.notes && <p className="small"><span className="muted">Notes:</span> {a.notes}</p>}
        </section>
      </div>
      <AccessoryForm open={editing} accessory={editing ? data.raw.accessories.find((x) => x.id === a.id) || a : null} onClose={() => setEditing(false)} />
      <AdjustStock accessory={adjust ? a : null} onClose={() => setAdjust(false)} />
      <AccessoryLabels accessory={labels ? a : null} onClose={() => setLabels(false)} />
      {confirmDialog}
    </div>
  );
}
