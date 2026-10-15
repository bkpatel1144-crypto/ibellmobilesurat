import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';

/**
 * "⋯ More" button for less-used actions, so page headers keep the title readable.
 *   items: [{ label, icon: Icon, onClick?, to?, danger?, hidden?, disabled? }]
 * The list is portalled (headers scroll sideways on phones and would clip it).
 */
export default function MoreMenu({ items, label = 'More actions', small = false }) {
  const list = items.filter((i) => i && !i.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(0);
  const btn = useRef();
  const pop = useRef();
  const navigate = useNavigate();

  // open below the button, or above it when the screen has no room below (rows near the bottom)
  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current.getBoundingClientRect();
    const width = 232;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const height = list.length * 40 + 10; // items are 40px + the list padding
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    if (height <= below || below >= above) setPos({ top: r.bottom + 8, left, width, maxHeight: below, transformOrigin: 'top right' });
    else setPos({ top: Math.max(8, r.top - 8 - Math.min(height, above)), left, width, maxHeight: above, transformOrigin: 'bottom right' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !pop.current?.contains(e.target) && !btn.current?.contains(e.target) && setOpen(false);
    // the page scrolling moves the button away, so close - but not when the list itself scrolls
    const shut = (e) => !(e.target instanceof Node && pop.current?.contains(e.target)) && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos) pop.current?.querySelectorAll('[role=menuitem]')[active]?.focus();
  }, [open, pos, active]);

  if (!list.length) return null;

  const run = (item) => {
    setOpen(false);
    btn.current?.focus();
    if (item.to) navigate(item.to);
    else item.onClick?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + list.length) % list.length);
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`btn btn-icon ${small ? 'btn-sm' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
      >
        <Ellipsis size={small ? 16 : 18} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} className="more-menu glass--large" role="menu" aria-label={label} style={pos} onKeyDown={onKey}>
            {list.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={i === active ? 0 : -1}
                  className={`more-item ${item.danger ? 'danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => run(item)}
                  onMouseEnter={() => setActive(i)}
                >
                  {Icon && <Icon size={16} aria-hidden="true" />}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
