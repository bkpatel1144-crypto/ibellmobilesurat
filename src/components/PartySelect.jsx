import { useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useData } from '../context/DataContext';
import PartyForm from './PartyForm';

/** Searchable party picker with inline "add new party". value = partyId */
export default function PartySelect({ value, onChange, placeholder = 'Search party…', allowEmpty, emptyLabel = 'None', defaultType }) {
  const { parties } = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef();

  const selected = parties.find((p) => p.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return parties
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone || '').includes(s))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [parties, q]);

  const pick = (p) => {
    onChange(p);
    setQ('');
    setOpen(false);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    }
  };

  return (
    <div className="combo">
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <div className="input-group grow">
          <Search size={16} />
          <input
            className="input"
            value={open ? q : selected?.name || ''}
            placeholder={selected ? selected.name : placeholder}
            onFocus={() => {
              setOpen(true);
              setActive(0);
            }}
            onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded={open}
          />
        </div>
        <button type="button" className="btn btn-icon" onClick={() => setAdding(true)} aria-label="Add new party" title="Add new party">
          <Plus size={18} />
        </button>
      </div>
      {open && (
        <div className="combo-list glass--large" role="listbox" onMouseDown={() => clearTimeout(blurTimer.current)}>
          {allowEmpty && (
            <button type="button" className="combo-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(null)}>
              <span className="muted">{emptyLabel}</span>
            </button>
          )}
          {list.map((p, i) => (
            <button
              type="button"
              key={p.id}
              className={`combo-item ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              role="option"
              aria-selected={p.id === value}
            >
              <span className="cell-main">{p.name}</span>
              <span className="muted small">{p.phone}</span>
            </button>
          ))}
          {!list.length && <div className="muted small" style={{ padding: 12 }}>No party found. Use + to add one.</div>}
        </div>
      )}
      <PartyForm
        open={adding}
        defaultType={defaultType}
        onClose={(p) => {
          setAdding(false);
          if (p) onChange(p);
        }}
      />
    </div>
  );
}
