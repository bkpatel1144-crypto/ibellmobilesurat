import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefs } from '../context/PrefsContext';
import { getPref } from './prefs';

export const PAGE_SIZES = [10, 25, 50, 100];

const blank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

function compare(a, b) {
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Pagination + whole-list sorting for a table.
 *   rows     - the full, filtered list
 *   sort     - one value function per column (index = column), or null for columns that don't sort
 *   resetOn  - values that, when they change (filters, search), send the user back to page 1
 * Returns { rows (this page), tableProps (spread on <table>), pager (spread on <Pager>) }.
 * Header clicks sort the whole list (not just the visible page); live data updates keep the page.
 */
export function usePaged(rows, { sort = [], resetOn = [] } = {}) {
  const { prefs, update } = usePrefs();
  const size = PAGE_SIZES.includes(Number(prefs.pageSize)) ? Number(prefs.pageSize) : 25;
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState(null); // { col, dir }
  const table = useRef();
  const sortRef = useRef(sort);
  sortRef.current = sort;

  useEffect(() => setPage(1), resetOn); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const f = order && sortRef.current[order.col];
    if (!f) return rows;
    return rows
      .map((r, i) => ({ r, i, k: f(r) }))
      .sort((a, b) => {
        const c = compare(a.k, b.k);
        if (blank(a.k) || blank(b.k)) return c || a.i - b.i; // blanks stay last either way
        return c * order.dir || a.i - b.i;
      })
      .map((x) => x.r);
  }, [rows, order]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages);
  const pageRows = useMemo(() => sorted.slice((current - 1) * size, current * size), [sorted, current, size]);

  // arrows on the sorted header
  useEffect(() => {
    table.current?.querySelectorAll('thead th').forEach((th, i) => {
      if (order && order.col === i) th.setAttribute('aria-sort', order.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
      th.toggleAttribute('data-sortable', Boolean(sortRef.current[i]));
    });
  });

  const onClick = (e) => {
    const th = e.target.closest('thead th');
    if (!th || getPref('tableSort') !== 'on' || !sortRef.current[th.cellIndex]) return;
    const col = th.cellIndex;
    setOrder((o) => (o && o.col === col ? { col, dir: -o.dir } : { col, dir: th.classList.contains('num') ? -1 : 1 }));
    setPage(1);
  };

  return {
    rows: pageRows,
    tableProps: { ref: table, onClick, 'data-managed-sort': '' },
    pager: {
      page: current,
      pages,
      size,
      total: sorted.length,
      onPage: (p) => setPage(Math.min(Math.max(1, p), pages)),
      onSize: (n) => {
        update({ pageSize: String(n) });
        setPage(1);
      },
    },
  };
}
