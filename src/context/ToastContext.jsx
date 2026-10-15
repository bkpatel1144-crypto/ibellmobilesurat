import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

const ToastContext = createContext(() => {});

/** One toast at a time - a new one replaces the old (§5.3 I). */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const show = useCallback((message, type = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, type, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), type === 'error' ? 5000 : 2800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.key} className="toast glass--large" role={toast.type === 'error' ? 'alert' : 'status'}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
