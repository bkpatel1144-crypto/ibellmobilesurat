import {
  collection,
  doc,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { num, round2, cleanImei, deviceName, today } from './format';
import { billTotals, splitGst, spreadLines } from './gst';
import { returnTotals } from './returns';

export const CASH_ACCOUNT = 'cash';

const newRef = (coll) => doc(collection(db, coll));
// who did it - saved on every record (standard audit trail)
const who = () => auth?.currentUser?.email || '';
const stamp = () => ({ createdAt: serverTimestamp(), createdBy: who(), updatedAt: serverTimestamp(), updatedBy: who() });

/* ------------------------------------------------------------------ numbering */

/** Allocates the next document number from settings/counters; falls back to the
 *  highest number already on this device when offline (transactions need the server). */
async function nextNumber(kind, prefix, existing = []) {
  const ref = doc(db, 'settings', 'counters');
  let n;
  try {
    n = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const cur = num(snap.exists() ? snap.data()[kind] : 0);
      const localMax = maxNumber(existing, prefix);
      const next = Math.max(cur, localMax) + 1;
      tx.set(ref, { [kind]: next }, { merge: true });
      return next;
    });
  } catch {
    n = maxNumber(existing, prefix) + 1;
  }
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/** Reserves `count` device SNs (e.g. G-523, G-524…). The next number lives in
 *  settings/shop.snNext so the owner can change it from Settings. */
export async function allocateSerials(count, settings, devices = []) {
  if (!count) return [];
  const prefix = settings?.snPrefix ?? 'G-';
  const localMax = maxNumber(devices.map((d) => d.sn), prefix);
  const ref = doc(db, 'settings', 'shop');
  let start;
  try {
    start = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = Math.max(num(snap.exists() ? snap.data().snNext : 0) || 1, localMax + 1);
      tx.set(ref, { snNext: next + count }, { merge: true });
      return next;
    });
  } catch {
    start = Math.max(num(settings?.snNext) || 1, localMax + 1);
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${start + i}`);
}

/** Gives an SN to devices bought before SNs existed; returns the devices with their SN. */
export async function ensureSerials(list, settings, allDevices) {
  const missing = list.filter((d) => !d.sn);
  if (!missing.length) return list;
  const sns = await allocateSerials(missing.length, settings, allDevices);
  const batch = writeBatch(db);
  const given = new Map();
  missing.forEach((d, i) => {
    given.set(d.id, sns[i]);
    batch.update(doc(db, 'devices', d.id), { sn: sns[i], updatedAt: serverTimestamp(), updatedBy: who() });
  });
  await batch.commit();
  return list.map((d) => (given.has(d.id) ? { ...d, sn: given.get(d.id) } : d));
}

export function maxNumber(list, prefix) {
  let max = 0;
  for (const no of list) {
    if (typeof no === 'string' && no.startsWith(prefix)) {
      const v = parseInt(no.slice(prefix.length), 10);
      if (v > max) max = v;
    }
  }
  return max;
}

/* ------------------------------------------------------------------ attachments */

/** Writes pending attachments ({name,type,dataUrl}) and returns their ids.
 *  Already-saved ids (strings) pass through untouched. */
export async function saveAttachments(files = []) {
  const ids = [];
  for (const f of files) {
    if (typeof f === 'string') {
      ids.push(f);
      continue;
    }
    const ref = newRef('attachments');
    await setDoc(ref, { name: f.name, type: f.type, dataUrl: f.dataUrl, createdAt: serverTimestamp(), createdBy: who() });
    ids.push(ref.id);
  }
  return ids;
}

export const deleteAttachment = (id) => deleteDoc(doc(db, 'attachments', id));

/* ------------------------------------------------------------------ payments helper */

function paymentDoc({ direction, amount, date, mode, accountId, partyId, partyName, refType, refId, refNo, note, hidden, billId }) {
  return {
    direction, // 'in' | 'out'
    amount: round2(amount),
    date,
    mode: mode || 'Cash',
    accountId: accountId || CASH_ACCOUNT,
    partyId: partyId || null,
    partyName: partyName || '',
    refType: refType || 'manual',
    refId: refId || null,
    refNo: refNo || '',
    note: note || '',
    hidden: Boolean(hidden),
    ...(billId ? { billId } : {}), // refunds: the bill the return note is against
    ...stamp(),
  };
}

/* ------------------------------------------------------------------ activity log */

/** Activity entries are kept this many days, then deleted automatically. */
export const ACTIVITY_KEEP_DAYS = 180;

/**
 * Records who did what. Pass a batch to save it together with the change itself.
 * hidden / deviceIds let the private view hide entries about privately sold phones.
 */
export function logActivity({ action, entity, refId = null, refNo = '', amount = null, note = '', hidden = false, deviceIds = [] }, batch) {
  const ref = newRef('activity');
  const data = {
    at: serverTimestamp(),
    by: who().toLowerCase(),
    action,
    entity,
    refId,
    refNo: refNo || '',
    amount: amount === null || amount === undefined ? null : round2(amount),
    note: note || '',
    hidden: Boolean(hidden),
    deviceIds,
    expireAt: Timestamp.fromMillis(Date.now() + ACTIVITY_KEEP_DAYS * 86400000),
  };
  if (batch) batch.set(ref, data);
  else setDoc(ref, data).catch(() => {}); // a missing log entry must never block the real work
}

/* ------------------------------------------------------------------ purchases */

export async function createPurchase(form, { settings, purchases, devices = [] }) {
  const prefix = settings?.purchasePrefix || 'PUR-';
  const purchaseNo = await nextNumber('purchase', prefix, purchases.map((p) => p.purchaseNo));
  const sns = await allocateSerials(form.items.length, settings, devices);
  const saved = [];

  // upload ID proofs first (each is its own document, too big for one batch)
  const items = [];
  for (const it of form.items) {
    const idProofs = await saveAttachments(it.idFiles);
    items.push({ ...it, idProofs });
  }

  const batch = writeBatch(db);
  const pRef = newRef('purchases');
  const lines = [];

  for (const [i, it] of items.entries()) {
    const dRef = newRef('devices');
    const sendRepair = Boolean(it.repair?.send);
    const device = {
      sn: sns[i],
      battery: it.battery === '' || it.battery == null ? null : Math.min(100, Math.max(0, Math.round(num(it.battery)))),
      imei: cleanImei(it.imei),
      imei2: cleanImei(it.imei2),
      brand: it.brand.trim(),
      model: it.model.trim(),
      variant: (it.variant || '').trim(),
      color: (it.color || '').trim(),
      condition: it.condition || 'Used',
      warranty: (it.warranty || '').trim(),
      notes: (it.notes || '').trim(),
      purchaseId: pRef.id,
      purchaseNo,
      purchaseDate: form.date,
      supplierId: form.partyId,
      supplierName: form.partyName,
      purchasePrice: round2(it.price),
      repairCost: 0,
      status: sendRepair ? 'in_repair' : 'in_stock',
      sellerIdType: it.idType || '',
      sellerIdNumber: (it.idNumber || '').trim(),
      sellerIdProofs: it.idProofs,
      hidden: false,
      ...stamp(),
    };
    batch.set(dRef, device);
    saved.push({ id: dRef.id, ...device });
    lines.push({
      deviceId: dRef.id,
      sn: device.sn,
      battery: device.battery,
      imei: device.imei,
      imei2: device.imei2,
      brand: device.brand,
      model: device.model,
      variant: device.variant,
      color: device.color,
      condition: device.condition,
      price: device.purchasePrice,
      idProofs: it.idProofs,
      idType: device.sellerIdType,
      idNumber: device.sellerIdNumber,
    });

    if (sendRepair) {
      batch.set(newRef('repairs'), {
        deviceId: dRef.id,
        imei: device.imei,
        deviceName: [device.brand, device.model, device.variant].filter(Boolean).join(' '),
        partyId: it.repair.partyId || null,
        partyName: it.repair.partyName || '',
        repairer: (it.repair.repairer || '').trim(),
        issue: (it.repair.issue || '').trim(),
        sentDate: form.date,
        status: 'in_repair',
        cost: 0,
        hidden: false,
        ...stamp(),
      });
    }
  }

  const subtotal = round2(lines.reduce((s, l) => s + num(l.price), 0));
  const total = round2(subtotal + num(form.otherCharges) - num(form.discount));
  const paid = round2(Math.min(num(form.paid), total));

  batch.set(pRef, {
    purchaseNo,
    supplierBillNo: (form.billNo || '').trim(),
    date: form.date,
    partyId: form.partyId,
    partyName: form.partyName,
    items: lines,
    subtotal,
    otherCharges: round2(form.otherCharges),
    discount: round2(form.discount),
    total,
    paid,
    mode: form.mode,
    accountId: form.accountId,
    notes: (form.notes || '').trim(),
    ...stamp(),
  });

  if (paid > 0) {
    batch.set(
      newRef('payments'),
      paymentDoc({
        direction: 'out',
        amount: paid,
        date: form.date,
        mode: form.mode,
        accountId: form.accountId,
        partyId: form.partyId,
        partyName: form.partyName,
        refType: 'purchase',
        refId: pRef.id,
        refNo: purchaseNo,
        note: `Paid against ${purchaseNo}`,
      }),
    );
  }

  logActivity(
    { action: 'create', entity: 'purchase', refId: pRef.id, refNo: purchaseNo, amount: total, note: `${lines.length} device(s) from ${form.partyName}`, deviceIds: lines.map((l) => l.deviceId) },
    batch,
  );
  await batch.commit();
  return { id: pRef.id, purchaseNo, devices: saved };
}

export async function deletePurchase(purchase, { devices, repairs, payments }) {
  const ids = new Set(purchase.items.map((i) => i.deviceId));
  const sold = devices.filter((d) => ids.has(d.id) && d.status === 'sold');
  if (sold.length) {
    throw new Error('Cannot delete: phones from this purchase are already sold. Delete those bills first, or edit the purchase instead.');
  }
  if (devices.some((d) => ids.has(d.id) && d.status === 'returned')) {
    throw new Error('Cannot delete: phones from this purchase were returned to the supplier. Delete that debit note first.');
  }
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, 'devices', id)));
  repairs.filter((r) => ids.has(r.deviceId)).forEach((r) => batch.delete(doc(db, 'repairs', r.id)));
  payments
    .filter((p) => p.refType === 'purchase' && p.refId === purchase.id)
    .forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  batch.delete(doc(db, 'purchases', purchase.id));
  logActivity(
    { action: 'delete', entity: 'purchase', refId: purchase.id, refNo: purchase.purchaseNo, amount: purchase.total, note: purchase.partyName, deviceIds: [...ids] },
    batch,
  );
  await batch.commit();
}

/** A sold phone's cost changed (purchase price or repair) → keep that bill's cost and profit right. */
function resyncSaleCosts(batch, sales, costs /* Map deviceId → new total cost */) {
  if (!costs.size) return;
  for (const s of sales) {
    if (!s.items?.some((i) => costs.has(i.deviceId))) continue;
    const items = s.items.map((i) => (costs.has(i.deviceId) ? { ...i, cost: round2(costs.get(i.deviceId)) } : i));
    const cost = round2(items.reduce((t, i) => t + num(i.cost), 0));
    const taxable = s.taxable ?? round2(num(s.total) - num(s.tax));
    batch.update(doc(db, 'sales', s.id), { items, cost, profit: round2(taxable - cost), updatedAt: serverTimestamp(), updatedBy: who() });
  }
}

const deviceFields = (it, form) => ({
  imei: cleanImei(it.imei),
  imei2: cleanImei(it.imei2),
  brand: it.brand.trim(),
  model: it.model.trim(),
  variant: (it.variant || '').trim(),
  color: (it.color || '').trim(),
  condition: it.condition || 'Used',
  warranty: (it.warranty || '').trim(),
  battery: it.battery === '' || it.battery == null ? null : Math.min(100, Math.max(0, Math.round(num(it.battery)))),
  notes: (it.notes || '').trim(),
  purchasePrice: round2(it.price),
  purchaseDate: form.date,
  supplierId: form.partyId,
  supplierName: form.partyName,
  sellerIdType: it.idType || '',
  sellerIdNumber: (it.idNumber || '').trim(),
});

/**
 * Edits a purchase: header, every device's details, add new phones, remove phones still in stock.
 * Privately sold phones (hidden while locked) are never shown in the form - they are kept untouched.
 */
export async function updatePurchase(purchase, form, { settings, devices, sales, repairs, payments }) {
  const devMap = new Map(devices.map((d) => [d.id, d]));
  const inForm = new Set(form.items.filter((i) => i.deviceId).map((i) => i.deviceId));
  const kept = [];
  const removed = [];
  for (const line of purchase.items) {
    if (inForm.has(line.deviceId)) continue;
    if (devMap.get(line.deviceId)?.hidden) kept.push(line);
    else removed.push(line);
  }
  for (const line of removed) {
    const d = devMap.get(line.deviceId);
    if (d && d.status !== 'in_stock') {
      throw new Error(`${line.brand} ${line.model} (${line.imei}) is ${{ sold: 'already sold', returned: 'returned to the supplier' }[d.status] || 'at repair'} - it can't be removed from this purchase.`);
    }
  }
  if (!form.items.length && !kept.length) throw new Error('A purchase needs at least one device. Delete the purchase instead.');

  const added = form.items.filter((i) => !i.deviceId);
  const sns = await allocateSerials(added.length, settings, devices);
  const batch = writeBatch(db);
  const lines = [];
  const costs = new Map();
  let n = 0;

  for (const it of form.items) {
    const idProofs = await saveAttachments(it.idFiles);
    const fields = { ...deviceFields(it, form), sellerIdProofs: idProofs };
    let deviceId = it.deviceId;
    let sn;
    if (deviceId) {
      const d = devMap.get(deviceId);
      sn = d?.sn || '';
      batch.update(doc(db, 'devices', deviceId), { ...fields, updatedAt: serverTimestamp(), updatedBy: who() });
      if (d?.status === 'sold' && round2(d.purchasePrice) !== fields.purchasePrice) costs.set(deviceId, fields.purchasePrice + num(d.repairCost));
    } else {
      const dRef = newRef('devices');
      deviceId = dRef.id;
      sn = sns[n];
      n += 1;
      const sendRepair = Boolean(it.repair?.send);
      batch.set(dRef, { ...fields, sn, purchaseId: purchase.id, purchaseNo: purchase.purchaseNo, repairCost: 0, status: sendRepair ? 'in_repair' : 'in_stock', hidden: false, ...stamp() });
      if (sendRepair) {
        batch.set(newRef('repairs'), {
          deviceId,
          imei: fields.imei,
          deviceName: [fields.brand, fields.model, fields.variant].filter(Boolean).join(' '),
          partyId: it.repair.partyId || null,
          partyName: it.repair.partyName || '',
          repairer: (it.repair.repairer || '').trim(),
          issue: (it.repair.issue || '').trim(),
          sentDate: form.date,
          status: 'in_repair',
          cost: 0,
          hidden: false,
          ...stamp(),
        });
      }
    }
    lines.push({
      deviceId,
      sn,
      battery: fields.battery,
      imei: fields.imei,
      imei2: fields.imei2,
      brand: fields.brand,
      model: fields.model,
      variant: fields.variant,
      color: fields.color,
      condition: fields.condition,
      price: fields.purchasePrice,
      idProofs,
      idType: fields.sellerIdType,
      idNumber: fields.sellerIdNumber,
    });
  }

  for (const line of removed) {
    batch.delete(doc(db, 'devices', line.deviceId));
    repairs.filter((r) => r.deviceId === line.deviceId).forEach((r) => batch.delete(doc(db, 'repairs', r.id)));
  }

  const all = [...lines, ...kept];
  const subtotal = round2(all.reduce((s, l) => s + num(l.price), 0));
  const total = round2(subtotal + num(form.otherCharges) - num(form.discount));
  batch.update(doc(db, 'purchases', purchase.id), {
    supplierBillNo: (form.billNo || '').trim(),
    date: form.date,
    partyId: form.partyId,
    partyName: form.partyName,
    items: all,
    subtotal,
    otherCharges: round2(form.otherCharges),
    discount: round2(form.discount),
    total,
    notes: (form.notes || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
  if (form.partyId !== purchase.partyId) {
    payments
      .filter((p) => p.refType === 'purchase' && p.refId === purchase.id)
      .forEach((p) => batch.update(doc(db, 'payments', p.id), { partyId: form.partyId, partyName: form.partyName }));
  }
  resyncSaleCosts(batch, sales, costs);
  logActivity(
    {
      action: 'update',
      entity: 'purchase',
      refId: purchase.id,
      refNo: purchase.purchaseNo,
      amount: total,
      note: [`${lines.length} device(s)`, added.length && `${added.length} added`, removed.length && `${removed.length} removed`].filter(Boolean).join(' · '),
      deviceIds: lines.map((l) => l.deviceId),
    },
    batch,
  );
  await batch.commit();
}

/** Removes one phone that is still in stock from its purchase (the purchase total drops by its price). */
export async function deleteDevice(device, purchase, repairs) {
  if (device.status !== 'in_stock') throw new Error('Only a phone that is in stock can be deleted.');
  if (!purchase || purchase.items.length <= 1) throw new Error('This is the only phone in its purchase - delete the purchase instead.');
  const line = purchase.items.find((i) => i.deviceId === device.id);
  const price = num(line?.price);
  const batch = writeBatch(db);
  batch.update(doc(db, 'purchases', purchase.id), {
    items: purchase.items.filter((i) => i.deviceId !== device.id),
    subtotal: round2(num(purchase.subtotal) - price),
    total: round2(num(purchase.total) - price),
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
  batch.delete(doc(db, 'devices', device.id));
  repairs.filter((r) => r.deviceId === device.id).forEach((r) => batch.delete(doc(db, 'repairs', r.id)));
  logActivity(
    { action: 'delete', entity: 'device', refId: device.id, refNo: device.imei, amount: price, note: `${deviceName(device)} removed from ${purchase.purchaseNo}`, deviceIds: [device.id] },
    batch,
  );
  await batch.commit();
}

/* ------------------------------------------------------------------ sales */

export async function createSale(form, { settings, sales, devices }) {
  const hidden = Boolean(form.hidden);
  const prefix = hidden ? settings?.cashInvoicePrefix || 'CS-' : settings?.invoicePrefix || 'INV-';
  const kind = hidden ? 'cashSale' : 'sale';
  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  for (const it of form.items) {
    const d = deviceMap.get(it.deviceId);
    if (!d) throw new Error('A selected device no longer exists.');
    if (d.status !== 'in_stock') throw new Error(`${d.brand} ${d.model} (${d.imei}) is not in stock.`);
  }

  const invoiceNo = await nextNumber(kind, prefix, sales.map((s) => s.invoiceNo));

  const items = [];
  for (const it of form.items) {
    const d = deviceMap.get(it.deviceId);
    const buyerIdProofs = await saveAttachments(it.idFiles);
    items.push({
      deviceId: d.id,
      sn: d.sn || '',
      battery: d.battery ?? null,
      imei: d.imei,
      imei2: d.imei2 || '',
      brand: d.brand,
      model: d.model,
      variant: d.variant || '',
      color: d.color || '',
      condition: d.condition,
      price: round2(it.price),
      cost: round2(num(d.purchasePrice) + num(d.repairCost)),
      warranty: (it.warranty || '').trim(),
      hsn: d.hsn || settings?.hsnDefault || '8517',
      buyerIdType: it.idType || '',
      buyerIdNumber: (it.idNumber || '').trim(),
      buyerIdProofs,
    });
  }

  // GST: the form passes the rate it shows (0 for a cash bill when GST is "bank payments only")
  const subtotal = round2(items.reduce((s, i) => s + i.price, 0));
  const rate = num(form.taxPercent);
  const inclusive = rate > 0 && settings?.gstInclusive !== false;
  const { taxable, tax, total } = billTotals({ subtotal, discount: form.discount, rate, inclusive });
  const customerGstin = (form.customerGstin || '').trim().toUpperCase();
  const split = splitGst(tax, settings?.gstin, customerGstin);
  spreadLines(items.map((i) => i.price), { discount: form.discount, taxable, tax }).forEach((l, n) => {
    items[n].taxable = l.taxable;
    items[n].gst = l.tax;
  });
  const received = round2(Math.min(num(form.received), total));
  const cost = round2(items.reduce((s, i) => s + i.cost, 0));

  if (received < total && !form.partyId) {
    throw new Error('Select a party to sell on credit (amount received is less than total).');
  }

  const batch = writeBatch(db);
  const sRef = newRef('sales');
  const saleData = {
    invoiceNo,
    date: form.date,
    partyId: form.partyId || null,
    customerName: (form.customerName || '').trim() || 'Walk-in Customer',
    customerPhone: (form.customerPhone || '').trim(),
    customerAddress: (form.customerAddress || '').trim(),
    items,
    subtotal,
    discount: round2(form.discount),
    taxPercent: rate,
    gst: rate > 0, // a tax invoice
    gstInclusive: inclusive,
    taxable,
    tax,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    customerGstin,
    placeOfSupply: rate > 0 ? split.placeOfSupply : '',
    total,
    received,
    cost,
    profit: round2(taxable - cost),
    mode: form.mode,
    accountId: form.accountId,
    notes: (form.notes || '').trim(),
    hidden,
  };
  batch.set(sRef, { ...saleData, ...stamp() });

  for (const it of items) {
    batch.update(doc(db, 'devices', it.deviceId), {
      status: 'sold',
      saleId: sRef.id,
      saleNo: invoiceNo,
      saleDate: form.date,
      salePrice: it.price,
      buyerId: form.partyId || null,
      buyerName: (form.customerName || '').trim() || 'Walk-in Customer',
      buyerPhone: (form.customerPhone || '').trim(),
      hidden,
      updatedAt: serverTimestamp(), updatedBy: who(),
    });
  }

  if (received > 0) {
    batch.set(
      newRef('payments'),
      paymentDoc({
        direction: 'in',
        amount: received,
        date: form.date,
        mode: form.mode,
        accountId: form.accountId,
        partyId: form.partyId,
        partyName: (form.customerName || '').trim() || 'Walk-in Customer',
        refType: 'sale',
        refId: sRef.id,
        refNo: invoiceNo,
        note: `Received against ${invoiceNo}`,
        hidden,
      }),
    );
  }

  logActivity(
    { action: 'create', entity: 'sale', refId: sRef.id, refNo: invoiceNo, amount: total, note: `${items.length} device(s) to ${saleData.customerName}${tax ? ` · GST ${rate}%` : ''}`, hidden, deviceIds: items.map((i) => i.deviceId) },
    batch,
  );
  await batch.commit();
  return { id: sRef.id, invoiceNo, sale: { id: sRef.id, ...saleData } };
}

export async function deleteSale(sale, { payments, returns = [] }) {
  const notes = returns.filter((x) => x.kind === 'sale' && x.billId === sale.id);
  if (notes.length) throw new Error(`This bill has returns (${notes.map((x) => x.returnNo).join(', ')}). Delete those first.`);
  const batch = writeBatch(db);
  for (const it of sale.items) {
    batch.update(doc(db, 'devices', it.deviceId), {
      status: 'in_stock',
      saleId: null,
      saleNo: null,
      saleDate: null,
      salePrice: null,
      buyerId: null,
      buyerName: null,
      buyerPhone: null,
      hidden: false,
      updatedAt: serverTimestamp(), updatedBy: who(),
    });
  }
  payments
    .filter((p) => p.refType === 'sale' && p.refId === sale.id)
    .forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  batch.delete(doc(db, 'sales', sale.id));
  logActivity(
    { action: 'delete', entity: 'sale', refId: sale.id, refNo: sale.invoiceNo, amount: sale.total, note: `${sale.customerName} · devices back in stock`, hidden: sale.hidden, deviceIds: sale.items.map((i) => i.deviceId) },
    batch,
  );
  await batch.commit();
}

/** Owner-only: move a sale in or out of the private (hidden) view */
export async function setSaleHidden(sale, hidden, { payments, devices = [], returns = [] }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'sales', sale.id), { hidden, updatedAt: serverTimestamp(), updatedBy: who() });
  // only the phones still sold on this bill - a returned phone is back in (visible) stock
  const onBill = new Set(devices.filter((d) => d.saleId === sale.id).map((d) => d.id));
  sale.items.forEach((it) => (!devices.length || onBill.has(it.deviceId)) && batch.update(doc(db, 'devices', it.deviceId), { hidden }));
  payments
    .filter((p) => (p.refType === 'sale' && p.refId === sale.id) || p.billId === sale.id)
    .forEach((p) => batch.update(doc(db, 'payments', p.id), { hidden }));
  returns.filter((x) => x.kind === 'sale' && x.billId === sale.id).forEach((x) => batch.update(doc(db, 'returns', x.id), { hidden }));
  // only visible in the private view
  logActivity({ action: hidden ? 'private' : 'public', entity: 'sale', refId: sale.id, refNo: sale.invoiceNo, amount: sale.total, hidden: true }, batch);
  await batch.commit();
}

/**
 * Edits a bill: customer, date, each phone's price / warranty / buyer ID proof, discount and GST.
 * The phones on the bill stay the same (to change phones, delete the bill and make a new one).
 */
export async function updateSale(sale, form, { settings, payments, devices = null }) {
  // phones that came back on a credit note are no longer on this bill - leave them alone
  const onBill = devices ? new Set(devices.filter((d) => d.saleId === sale.id).map((d) => d.id)) : null;
  const byDevice = new Map(form.items.map((i) => [i.deviceId, i]));
  const items = [];
  for (const it of sale.items) {
    const f = byDevice.get(it.deviceId) || {};
    const buyerIdProofs = await saveAttachments(f.idFiles ?? it.buyerIdProofs ?? []);
    items.push({
      ...it,
      price: round2(f.price ?? it.price),
      warranty: (f.warranty ?? it.warranty ?? '').trim(),
      buyerIdType: f.idType ?? it.buyerIdType ?? '',
      buyerIdNumber: (f.idNumber ?? it.buyerIdNumber ?? '').trim(),
      buyerIdProofs,
    });
  }
  const subtotal = round2(items.reduce((s, i) => s + i.price, 0));
  const rate = num(form.taxPercent);
  const inclusive = rate > 0 && (sale.tax > 0 ? sale.gstInclusive !== false : settings?.gstInclusive !== false);
  const { taxable, tax, total } = billTotals({ subtotal, discount: form.discount, rate, inclusive });
  const customerGstin = (form.customerGstin || '').trim().toUpperCase();
  const split = splitGst(tax, settings?.gstin, customerGstin);
  spreadLines(items.map((i) => i.price), { taxable, tax }).forEach((l, n) => {
    items[n].taxable = l.taxable;
    items[n].gst = l.tax;
  });
  const linked = payments.filter((p) => p.refType === 'sale' && p.refId === sale.id);
  const received = round2(linked.reduce((s, p) => s + num(p.amount), 0));
  if (received < total - 0.004 && !form.partyId) throw new Error('Amount received is less than the new total. Select a party so the balance is on their account.');
  const cost = round2(items.reduce((s, i) => s + num(i.cost), 0));
  const customerName = (form.customerName || '').trim() || 'Walk-in Customer';

  const batch = writeBatch(db);
  batch.update(doc(db, 'sales', sale.id), {
    date: form.date,
    partyId: form.partyId || null,
    customerName,
    customerPhone: (form.customerPhone || '').trim(),
    customerAddress: (form.customerAddress || '').trim(),
    customerGstin,
    items,
    subtotal,
    discount: round2(form.discount),
    taxPercent: rate,
    gst: rate > 0,
    gstInclusive: inclusive,
    taxable,
    tax,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    placeOfSupply: rate > 0 ? split.placeOfSupply : '',
    total,
    cost,
    profit: round2(taxable - cost),
    notes: (form.notes || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
  for (const it of items) {
    if (onBill && !onBill.has(it.deviceId)) continue;
    batch.update(doc(db, 'devices', it.deviceId), {
      salePrice: it.price,
      saleDate: form.date,
      buyerId: form.partyId || null,
      buyerName: customerName,
      buyerPhone: (form.customerPhone || '').trim(),
      updatedAt: serverTimestamp(),
      updatedBy: who(),
    });
  }
  if ((form.partyId || null) !== (sale.partyId || null) || customerName !== sale.customerName) {
    linked.forEach((p) => batch.update(doc(db, 'payments', p.id), { partyId: form.partyId || null, partyName: customerName }));
  }
  logActivity(
    { action: 'update', entity: 'sale', refId: sale.id, refNo: sale.invoiceNo, amount: total, note: `${customerName}${tax ? ` · GST ${rate}%` : ''}`, hidden: sale.hidden, deviceIds: items.map((i) => i.deviceId) },
    batch,
  );
  await batch.commit();
}

/* ------------------------------------------------------------------ returns (credit / debit notes) */

const RETURN_REF = { sale: 'saleReturn', purchase: 'purchaseReturn' };

/** The note's lines from the bill lines + the values typed on the form. */
function noteLines(kind, bill, values, devMap) {
  return bill.items
    .filter((it) => values.has(it.deviceId))
    .map((it) => {
      const d = devMap.get(it.deviceId) || {};
      return {
        deviceId: it.deviceId,
        sn: d.sn || it.sn || '',
        imei: it.imei,
        imei2: it.imei2 || '',
        brand: it.brand,
        model: it.model,
        variant: it.variant || '',
        color: it.color || '',
        condition: it.condition || '',
        hsn: it.hsn || '',
        price: num(it.price),
        taxable: it.taxable ?? null,
        gst: it.gst ?? null,
        // sales: the cost goes back into stock · purchases: what the phone cost us (price + repairs)
        cost: kind === 'sale' ? num(it.cost) : round2(num(d.purchasePrice ?? it.price) + num(d.repairCost)),
        value: num(values.get(it.deviceId)),
      };
    });
}

/**
 * Makes a Credit Note (sales return) or Debit Note (purchase return) for some or all phones of a bill.
 *   form: { date, reason, notes, values: Map(deviceId → amount credited), refund, mode, accountId }
 */
export async function createReturn(kind, bill, form, { settings, returns, devices }) {
  const devMap = new Map(devices.map((d) => [d.id, d]));
  if (!form.values.size) throw new Error('Tick at least one phone to return.');
  for (const id of form.values.keys()) {
    const d = devMap.get(id);
    const ok = kind === 'sale' ? d?.status === 'sold' && d.saleId === bill.id : d?.status === 'in_stock' && d.purchaseId === bill.id;
    if (!ok) {
      const name = d ? `${deviceName(d)} (${d.imei})` : 'A phone';
      throw new Error(kind === 'sale' ? `${name} is no longer sold on this bill.` : `${name} is not in stock - only phones in stock can go back to the supplier.`);
    }
    if (!(num(form.values.get(id)) > 0)) throw new Error('Every returned phone needs an amount more than 0.');
  }
  const t = returnTotals(kind, bill, noteLines(kind, bill, form.values, devMap));
  if (kind === 'sale') {
    const over = t.items.find((i) => i.value > i.billed + 0.004);
    if (over) throw new Error(`${over.brand} ${over.model}: the return amount can't be more than its bill value (${round2(over.billed)}).`);
  }
  const refund = round2(Math.min(Math.max(num(form.refund), 0), t.total));
  const partyId = bill.partyId || null;
  if (kind === 'sale' && !partyId && refund < t.total - 0.004) {
    throw new Error('Walk-in customer: refund the full amount (there is no account to keep a balance). Or link the bill to a party first.');
  }

  const hidden = kind === 'sale' && Boolean(bill.hidden);
  const prefix = kind === 'purchase' ? settings?.purchaseReturnPrefix || 'DN-' : hidden ? settings?.cashReturnPrefix || 'CR-' : settings?.saleReturnPrefix || 'CN-';
  const counter = kind === 'purchase' ? 'purchaseReturn' : hidden ? 'cashSaleReturn' : 'saleReturn';
  const returnNo = await nextNumber(counter, prefix, returns.map((x) => x.returnNo));
  const partyName = kind === 'sale' ? bill.customerName : bill.partyName;

  const batch = writeBatch(db);
  const ref = newRef('returns');
  batch.set(ref, {
    kind,
    returnNo,
    date: form.date,
    reason: form.reason || '',
    notes: (form.notes || '').trim(),
    billId: bill.id,
    billNo: kind === 'sale' ? bill.invoiceNo : bill.purchaseNo,
    billDate: bill.date,
    partyId,
    partyName,
    partyPhone: kind === 'sale' ? bill.customerPhone || '' : '',
    customerGstin: kind === 'sale' ? bill.customerGstin || '' : '',
    placeOfSupply: kind === 'sale' ? bill.placeOfSupply || '' : '',
    taxPercent: kind === 'sale' ? num(bill.taxPercent) : 0,
    ...t,
    hidden,
    ...stamp(),
  });

  for (const it of t.items) {
    batch.update(
      doc(db, 'devices', it.deviceId),
      kind === 'sale'
        ? { status: 'in_stock', saleId: null, saleNo: null, saleDate: null, salePrice: null, buyerId: null, buyerName: null, buyerPhone: null, hidden: false, returnId: ref.id, returnNo, updatedAt: serverTimestamp(), updatedBy: who() }
        : { status: 'returned', returnId: ref.id, returnNo, returnDate: form.date, updatedAt: serverTimestamp(), updatedBy: who() },
    );
  }

  if (refund > 0) {
    batch.set(
      newRef('payments'),
      paymentDoc({
        direction: kind === 'sale' ? 'out' : 'in',
        amount: refund,
        date: form.date,
        mode: form.mode,
        accountId: form.accountId,
        partyId,
        partyName,
        refType: RETURN_REF[kind],
        refId: ref.id,
        refNo: returnNo,
        billId: bill.id,
        note: kind === 'sale' ? `Refund for ${returnNo}` : `Refund received for ${returnNo}`,
        hidden,
      }),
    );
  }

  logActivity(
    { action: 'create', entity: 'return', refId: ref.id, refNo: returnNo, amount: t.total, note: `${t.items.length} device(s) · against ${kind === 'sale' ? bill.invoiceNo : bill.purchaseNo}`, hidden, deviceIds: t.items.map((i) => i.deviceId) },
    batch,
  );
  await batch.commit();
  return { id: ref.id, returnNo };
}

/**
 * Edits a note: date, reason, notes and the amount per phone (the phones on it stay - delete the note to change them).
 * A walk-in refund follows the new total; for a party, extra or missing refund stays on their account.
 */
export async function updateReturn(note, form, { bill, payments }) {
  if (note.kind === 'sale' && !bill) throw new Error(`Bill ${note.billNo} no longer exists.`);
  // saved lines hold the returned GST; the bill's own line numbers are needed to work it out again
  const lines = note.items.map((i) => {
    const b = note.kind === 'sale' ? bill.items.find((x) => x.deviceId === i.deviceId) : null;
    const base = b ? { ...i, price: num(b.price), taxable: b.taxable ?? null, gst: b.gst ?? null } : i;
    return { ...base, value: num(form.values.get(i.deviceId) ?? i.value) };
  });
  if (lines.some((l) => !(l.value > 0))) throw new Error('Every returned phone needs an amount more than 0.');
  const t = returnTotals(note.kind, bill || note, lines);
  if (note.kind === 'sale') {
    const over = t.items.find((i) => i.billed != null && i.value > i.billed + 0.004);
    if (over) throw new Error(`${over.brand} ${over.model}: the return amount can't be more than its bill value (${round2(over.billed)}).`);
  }
  const refunds = payments.filter((p) => p.refType === RETURN_REF[note.kind] && p.refId === note.id);
  const batch = writeBatch(db);
  if (note.kind === 'sale' && !note.partyId) {
    if (refunds.length > 1) throw new Error('This walk-in return has more than one refund. Change them on the Payments page first.');
    if (refunds[0]) batch.update(doc(db, 'payments', refunds[0].id), { amount: t.total, date: form.date, updatedAt: serverTimestamp(), updatedBy: who() });
  }
  batch.update(doc(db, 'returns', note.id), {
    date: form.date,
    reason: form.reason || '',
    notes: (form.notes || '').trim(),
    ...t,
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
  logActivity({ action: 'update', entity: 'return', refId: note.id, refNo: note.returnNo, amount: t.total, note: `against ${note.billNo}`, hidden: note.hidden, deviceIds: t.items.map((i) => i.deviceId) }, batch);
  await batch.commit();
}

/** Cancels a note: the phones go back to how they were (sold on the bill / in stock) and its refunds are removed. */
export async function deleteReturn(note, { devices, sales, payments }) {
  const devMap = new Map(devices.map((d) => [d.id, d]));
  const batch = writeBatch(db);
  if (note.kind === 'sale') {
    const sale = sales.find((s) => s.id === note.billId);
    if (!sale) throw new Error(`Bill ${note.billNo} no longer exists.`);
    for (const it of note.items) {
      const d = devMap.get(it.deviceId);
      if (!d || d.status !== 'in_stock') {
        const where = !d ? 'deleted' : d.status === 'sold' ? `sold again on ${d.saleNo}` : d.status === 'returned' ? 'returned to the supplier' : 'at repair';
        throw new Error(`${it.brand} ${it.model} (${it.imei}) is ${where} - this return can't be cancelled.`);
      }
      const line = sale.items.find((i) => i.deviceId === it.deviceId);
      batch.update(doc(db, 'devices', it.deviceId), {
        status: 'sold',
        saleId: sale.id,
        saleNo: sale.invoiceNo,
        saleDate: sale.date,
        salePrice: num(line?.price ?? it.price),
        buyerId: sale.partyId || null,
        buyerName: sale.customerName,
        buyerPhone: sale.customerPhone || '',
        hidden: Boolean(sale.hidden),
        returnId: null,
        returnNo: null,
        updatedAt: serverTimestamp(),
        updatedBy: who(),
      });
    }
  } else {
    for (const it of note.items) {
      const d = devMap.get(it.deviceId);
      if (!d || d.status !== 'returned' || d.returnId !== note.id) throw new Error(`${it.brand} ${it.model} (${it.imei}) has changed since it was returned - this note can't be cancelled.`);
      batch.update(doc(db, 'devices', it.deviceId), { status: 'in_stock', returnId: null, returnNo: null, returnDate: null, updatedAt: serverTimestamp(), updatedBy: who() });
    }
  }
  payments.filter((p) => p.refType === RETURN_REF[note.kind] && p.refId === note.id).forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  batch.delete(doc(db, 'returns', note.id));
  logActivity({ action: 'delete', entity: 'return', refId: note.id, refNo: note.returnNo, amount: note.total, note: `against ${note.billNo}`, hidden: note.hidden, deviceIds: note.items.map((i) => i.deviceId) }, batch);
  await batch.commit();
}

/* ------------------------------------------------------------------ devices */

export async function updateDevice(id, data, label = '') {
  await updateDoc(doc(db, 'devices', id), { ...data, updatedAt: serverTimestamp(), updatedBy: who() });
  logActivity({ action: 'update', entity: 'device', refId: id, refNo: label, note: Object.keys(data).join(', '), deviceIds: [id] });
}

/* ------------------------------------------------------------------ repairs */

export async function sendToRepair({ device, partyId, partyName, repairer, issue, date }) {
  const batch = writeBatch(db);
  batch.set(newRef('repairs'), {
    deviceId: device.id,
    imei: device.imei,
    deviceName: [device.brand, device.model, device.variant].filter(Boolean).join(' '),
    partyId: partyId || null,
    partyName: partyName || '',
    repairer: (repairer || '').trim(),
    issue: (issue || '').trim(),
    sentDate: date,
    status: 'in_repair',
    cost: 0,
    hidden: false,
    ...stamp(),
  });
  batch.update(doc(db, 'devices', device.id), { status: 'in_repair', updatedAt: serverTimestamp(), updatedBy: who() });
  logActivity({ action: 'repair-sent', entity: 'repair', refNo: device.imei, note: `${deviceName(device)} → ${partyName || repairer || 'repairer'}`, deviceIds: [device.id] }, batch);
  await batch.commit();
}

export async function completeRepair(repair, { cost, date, notes, paid, mode, accountId }) {
  const batch = writeBatch(db);
  const c = round2(cost);
  const p = round2(Math.min(num(paid), c));
  batch.update(doc(db, 'repairs', repair.id), {
    status: 'done',
    cost: c,
    doneDate: date,
    doneNotes: (notes || '').trim(),
    paid: p,
    updatedAt: serverTimestamp(), updatedBy: who(),
  });
  batch.update(doc(db, 'devices', repair.deviceId), {
    status: 'in_stock',
    repairCost: increment(c),
    updatedAt: serverTimestamp(), updatedBy: who(),
  });
  if (p > 0) {
    batch.set(
      newRef('payments'),
      paymentDoc({
        direction: 'out',
        amount: p,
        date,
        mode,
        accountId,
        partyId: repair.partyId,
        partyName: repair.partyName || repair.repairer,
        refType: 'repair',
        refId: repair.id,
        refNo: repair.imei,
        note: `Repair: ${repair.deviceName}`,
      }),
    );
  }
  logActivity({ action: 'repair-done', entity: 'repair', refId: repair.id, refNo: repair.imei, amount: c, note: repair.deviceName, deviceIds: [repair.deviceId] }, batch);
  await batch.commit();
}

export async function cancelRepair(repair) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'repairs', repair.id));
  batch.update(doc(db, 'devices', repair.deviceId), { status: 'in_stock', updatedAt: serverTimestamp(), updatedBy: who() });
  logActivity({ action: 'delete', entity: 'repair', refId: repair.id, refNo: repair.imei, note: `${repair.deviceName} · repair cancelled`, deviceIds: [repair.deviceId] }, batch);
  await batch.commit();
}

/**
 * Edits a repair. For a finished repair a cost change moves the phone's cost by the difference
 * (and the bill's profit, if the phone is already sold). Payments to the repairer are edited on Payments.
 */
export async function updateRepair(repair, form, { devices, sales, payments = [] }) {
  const batch = writeBatch(db);
  const data = {
    partyId: form.partyId || null,
    partyName: form.partyName || '',
    repairer: (form.repairer || '').trim(),
    issue: (form.issue || '').trim(),
    sentDate: form.sentDate,
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  };
  const costs = new Map();
  if (repair.status === 'done') {
    const cost = round2(form.cost);
    const delta = round2(cost - num(repair.cost));
    Object.assign(data, { cost, doneDate: form.doneDate, doneNotes: (form.doneNotes || '').trim() });
    if (delta) {
      batch.update(doc(db, 'devices', repair.deviceId), { repairCost: increment(delta), updatedAt: serverTimestamp(), updatedBy: who() });
      const d = devices.find((x) => x.id === repair.deviceId);
      if (d?.status === 'sold') costs.set(d.id, num(d.purchasePrice) + num(d.repairCost) + delta);
    }
  }
  batch.update(doc(db, 'repairs', repair.id), data);
  // payments to the repairer follow the repair: new party, and (with no party ledger) the new cost
  const linked = payments.filter((p) => p.refType === 'repair' && p.refId === repair.id);
  for (const p of linked) {
    const patch = { partyId: data.partyId, partyName: data.partyName || data.repairer, updatedAt: serverTimestamp(), updatedBy: who() };
    if (!data.partyId && linked.length === 1 && data.cost != null) patch.amount = data.cost;
    batch.update(doc(db, 'payments', p.id), patch);
  }
  resyncSaleCosts(batch, sales, costs);
  logActivity({ action: 'update', entity: 'repair', refId: repair.id, refNo: repair.imei, amount: data.cost ?? null, note: repair.deviceName, deviceIds: [repair.deviceId] }, batch);
  await batch.commit();
}

/** Deletes a repair. A finished one also takes its cost off the phone (and the bill, if sold) and removes its payments. */
export async function deleteRepair(repair, { devices, sales, payments }) {
  if (repair.status !== 'done') return cancelRepair(repair);
  const batch = writeBatch(db);
  const cost = num(repair.cost);
  batch.delete(doc(db, 'repairs', repair.id));
  const d = devices.find((x) => x.id === repair.deviceId);
  if (d && cost) {
    batch.update(doc(db, 'devices', d.id), { repairCost: increment(-cost), updatedAt: serverTimestamp(), updatedBy: who() });
    if (d.status === 'sold') resyncSaleCosts(batch, sales, new Map([[d.id, num(d.purchasePrice) + num(d.repairCost) - cost]]));
  }
  payments.filter((p) => p.refType === 'repair' && p.refId === repair.id).forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  logActivity({ action: 'delete', entity: 'repair', refId: repair.id, refNo: repair.imei, amount: cost, note: repair.deviceName, deviceIds: [repair.deviceId] }, batch);
  await batch.commit();
}

/* ------------------------------------------------------------------ simple collections */

export async function saveParty(party) {
  const data = {
    name: party.name.trim(),
    phone: (party.phone || '').trim(),
    email: (party.email || '').trim(),
    address: (party.address || '').trim(),
    gstin: (party.gstin || '').trim().toUpperCase(),
    type: party.type || 'both',
    openingBalance: round2(party.openingBalance),
    notes: (party.notes || '').trim(),
    updatedAt: serverTimestamp(), updatedBy: who(),
  };
  if (party.id) {
    await updateDoc(doc(db, 'parties', party.id), data);
    logActivity({ action: 'update', entity: 'party', refId: party.id, refNo: data.name });
    return party.id;
  }
  const ref = newRef('parties');
  await setDoc(ref, { ...data, createdAt: serverTimestamp(), createdBy: who() });
  logActivity({ action: 'create', entity: 'party', refId: ref.id, refNo: data.name });
  return ref.id;
}

/** True when any record (including private ones) points at the party - such a party can't be deleted. */
export const partyInUse = (id, raw) =>
  ['purchases', 'sales', 'payments', 'repairs', 'expenses'].some((k) => (raw[k] || []).some((x) => x.partyId === id));

export async function deleteParty(id, name = '', raw = null) {
  if (raw && partyInUse(id, raw)) throw new Error('This party has transactions and cannot be deleted.');
  await deleteDoc(doc(db, 'parties', id));
  logActivity({ action: 'delete', entity: 'party', refId: id, refNo: name });
}

export async function saveBank(bank) {
  const data = {
    name: bank.name.trim(),
    bankName: (bank.bankName || '').trim(),
    accountNo: (bank.accountNo || '').trim(),
    ifsc: (bank.ifsc || '').trim().toUpperCase(),
    upiId: (bank.upiId || '').trim(),
    openingBalance: round2(bank.openingBalance),
    updatedAt: serverTimestamp(), updatedBy: who(),
  };
  if (bank.id) {
    await updateDoc(doc(db, 'banks', bank.id), data);
    logActivity({ action: 'update', entity: 'bank', refId: bank.id, refNo: data.name });
    return;
  }
  const ref = newRef('banks');
  await setDoc(ref, { ...data, createdAt: serverTimestamp(), createdBy: who() });
  logActivity({ action: 'create', entity: 'bank', refId: ref.id, refNo: data.name });
}

export async function deleteBank(id, name = '') {
  await deleteDoc(doc(db, 'banks', id));
  logActivity({ action: 'delete', entity: 'bank', refId: id, refNo: name });
}

export async function savePayment(p) {
  const data = {
    direction: p.direction,
    amount: round2(p.amount),
    date: p.date,
    mode: p.mode,
    accountId: p.accountId || CASH_ACCOUNT,
    partyId: p.partyId || null,
    partyName: p.partyName || '',
    refType: p.refType || 'manual',
    refId: p.refId || null,
    refNo: p.refNo || '',
    note: (p.note || '').trim(),
    hidden: Boolean(p.hidden),
    ...(p.billId ? { billId: p.billId } : {}),
    updatedAt: serverTimestamp(), updatedBy: who(),
  };
  const what = `${data.direction === 'in' ? 'Received from' : 'Paid to'} ${data.partyName || '—'} · ${data.mode}`;
  if (p.id) {
    await updateDoc(doc(db, 'payments', p.id), data);
    logActivity({ action: 'update', entity: 'payment', refId: p.id, refNo: data.refNo, amount: data.amount, note: what, hidden: data.hidden });
    return;
  }
  const ref = newRef('payments');
  await setDoc(ref, { ...data, createdAt: serverTimestamp(), createdBy: who() });
  logActivity({ action: 'create', entity: 'payment', refId: ref.id, refNo: data.refNo, amount: data.amount, note: what, hidden: data.hidden });
}

export async function deletePayment(id, p = {}) {
  await deleteDoc(doc(db, 'payments', id));
  logActivity({ action: 'delete', entity: 'payment', refId: id, refNo: p.refNo || '', amount: p.amount ?? null, note: p.partyName || '', hidden: p.hidden });
}

export async function updateTransfer(id, { fromAccountId, toAccountId, amount, date, note }) {
  await updateDoc(doc(db, 'payments', id), {
    fromAccountId,
    toAccountId,
    accountId: fromAccountId,
    amount: round2(amount),
    date,
    note: (note || '').trim(),
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
  logActivity({ action: 'update', entity: 'transfer', refId: id, amount, note: (note || '').trim() });
}

export async function saveTransfer({ fromAccountId, toAccountId, amount, date, note }) {
  await setDoc(newRef('payments'), {
    direction: 'transfer',
    fromAccountId,
    toAccountId,
    accountId: fromAccountId,
    amount: round2(amount),
    date,
    mode: 'Transfer',
    partyId: null,
    partyName: '',
    refType: 'transfer',
    note: (note || '').trim(),
    hidden: false,
    ...stamp(),
  });
  logActivity({ action: 'create', entity: 'transfer', amount, note: (note || '').trim() });
}

export async function saveExpense(e) {
  const data = {
    date: e.date,
    category: e.category,
    amount: round2(e.amount),
    mode: e.mode,
    accountId: e.accountId || CASH_ACCOUNT,
    paidTo: (e.paidTo || '').trim(),
    note: (e.note || '').trim(),
    updatedAt: serverTimestamp(), updatedBy: who(),
  };
  const what = [data.category, data.paidTo].filter(Boolean).join(' · ');
  if (e.id) {
    await updateDoc(doc(db, 'expenses', e.id), data);
    logActivity({ action: 'update', entity: 'expense', refId: e.id, amount: data.amount, note: what });
    return;
  }
  const ref = newRef('expenses');
  await setDoc(ref, { ...data, createdAt: serverTimestamp(), createdBy: who() });
  logActivity({ action: 'create', entity: 'expense', refId: ref.id, amount: data.amount, note: what });
}

export async function deleteExpense(id, e = {}) {
  await deleteDoc(doc(db, 'expenses', id));
  logActivity({ action: 'delete', entity: 'expense', refId: id, amount: e.amount ?? null, note: [e.category, e.paidTo].filter(Boolean).join(' · ') });
}

/* ------------------------------------------------------------------ stock audits */

/** Audits are kept for this many days, then deleted automatically. */
export const AUDIT_KEEP_DAYS = 15;
const auditExpiry = () => Timestamp.fromMillis(Date.now() + AUDIT_KEEP_DAYS * 86400000);

/** Starts an audit with a snapshot of everything that should be on the shelf right now. */
export async function startAudit({ devices, by, note }) {
  const expected = devices
    .filter((d) => d.status === 'in_stock')
    .map((d) => ({
      deviceId: d.id,
      sn: d.sn || '',
      imei: d.imei,
      imei2: d.imei2 || '',
      name: deviceName(d),
      color: d.color || '',
      condition: d.condition || '',
    }));
  const ref = newRef('audits');
  await setDoc(ref, {
    status: 'in_progress',
    date: today(),
    startedBy: by || '',
    note: (note || '').trim(),
    expected,
    scans: [],
    expireAt: auditExpiry(), // also usable by a Firestore TTL policy on this field
    ...stamp(),
  });
  logActivity({ action: 'audit-start', entity: 'audit', refId: ref.id, note: `${expected.length} phones to check` });
  return ref.id;
}

/** scan = { code, at (ms), by, manual? } */
export const addAuditScan = (id, scan) =>
  updateDoc(doc(db, 'audits', id), { scans: arrayUnion(scan), updatedAt: serverTimestamp(), updatedBy: who() });

export const removeAuditScans = (id, scans) =>
  updateDoc(doc(db, 'audits', id), { scans: arrayRemove(...scans), updatedAt: serverTimestamp(), updatedBy: who() });

/** Freezes the result so the report never changes after completion; the 15 days restart from now. */
export const completeAudit = (id, result, by) =>
  updateDoc(doc(db, 'audits', id), {
    status: 'completed',
    result,
    summary: {
      expected: result.found.length + result.missing.length + result.soldDuring.length,
      found: result.found.length,
      missing: result.missing.length,
      soldDuring: result.soldDuring.length,
      extra: result.extras.length,
    },
    completedBy: by || '',
    completedAt: serverTimestamp(),
    expireAt: auditExpiry(),
    updatedAt: serverTimestamp(), updatedBy: who(),
  }).then(() =>
    logActivity({ action: 'audit-done', entity: 'audit', refId: id, note: `${result.found.length} found · ${result.missing.length} missing · ${result.extras.length} extra` }),
  );

/** label is given for a manual delete; automatic 15-day clean-up passes none and isn't logged */
export async function deleteAudit(id, label) {
  await deleteDoc(doc(db, 'audits', id));
  if (label) logActivity({ action: 'delete', entity: 'audit', refId: id, note: label });
}

/* ------------------------------------------------------------------ settings */

export async function saveSettings(data) {
  await setDoc(doc(db, 'settings', 'shop'), { ...data, updatedAt: serverTimestamp(), updatedBy: who() }, { merge: true });
  logActivity({ action: 'update', entity: 'settings', note: Object.keys(data).filter((k) => k !== 'logo').slice(0, 12).join(', ') });
}

export const savePasskeyHash = (hash) =>
  setDoc(doc(db, 'settings', 'secure'), { passkeyHash: hash, updatedAt: serverTimestamp(), updatedBy: who() }, { merge: true });
