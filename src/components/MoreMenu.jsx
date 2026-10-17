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

  // below the button, or above it when the screen has no room below (rows near the bottom).
  // Returns false once the button has left the screen.
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return false;
    const width = 232;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const height = list.length * 40 + 10; // items are 40px + the list padding
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    if (height <= below || below >= above) setPos({ top: r.bottom + 8, left, width, maxHeight: below, transformOrigin: 'top right' });
    else setPos({ top: Math.max(8, r.top - 8 - Math.min(height, above)), left, width, maxHeight: above, transformOrigin: 'bottom right' });
    return true;
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(() => {
    if (open) placeRef.current();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !pop.current?.contains(e.target) && !btn.current?.contains(e.target) && setOpen(false);
    // the page scrolling: follow the button (a small scroll right after a tap must not close it)
    const follow = (e) => {
      if (e.target instanceof Node && pop.current?.contains(e.target)) return; // the list itself scrolling
      if (!placeRef.current()) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) pop.current?.querySelectorAll('[role=menuitem]')[active]?.focus({ preventScroll: true });
  }, [open, Boolean(pos), active]); // eslint-disable-line react-hooks/exhaustive-deps

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
