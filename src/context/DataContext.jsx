import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { round2, num } from '../lib/format';
import { sha256 } from '../lib/files';
import { savePasskeyHash, deleteAudit, logActivity } from '../lib/db';
import { accountList } from '../lib/ledger';
import { isExpired } from '../lib/audit';
import { useAuth } from './AuthContext';
import { saveMember, emailKey, STAFF_DEFAULTS } from '../lib/team';
import { WA_DEFAULTS } from '../lib/share';

const COLLECTIONS = ['parties', 'devices', 'purchases', 'sales', 'returns', 'repairs', 'payments', 'expenses', 'banks', 'audits', 'team'];

export const DEFAULT_SETTINGS = {
  shopName: 'IBELL MOBILE',
  tagline: 'Mobile Sales & Service',
  address: '',
  phone: '',
  email: '',
  gstin: '',
  logo: '',
  invoicePrefix: 'INV-',
  cashInvoicePrefix: 'CS-',
  purchasePrefix: 'PUR-',
  saleReturnPrefix: 'CN-', // credit note (sales return)
  cashReturnPrefix: 'CR-', // private sales returns
  purchaseReturnPrefix: 'DN-', // debit note (purchase return)
  defaultTax: 0,
  gstEnabled: false,
  gstRate: 18,
  gstOn: 'bank', // 'bank' = only bills paid by UPI / card / bank / cheque · 'all' = every bill
  gstInclusive: true, // selling price already includes GST
  hsnDefault: '8517',
  staffPerms: { deleteRecords: false, viewProfit: false, reports: false, banks: true, editSettings: false }, // see lib/team.js
  defaultWarranty: '',
  invoiceTerms:
    '1. Goods once sold will not be taken back.\n2. Warranty as per manufacturer / shop policy.\n3. Used devices are sold in as-is condition after inspection by the customer.',
  invoiceFooter: 'Thank you for shopping with us!',
  cashOpening: 0,
  snPrefix: 'G-',
  snNext: 1,
  labelWidth: 50,
  labelHeight: 25,
  labelShowBattery: true,
  labelShowWarranty: true,
  labelTitlePt: 9,
  labelCodePt: 8,
  labelInfoPt: 10,
  autoPrintLabels: false,
  ...WA_DEFAULTS, // WhatsApp message wording
};

const DataContext = createContext(null);

const emptyRaw = () => Object.fromEntries(COLLECTIONS.map((c) => [c, []]));

export function DataProvider({ children }) {
  const [raw, setRaw] = useState(emptyRaw);
  const [loaded, setLoaded] = useState(() => new Set());
  const [settingsDoc, setSettingsDoc] = useState(null);
  const [secure, setSecure] = useState(undefined);
  const [error, setError] = useState(null);
  const [unlocked, setUnlocked] = useState(false); // memory only: a reload locks again

  // live listeners for every collection
  useEffect(() => {
    const onErr = (e) => setError(e);
    const unsubs = COLLECTIONS.map((name) =>
      onSnapshot(
        collection(db, name),
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setRaw((prev) => ({ ...prev, [name]: rows }));
          setLoaded((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
        },
        onErr,
      ),
    );
    unsubs.push(
      onSnapshot(doc(db, 'settings', 'shop'), (s) => setSettingsDoc(s.exists() ? s.data() : {}), onErr),
      onSnapshot(doc(db, 'settings', 'secure'), (s) => setSecure(s.exists() ? s.data() : {}), onErr),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(settingsDoc || {}) }), [settingsDoc]);

  // Stock audits are kept 15 days: expired ones vanish at once and are deleted from Firestore
  // by whichever signed-in device sees them first (checked again every hour while open).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 3600000);
    return () => clearInterval(t);
  }, []);
  const purging = useRef(new Set());
  useEffect(() => {
    const now = Date.now();
    for (const a of raw.audits) {
      if (isExpired(a, now) && !purging.current.has(a.id)) {
        purging.current.add(a.id);
        deleteAudit(a.id).catch(() => purging.current.delete(a.id));
      }
    }
  }, [raw.audits, clock]);

  const data = useMemo(() => {
    const d = withSettlement(unlocked ? raw : applyPrivacy(raw));
    return { ...d, audits: raw.audits.filter((a) => !isExpired(a, clock)) };
  }, [raw, unlocked, clock]);

  const accounts = useMemo(() => accountList(data.banks, settings), [data.banks, settings]);

  const hasPasskey = Boolean(secure?.passkeyHash);

  const unlock = useCallback(
    async (pass) => {
      const hash = await sha256(`ibell:${pass}`);
      if (hash !== secure?.passkeyHash) return false;
      setUnlocked(true);
      return true;
    },
    [secure],
  );

  const setPasskey = useCallback(async (pass) => {
    await savePasskeyHash(await sha256(`ibell:${pass}`));
    setUnlocked(true);
  }, []);

  // ---- who am I: role + permissions (also enforced by firestore.rules)
  const { user } = useAuth();
  const myEmail = emailKey(user?.email);
  const meDoc = raw.team.find((m) => m.id === myEmail);
  const teamLoaded = loaded.has('team');
  // No team yet: the first person in is the owner (the rules only let OWNERS in at that point).
  const role = meDoc?.role || (teamLoaded && raw.team.length === 0 ? 'owner' : 'staff');
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!teamLoaded || bootstrapped.current || !user || raw.team.length) return;
    bootstrapped.current = true;
    saveMember({ email: user.email, name: user.displayName || user.email.split('@')[0], role: 'owner', active: true }).catch(() => {});
  }, [teamLoaded, raw.team.length, user]);
  const perms = useMemo(() => {
    if (role === 'owner') return Object.fromEntries(Object.keys(STAFF_DEFAULTS).map((k) => [k, true]));
    return { ...STAFF_DEFAULTS, ...(settings.staffPerms || {}) };
  }, [role, settings.staffPerms]);
  const can = useCallback((p) => Boolean(perms[p]), [perms]);

  // one "signed in" entry per browser session
  useEffect(() => {
    if (!user || !teamLoaded) return;
    const key = `ibell-login-${user.uid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked - log anyway */
    }
    logActivity({ action: 'login', entity: 'session', note: navigator.userAgent.includes('Mobile') ? 'Phone' : 'Computer' });
  }, [user, teamLoaded]);

  const value = {
    ...data,
    raw,
    settings,
    accounts,
    me: { email: myEmail, name: meDoc?.name || user?.displayName || myEmail.split('@')[0], role, isOwner: role === 'owner' },
    can,
    ready: loaded.size === COLLECTIONS.length && settingsDoc !== null,
    error,
    privacy: {
      unlocked,
      hasPasskey,
      passkeyLoaded: secure !== undefined,
      unlock,
      lock: () => setUnlocked(false),
      setPasskey,
    },
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);

/** "paid" on purchases and "received" on sales always come from the linked payments,
 *  so a payment recorded later (Payments page) settles the bill automatically.
 *  Returns (credit / debit notes) and their refunds settle the bill too:
 *    due = total − returned − (received − refunded) */
function withSettlement(d) {
  const paid = new Map();
  const refunded = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + num(v));
  for (const p of d.payments) {
    if (p.refId && (p.refType === 'purchase' || p.refType === 'sale')) add(paid, p.refId, p.amount);
    else if (p.billId && (p.refType === 'saleReturn' || p.refType === 'purchaseReturn')) add(refunded, p.billId, p.amount);
  }
  const returned = new Map();
  const returnCount = new Map();
  for (const x of d.returns) {
    add(returned, x.billId, x.total);
    add(returnCount, x.billId, x.items?.length || 0);
  }
  const extra = (id) => ({ returned: round2(returned.get(id) || 0), refunded: round2(refunded.get(id) || 0), returnedCount: returnCount.get(id) || 0 });
  return {
    ...d,
    purchases: d.purchases.map((p) => {
      const x = extra(p.id);
      const pd = round2(Math.min(paid.get(p.id) || 0, Math.max(num(p.total), 0)));
      return { ...p, ...x, paid: pd, due: round2(num(p.total) - x.returned - pd + x.refunded) };
    }),
    sales: d.sales.map((s) => {
      const x = extra(s.id);
      const rc = round2(paid.get(s.id) || 0);
      return { ...s, ...x, received: rc, due: round2(num(s.total) - x.returned - rc + x.refunded) };
    }),
  };
}

/**
 * Private (cash) sales: while locked, every trace of a privately sold device disappears -
 * the sale, its payment, the device, its repairs, and its line in the purchase it came from.
 */
function applyPrivacy(raw) {
  const hiddenDevices = new Set(raw.devices.filter((d) => d.hidden).map((d) => d.id));
  const hiddenPurchases = new Set();
  const hiddenShare = new Map(); // purchaseId → amount of hidden device lines
  const purchases = [];

  for (const p of raw.purchases) {
    const items = p.items || [];
    const visible = items.filter((i) => !hiddenDevices.has(i.deviceId));
    if (visible.length === items.length) {
      purchases.push(p);
    } else if (visible.length === 0) {
      hiddenPurchases.add(p.id);
    } else {
      const hiddenAmt = items.filter((i) => hiddenDevices.has(i.deviceId)).reduce((s, i) => s + num(i.price), 0);
      const total = round2(num(p.total) - hiddenAmt);
      hiddenShare.set(p.id, hiddenAmt);
      purchases.push({ ...p, items: visible, subtotal: round2(num(p.subtotal) - hiddenAmt), total, paid: Math.min(num(p.paid), total) });
    }
  }

  const hiddenRepairs = new Set(raw.repairs.filter((r) => hiddenDevices.has(r.deviceId) || r.hidden).map((r) => r.id));

  // Payments made against a partly hidden purchase shrink by the hidden share,
  // otherwise the supplier would look over-paid by exactly the hidden device's price.
  const payments = [];
  for (const p of raw.payments) {
    if (p.hidden) continue;
    if (p.refType === 'purchase' && hiddenPurchases.has(p.refId)) continue;
    if (p.refType === 'repair' && hiddenRepairs.has(p.refId)) continue;
    const share = p.refType === 'purchase' ? hiddenShare.get(p.refId) : 0;
    if (share > 0) {
      const cut = Math.min(share, num(p.amount));
      hiddenShare.set(p.refId, share - cut);
      if (num(p.amount) - cut > 0.004) payments.push({ ...p, amount: round2(num(p.amount) - cut) });
      continue;
    }
    payments.push(p);
  }

  // A fully hidden purchase would leave a hole in the purchase numbers (PUR-0002, PUR-0003 with no
  // PUR-0001). While locked, each later number moves down by the hidden purchases before it, so the
  // series reads without gaps. Gaps from purchases that were really deleted are left as they are.
  const showNo = gaplessNumbers(raw.purchases.filter((p) => hiddenPurchases.has(p.id)).map((p) => p.purchaseNo));
  const purchaseNo = new Map(purchases.map((p) => [p.id, showNo(p.purchaseNo)]));

  return {
    ...raw,
    devices: raw.devices
      .filter((d) => !d.hidden)
      .map((d) => (purchaseNo.has(d.purchaseId) ? { ...d, purchaseNo: purchaseNo.get(d.purchaseId) } : d)),
    sales: raw.sales.filter((s) => !s.hidden),
    returns: raw.returns
      .filter((x) => !x.hidden)
      .map((x) => (x.kind === 'purchase' && purchaseNo.has(x.billId) ? { ...x, billNo: purchaseNo.get(x.billId) } : x)),
    purchases: purchases.map((p) => ({ ...p, purchaseNo: purchaseNo.get(p.id) })),
    repairs: raw.repairs.filter((r) => !hiddenRepairs.has(r.id)),
    payments: payments.map((p) => (p.refType === 'purchase' && purchaseNo.has(p.refId) ? { ...p, refNo: purchaseNo.get(p.refId) } : p)),
  };
}

/** Returns a function that renumbers e.g. PUR-0005 → PUR-0004 when one hidden number sits below it. */
function gaplessNumbers(hiddenNos) {
  const split = (no) => {
    const m = /^(.*?)(\d+)$/.exec(no || '');
    return m ? { prefix: m[1], n: Number(m[2]), width: m[2].length } : null;
  };
  const hidden = {};
  for (const no of hiddenNos) {
    const s = split(no);
    if (s) (hidden[s.prefix] ||= []).push(s.n);
  }
  return (no) => {
    const s = split(no);
    if (!s || !hidden[s.prefix]) return no;
    const below = hidden[s.prefix].filter((n) => n < s.n).length;
    return below ? `${s.prefix}${String(s.n - below).padStart(s.width, '0')}` : no;
  };
}
