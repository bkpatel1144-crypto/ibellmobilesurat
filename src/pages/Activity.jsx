import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, getDocs, limit, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { ScrollText, Search } from 'lucide-react';
import { db } from '../firebase';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, SkeletonPage } from '../components/ui';
import { DateRange, ExportButtons, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { ACTIVITY_KEEP_DAYS } from '../lib/db';
import { money, toISODate, inRange } from '../lib/format';

const ACTIONS = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  login: 'Signed in',
  'repair-sent': 'Sent to repair',
  'repair-done': 'Repair done',
  'audit-start': 'Audit started',
  'audit-done': 'Audit completed',
  private: 'Made private',
  public: 'Made visible',
};

const ENTITIES = {
  sale: 'Bill',
  purchase: 'Purchase',
  return: 'Return',
  payment: 'Payment',
  transfer: 'Transfer',
  expense: 'Expense',
  party: 'Party',
  bank: 'Bank account',
  device: 'Device',
  repair: 'Repair',
  audit: 'Stock audit',
  settings: 'Settings',
  team: 'Team',
  session: 'Session',
};

const LINKS = { sale: '/sales/', purchase: '/purchases/', return: '/returns/', party: '/parties/', audit: '/audit/' };

/** Only the newest entries are streamed; older ones are removed automatically after ACTIVITY_KEEP_DAYS. */
const LIVE_LIMIT = 3000;

export default function Activity() {
  const { raw, purchases, sales, parties, settings, privacy } = useData();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [who, setWho] = useState('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');

  // clean up entries older than ACTIVITY_KEEP_DAYS (a Firestore TTL policy on `expireAt` does the same server-side)
  useEffect(() => {
    getDocs(query(collection(db, 'activity'), where('expireAt', '<', Timestamp.now()), limit(300)))
      .then((snap) => Promise.all(snap.docs.map((d) => deleteDoc(d.ref))))
      .catch(() => {});
  }, []);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'activity'), orderBy('at', 'desc'), limit(LIVE_LIMIT)),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
        setError,
      ),
    [],
  );

  // private view: hide entries about private sales and privately sold phones
  const visible = useMemo(() => {
    if (!rows) return [];
    if (privacy.unlocked) return rows;
    const hiddenDevices = new Set(raw.devices.filter((d) => d.hidden).map((d) => d.id));
    const shown = new Map(purchases.map((p) => [p.id, p]));
    return rows
      .filter((r) => {
        if (r.hidden) return false;
        // a purchase stays in the log as long as the purchase itself is visible (only its private phones are gone)
        if (r.entity === 'purchase') return r.action === 'delete' || shown.has(r.refId);
        return !(r.deviceIds || []).some((id) => hiddenDevices.has(id));
      })
      .map((r) => {
        const p = r.entity === 'purchase' && shown.get(r.refId);
        // device count as the locked view shows it, so the log never reveals a privately sold phone
        return p && r.action === 'create' ? { ...r, note: `${p.items.length} device(s) from ${p.partyName}`, amount: p.total } : r;
      });
  }, [rows, privacy.unlocked, raw.devices, purchases]);

  // purchase numbers follow the (gap-free) numbers shown in the rest of the app
  const label = useMemo(() => {
    const pNo = new Map(purchases.map((p) => [p.id, p.purchaseNo]));
    const sNo = new Map(sales.map((s) => [s.id, s.invoiceNo]));
    const party = new Map(parties.map((p) => [p.id, p.name]));
    return (r) => (r.entity === 'purchase' && pNo.get(r.refId)) || (r.entity === 'sale' && sNo.get(r.refId)) || (r.entity === 'party' && party.get(r.refId)) || r.refNo || '';
  }, [purchases, sales, parties]);

  const people = useMemo(() => [...new Set(visible.map((r) => r.by).filter(Boolean))].sort(), [visible]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return visible
      .map((r) => ({ ...r, ms: r.at?.toMillis?.() || 0 }))
      .filter((r) => inRange(toISODate(r.ms || Date.now()), range.from, range.to))
      .filter((r) => who === 'all' || r.by === who)
      .filter((r) => kind === 'all' || r.entity === kind)
      .filter((r) => !s || `${label(r)} ${r.note} ${r.by} ${ENTITIES[r.entity]} ${ACTIONS[r.action]}`.toLowerCase().includes(s));
  }, [visible, range, who, kind, q, label]);

  const pg = usePaged(list, {
    resetOn: [range, who, kind, q],
    sort: [(r) => r.ms, (r) => r.by, (r) => ACTIONS[r.action] || r.action, (r) => label(r), (r) => r.amount],
  });

  const when = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

  const spec = () => ({
    settings,
    title: 'Activity Log',
    filename: `activity-${range.from || 'all'}-${range.to || 'all'}`,
    landscape: true,
    columns: [
      { header: 'When', key: 'when' },
      { header: 'Who', key: 'by' },
      { header: 'Action', key: 'action' },
      { header: 'Record', key: 'record' },
      { header: 'Details', key: 'note' },
      { header: 'Amount', key: 'amount', money: true },
    ],
    rows: list.map((r) => ({
      when: when(r.ms),
      by: r.by,
      action: `${ACTIONS[r.action] || r.action} ${ENTITIES[r.entity] || r.entity}`,
      record: label(r),
      note: r.note,
      amount: r.amount ?? '',
    })),
  });

  if (error) {
    return (
      <div className="page">
        <PageHeader title="Activity Log" />
        <div className="card"><Empty icon={ScrollText} title="Can't load the activity log">{error.message}</Empty></div>
      </div>
    );
  }
  if (!rows) return <SkeletonPage />;

  return (
    <div className="page">
      <PageHeader
        title="Activity Log"
        subtitle={`Who did what · kept ${ACTIVITY_KEEP_DAYS} days, then removed automatically`}
        actions={<ExportButtons build={spec} />}
      />
      <section className="card card-lg">
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} />
            <input className="input" placeholder="Search bill no., party, details…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <DateRange value={range} onChange={setRange} />
          <select className="select" style={{ width: 210 }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
            <option value="all">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="select" style={{ width: 170 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Record type">
            <option value="all">All records</option>
            {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {list.length ? (
          <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => {
                    const link = r.action !== 'delete' && LINKS[r.entity] && r.refId ? `${LINKS[r.entity]}${r.refId}` : null;
                    return (
                      <tr key={r.id}>
                        <td className="tnum small">{when(r.ms)}</td>
                        <td className="small">{r.by}</td>
                        <td>
                          <span className={`chip ${r.action === 'delete' ? 'urgent' : r.action === 'create' ? 'success' : 'plain'}`}>
                            {ACTIONS[r.action] || r.action}
                          </span>{' '}
                          <span className="small muted">{ENTITIES[r.entity] || r.entity}</span>
                        </td>
                        <td>
                          <div className="cell-main">{link ? <Link to={link}>{label(r)}</Link> : label(r) || '—'}</div>
                          {r.note && <div className="cell-sub">{r.note}</div>}
                        </td>
                        <td className="num">{r.amount !== null && r.amount !== undefined ? money(r.amount) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
          </>
        ) : (
          <Empty icon={ScrollText} title="Nothing in this period" />
        )}
      </section>
    </div>
  );
}
