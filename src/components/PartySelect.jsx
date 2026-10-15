import { useMemo, useRef, useState } from 'react';
import { Plus, Search, Check } from 'lucide-react';
import { useData } from '../context/DataContext';
import PartyForm from './PartyForm';

/**
 * Searchable party picker with inline "add new party". value = partyId (null = none).
 * With allowEmpty, a "none" option (e.g. "Walk-in customer") is offered and shown as the
 * chosen value when no party is selected.
 */
export default function PartySelect({ value, onChange, placeholder = 'Search party…', allowEmpty, emptyLabel = 'None', defaultType }) {
  const { parties } = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef();
  const blurTimer = useRef();

  const selected = parties.find((p) => p.id === value);
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = parties
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone || '').includes(s))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
      .map((p) => ({ key: p.id, party: p }));
    const showEmpty = allowEmpty && (!s || emptyLabel.toLowerCase().includes(s));
    return showEmpty ? [{ key: '__none', party: null }, ...list] : list;
  }, [parties, q, allowEmpty, emptyLabel]);

  const openList = () => {
    clearTimeout(blurTimer.current);
    if (!open) setActive(0);
    setOpen(true);
  };

  const pick = (p) => {
    onChange(p);
    setQ('');
    setOpen(false);
    input.current?.blur(); // closes the phone keyboard; the next tap opens the list again
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQ('');
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      openList();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter inside the picker must never submit the surrounding form (sale / purchase)
      e.preventDefault();
      if (open && options[active]) pick(options[active].party);
      else if (q.trim()) addNew();
    }
  };

  const addNew = () => {
    setNewName(q.trim());
    setOpen(false);
    setAdding(true);
  };

  // closed: show the chosen party, or the "none" option when nothing is chosen
  const shown = open ? q : selected?.name || (allowEmpty && !value ? emptyLabel : '');

  return (
    <div className="combo">
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <div className="input-group grow">
          <Search size={16} />
          <input
            ref={input}
            className="input"
            value={shown}
            placeholder={open ? placeholder : allowEmpty ? emptyLabel : placeholder}
            // opens on tap/typing/arrows - not on focus, so a modal that focuses it first
            // doesn't drop the list over the fields below
            onClick={openList}
            onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>
        <button type="button" className="btn btn-icon" onClick={() => { setNewName(q.trim()); setAdding(true); }} aria-label="Add new party" title="Add new party">
          <Plus size={18} />
        </button>
      </div>
      {open && (
        <div className="combo-list glass--large" role="listbox" onMouseDown={() => clearTimeout(blurTimer.current)}>
          {options.map((o, i) => {
            const chosen = o.party ? o.party.id === value : !value;
            return (
              <button
                type="button"
                key={o.key}
                className={`combo-item ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.party)}
                role="option"
                aria-selected={chosen}
              >
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                  <Check size={15} style={{ visibility: chosen ? 'visible' : 'hidden', flex: 'none' }} aria-hidden="true" />
                  {o.party ? <span className="cell-main">{o.party.name}</span> : <span className="muted">{emptyLabel}</span>}
                </span>
                {o.party && <span className="muted small">{o.party.phone}</span>}
              </button>
            );
          })}
          {!options.length &&
            (q.trim() ? (
              <button type="button" className="combo-item active" onMouseDown={(e) => e.preventDefault()} onClick={addNew}>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                  <Plus size={15} style={{ flex: 'none' }} aria-hidden="true" />
                  <span>
                    Add <b>“{q.trim()}”</b> as a new party
                  </span>
                </span>
                <span className="muted small">Enter</span>
              </button>
            ) : (
              <div className="muted small" style={{ padding: 12 }}>No party yet. Use + to add one.</div>
            ))}
        </div>
      )}
      <PartyForm
        open={adding}
        defaultType={defaultType}
        initialName={newName}
        onClose={(p) => {
          setAdding(false);
          setNewName('');
          setQ('');
          if (p) onChange(p);
        }}
      />
    </div>
  );
}
