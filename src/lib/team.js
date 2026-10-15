// Team & roles. Members live in team/{email}. Owners can do everything; staff get the
// permissions the owner switches on (settings/shop.staffPerms). The same rules are enforced
// by firestore.rules, so hiding a button is never the only protection.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { app, db, auth } from '../firebase';
import { logActivity } from './db';

export const PERMS = [
  { key: 'deleteRecords', label: 'Delete records', desc: 'Delete bills, purchases, payments, expenses, parties, bank accounts and audits.' },
  { key: 'viewProfit', label: 'See profit & cost', desc: 'Profit, margins, purchase cost on bills and stock value.' },
  { key: 'reports', label: 'Reports', desc: 'Analysis, GST Report and Activity log.' },
  { key: 'banks', label: 'Banks & payments', desc: 'Bank balances, statements, payments and transfers.' },
  { key: 'editSettings', label: 'Shop settings', desc: 'Change shop details, billing, GST and sticker settings.' },
];

export const STAFF_DEFAULTS = { deleteRecords: false, viewProfit: false, reports: false, banks: true, editSettings: false };

export const emailKey = (e) => String(e || '').trim().toLowerCase();

export async function saveMember({ email, name, role, active = true }, { log = true } = {}) {
  const id = emailKey(email);
  await setDoc(
    doc(db, 'team', id),
    { email: id, name: (name || '').trim(), role, active, updatedAt: serverTimestamp(), updatedBy: auth?.currentUser?.email || '' },
    { merge: true },
  );
  if (log) logActivity({ action: 'update', entity: 'team', refNo: id, note: `${role}${active ? '' : ' · blocked'}` });
}

export async function removeMember(email) {
  await deleteDoc(doc(db, 'team', emailKey(email)));
  logActivity({ action: 'delete', entity: 'team', refNo: emailKey(email) });
}

let secondaryReady = false;
/**
 * Creates a sign-in account for a staff member without signing the owner out
 * (uses a second, throw-away Firebase Auth instance).
 */
export async function createLogin(email, password) {
  const sec = getApps().find((a) => a.name === 'staff-creator') || initializeApp(app.options, 'staff-creator');
  const secAuth = getAuth(sec);
  if (!secondaryReady && import.meta.env.VITE_USE_EMULATOR === 'true') {
    connectAuthEmulator(secAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  secondaryReady = true;
  try {
    await createUserWithEmailAndPassword(secAuth, emailKey(email), password);
    return 'created';
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') return 'exists';
    throw e;
  } finally {
    await signOut(secAuth).catch(() => {});
  }
}
