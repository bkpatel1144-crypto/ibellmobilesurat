import { num, round2, byDateAsc } from './format';
import { billCountText, billItemsText } from './accessories';
import { CASH_ACCOUNT } from './db';

/* Sign convention for parties: balance > 0 → party owes us (receivable),
   balance < 0 → we owe the party (payable). Debit raises it, credit lowers it. */

export function partyEntries(partyId, { sales, purchases, payments, repairs, returns = [] }) {
  const rows = [];
  // credit note: we owe the customer back · debit note: the supplier owes us back
  for (const x of returns) {
    if (x.partyId !== partyId) continue;
    const sale = x.kind === 'sale';
    rows.push({
      date: x.date,
      createdAt: x.createdAt,
      type: sale ? 'Sales Return' : 'Purchase Return',
      ref: x.returnNo,
      particulars: `${billCountText(x)} against ${x.billNo}: ${billItemsText(x)}`,
      debit: sale ? 0 : num(x.total),
      credit: sale ? num(x.total) : 0,
      link: `/returns/${x.id}`,
    });
  }
  for (const s of sales) {
    if (s.partyId !== partyId) continue;
    rows.push({
      date: s.date,
      createdAt: s.createdAt,
      type: 'Sale',
      ref: s.invoiceNo,
      particulars: `${billCountText(s)}: ${billItemsText(s)}`,
      debit: num(s.total),
      credit: 0,
      link: `/sales/${s.id}`,
    });
  }
  for (const p of purchases) {
    if (p.partyId !== partyId) continue;
    rows.push({
      date: p.date,
      createdAt: p.createdAt,
      type: 'Purchase',
      ref: p.purchaseNo,
      particulars: `${billCountText(p)}: ${billItemsText(p)}`,
      debit: 0,
      credit: num(p.total),
      link: `/purchases/${p.id}`,
    });
  }
  for (const r of repairs) {
    if (r.partyId !== partyId || r.status !== 'done') continue;
    rows.push({
      date: r.doneDate || r.sentDate,
      createdAt: r.createdAt,
      type: 'Repair',
      ref: r.imei,
      particulars: `Repair charges: ${r.deviceName}`,
      debit: 0,
      credit: num(r.cost),
    });
  }
  for (const p of payments) {
    if (p.partyId !== partyId || p.direction === 'transfer') continue;
    rows.push({
      date: p.date,
      createdAt: p.createdAt,
      type: p.direction === 'in' ? 'Payment In' : 'Payment Out',
      ref: p.refNo || '',
      particulars: `${p.mode}${p.note ? ` · ${p.note}` : ''}`,
      debit: p.direction === 'out' ? num(p.amount) : 0,
      credit: p.direction === 'in' ? num(p.amount) : 0,
    });
  }
  return rows.sort(byDateAsc);
}

export function partyLedger(party, data, { from, to } = {}) {
  const all = partyEntries(party.id, data);
  let opening = num(party.openingBalance);
  const rows = [];
  for (const r of all) {
    if (from && r.date < from) {
      opening += r.debit - r.credit;
      continue;
    }
    if (to && r.date > to) continue;
    rows.push(r);
  }
  let bal = opening;
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    bal += r.debit - r.credit;
    debit += r.debit;
    credit += r.credit;
    r.balance = round2(bal);
  }
  return { opening: round2(opening), rows, debit: round2(debit), credit: round2(credit), closing: round2(bal) };
}

export function partyBalances(parties, data) {
  const map = new Map(parties.map((p) => [p.id, num(p.openingBalance)]));
  const add = (id, v) => {
    if (id && map.has(id)) map.set(id, map.get(id) + v);
  };
  data.sales.forEach((s) => add(s.partyId, num(s.total)));
  data.purchases.forEach((p) => add(p.partyId, -num(p.total)));
  data.repairs.forEach((r) => r.status === 'done' && add(r.partyId, -num(r.cost)));
  (data.returns || []).forEach((x) => add(x.partyId, x.kind === 'sale' ? -num(x.total) : num(x.total)));
  data.payments.forEach((p) => {
    if (p.direction === 'in') add(p.partyId, -num(p.amount));
    else if (p.direction === 'out') add(p.partyId, num(p.amount));
  });
  for (const [k, v] of map) map.set(k, round2(v));
  return map;
}

export const balanceLabel = (bal) =>
  bal > 0.004 ? 'To receive' : bal < -0.004 ? 'To pay' : 'Settled';

/* ------------------------------------------------------------------ accounts */

export function accountList(banks, settings) {
  return [
    { id: CASH_ACCOUNT, name: 'Cash in Hand', openingBalance: num(settings?.cashOpening), isCash: true },
    ...banks.slice().sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

export function accountEntries(accountId, { payments, expenses }) {
  const rows = [];
  for (const p of payments) {
    if (p.direction === 'transfer') {
      if (p.fromAccountId === accountId)
        rows.push({ ...base(p), type: 'Transfer Out', particulars: p.note || 'Transfer', in: 0, out: num(p.amount), transfer: true });
      if (p.toAccountId === accountId)
        rows.push({ ...base(p), type: 'Transfer In', particulars: p.note || 'Transfer', in: num(p.amount), out: 0, transfer: true });
      continue;
    }
    if ((p.accountId || CASH_ACCOUNT) !== accountId) continue;
    rows.push({
      ...base(p),
      type: p.direction === 'in' ? 'Received' : 'Paid',
      particulars: [p.partyName, p.note].filter(Boolean).join(' · ') || p.mode,
      in: p.direction === 'in' ? num(p.amount) : 0,
      out: p.direction === 'out' ? num(p.amount) : 0,
    });
  }
  for (const e of expenses) {
    if ((e.accountId || CASH_ACCOUNT) !== accountId) continue;
    rows.push({
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      type: 'Expense',
      ref: e.category,
      particulars: [e.category, e.paidTo, e.note].filter(Boolean).join(' · '),
      in: 0,
      out: num(e.amount),
    });
  }
  return rows.sort(byDateAsc);
}

const base = (p) => ({ id: p.id, date: p.date, createdAt: p.createdAt, ref: p.refNo || '', mode: p.mode });

export function accountLedger(account, data) {
  const rows = accountEntries(account.id, data);
  let bal = num(account.openingBalance);
  let tin = 0;
  let tout = 0;
  for (const r of rows) {
    bal += r.in - r.out;
    tin += r.in;
    tout += r.out;
    r.balance = round2(bal);
  }
  return { opening: num(account.openingBalance), rows, in: round2(tin), out: round2(tout), closing: round2(bal) };
}

export function accountBalances(accounts, data) {
  const map = new Map();
  for (const a of accounts) map.set(a.id, accountLedger(a, data).closing);
  return map;
}

export const accountName = (accounts, id) => accounts.find((a) => a.id === (id || CASH_ACCOUNT))?.name || 'Cash in Hand';
