import { num, round2 } from './format';

/*
 * Returns follow the standard GST flow:
 *   Sales return    → Credit Note (CN-0001) against the original bill. Phones go back to stock,
 *                     the customer is refunded or their account is credited, GST (if any) is reversed
 *                     in the month the note is made.
 *   Purchase return → Debit Note (DN-0001) against the original purchase. Phones leave stock,
 *                     the supplier refunds us or their balance goes down.
 * The original bill never changes - the note sits next to it, so 1, 2 or all phones can come back.
 */

export const REASONS = {
  sale: ['Customer changed mind', 'Defective / not working', 'Wrong phone given', 'Exchange', 'Other'],
  purchase: ['Defective / not working', 'Not as described', 'Blacklisted / blocked IMEI', 'Supplier took it back', 'Other'],
};

export const NOTE_TITLE = { sale: 'Credit Note', purchase: 'Debit Note' };
export const KIND_LABEL = { sale: 'Sales return', purchase: 'Purchase return' };

/** What the customer paid for one line: its share of the bill after discount, GST included. */
export function saleLineValue(sale, it) {
  if (it.taxable != null) return round2(num(it.taxable) + num(it.gst));
  const price = num(it.price ?? it.amount); // phones: price · accessory lines: amount
  const sub = num(sale.subtotal) || sale.items.reduce((s, i) => s + num(i.price), 0);
  return round2(sub ? (price * num(sale.total)) / sub : price);
}

function saleLineTaxable(sale, it) {
  if (it.taxable != null) return num(it.taxable);
  const v = saleLineValue(sale, it);
  const total = num(sale.total);
  return round2(total ? (v * (total - num(sale.tax))) / total : v);
}

/** Lines of a bill that can still come back: the phone is still sold on this very bill. */
export function returnableSaleLines(sale, devices) {
  const m = new Map(devices.map((d) => [d.id, d]));
  return sale.items.filter((it) => {
    const d = m.get(it.deviceId);
    return d && d.status === 'sold' && d.saleId === sale.id;
  });
}

/** Lines of a purchase that can go back to the supplier: the phone is still in stock. */
export function returnablePurchaseLines(purchase, devices) {
  const m = new Map(devices.map((d) => [d.id, d]));
  return purchase.items.filter((it) => {
    const d = m.get(it.deviceId);
    return d && d.status === 'in_stock' && d.purchaseId === purchase.id;
  });
}

/** A bill with nothing left to pay that was cleared by returns alone (no money paid / received). */
export const settledByReturn = (bill) => (num(bill.returned) > 0 || num(bill.credit) > 0) && !num(bill.received ?? bill.paid) && !num(bill.advance);

/** Device ids already on a return note of this bill. */
export const returnedIds = (returns, billId) =>
  new Set(returns.filter((r) => r.billId === billId).flatMap((r) => r.items.map((i) => i.deviceId)));

/** The note (CN / DN number) a phone of this bill came back on. */
export const returnOf = (returns, billId, deviceId) => returns.find((r) => r.billId === billId && r.items.some((i) => i.deviceId === deviceId));

/** The most one line can be credited for. */
export const lineMax = (kind, bill, it) => (kind === 'sale' ? saleLineValue(bill, it) : null);

/**
 * Builds the note's lines and totals.
 *   lines: [{ ...billLine, value, cost }]   value = amount credited for the phone
 * Sales: GST comes off in the same share as the value (a full return reverses all of that line's GST).
 * Purchases carry no GST in this app (phones are mostly bought from individuals).
 */
export function returnTotals(kind, bill, lines, accessoryLines = []) {
  const items = lines.map((l) => {
    const value = round2(l.value);
    if (kind !== 'sale') return { ...l, value, taxable: value, gst: 0 };
    const billed = saleLineValue(bill, l);
    const lineTaxable = saleLineTaxable(bill, l);
    const taxable = num(bill.tax) > 0 && billed ? round2((lineTaxable * value) / billed) : value;
    return { ...l, billed, value, taxable, gst: round2(value - taxable) };
  });
  // accessory lines: { ...billLine (whole line: amount, taxable, gst), qty returned, billQty, serials, value, cost }
  const accessories = accessoryLines.map((l) => {
    const value = round2(l.value);
    const share = num(l.billQty) ? Math.min(1, num(l.qty) / num(l.billQty)) : 1;
    const { billQty, ...line } = l;
    if (kind !== 'sale') return { ...line, value, taxable: value, gst: 0 };
    const billed = round2(saleLineValue(bill, l) * share);
    const lineTaxable = round2(saleLineTaxable(bill, l) * share);
    const taxable = num(bill.tax) > 0 && billed ? round2((lineTaxable * value) / billed) : value;
    return { ...line, billed, value, taxable, gst: round2(value - taxable) };
  });
  const all = [...items, ...accessories];
  const total = round2(all.reduce((s, i) => s + i.value, 0));
  const taxable = round2(all.reduce((s, i) => s + i.taxable, 0));
  const tax = round2(total - taxable);
  const igst = num(bill.igst) > 0 ? tax : 0;
  const cgst = igst ? 0 : round2(tax / 2);
  const sgst = igst ? 0 : round2(tax - cgst);
  const cost = round2(all.reduce((s, i) => s + num(i.cost), 0));
  return {
    items,
    accessories,
    total,
    taxable,
    tax,
    cgst,
    sgst,
    igst,
    cost,
    // sales: the profit this takes back · purchases: gain (+) or loss (−) against what the phones cost us
    profit: kind === 'sale' ? round2(taxable - cost) : round2(total - cost),
  };
}

/**
 * The refund that settles things: what the bill still owes after this note decides.
 * Sale with ₹10,000 due and a ₹6,000 return → no refund, the due drops to ₹4,000.
 * Paid-in-full sale with a ₹6,000 return → refund ₹6,000.
 * partyDue: what the party's bills of this kind still owe in all (credit on one bill settles their
 * other open bills first), so cash only goes back for credit no open bill can take.
 */
export function suggestedRefund(kind, bill, noteTotal, partyDue = bill.due) {
  if (kind === 'sale' && !bill.partyId) return noteTotal; // walk-in: no account to keep a balance on
  const after = num(partyDue) - noteTotal;
  return round2(Math.min(noteTotal, Math.max(0, -after)));
}

/** The party's other bills of this kind (sales or purchases) that still have money due. */
export function otherOpenDue(bills, bill) {
  if (!bill.partyId) return 0;
  return round2(bills.filter((b) => b.id !== bill.id && b.partyId === bill.partyId && num(b.due) > 0.004).reduce((s, b) => s + num(b.due), 0));
}
