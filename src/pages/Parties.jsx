import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Users, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi } from '../components/ui';
import { ExportButtons } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import PartyForm from '../components/PartyForm';
import { partyBalances, balanceLabel } from '../lib/ledger';
import { money } from '../lib/format';

const TYPE_LABEL = { both: 'Buy & Sell', supplier: 'Supplier', customer: 'Customer', repairer: 'Repairer' };

export default function Parties() {
  const data = useData();
  const { parties, settings } = data;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);

  const balances = useMemo(() => partyBalances(parties, data), [parties, data]);

  const stats = useMemo(() => {
    const m = new Map();
    for (const p of parties) m.set(p.id, { sold: 0, bought: 0 });
    data.sales.forEach((s) => m.get(s.partyId) && (m.get(s.partyId).sold += s.items.length));
    data.purchases.forEach((p) => m.get(p.partyId) && (m.get(p.partyId).bought += p.items.length));
    return m;
  }, [parties, data.sales, data.purchases]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return parties
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone || '').includes(s))
      .filter((p) => {
        const b = balances.get(p.id) || 0;
        if (filter === 'receive') return b > 0.004;
        if (filter === 'pay') return b < -0.004;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parties, q, filter, balances]);

  let receive = 0;
  let pay = 0;
  balances.forEach((v) => (v > 0 ? (receive += v) : (pay -= v)));

  const exportSpec = () => ({
    settings,
    title: 'Party Balances',
    filename: 'party-balances',
    columns: [
      { header: 'Party', key: 'name' },
      { header: 'Phone', key: 'phone' },
      { header: 'Type', key: 'type' },
      { header: 'To receive', key: 'rec', money: true },
      { header: 'To pay', key: 'pay', money: true },
    ],
    rows: rows.map((p) => {
      const b = balances.get(p.id) || 0;
      return { name: p.name, phone: p.phone, type: TYPE_LABEL[p.type] || p.type, rec: b > 0 ? b : 0, pay: b < 0 ? -b : 0 };
    }),
    foot: { name: 'Total', rec: receive, pay },
  });

  const pg = usePaged(rows, {
    resetOn: [q, filter],
    // balance sorts signed: biggest "to receive" first, "to pay" at the end
    sort: [(p) => p.name, (p) => TYPE_LABEL[p.type] || p.type, (p) => stats.get(p.id)?.bought || 0, (p) => stats.get(p.id)?.sold || 0, (p) => balances.get(p.id) || 0],
  });

  return (
    <div className="page">
      <PageHeader
        title="Parties"
        subtitle="People and shops you buy from and sell to"
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New Party
          </button>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={Users} label="Parties" value={parties.length} />
          <Kpi icon={ArrowDownLeft} label="Total to receive" value={money(receive)} />
          <Kpi icon={ArrowUpRight} label="Total to pay" value={money(pay)} />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented
              label="Balance filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'receive', label: 'To receive' },
                { value: 'pay', label: 'To pay' },
              ]}
            />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={exportSpec} small />
            </div>
          </div>
          {rows.length ? (
            <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr>
                    <th>Party</th>
                    <th>Type</th>
                    <th className="num">Bought from</th>
                    <th className="num">Sold to</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((p) => {
                    const b = balances.get(p.id) || 0;
                    const st = stats.get(p.id);
                    return (
                      <tr key={p.id} className="clickable" onClick={() => navigate(`/parties/${p.id}`)}>
                        <td>
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">{p.phone}</div>
                        </td>
                        <td><span className="chip plain">{TYPE_LABEL[p.type] || p.type}</span></td>
                        <td className="num">{st?.bought || 0} devices</td>
                        <td className="num">{st?.sold || 0} devices</td>
                        <td className="num">
                          <div className={`cell-main ${b > 0.004 ? 'pos' : b < -0.004 ? 'neg' : ''}`}>{money(Math.abs(b))}</div>
                          <div className="cell-sub">{balanceLabel(b)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Users} title="No parties" action={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> New Party</button>} />
          )}
        </section>
      </div>
      <PartyForm open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

export { TYPE_LABEL };
