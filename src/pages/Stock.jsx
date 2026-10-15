import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Boxes, Wrench, ShoppingCart, History, Plus, Barcode, Undo2, Redo2 } from 'lucide-react';
import { useLabels } from '../lib/useLabels';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, StatusChip, Kpi, Modal, Field, useConfirm } from '../components/ui';
import RowActions from '../components/RowActions';
import { ExportButtons } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import SendRepairModal from '../components/SendRepairModal';
import { updateDevice, deleteDevice, deletePurchase } from '../lib/db';
import { money, num, fmtDate, deviceName } from '../lib/format';

export default function Stock() {
  const data = useData();
  const { devices, settings, can } = data;
  const canDelete = can('deleteRecords');
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const showCost = can('viewProfit');
  const navigate = useNavigate();
  const [status, setStatus] = useState('in_stock');
  const [cond, setCond] = useState('all');
  const [q, setQ] = useState('');
  const [repairDevice, setRepairDevice] = useState(null);
  const [editing, setEditing] = useState(null);
  const [printLabelsFor, labelBusy] = useLabels();

  /** Only a phone still in stock can go; the last phone of a purchase takes the purchase with it. */
  const remove = async (d) => {
    const purchase = data.raw.purchases.find((p) => p.id === d.purchaseId);
    const last = !purchase || purchase.items.length <= 1;
    const ok = await confirm({
      title: `Delete ${deviceName(d)}?`,
      message: last
        ? `This is the only phone in ${purchase?.purchaseNo || 'its purchase'}, so the whole purchase, its repairs and payments are deleted too. This cannot be undone.`
        : `The phone is removed from stock and from ${purchase.purchaseNo}, and that purchase total goes down by its price. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      if (last && purchase) await deletePurchase(purchase, data.raw);
      else await deleteDevice(d, purchase, data.raw.repairs);
      toast('Phone deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return devices
      .filter((d) => status === 'all' || d.status === status)
      .filter((d) => cond === 'all' || d.condition === cond)
      .filter(
        (d) =>
          !s ||
          d.imei.includes(s) ||
          (d.sn || '').toLowerCase().includes(s) ||
          (d.imei2 || '').includes(s) ||
          deviceName(d).toLowerCase().includes(s) ||
          (d.supplierName || '').toLowerCase().includes(s) ||
          (d.color || '').toLowerCase().includes(s),
      )
      .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
  }, [devices, status, cond, q]);

  const cost = (d) => num(d.purchasePrice) + num(d.repairCost);
  const inStock = devices.filter((d) => d.status === 'in_stock');
  const value = inStock.reduce((s, d) => s + cost(d), 0);

  const exportSpec = () => ({
    settings,
    title: 'Stock Report',
    filename: `stock-${status}`,
    landscape: true,
    meta: [['Filter', `${status === 'all' ? 'All devices' : status.replace('_', ' ')} · ${cond === 'all' ? 'New & used' : cond}`]],
    columns: [
      { header: 'Device', key: 'name' },
      { header: 'IMEI', key: 'imei' },
      { header: 'Colour', key: 'color' },
      { header: 'Condition', key: 'cond' },
      { header: 'Supplier', key: 'sup' },
      { header: 'Purchased', key: 'date' },
      { header: 'Status', key: 'status' },
      ...(showCost ? [{ header: 'Cost', key: 'cost', money: true }] : []),
    ],
    rows: rows.map((d) => ({
      name: deviceName(d),
      imei: [d.imei, d.imei2].filter(Boolean).join(' / '),
      color: d.color,
      cond: d.condition,
      sup: d.supplierName,
      date: fmtDate(d.purchaseDate),
      status: d.status.replace('_', ' '),
      cost: cost(d),
    })),
    foot: { name: `${rows.length} devices`, cost: rows.reduce((s, d) => s + cost(d), 0) },
  });

  const pg = usePaged(rows, {
    resetOn: [status, cond, q],
    sort: [(d) => deviceName(d), (d) => d.imei, (d) => d.condition, (d) => d.supplierName, ...(showCost ? [(d) => num(d.purchasePrice) + num(d.repairCost)] : []), (d) => d.status, null],
  });

  return (
    <div className="page">
      <PageHeader
        title="Stock"
        subtitle="Every device you have bought"
        actions={
          <Link to="/purchases/new" className="btn btn-primary">
            <Plus size={16} /> Add stock
          </Link>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={Boxes} label="In stock" value={inStock.length} sub={showCost ? `Value ${money(value)}` : 'Ready to sell'} />
          <Kpi label="New" value={inStock.filter((d) => d.condition === 'New').length} sub="In stock" />
          <Kpi label="Used" value={inStock.filter((d) => d.condition === 'Used').length} sub="In stock" />
          <Kpi icon={Wrench} label="In repair" value={devices.filter((d) => d.status === 'in_repair').length} />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search IMEI, model, supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'in_stock', label: 'In stock' },
                { value: 'in_repair', label: 'In repair' },
                { value: 'sold', label: 'Sold' },
                { value: 'returned', label: 'Returned' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Segmented
              label="Condition"
              value={cond}
              onChange={setCond}
              options={[
                { value: 'all', label: 'All' },
                { value: 'New', label: 'New' },
                { value: 'Used', label: 'Used' },
              ]}
            />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <button
                className="btn btn-sm"
                disabled={labelBusy || !rows.length}
                onClick={() => printLabelsFor(rows)}
                title="Print a barcode label for every device in this list"
              >
                <Barcode size={15} /> Labels ({rows.length})
              </button>
              <ExportButtons build={exportSpec} small />
            </div>
          </div>
          {rows.length ? (
            <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>IMEI</th>
                    <th>Condition</th>
                    <th>Supplier</th>
                    {showCost && <th className="num">Cost</th>}
                    <th>Status</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="cell-main">{deviceName(d)}</div>
                        <div className="cell-sub">
                          {[d.sn && `SN ${d.sn}`, d.color, d.battery != null && `BH ${d.battery}%`, d.notes].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="mono small">{d.imei}{d.imei2 && <div className="cell-sub">{d.imei2}</div>}</td>
                      <td><span className="chip plain">{d.condition}</span></td>
                      <td>
                        <div>{d.supplierName}</div>
                        <div className="cell-sub">
                          <Link to={`/purchases/${d.purchaseId}`}>{d.purchaseNo}</Link> · {fmtDate(d.purchaseDate)}
                        </div>
                      </td>
                      {showCost && (
                        <td className="num">
                          <div className="cell-main">{money(cost(d))}</div>
                          {num(d.repairCost) > 0 && <div className="cell-sub">incl. repair {money(d.repairCost)}</div>}
                        </td>
                      )}
                      <td>
                        <StatusChip status={d.status} />
                        {d.status === 'sold' && <div className="cell-sub"><Link to={`/sales/${d.saleId}`}>{d.saleNo}</Link> · {money(d.salePrice)}</div>}
                        {d.status === 'returned' && <div className="cell-sub"><Link to={`/returns/${d.returnId}`}>{d.returnNo}</Link></div>}
                      </td>
                      <td className="actions">
                        <RowActions
                          onEdit={() => setEditing(d)}
                          onDelete={canDelete && d.status === 'in_stock' ? () => remove(d) : null}
                          editLabel="Edit device"
                          deleteLabel="Delete device"
                        >
                          {d.status === 'in_stock' && (
                            <>
                              <button className="btn btn-sm btn-primary" onClick={() => navigate(`/sales/new?device=${d.id}`)} title="Sell">
                                <ShoppingCart size={14} /> Sell
                              </button>
                              <button className="btn btn-sm btn-icon" onClick={() => setRepairDevice(d)} aria-label="Send to repair" title="Send to repair">
                                <Wrench size={14} />
                              </button>
                            </>
                          )}
                          {d.status === 'sold' && (
                            <Link className="btn btn-sm btn-icon" to={`/returns/new?kind=sale&bill=${d.saleId}&device=${d.id}`} aria-label="Sales return" title="Sales return (customer brings it back)">
                              <Undo2 size={14} />
                            </Link>
                          )}
                          {d.status === 'in_stock' && (
                            <Link className="btn btn-sm btn-icon" to={`/returns/new?kind=purchase&bill=${d.purchaseId}&device=${d.id}`} aria-label="Return to supplier" title="Return to supplier">
                              <Redo2 size={14} />
                            </Link>
                          )}
                          <button className="btn btn-sm btn-icon" disabled={labelBusy} onClick={() => printLabelsFor([d])} aria-label="Print label" title="Print label">
                            <Barcode size={14} />
                          </button>
                          <Link className="btn btn-sm btn-icon" to={`/timeline/${d.imei}`} aria-label="IMEI timeline" title="Timeline">
                            <History size={14} />
                          </Link>
                        </RowActions>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Boxes} title="No devices here" />
          )}
        </section>
      </div>
      <SendRepairModal device={repairDevice} onClose={() => setRepairDevice(null)} />
      <EditDevice device={editing} onClose={() => setEditing(null)} />
      {confirmDialog}
    </div>
  );
}

function EditDevice({ device, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (device) setF({ brand: device.brand, model: device.model, variant: device.variant || '', color: device.color || '', imei2: device.imei2 || '', condition: device.condition, notes: device.notes || '', battery: device.battery ?? '', warranty: device.warranty || '', hsn: device.hsn || '' });
  }, [device]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.brand?.trim() || !f.model?.trim()) return toast('Brand and model are required', 'error');
    setBusy(true);
    try {
      await updateDevice(device.id, {
        brand: f.brand.trim(),
        model: f.model.trim(),
        variant: f.variant.trim(),
        color: f.color.trim(),
        imei2: f.imei2.trim(),
        battery: f.battery === '' || f.battery == null ? null : Math.min(100, Math.max(0, Math.round(Number(f.battery)))),
        warranty: (f.warranty || '').trim(),
        hsn: (f.hsn || '').trim(),
        condition: f.condition,
        notes: f.notes.trim(),
      }, device.imei);
      toast('Device updated');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={Boolean(device)} onClose={onClose} title="Edit device" subtitle={device?.imei}>
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="Brand" required><input className="input" value={f.brand || ''} onChange={set('brand')} /></Field>
          <Field label="Model" required><input className="input" value={f.model || ''} onChange={set('model')} /></Field>
          <Field label="RAM / Storage"><input className="input" value={f.variant || ''} onChange={set('variant')} /></Field>
          <Field label="Colour"><input className="input" value={f.color || ''} onChange={set('color')} /></Field>
          <Field label="IMEI 2"><input className="input mono" value={f.imei2 || ''} onChange={set('imei2')} /></Field>
          <Field label="Battery health (%)"><input className="input num" type="number" min="0" max="100" value={f.battery ?? ''} onChange={set('battery')} /></Field>
          <Field label="Warranty"><input className="input" placeholder="e.g. 6 Months" value={f.warranty || ''} onChange={set('warranty')} /></Field>
          <Field label="HSN code (GST)" hint="Empty = default from Settings"><input className="input mono" value={f.hsn || ''} onChange={set('hsn')} /></Field>
          <Field label="Condition">
            <select className="select" value={f.condition || 'Used'} onChange={set('condition')}>
              <option>New</option>
              <option>Used</option>
            </select>
          </Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes || ''} onChange={set('notes')} /></Field>
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
