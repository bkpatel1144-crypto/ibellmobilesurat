// Mobile accessories: chargers, cables, earphones, covers, glass, smartwatches…
//
// Two kinds, chosen per item (the standard in Zoho / Vyapar / Tally):
//   track 'serial' - every unit has its own serial number and warranty (e.g. Apple 20W adapter, AirPods)
//   track 'qty'    - counted only (covers, tempered glass, cables)
//
// Bills keep phones in `items` (one line per phone, as before) and accessories in a separate
// `accessories` array, one line per item:
//   { accessoryId, name, brand, category, hsn, track, qty, rate, amount, serials[], warranty, cost, taxable, gst }
// Old bills simply have no `accessories`.
//
// Stock is never stored - it is worked out from the documents every time:
//   opening + purchases − purchase returns − sales + sales returns ± adjustments
// so editing or deleting any bill keeps it right, with no counter that can drift.
import { num, round2 } from './format';

export const ACC_CATEGORIES = [
  { name: 'Charger / Adapter', hsn: '8504' },
  { name: 'Cable', hsn: '8544' },
  { name: 'Earphones / Headphones', hsn: '8518' },
  { name: 'Speaker', hsn: '8518' },
  { name: 'Smartwatch / Band', hsn: '8517' },
  { name: 'Power bank', hsn: '8507' },
  { name: 'Cover / Case', hsn: '3926' },
  { name: 'Tempered glass / Screen guard', hsn: '7007' },
  { name: 'Memory card / Pendrive', hsn: '8523' },
  { name: 'Other', hsn: '' },
];

export const TRACK_LABEL = { serial: 'Serial number', qty: 'Quantity' };

export const ADJUST_REASONS = ['Damaged', 'Lost / missing', 'Found / extra', 'Stock count correction', 'Used in shop / demo', 'Other'];

export const categoryHsn = (name) => ACC_CATEGORIES.find((c) => c.name === name)?.hsn || '';

/** Serial numbers are compared without spaces and case. */
export const cleanSerial = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

/** The accessory lines of a bill / note (none on older documents). */
export const accLines = (bill) => (Array.isArray(bill?.accessories) ? bill.accessories : []);

export const lineQty = (l) => Math.max(0, Math.round(num(l?.qty)));

/** Phones + accessory pieces on a bill. */
export const billUnits = (bill) => (bill?.items?.length || 0) + accLines(bill).reduce((s, l) => s + lineQty(l), 0);

/** "Apple 20W Adapter ×2" */
export const accLineName = (l) => `${l.name}${lineQty(l) > 1 ? ` ×${lineQty(l)}` : ''}`;

/** Short names of everything on a bill: phones first, then accessories. */
export const billItemNames = (bill) => [
  ...(bill?.items || []).map((i) => [i.brand, i.model].filter(Boolean).join(' ')),
  ...accLines(bill).map(accLineName),
];

/** "iPhone 13, Apple 20W Adapter ×2 +1" style text for lists. */
export function billItemsText(bill, max = 0) {
  const names = billItemNames(bill);
  if (!max || names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

/** "3 phones · 4 accessories" */
export function billCountText(bill) {
  const phones = bill?.items?.length || 0;
  const acc = accLines(bill).reduce((s, l) => s + lineQty(l), 0);
  return [phones && `${phones} phone${phones === 1 ? '' : 's'}`, acc && `${acc} accessor${acc === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ') || '0 items';
}

/** Does a search text match a bill's accessory names / serials? */
export const accMatches = (bill, s) =>
  accLines(bill).some((l) => (l.name || '').toLowerCase().includes(s) || (l.serials || []).some((x) => x.toLowerCase().includes(s)));

/**
 * Stock of every accessory, worked out from the documents.
 * Returns Map(accessoryId → {
 *   qty, value, avgCost, purchasedQty, soldQty, low,
 *   serials: Map(SERIAL → { count, cost, purchaseId, purchaseNo, date }),   (serial items)
 *   inStock: [SERIAL, …]                                                     (serial items)
 * })
 * A serial is in stock while (times it came in) − (times it went out) > 0, so the order of the
 * documents never matters.
 */
export function accessoryStock({ accessories = [], purchases = [], sales = [], returns = [], stockAdjustments = [] }) {
  const m = new Map();
  for (const a of accessories) {
    const st = {
      qty: 0,
      purchasedQty: 0,
      soldQty: 0,
      inValue: 0, // opening + purchases, for the average cost
      inQty: 0,
      serials: new Map(),
      track: a.track === 'serial' ? 'serial' : 'qty',
    };
    const oq = Math.max(0, Math.round(num(a.openingQty)));
    st.qty += oq;
    st.inQty += oq;
    st.inValue += oq * num(a.openingCost);
    if (st.track === 'serial') for (const s of a.openingSerials || []) bump(st, s, 1, { cost: num(a.openingCost), purchaseNo: 'Opening stock', date: a.openingDate || '' });
    m.set(a.id, st);
  }
  const each = (docs, fn) => {
    for (const d of docs) for (const l of accLines(d)) {
      const st = m.get(l.accessoryId);
      if (st) fn(st, l, d);
    }
  };
  each(purchases, (st, l, p) => {
    const q = lineQty(l);
    st.qty += q;
    st.purchasedQty += q;
    st.inQty += q;
    st.inValue += num(l.amount ?? q * num(l.rate));
    for (const s of l.serials || []) bump(st, s, 1, { cost: num(l.rate), purchaseId: p.id, purchaseNo: p.purchaseNo, date: p.date });
  });
  each(sales, (st, l) => {
    st.qty -= lineQty(l);
    st.soldQty += lineQty(l);
    for (const s of l.serials || []) bump(st, s, -1);
  });
  each(returns, (st, l, x) => {
    const sign = x.kind === 'sale' ? 1 : -1; // customer brings it back / it goes back to the supplier
    st.qty += sign * lineQty(l);
    if (x.kind === 'sale') st.soldQty -= lineQty(l);
    else st.purchasedQty -= lineQty(l);
    for (const s of l.serials || []) bump(st, s, sign);
  });
  for (const adj of stockAdjustments) {
    const st = m.get(adj.accessoryId);
    if (!st) continue;
    st.qty += Math.round(num(adj.qty));
    const sign = num(adj.qty) >= 0 ? 1 : -1;
    for (const s of adj.serials || []) bump(st, s, sign, sign > 0 ? { cost: num(adj.cost), purchaseNo: 'Stock adjustment', date: adj.date } : undefined);
  }
  const byId = new Map(accessories.map((a) => [a.id, a]));
  for (const [id, st] of m) {
    const a = byId.get(id);
    st.avgCost = st.inQty ? round2(st.inValue / st.inQty) : round2(num(a?.purchasePrice));
    if (st.track === 'serial') {
      st.inStock = [...st.serials.entries()].filter(([, v]) => v.count > 0).map(([k]) => k).sort();
      st.qty = st.inStock.length;
      st.value = round2(st.inStock.reduce((t, k) => t + num(st.serials.get(k).cost ?? st.avgCost), 0));
    } else {
      st.inStock = [];
      st.value = round2(Math.max(0, st.qty) * st.avgCost);
    }
    st.low = num(a?.lowStock) > 0 && st.qty <= num(a.lowStock);
  }
  return m;
}

function bump(st, serial, by, info) {
  const k = cleanSerial(serial);
  if (!k) return;
  const cur = st.serials.get(k) || { count: 0 };
  cur.count += by;
  if (info) Object.assign(cur, info.cost == null ? {} : { cost: info.cost }, info.purchaseId ? { purchaseId: info.purchaseId } : {}, info.purchaseNo ? { purchaseNo: info.purchaseNo } : {}, info.date ? { date: info.date } : {});
  st.serials.set(k, cur);
}

/** What one sale line cost the shop: exact serial costs, or quantity × average cost. */
export function lineCost(line, st) {
  if (!st) return 0;
  if ((line.serials || []).length) return round2(line.serials.reduce((t, s) => t + num(st.serials.get(cleanSerial(s))?.cost ?? st.avgCost), 0));
  return round2(lineQty(line) * st.avgCost);
}

/** Quantity and serials of one accessory already on return notes against this bill. */
export function accReturned(returns, billId, accessoryId, exceptId = null) {
  let qty = 0;
  const serials = new Set();
  for (const x of returns) {
    if (x.billId !== billId || x.id === exceptId) continue;
    for (const l of accLines(x)) {
      if (l.accessoryId !== accessoryId) continue;
      qty += lineQty(l);
      (l.serials || []).forEach((s) => serials.add(cleanSerial(s)));
    }
  }
  return { qty, serials };
}

/** Every place one accessory serial appears, oldest first - for the warranty check. */
export function serialHistory(serial, { accessories = [], purchases = [], sales = [], returns = [], stockAdjustments = [] }) {
  const k = cleanSerial(serial);
  if (!k) return null;
  const has = (l) => (l.serials || []).some((s) => cleanSerial(s) === k);
  const events = [];
  let accessoryId = null;
  for (const a of accessories) {
    if ((a.openingSerials || []).some((s) => cleanSerial(s) === k)) {
      accessoryId = a.id;
      events.push({ type: 'opening', date: a.openingDate || '', doc: a, line: { name: a.name, rate: a.openingCost } });
    }
  }
  for (const p of purchases) for (const l of accLines(p)) if (has(l)) { accessoryId = l.accessoryId; events.push({ type: 'purchase', date: p.date, doc: p, line: l }); }
  for (const s of sales) for (const l of accLines(s)) if (has(l)) { accessoryId = l.accessoryId; events.push({ type: 'sale', date: s.date, doc: s, line: l }); }
  for (const x of returns) for (const l of accLines(x)) if (has(l)) { accessoryId = l.accessoryId; events.push({ type: x.kind === 'sale' ? 'saleReturn' : 'purchaseReturn', date: x.date, doc: x, line: l }); }
  for (const adj of stockAdjustments) if ((adj.serials || []).some((s) => cleanSerial(s) === k)) { accessoryId = adj.accessoryId; events.push({ type: 'adjust', date: adj.date, doc: adj, line: adj }); }
  if (!events.length) return null;
  const order = { opening: 0, purchase: 1, adjust: 2, sale: 3, saleReturn: 4, purchaseReturn: 5 };
  events.sort((a, b) => (a.date || '').localeCompare(b.date || '') || order[a.type] - order[b.type]);
  return { serial: k, accessory: accessories.find((a) => a.id === accessoryId) || null, events };
}

/**
 * Warranty end date from the sale date and a warranty text like "6 Months", "1 Year", "15 Days".
 * Returns '' when it cannot be read (e.g. "As per brand").
 */
export function warrantyEnd(saleDate, text) {
  const m = /(\d+)\s*(day|days|month|months|mon|year|years|yr|yrs)\b/i.exec(String(text || ''));
  if (!saleDate || !m) return '';
  const n = Number(m[1]);
  const d = new Date(`${saleDate}T00:00:00`);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('d')) d.setDate(d.getDate() + n);
  else if (unit.startsWith('m')) d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  d.setDate(d.getDate() - 1);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** A barcode label for one accessory piece (same shape the label printer uses for phones). */
export const accLabel = (a, code) => ({ id: `acc-${a.accessoryId || a.id}-${code}`, brand: a.brand || '', model: a.name, variant: '', color: '', imei: code, sn: '', battery: null, warranty: a.warranty || '' });

/** Labels for the accessory lines of a bill: one per serial, or one per piece with the item code. */
export function accLabels(bill, accById) {
  const out = [];
  for (const l of accLines(bill)) {
    const a = accById.get(l.accessoryId) || l;
    const base = { ...l, warranty: a.warranty || l.warranty || '' };
    if ((l.serials || []).length) l.serials.forEach((s) => out.push(accLabel(base, s)));
    else for (let i = 0; i < lineQty(l); i += 1) out.push(accLabel(base, a.code || l.code));
  }
  return out.filter((x) => x.imei);
}
