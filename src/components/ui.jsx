import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Inbox } from 'lucide-react';

/* ------------------------------------------------------------------ Modal (§6.4) */
export function Modal({ open, onClose, title, subtitle, children, footer, size, labelledBy }) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // runs only when the dialog opens/closes - callers pass a new onClose every render
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeRef.current?.();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    const t = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) {
        ref.current?.querySelector('input:not([type=hidden]):not([type=file]),select,textarea,button:not(.modal-close)')?.focus();
      }
    }, 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        className={`modal glass--large ${size || ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted small" style={{ margin: '4px 0 0' }}>{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm modal-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Confirm */
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  const dialog = (
    <Modal
      open={Boolean(state)}
      onClose={() => close(false)}
      title={state?.title || 'Are you sure?'}
      size="narrow"
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(false)}>Cancel</button>
          <button className={`btn ${state?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
            {state?.confirmText || 'Confirm'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>{state?.message}</p>
    </Modal>
  );
  return [dialog, confirm];
}

/* ------------------------------------------------------------------ Segmented control (§6.2) */
export function Segmented({ options, value, onChange, label }) {
  const wrap = useRef();
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector('[aria-selected="true"]');
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options]);

  const onKey = (e) => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight') onChange(options[(i + 1) % options.length].value);
    if (e.key === 'ArrowLeft') onChange(options[(i - 1 + options.length) % options.length].value);
  };

  return (
    <div className="seg" role="tablist" aria-label={label} ref={wrap} onKeyDown={onKey}>
      {pill && <span className="seg-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */
export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={40} strokeWidth={1.5} />
      <h3>{title}</h3>
      {children && <p style={{ margin: '0 0 16px' }}>{children}</p>}
      {action}
    </div>
  );
}

export function Kpi({ icon: Icon, label, value, sub, inverse }) {
  return (
    <div className={`kpi ${inverse ? 'inverse' : ''}`}>
      <div className="kpi-label">
        {Icon && <Icon size={16} />}
        {label}
      </div>
      <div className="kpi-value" key={value} title={String(value)}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 104 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 320 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}

const STATUS = {
  in_stock: ['In stock', 'success'],
  in_repair: ['In repair', 'caution'],
  sold: ['Sold', ''],
  done: ['Repaired', 'success'],
};

export function StatusChip({ status }) {
  const [label, cls] = STATUS[status] || [status, ''];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export function Field({ label, required, children, hint, style }) {
  return (
    <label className="field" style={style}>
      <span>
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {hint && <span className="xs muted">{hint}</span>}
    </label>
  );
}

/** Hook: tracks whether the window has scrolled, for the soft scroll edge (§5.3 H) */
export function useScrolled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = () => setOn(window.scrollY > 8);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  return on;
}
