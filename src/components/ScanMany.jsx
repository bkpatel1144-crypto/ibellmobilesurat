import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ScanLine } from 'lucide-react';
import { Modal, Field } from './ui';
import { beep } from '../lib/beep';
import { amountText, money, num } from '../lib/format';

/**
 * "Scan many": scan phones one after another (or paste a list of IMEIs / serials / barcodes from
 * WhatsApp or Excel), see every line checked at once, then add them all to the bill together.
 *   resolve(code, taken) → { ok: true, kind: 'device' | 'accessory', key, label, sub, add } | { ok: false, reason }
 *     taken = Set of keys already picked (on the bill or earlier in this list)
 *   takenOnBill = Set of keys already on the bill
 *   onAdd(results, price) - results: the ok lines, price: one selling price for every phone (optional)
 */
export default function ScanMany({ open, onClose, resolve, takenOnBill, onAdd }) {
  const [text, setText] = useState('');
  const [price, setPrice] = useState('');
  const box = useRef();
  const heard = useRef({ ok: 0, bad: 0 });

  useEffect(() => {
    if (!open) return;
    setText('');
    setPrice('');
    heard.current = { ok: 0, bad: 0 };
  }, [open]);

  // every finished line is checked; the last line is "in progress" until Enter / a new line
  const lines = useMemo(() => {
    const parts = text.split(/[\n,;\t]+/).map((x) => x.trim());
    const done = /[\n,;\t]\s*$/.test(text) ? parts.filter(Boolean) : parts.slice(0, -1).filter(Boolean);
    const taken = new Set(takenOnBill);
    return done.map((code) => {
      const r = resolve(code, taken);
      if (r.ok) taken.add(r.key);
      return { code, ...r };
    });
  }, [text, resolve, takenOnBill]);

  const good = lines.filter((l) => l.ok);
  const bad = lines.filter((l) => !l.ok);
  const phones = good.filter((l) => l.kind === 'device').length;

  // a sound per scan, so nobody has to look at the screen
  useEffect(() => {
    if (!open) return;
    if (good.length > heard.current.ok) beep('ok');
    else if (bad.length > heard.current.bad) beep('error');
    heard.current = { ok: good.length, bad: bad.length };
  }, [good.length, bad.length, open]);

  const add = () => {
    onAdd(good, num(price) > 0 ? num(price) : null);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan many" subtitle="Scan one after another, or paste a list - every line is checked as you go" size="wide">
      <div className="stack">
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Field label="IMEI / serial / barcode - one per line" hint="A scanner adds the new line by itself. Commas also work.">
            <textarea
              ref={box}
              className="textarea mono scan-many-box"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'356789012345678\n356789012345679\nAC-0002'}
              autoFocus
              aria-label="Codes to add"
            />
          </Field>
          <div className="stack-sm">
            <div className="row" style={{ gap: 8 }}>
              <span className="chip success">{good.length} ready</span>
              {bad.length > 0 && <span className="chip urgent">{bad.length} not added</span>}
            </div>
            <div className="scan-many-list" role="list" aria-label="Checked codes">
              {lines.length === 0 && (
                <div className="muted small" style={{ padding: 12 }}>
                  <ScanLine size={16} /> Start scanning - each phone shows here with a tick.
                </div>
              )}
              {[...lines].reverse().map((l, i) => (
                <div key={`${l.code}-${lines.length - i}`} className={`scan-many-row ${l.ok ? '' : 'bad'}`} role="listitem">
                  {l.ok ? <CheckCircle2 size={16} className="pos" /> : <XCircle size={16} className="neg" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-main">{l.ok ? l.label : l.code}</div>
                    <div className="cell-sub mono">{l.ok ? l.sub : l.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {phones > 0 && (
          <Field label="Selling price for each phone (optional)" hint="Fills every phone added now - you can still change any of them on the bill">
            <input className="input num" inputMode="decimal" style={{ maxWidth: 220 }} value={price} onChange={(e) => setPrice(amountText(e.target.value))} aria-label="Price for each phone" />
          </Field>
        )}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!good.length} onClick={add}>
            Add {good.length} item{good.length === 1 ? '' : 's'} to the bill{num(price) > 0 && phones ? ` · ${money(price)} each` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
