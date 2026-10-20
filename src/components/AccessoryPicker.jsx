import { useMemo, useRef, useState } from 'react';
import { Search, ScanLine, Plus } from 'lucide-react';
import { useData } from '../context/DataContext';
import { cleanSerial } from '../lib/accessories';
import { money } from '../lib/format';

/**
 * Find an accessory by name / brand / code, or scan its box barcode or a serial number.
 *   onPick(accessory, serial?)  serial is set when a serial number in stock was scanned
 *   onCreate(name)              optional "New accessory" entry
 *   inStockOnly                 sales: only items with stock
 */
export default function AccessoryPicker({ onPick, onCreate, inStockOnly = false, placeholder = 'Scan barcode / serial, or search accessory…' }) {
  const { accessories, accStock } = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const blur = useRef();

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return accessories
      .filter((a) => !inStockOnly || accStock.get(a.id)?.qty > 0)
      .filter(
        (a) =>
          !s ||
          a.name.toLowerCase().includes(s) ||
          (a.brand || '').toLowerCase().includes(s) ||
          (a.code || '').toLowerCase().includes(s) ||
          (a.category || '').toLowerCase().includes(s),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [accessories, accStock, q, inStockOnly]);

  // the list closes after a pick so it never covers the line just added; typing opens it again
  const pick = (a, serial) => {
    onPick(a, serial);
    setQ('');
    setOpen(false);
  };

  const onKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = q.trim().toUpperCase();
    if (!code) return;
    const byCode = accessories.find((a) => (a.code || '').toUpperCase() === code);
    if (byCode && (!inStockOnly || accStock.get(byCode.id)?.qty > 0)) return pick(byCode);
    const serial = cleanSerial(code);
    for (const a of accessories) {
      const st = accStock.get(a.id);
      if (st?.serials.get(serial)?.count > 0) return pick(a, serial);
    }
    if (matches.length === 1) pick(matches[0]);
  };

  return (
    <div className="combo">
      <div className="input-group">
        {q ? <Search size={16} /> : <ScanLine size={16} />}
        <input
          className="input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => (blur.current = setTimeout(() => setOpen(false), 150))}
          onKeyDown={onKey}
          aria-label="Find accessory"
        />
      </div>
      {open && (
        <div className="combo-list glass--large" onMouseDown={() => clearTimeout(blur.current)}>
          {matches.map((a) => {
            const st = accStock.get(a.id);
            return (
              <button type="button" key={a.id} className="combo-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)}>
                <span style={{ minWidth: 0 }}>
                  <span className="cell-main">{a.name}</span>
                  <div className="cell-sub">{[a.brand, a.code, a.track === 'serial' && 'Serial no.'].filter(Boolean).join(' · ')}</div>
                </span>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <span className={`chip plain ${st?.qty > 0 ? '' : 'urgent'}`}>{st?.qty > 0 ? `${st.qty} in stock` : 'No stock'}</span>
                  {a.salePrice > 0 && <span className="muted small num">{money(a.salePrice)}</span>}
                </span>
              </button>
            );
          })}
          {onCreate && (
            <button type="button" className="combo-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(q.trim()); setQ(''); setOpen(false); }}>
              <span className="cell-main"><Plus size={14} /> New accessory{q.trim() ? ` "${q.trim()}"` : ''}</span>
            </button>
          )}
          {!matches.length && !onCreate && <div className="muted small" style={{ padding: 12 }}>{inStockOnly ? 'No matching accessory in stock.' : 'No matching accessory.'}</div>}
        </div>
      )}
    </div>
  );
}
