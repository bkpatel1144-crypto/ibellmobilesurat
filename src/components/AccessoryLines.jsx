import { Link } from 'react-router-dom';
import { accLines, accReturned, lineQty, warrantyEnd } from '../lib/accessories';
import { money, num, fmtDate, today } from '../lib/format';

/**
 * Accessory lines of a bill or a return note.
 *   kind: 'purchase' | 'sale' | 'return'
 *   returns + billId: show how many pieces already came back on notes (bills only)
 *   date: the bill date, for "warranty till" (sales)
 */
export default function AccessoryLines({ doc, kind, returns = [], showCost = false }) {
  const lines = accLines(doc);
  if (!lines.length) return null;
  const isReturn = kind === 'return';
  const gst = kind === 'sale' && num(doc.tax) > 0;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Accessory</th>
            <th className="num">Qty</th>
            {!isReturn && <th className="num">Rate</th>}
            {gst && <th className="num">GST</th>}
            {kind === 'sale' && <th>Warranty</th>}
            {showCost && kind === 'sale' && <th className="num">Cost</th>}
            <th className="num">{isReturn ? (doc.kind === 'sale' ? 'Credited' : 'Debited') : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const back = isReturn ? null : accReturned(returns.filter((x) => x.kind === (kind === 'sale' ? 'sale' : 'purchase')), doc.id, l.accessoryId);
            const end = kind === 'sale' ? warrantyEnd(doc.date, l.warranty) : '';
            return (
              <tr key={l.accessoryId}>
                <td>
                  <div className="cell-main"><Link to={`/accessories/${l.accessoryId}`}>{l.name}</Link></div>
                  <div className="cell-sub">{[l.brand, l.code, l.hsn && `HSN ${l.hsn}`].filter(Boolean).join(' · ')}</div>
                  {(l.serials || []).length > 0 && (
                    <div className="cell-sub mono">
                      {l.serials.map((s, i) => (
                        <span key={s}>
                          {i > 0 && ', '}
                          <Link to={`/timeline/${encodeURIComponent(s)}`}>{s}</Link>
                          {back?.serials.has(s) && ' (returned)'}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="num">
                  {lineQty(l)}
                  {back?.qty > 0 && <div><span className="chip plain">{back.qty} returned</span></div>}
                </td>
                {!isReturn && <td className="num">{money(l.rate)}</td>}
                {gst && <td className="num">{money(l.gst)}</td>}
                {kind === 'sale' && (
                  <td className="small">
                    {l.warranty || '—'}
                    {end && <div className="cell-sub">till {fmtDate(end)}{end < today() ? ' · expired' : ''}</div>}
                  </td>
                )}
                {showCost && kind === 'sale' && <td className="num">{money(l.cost)}</td>}
                <td className="num cell-main">{money(isReturn ? l.value : l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
