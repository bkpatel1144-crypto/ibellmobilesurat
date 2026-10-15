const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (v) => Math.round(num(v) * 100) / 100;

/** ₹ for the screen */
export const money = (v) => {
  const n = round2(v);
  return n < 0 ? `−₹${inr.format(-n)}` : `₹${inr.format(n)}`;
};

/** "Rs." for PDFs - the built-in PDF fonts have no ₹ glyph */
export const moneyPdf = (v) => `Rs. ${inr2.format(round2(v))}`;

export const plain = (v) => inr2.format(round2(v));

export const today = () => toISODate(new Date());

export const toISODate = (d) => {
  const x = new Date(d);
  const off = x.getTimezoneOffset();
  return new Date(x.getTime() - off * 60000).toISOString().slice(0, 10);
};

// date style chosen in Settings → Tables & Lists (set by prefs.js)
let dateStyle = 'medium';
export const setDateFormat = (s) => {
  dateStyle = s || 'medium';
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  if (dateStyle === 'iso') return iso.slice(0, 10);
  if (dateStyle === 'dmy') return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateShort = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const monthKey = (iso) => (iso || '').slice(0, 7);

export const fmtMonth = (key) => {
  if (!key) return '';
  const d = new Date(`${key}-01T00:00:00`);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};

export const startOfMonth = (iso = today()) => `${iso.slice(0, 7)}-01`;

export const startOfFY = (iso = today()) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
};

export const inRange = (iso, from, to) => (!from || iso >= from) && (!to || iso <= to);

export const deviceName = (d) =>
  [d?.brand, d?.model, d?.variant].filter(Boolean).join(' ') || 'Device';

export const cleanImei = (v) => String(v || '').replace(/\s+/g, '').trim();

export const byDateDesc = (a, b) =>
  (b.date || '').localeCompare(a.date || '') || tsMillis(b.createdAt) - tsMillis(a.createdAt);

export const byDateAsc = (a, b) => -byDateDesc(a, b);

export const tsMillis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  return 0;
};

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

export const ID_TYPES = ['Aadhaar Card', 'PAN Card', 'Driving Licence', 'Voter ID', 'Passport', 'Other'];

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Salary',
  'Electricity',
  'Internet & Phone',
  'Shop Maintenance',
  'Transport',
  'Tea & Food',
  'Marketing',
  'Accessories',
  'Tax & Fees',
  'Other',
];

/** Indian-system amount in words, e.g. 125000 -> "One Lakh Twenty Five Thousand Rupees Only" */
export function amountInWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  const n = Math.floor(Math.abs(num(amount)));
  const paise = Math.round((Math.abs(num(amount)) - n) * 100);
  if (n === 0 && paise === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  let s = `${parts.join(' ')} Rupees`;
  if (paise) s += ` and ${two(paise)} Paise`;
  return `${s} Only`;
}
