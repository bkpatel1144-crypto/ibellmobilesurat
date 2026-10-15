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
} from 'firebase/firestore';
import { db } from '../firebase';
import { num, round2, cleanImei } from './format';

export const CASH_ACCOUNT = 'cash';

const newRef = (coll) => doc(collection(db, coll));
const stamp = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

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

function maxNumber(list, prefix) {
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
    await setDoc(ref, { name: f.name, type: f.type, dataUrl: f.dataUrl, createdAt: serverTimestamp() });
    ids.push(ref.id);
  }
  return ids;
}

export const deleteAttachment = (id) => deleteDoc(doc(db, 'attachments', id));

/* ------------------------------------------------------------------ payments helper */

function paymentDoc({ direction, amount, date, mode, accountId, partyId, partyName, refType, refId, refNo, note, hidden }) {
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
    ...stamp(),
  };
}

/* ------------------------------------------------------------------ purchases */

export async function createPurchase(form, { settings, purchases }) {
  const prefix = settings?.purchasePrefix || 'PUR-';
  const purchaseNo = await nextNumber('purchase', prefix, purchases.map((p) => p.purchaseNo));

  // upload ID proofs first (each is its own document, too big for one batch)
  const items = [];
  for (const it of form.items) {
    const idProofs = await saveAttachments(it.idFiles);
    items.push({ ...it, idProofs });
  }

  const batch = writeBatch(db);
  const pRef = newRef('purchases');
  const lines = [];

  for (const it of items) {
    const dRef = newRef('devices');
    const sendRepair = Boolean(it.repair?.send);
    const device = {
      imei: cleanImei(it.imei),
      imei2: cleanImei(it.imei2),
      brand: it.brand.trim(),
      model: it.model.trim(),
      variant: (it.variant || '').trim(),
      color: (it.color || '').trim(),
      condition: it.condition || 'Used',
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
    lines.push({
      deviceId: dRef.id,
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

  await batch.commit();
  return { id: pRef.id, purchaseNo };
}

export async function deletePurchase(purchase, { devices, repairs, payments }) {
  const ids = new Set(purchase.items.map((i) => i.deviceId));
  const sold = devices.filter((d) => ids.has(d.id) && d.status === 'sold');
  if (sold.length) {
    throw new Error(`Cannot delete: ${sold.length} device(s) from this purchase are already sold. Delete those sales first.`);
  }
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, 'devices', id)));
  repairs.filter((r) => ids.has(r.deviceId)).forEach((r) => batch.delete(doc(db, 'repairs', r.id)));
  payments
    .filter((p) => p.refType === 'purchase' && p.refId === purchase.id)
    .forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  batch.delete(doc(db, 'purchases', purchase.id));
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
      buyerIdType: it.idType || '',
      buyerIdNumber: (it.idNumber || '').trim(),
      buyerIdProofs,
    });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.price, 0));
  const taxable = round2(subtotal - num(form.discount));
  const tax = round2((taxable * num(form.taxPercent)) / 100);
  const total = round2(taxable + tax);
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
    taxPercent: num(form.taxPercent),
    tax,
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
      updatedAt: serverTimestamp(),
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

  await batch.commit();
  return { id: sRef.id, invoiceNo, sale: { id: sRef.id, ...saleData } };
}

export async function deleteSale(sale, { payments }) {
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
      updatedAt: serverTimestamp(),
    });
  }
  payments
    .filter((p) => p.refType === 'sale' && p.refId === sale.id)
    .forEach((p) => batch.delete(doc(db, 'payments', p.id)));
  batch.delete(doc(db, 'sales', sale.id));
  await batch.commit();
}

/** Owner-only: move a sale in or out of the private (hidden) view */
export async function setSaleHidden(sale, hidden, { payments }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'sales', sale.id), { hidden, updatedAt: serverTimestamp() });
  sale.items.forEach((it) => batch.update(doc(db, 'devices', it.deviceId), { hidden }));
  payments
    .filter((p) => p.refType === 'sale' && p.refId === sale.id)
    .forEach((p) => batch.update(doc(db, 'payments', p.id), { hidden }));
  await batch.commit();
}

/* ------------------------------------------------------------------ devices */

export const updateDevice = (id, data) =>
  updateDoc(doc(db, 'devices', id), { ...data, updatedAt: serverTimestamp() });

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
  batch.update(doc(db, 'devices', device.id), { status: 'in_repair', updatedAt: serverTimestamp() });
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
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'devices', repair.deviceId), {
    status: 'in_stock',
    repairCost: increment(c),
    updatedAt: serverTimestamp(),
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
  await batch.commit();
}

export async function cancelRepair(repair) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'repairs', repair.id));
  batch.update(doc(db, 'devices', repair.deviceId), { status: 'in_stock', updatedAt: serverTimestamp() });
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
    updatedAt: serverTimestamp(),
  };
  if (party.id) {
    await updateDoc(doc(db, 'parties', party.id), data);
    return party.id;
  }
  const ref = newRef('parties');
  await setDoc(ref, { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export const deleteParty = (id) => deleteDoc(doc(db, 'parties', id));

export async function saveBank(bank) {
  const data = {
    name: bank.name.trim(),
    bankName: (bank.bankName || '').trim(),
    accountNo: (bank.accountNo || '').trim(),
    ifsc: (bank.ifsc || '').trim().toUpperCase(),
    upiId: (bank.upiId || '').trim(),
    openingBalance: round2(bank.openingBalance),
    updatedAt: serverTimestamp(),
  };
  if (bank.id) return updateDoc(doc(db, 'banks', bank.id), data);
  return setDoc(newRef('banks'), { ...data, createdAt: serverTimestamp() });
}

export const deleteBank = (id) => deleteDoc(doc(db, 'banks', id));

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
    updatedAt: serverTimestamp(),
  };
  if (p.id) return updateDoc(doc(db, 'payments', p.id), data);
  return setDoc(newRef('payments'), { ...data, createdAt: serverTimestamp() });
}

export const deletePayment = (id) => deleteDoc(doc(db, 'payments', id));

export async function saveTransfer({ fromAccountId, toAccountId, amount, date, note }) {
  return setDoc(newRef('payments'), {
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
    updatedAt: serverTimestamp(),
  };
  if (e.id) return updateDoc(doc(db, 'expenses', e.id), data);
  return setDoc(newRef('expenses'), { ...data, createdAt: serverTimestamp() });
}

export const deleteExpense = (id) => deleteDoc(doc(db, 'expenses', id));

/* ------------------------------------------------------------------ settings */

export const saveSettings = (data) =>
  setDoc(doc(db, 'settings', 'shop'), { ...data, updatedAt: serverTimestamp() }, { merge: true });

export const savePasskeyHash = (hash) =>
  setDoc(doc(db, 'settings', 'secure'), { passkeyHash: hash, updatedAt: serverTimestamp() }, { merge: true });
