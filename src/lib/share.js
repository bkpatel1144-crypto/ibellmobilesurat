import { money, num, fmtDate } from './format';
import { settledByReturn } from './returns';

/*
 * WhatsApp sharing without a server.
 *   Phone / Windows / Mac browsers that can share files → the share sheet opens with the PDF attached
 *   and the message ready; pick WhatsApp and the chat, press send.
 *   Other browsers → the PDF is saved and WhatsApp opens on the customer's chat with the message typed.
 */

/** Message templates - editable in Settings → Billing. {words} are filled in per document. */
export const WA_DEFAULTS = {
  waSale: 'Dear {name},\nThank you for shopping with {shop}!\n\nBill: {no} ({date})\nPhones: {items}\nTotal: {total}\n{balance}\n\nYour bill is attached.',
  waPurchase: 'Dear {name},\nPurchase voucher {no} ({date}) from {shop}.\nPhones: {items}\nTotal: {total}\n{balance}',
  waReturn: 'Dear {name},\n{title} {no} ({date}) against {bill}.\nPhones: {items}\nAmount: {total}\n{balance}',
  waLedger: 'Dear {name},\nYour account statement with {shop} ({period}) is attached.\nClosing balance: {balance}',
};

export const WA_FIELDS = [
  ['waSale', 'Sales bill', '{name} {shop} {no} {date} {items} {total} {balance}'],
  ['waPurchase', 'Purchase voucher', '{name} {shop} {no} {date} {items} {total} {balance}'],
  ['waReturn', 'Return note', '{name} {shop} {title} {no} {date} {bill} {items} {total} {balance}'],
  ['waLedger', 'Party ledger', '{name} {shop} {period} {balance}'],
];

export const fillTemplate = (tpl, vars) =>
  String(tpl || '')
    .replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const items = (list) => list.map((i) => [i.brand, i.model].filter(Boolean).join(' ')).join(', ');
const tpl = (settings, key) => settings?.[key] || WA_DEFAULTS[key];

export function saleMessage(s, settings) {
  const due = num(s.due ?? num(s.total) - num(s.received));
  return fillTemplate(tpl(settings, 'waSale'), {
    name: s.customerName || 'Customer',
    shop: settings.shopName,
    no: s.invoiceNo,
    date: fmtDate(s.date),
    items: items(s.items),
    total: money(s.total),
    balance: due > 0.004 ? `Balance due: ${money(due)}` : due < -0.004 ? `Refund due to you: ${money(-due)}` : settledByReturn(s) ? 'Settled by return.' : 'Paid in full. Thank you!',
  });
}

export function purchaseMessage(p, settings) {
  const due = num(p.due ?? num(p.total) - num(p.paid));
  return fillTemplate(tpl(settings, 'waPurchase'), {
    name: p.partyName,
    shop: settings.shopName,
    no: p.purchaseNo,
    date: fmtDate(p.date),
    items: items(p.items),
    total: money(p.total),
    balance: due > 0.004 ? `Paid ${money(p.paid)} · balance ${money(due)}` : due < -0.004 ? `You owe us ${money(-due)} (returns)` : settledByReturn(p) ? 'Settled by return (debit note).' : 'Paid in full.',
  });
}

export function returnMessage(n, settings, refunded = 0) {
  const sale = n.kind === 'sale';
  const rest = num(n.total) - num(refunded);
  return fillTemplate(tpl(settings, 'waReturn'), {
    name: n.partyName,
    shop: settings.shopName,
    title: sale ? (num(n.tax) > 0 ? 'Credit note' : 'Sales return') : 'Debit note',
    no: n.returnNo,
    date: fmtDate(n.date),
    bill: n.billNo,
    items: items(n.items),
    total: money(n.total),
    balance: `${sale ? 'Refunded' : 'Refund received'}: ${money(refunded)}${rest > 0.004 ? ` · ${money(rest)} adjusted against bill ${n.billNo}` : ''}`,
  });
}

export function ledgerMessage(party, closing, period, settings) {
  return fillTemplate(tpl(settings, 'waLedger'), {
    name: party.name,
    shop: settings.shopName,
    period,
    balance: closing > 0.004 ? `${money(closing)} to pay us` : closing < -0.004 ? `${money(-closing)} we owe you` : 'Settled',
  });
}

/** 10-digit Indian mobiles get +91; anything else is used as typed (digits only). */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? d : '';
}

export const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

export const canShareFiles = (file) => {
  try {
    return Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
};

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * Shares the PDF with the message. Returns:
 *   'shared'     share sheet finished
 *   'cancelled'  closed without sharing
 *   'needs-tap'  the browser wants a fresh tap (the PDF took too long) - call again from a button
 *   'fallback'   PDF saved + WhatsApp chat opened with the message
 */
export async function sharePdf({ file, text, phone }) {
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], text, title: file.name.replace(/\.pdf$/, '') });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      if (e?.name === 'NotAllowedError') return 'needs-tap';
      throw e;
    }
  }
  download(file);
  window.open(waLink(phone, text), '_blank', 'noopener');
  return 'fallback';
}
