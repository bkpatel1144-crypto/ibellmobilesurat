import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { round2, num } from '../lib/format';
import { sha256 } from '../lib/files';
import { savePasskeyHash, deleteAudit } from '../lib/db';
import { accountList } from '../lib/ledger';
import { isExpired } from '../lib/audit';

const COLLECTIONS = ['parties', 'devices', 'purchases', 'sales', 'repairs', 'payments', 'expenses', 'banks', 'audits'];

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
  defaultTax: 0,
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
  autoPrintLabels: false,
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

  const value = {
    ...data,
    raw,
    settings,
    accounts,
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
 *  so a payment recorded later (Payments page) settles the bill automatically. */
function withSettlement(d) {
  const paid = new Map();
  for (const p of d.payments) {
    if (p.refId && (p.refType === 'purchase' || p.refType === 'sale')) paid.set(p.refId, (paid.get(p.refId) || 0) + num(p.amount));
  }
  return {
    ...d,
    purchases: d.purchases.map((p) => ({ ...p, paid: round2(Math.min(paid.get(p.id) || 0, Math.max(num(p.total), 0))) })),
    sales: d.sales.map((s) => ({ ...s, received: round2(paid.get(s.id) || 0) })),
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

  return {
    ...raw,
    devices: raw.devices.filter((d) => !d.hidden),
    sales: raw.sales.filter((s) => !s.hidden),
    purchases,
    repairs: raw.repairs.filter((r) => !hiddenRepairs.has(r.id)),
    payments,
  };
}
