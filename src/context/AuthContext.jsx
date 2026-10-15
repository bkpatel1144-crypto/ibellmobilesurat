import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);

  return (
    <AuthContext.Provider value={{ user, logout: () => signOut(auth) }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
