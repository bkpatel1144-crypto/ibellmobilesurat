// "Check & fix old data" (Settings → Data): problems left by records made with older versions.
// Every check only reads; nothing changes until the owner presses a button.
import { num } from './format';

// words staff use for repairs, in English / Gujarati / Hindi
const REPAIR_WORD = /repair|repar|ripar|rippar|રિપેર|રીપેર|રિપેરીંગ|रिपेयर|रिपेर|मरम्मत/i;

const dayGap = (a, b) => {
  if (!a || !b) return 999;
  return Math.abs(new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000;
};

/**
 * Repair costs that were also typed in as shop expenses. A finished repair already adds its cost to
 * the phone (and so to profit when sold) - the same amount as an expense takes it off twice.
 * Returns [{ expense, repair }] - repair = the repair record it matches (IMEI in the text, or the
 * same amount within 7 days), or null when nothing matches (then it is counted only once - keep it).
 */
export function repairExpenseDuplicates({ expenses, repairs }) {
  const done = repairs.filter((r) => r.status === 'done' && num(r.cost) > 0);
  const used = new Set();
  const out = [];
  const list = expenses
    .filter((e) => REPAIR_WORD.test(`${e.category || ''} ${e.paidTo || ''} ${e.note || ''}`))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const e of list) {
    const text = `${e.paidTo || ''} ${e.note || ''}`;
    const free = done.filter((r) => !used.has(r.id));
    const byImei = free.find((r) => r.imei && text.includes(r.imei) && Math.abs(num(r.cost) - num(e.amount)) < 0.01);
    const byAmount = free
      .filter((r) => Math.abs(num(r.cost) - num(e.amount)) < 0.01 && dayGap(r.doneDate || r.sentDate, e.date) <= 7)
      .sort((a, b) => dayGap(a.doneDate || a.sentDate, e.date) - dayGap(b.doneDate || b.sentDate, e.date))[0];
    const repair = byImei || byAmount || null;
    if (repair) used.add(repair.id);
    out.push({ expense: e, repair });
  }
  return out;
}

/**
 * Money received / paid "on account" with a typed name instead of a chosen party
 * ("No party (enter name)"). It never settles that party's bills. When the typed name matches
 * exactly one party, it can be linked. Payments of a bill are left alone (a walk-in bill's payment
 * must never land in a party's ledger).
 */
export function unlinkedPayments({ payments, parties }) {
  const byName = new Map();
  for (const p of parties) {
    const k = (p.name || '').trim().toLowerCase();
    if (!k) continue;
    byName.set(k, byName.has(k) ? null : p); // null = two parties with this name - can't tell which
  }
  return payments
    .filter((p) => !p.partyId && (p.direction === 'in' || p.direction === 'out') && (!p.refType || p.refType === 'manual'))
    .map((p) => ({ payment: p, party: byName.get((p.partyName || '').trim().toLowerCase()) || null }))
    .filter((x) => x.party);
}

/** Payments still pointing at a sale / purchase that no longer exists - they settle nothing. */
export function orphanPayments({ payments, sales, purchases }) {
  const saleIds = new Set(sales.map((s) => s.id));
  const purchaseIds = new Set(purchases.map((p) => p.id));
  return payments.filter(
    (p) => p.refId && ((p.refType === 'sale' && !saleIds.has(p.refId)) || (p.refType === 'purchase' && !purchaseIds.has(p.refId))),
  );
}
