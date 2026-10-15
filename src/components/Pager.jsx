import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZES } from '../lib/usePaged';

/** Page numbers to show: 1 … 4 5 [6] 7 8 … 20 */
function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((p) => set.add(p));
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => {
    if (i && p - list[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

/** Standard table footer: "Showing 26–50 of 132", rows per page, page buttons. */
export default function Pager({ page, pages, size, total, onPage, onSize }) {
  if (!total) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div className="pager">
      <span className="pager-count">
        Showing <b className="num">{from}–{to}</b> of <b className="num">{total}</b>
      </span>
      <label className="pager-size">
        <span>Rows per page</span>
        <select className="select" value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      {pages > 1 && (
        <nav className="pager-nav" aria-label="Pagination">
          <button type="button" className="pager-btn" onClick={() => onPage(1)} disabled={page === 1} aria-label="First page">
            <ChevronsLeft size={16} />
          </button>
          <button type="button" className="pager-btn" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`gap${i}`} className="pager-gap" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`pager-btn ${p === page ? 'on' : ''}`}
                onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className="pager-btn" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="pager-btn" onClick={() => onPage(pages)} disabled={page === pages} aria-label="Last page">
            <ChevronsRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
