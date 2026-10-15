// Click-to-sort for every `table.table` in the app (Settings → Tables & Lists → Click to sort).
// Works on the rendered rows, so no page needs its own sorting code. A MutationObserver re-applies
// the sort when live data (onSnapshot) adds, removes or changes rows, so the order stays put.
import { getPref } from './prefs';

const sorts = new WeakMap(); // table → { col, dir }
const observers = new WeakMap(); // tbody → MutationObserver
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** A comparable key for one cell: [0, number] for numbers, money and dates, [1, text] otherwise. */
function keyOf(cell) {
  const t = (cell?.innerText || '').trim().split('\n')[0].trim();
  if (!t || t === '—' || t === '-') return [2, ''];
  let m = t.match(/^(\d{1,2}) ([A-Za-z]{3,4}) (\d{4})$/); // 15 Oct 2026
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return [0, Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1])];
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // 15/10/2026
  if (m) return [0, Date.UTC(+m[3], +m[2] - 1, +m[1])];
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); // 2026-10-15
  if (m) return [0, Date.UTC(+m[1], +m[2] - 1, +m[3])];
  m = t.replace(/,/g, '').match(/^([−-])?\s*₹?\s*([−-])?(\d+(?:\.\d+)?)\s*(%|days?|devices?|Dr|Cr)?$/i); // ₹36,000 · −₹500 · 95% · 6,000.00 Dr
  if (m) {
    const neg = m[1] || m[2] || /^cr$/i.test(m[4] || '');
    return [0, (neg ? -1 : 1) * parseFloat(m[3])];
  }
  return [1, t.toLowerCase()];
}

function sortTable(table) {
  const s = sorts.get(table);
  const body = table.tBodies[0];
  if (!s || !body) return;
  const rows = [...body.rows];
  if (rows.length < 2 || rows.some((r) => r.cells.length === 1 && r.cells[0].colSpan > 1)) return;
  const keyed = rows.map((r, i) => ({ r, i, k: keyOf(r.cells[s.col]) }));
  keyed.sort((a, b) => {
    if (a.k[0] !== b.k[0]) return a.k[0] - b.k[0]; // blanks always last
    const c = a.k[0] === 1 ? a.k[1].localeCompare(b.k[1], undefined, { numeric: true }) : a.k[1] - b.k[1];
    return (c || a.i - b.i) * (a.k[0] === 2 ? 1 : s.dir);
  });
  if (keyed.every((x, i) => x.r === rows[i])) return;
  const obs = observers.get(body);
  obs?.disconnect();
  body.append(...keyed.map((x) => x.r));
  obs?.observe(body, { childList: true, subtree: true, characterData: true });
}

function watch(table) {
  const body = table.tBodies[0];
  if (!body || observers.has(body)) return;
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (table.isConnected) sortTable(table);
    });
  });
  obs.observe(body, { childList: true, subtree: true, characterData: true });
  observers.set(body, obs);
}

function onClick(e) {
  if (getPref('tableSort') !== 'on') return;
  const th = e.target.closest('table.table thead th');
  if (!th || !th.textContent.trim() || e.target.closest('button, a, input, select')) return;
  const table = th.closest('table');
  const col = th.cellIndex;
  const cur = sorts.get(table);
  const dir = cur && cur.col === col ? -cur.dir : th.classList.contains('num') ? -1 : 1; // numbers start high → low
  sorts.set(table, { col, dir });
  table.querySelectorAll('thead th').forEach((h) => h.removeAttribute('aria-sort'));
  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
  watch(table);
  sortTable(table);
}

let installed = false;
export function installTableSort() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', onClick);
}
