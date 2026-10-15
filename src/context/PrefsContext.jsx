import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { PREF_DEFAULTS, applyPrefs, clean, loadLocalPrefs, saveLocalPrefs } from '../lib/prefs';

const PrefsContext = createContext({ prefs: PREF_DEFAULTS, update: () => {}, reset: () => {} });

/**
 * UI preferences per signed-in user, stored in Firestore (prefs/{uid}) so they follow
 * the login to any device, and cached in localStorage so the page never flashes.
 * Every copy carries `_at` (ms) and the newest copy wins, so a late echo of an older
 * save can never undo a newer change.
 */
export function PrefsProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(loadLocalPrefs);
  const latest = useRef(prefs);
  latest.current = prefs;

  useEffect(() => {
    applyPrefs(prefs);
    saveLocalPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, 'prefs', user.uid),
      (s) => {
        if (!s.exists()) return;
        const remote = clean(s.data());
        if (remote._at > latest.current._at) setPrefs(remote);
      },
      () => {
        /* offline or not allowed - local prefs keep working */
      },
    );
  }, [user]);

  const commit = useCallback(
    (next) => {
      latest.current = next; // so a second change in the same tick builds on this one
      setPrefs(next);
      if (user) setDoc(doc(db, 'prefs', user.uid), { ...next, updatedAt: serverTimestamp() }).catch(() => {});
    },
    [user],
  );

  const update = useCallback((patch) => commit(clean({ ...latest.current, ...patch, _at: Date.now() })), [commit]);

  /** keys = only these go back to default (e.g. just the colours); none = everything */
  const reset = useCallback(
    (keys) => {
      const base = keys ? { ...latest.current, ...Object.fromEntries(keys.map((k) => [k, PREF_DEFAULTS[k]])) } : { ...PREF_DEFAULTS };
      commit(clean({ ...base, _at: Date.now() }));
    },
    [commit],
  );

  return <PrefsContext.Provider value={{ prefs, update, reset }}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
