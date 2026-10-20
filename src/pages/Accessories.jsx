import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Headphones, AlertTriangle, Barcode, SlidersHorizontal, ShoppingCart, PackagePlus } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi, Modal, Field, useConfirm } from '../components/ui';
import RowActions from '../components/RowActions';
import { ExportButtons } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import AccessoryForm, { AdjustStock } from '../components/AccessoryForm';
import { deleteAccessory } from '../lib/db';
import { ACC_CATEGORIES, TRACK_LABEL, accLabel } from '../lib/accessories';
import { money, num } from '../lib/format';

export default function Accessories() {
  const data = useData();
  const { accessories, accStock, settings, can } = data;
  const canDelete = can('deleteRecords');
  const showCost = can('viewProfit');
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [show, setShow] = useState('all');
  const [form, setForm] = useState(null); // { accessory } | { accessory: null } for new
  const [adjust, setAdjust] = useState(null);
  const [labels, setLabels] = useState(null);

  const stockOf = (a) => accStock.get(a.id) || { qty: 0, value: 0, avgCost: 0, low: false, inStock: [] };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return accessories
      .filter((a) => cat === 'all' || a.category === cat)
      .filter((a) => {
        const st = accStock.get(a.id);
        if (show === 'in') return st?.qty > 0;
        if (show === 'low') return st?.low && st.qty > 0;
        if (show === 'out') return !(st?.qty > 0);
        return true;
      })
      .filter(
        (a) =>
          !s ||
          a.name.toLowerCase().includes(s) ||
          (a.brand || '').toLowerCase().includes(s) ||
          (a.code || '').toLowerCase().includes(s) ||
          (a.notes || '').toLowerCase().includes(s) ||
          (accStock.get(a.id)?.inStock || []).some((x) => x.toLowerCase().includes(s)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accessories, accStock, cat, show, q]);

  const totals = useMemo(() => {
    let pieces = 0;
    let value = 0;
    let low = 0;
    let out = 0;
    for (const a of accessories) {
      const st = accStock.get(a.id);
      if (!st) continue;
      pieces += Math.max(0, st.qty);
      value += st.value;
      if (st.qty <= 0) out += 1;
      else if (st.low) low += 1;
    }
    return { pieces, value, low, out };
  }, [accessories, accStock]);

  const remove = async (a) => {
    const ok = await confirm({ title: `Delete ${a.name}?`, message: 'The item is removed from the catalogue. This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteAccessory(a, data.raw);
      toast(`${a.name} deleted`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const exportSpec = () => ({
    settings,
    title: 'Accessories Stock',
    filename: 'accessories-stock',
    landscape: true,
    meta: [['Filter', `${cat === 'all' ? 'All categories' : cat} · ${{ all: 'All items', in: 'In stock', low: 'Low stock', out: 'Out of stock' }[show]}`]],
    columns: [
      { header: 'Item', key: 'name' },
      { header: 'Code', key: 'code' },
      { header: 'Category', key: 'cat' },
      { header: 'Tracking', key: 'track' },
      { header: 'In stock', key: 'qty' },
      { header: 'Selling price', key: 'sale', money: true },
      ...(showCost ? [{ header: 'Avg cost', key: 'cost', money: true }, { header: 'Stock value', key: 'value', money: true }] : []),
    ],
    rows: rows.map((a) => {
      const st = stockOf(a);
      return { name: [a.name, a.brand && `(${a.brand})`].filter(Boolean).join(' '), code: a.code, cat: a.category, track: TRACK_LABEL[a.track === 'serial' ? 'serial' : 'qty'], qty: st.qty, sale: num(a.salePrice), cost: st.avgCost, value: st.value };
    }),
    foot: { name: `${rows.length} items`, qty: rows.reduce((t, a) => t + Math.max(0, stockOf(a).qty), 0), value: rows.reduce((t, a) => t + stockOf(a).value, 0) },
  });

  const pg = usePaged(rows, {
    resetOn: [cat, show, q],
    sort: [(a) => a.name, (a) => a.category, (a) => stockOf(a).qty, (a) => num(a.salePrice), ...(showCost ? [(a) => stockOf(a).value] : []), null],
  });

  return (
    <div className="page">
      <PageHeader
        title="Accessories"
        subtitle="Chargers, cables, earphones, covers, glass… with serial numbers or counted"
        actions={
          <>
            <button className="btn" onClick={() => setForm({ accessory: null })}><Plus size={16} /> New accessory</button>
            <button className="btn btn-primary" onClick={() => navigate('/purchases/new?accessories=1')} title="Buy accessories from a party - same as a phone purchase"><PackagePlus size={16} /> Add stock</button>
          </>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={Headphones} label="Pieces in stock" value={totals.pieces} sub={showCost ? `Value ${money(totals.value)}` : `${accessories.length} items`} />
          <Kpi label="Items" value={accessories.length} sub={`${accessories.filter((a) => a.track === 'serial').length} with serial numbers`} />
          <Kpi icon={AlertTriangle} label="Low stock" value={totals.low} sub="At or below the alert level" />
          <Kpi label="Out of stock" value={totals.out} />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search name, brand, code, serial…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accessories" />
            </div>
            <select className="select" style={{ width: 210 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {ACC_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}
            </select>
            <Segmented
              label="Stock"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All' },
                { value: 'in', label: 'In stock' },
                { value: 'low', label: 'Low' },
                { value: 'out', label: 'Out' },
              ]}
            />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={exportSpec} small />
            </div>
          </div>
          {rows.length ? (
            <>
              <div className="table-wrap">
                <table className="table" {...pg.tableProps}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th className="num">In stock</th>
                      <th className="num">Selling price</th>
                      {showCost && <th className="num">Stock value</th>}
                      <th className="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((a) => {
                      const st = stockOf(a);
                      return (
                        <tr key={a.id} className="clickable" onClick={() => navigate(`/accessories/${a.id}`)}>
                          <td>
                            <div className="cell-main">{a.name}</div>
                            <div className="cell-sub">{[a.brand, a.code, a.track === 'serial' && 'Serial no.', a.warranty && `W: ${a.warranty}`].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="small">{a.category}</td>
                          <td className="num">
                            <b>{st.qty}</b>
                            {st.qty <= 0 ? <div><span className="chip urgent">Out</span></div> : st.low ? <div><span className="chip caution">Low</span></div> : null}
                          </td>
                          <td className="num">{num(a.salePrice) ? money(a.salePrice) : '—'}</td>
                          {showCost && (
                            <td className="num">
                              {money(st.value)}
                              <div className="cell-sub">avg {money(st.avgCost)}</div>
                            </td>
                          )}
                          <td className="actions">
                            <RowActions
                              onEdit={() => setForm({ accessory: data.raw.accessories.find((x) => x.id === a.id) || a })}
                              onDelete={canDelete ? () => remove(a) : null}
                              editLabel="Edit accessory"
                              deleteLabel="Delete accessory"
                              more={[
                                { label: 'Adjust stock', icon: SlidersHorizontal, onClick: () => setAdjust(a) },
                                { label: 'Print labels', icon: Barcode, onClick: () => setLabels(a) },
                              ]}
                            >
                              {st.qty > 0 && (
                                <button className="btn btn-sm btn-primary" onClick={() => navigate(`/sales/new?accessory=${a.id}`)} title="Sell">
                                  <ShoppingCart size={14} /> Sell
                                </button>
                              )}
                            </RowActions>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager {...pg.pager} />
            </>
          ) : (
            <Empty
              icon={Headphones}
              title={accessories.length ? 'Nothing matches' : 'No accessories yet'}
              action={!accessories.length && <button className="btn btn-primary" onClick={() => setForm({ accessory: null })}><Plus size={16} /> New accessory</button>}
            >
              {!accessories.length && 'Add stock the same way as phones: New Purchase → pick the party → add accessories. New items can be created right there.'}
            </Empty>
          )}
        </section>
      </div>
      <AccessoryForm open={Boolean(form)} accessory={form?.accessory || null} onClose={() => setForm(null)} />
      <AdjustStock accessory={adjust} onClose={() => setAdjust(null)} />
      <AccessoryLabels accessory={labels} onClose={() => setLabels(null)} />
      {confirmDialog}
    </div>
  );
}

/** Barcode labels: one per serial in stock, or a chosen number of copies of the item code. */
export function AccessoryLabels({ accessory, onClose }) {
  const { accStock, settings } = useData();
  const toast = useToast();
  const st = accessory ? accStock.get(accessory.id) : null;
  const serial = accessory?.track === 'serial';
  const [copies, setCopies] = useState('');
  const [busy, setBusy] = useState(false);
  const count = serial ? st?.inStock.length || 0 : Math.max(1, Math.min(200, Math.round(num(copies || Math.max(1, st?.qty || 1)))));

  const print = async () => {
    setBusy(true);
    try {
      const { printLabels } = await import('../lib/labels');
      const unit = (code) => accLabel(accessory, code);
      const list = serial ? st.inStock.map(unit) : Array.from({ length: count }, () => unit(accessory.code));
      await printLabels(list, settings);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(accessory)} onClose={onClose} title="Print labels" subtitle={accessory?.name} size="narrow">
      <div className="stack">
        {serial ? (
          <p className="muted" style={{ margin: 0 }}>{count ? `One label for each of the ${count} serial number(s) in stock.` : 'No serial numbers in stock.'}</p>
        ) : (
          <Field label="How many labels" hint={`Barcode ${accessory?.code} · ${st?.qty || 0} in stock`}>
            <input className="input num" inputMode="numeric" value={copies} placeholder={String(Math.max(1, st?.qty || 1))} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !count} onClick={print}><Barcode size={16} /> {busy ? 'Preparing…' : `Print ${count}`}</button>
        </div>
      </div>
    </Modal>
  );
}
