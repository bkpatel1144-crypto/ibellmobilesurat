import { useMemo, useState } from 'react';
import { IndianRupee, TrendingUp, Receipt, ShoppingBag, ShoppingCart, Percent, Boxes, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Kpi } from '../components/ui';
import { DateRange, ExportButtons, PRESETS, defaultRange } from '../components/Filters';
import { MoneyBars, BarList } from '../components/Charts';
import { money, num, round2, inRange, monthKey, fmtMonth, fmtDate, fmtDateShort, addDays, today, deviceName } from '../lib/format';

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '0.0%');

export default function Analysis() {
  const { sales, purchases, expenses, devices, payments, settings, returns } = useData();
  const [range, setRange] = useState(defaultRange);

  const r = useMemo(() => {
    const S = sales.filter((s) => inRange(s.date, range.from, range.to));
    const P = purchases.filter((p) => inRange(p.date, range.from, range.to));
    const E = expenses.filter((e) => inRange(e.date, range.from, range.to));
    const PAY = payments.filter((p) => inRange(p.date, range.from, range.to));
    // returns land in the period they are made (as the GST credit / debit note does)
    const SR = returns.filter((x) => x.kind === 'sale' && inRange(x.date, range.from, range.to));
    const PR = returns.filter((x) => x.kind === 'purchase' && inRange(x.date, range.from, range.to));
    const sum = (arr, f) => arr.reduce((t, x) => t + num(f(x)), 0);

    const grossSales = sum(S, (s) => s.total);
    const salesReturns = sum(SR, (x) => x.total);
    const revenue = grossSales - salesReturns;
    const tax = sum(S, (s) => s.tax) - sum(SR, (x) => x.tax);
    const cogs = sum(S, (s) => s.cost) - sum(SR, (x) => x.cost);
    const prGain = sum(PR, (x) => x.profit); // + gain / − loss on phones sent back
    const gross = sum(S, (s) => s.profit) - sum(SR, (x) => x.profit) + prGain;
    const exp = sum(E, (e) => e.amount);
    const sold = S.reduce((t, s) => t + s.items.length, 0) - SR.reduce((t, x) => t + x.items.length, 0);
    const bought = P.reduce((t, p) => t + p.items.length, 0) - PR.reduce((t, x) => t + x.items.length, 0);
    const purchGross = sum(P, (p) => p.total);
    const purchReturns = sum(PR, (x) => x.total);

    // time series - by day for short ranges, by month otherwise
    const from = range.from || [...S, ...P].map((x) => x.date).sort()[0] || today();
    const to = range.to || today();
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const daily = days <= 45;
    const keyOf = (d) => (daily ? d : monthKey(d));
    const buckets = new Map();
    if (daily) for (let i = 0; i < days; i += 1) buckets.set(addDays(from, i), { rev: 0, net: 0, n: 0 });
    else {
      let k = monthKey(from);
      while (k <= monthKey(to)) {
        buckets.set(k, { rev: 0, net: 0, n: 0 });
        const d = new Date(`${k}-01T00:00:00`);
        d.setMonth(d.getMonth() + 1);
        k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }
    for (const s of S) {
      const b = buckets.get(keyOf(s.date));
      if (b) {
        b.rev += num(s.total);
        b.net += num(s.profit);
        b.n += 1;
      }
    }
    for (const e of E) {
      const b = buckets.get(keyOf(e.date));
      if (b) b.net -= num(e.amount);
    }
    for (const x of SR) {
      const b = buckets.get(keyOf(x.date));
      if (b) {
        b.rev -= num(x.total);
        b.net -= num(x.profit);
      }
    }
    for (const x of PR) {
      const b = buckets.get(keyOf(x.date));
      if (b) b.net += num(x.profit);
    }
    const label = (k) => (daily ? fmtDateShort(k) : fmtMonth(k));
    const full = (k) => (daily ? fmtDate(k) : fmtMonth(k));
    const revSeries = [...buckets.entries()].map(([k, b]) => ({ label: label(k), fullLabel: full(k), value: round2(b.rev), count: b.n }));
    const netSeries = [...buckets.entries()].map(([k, b]) => ({ label: label(k), fullLabel: full(k), value: round2(b.net) }));

    // brand / condition / model
    const group = (keyFn) => {
      const m = new Map();
      for (const s of S)
        for (const it of s.items) {
          const k = keyFn(it);
          const g = m.get(k) || { key: k, n: 0, rev: 0, cost: 0 };
          g.n += 1;
          g.rev += num(it.price);
          g.cost += num(it.cost);
          m.set(k, g);
        }
      for (const x of SR)
        for (const it of x.items) {
          const g = m.get(keyFn(it));
          if (!g) continue;
          g.n -= 1;
          g.rev -= num(it.value);
          g.cost -= num(it.cost);
        }
      return [...m.values()].filter((g) => g.n > 0).map((g) => ({ ...g, profit: g.rev - g.cost })).sort((a, b) => b.rev - a.rev);
    };
    const brands = group((it) => it.brand || 'Other');
    const conds = group((it) => it.condition || 'Used');
    const models = group((it) => `${it.brand} ${it.model}`).slice(0, 10);

    // parties
    const cust = new Map();
    for (const s of S) {
      const k = s.partyId || `walkin`;
      const g = cust.get(k) || { label: s.partyId ? s.customerName : 'Walk-in customers', value: 0, n: 0 };
      g.value += num(s.total);
      g.n += s.items.length;
      cust.set(k, g);
    }
    for (const x of SR) {
      const g = cust.get(x.partyId || 'walkin');
      if (g) {
        g.value -= num(x.total);
        g.n -= x.items.length;
      }
    }
    const sup = new Map();
    for (const p of P) {
      const g = sup.get(p.partyId) || { label: p.partyName, value: 0, n: 0 };
      g.value += num(p.total);
      g.n += p.items.length;
      sup.set(p.partyId, g);
    }
    for (const x of PR) {
      const g = sup.get(x.partyId);
      if (g) {
        g.value -= num(x.total);
        g.n -= x.items.length;
      }
    }
    const expCat = new Map();
    for (const e of E) expCat.set(e.category, (expCat.get(e.category) || 0) + num(e.amount));
    const modes = new Map();
    for (const p of PAY.filter((x) => x.direction === 'in')) modes.set(p.mode, (modes.get(p.mode) || 0) + num(p.amount));

    const stock = devices.filter((d) => d.status === 'in_stock');
    const ageOf = (d) => Math.round((new Date(today()) - new Date(d.purchaseDate)) / 86400000);
    const aging = stock
      .map((d) => ({ d, age: ageOf(d) }))
      .filter((x) => x.age >= 30)
      .sort((a, b) => b.age - a.age)
      .slice(0, 10);

    return {
      revenue,
      tax,
      cogs,
      gross,
      exp,
      net: gross - exp,
      purchTotal: purchGross - purchReturns,
      purchGross,
      purchReturns,
      grossSales,
      salesReturns,
      srCount: SR.length,
      prCount: PR.length,
      prGain,
      sold,
      bought,
      bills: S.length,
      avg: sold ? (revenue - tax) / sold : 0,
      stockValue: sum(stock, (d) => num(d.purchasePrice) + num(d.repairCost)),
      stockCount: stock.length,
      revSeries,
      netSeries,
      daily,
      brands,
      conds,
      models,
      customers: [...cust.values()].filter((g) => g.n > 0).sort((a, b) => b.value - a.value).slice(0, 8).map((g) => ({ ...g, sub: `${g.n} devices` })),
      suppliers: [...sup.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((g) => ({ ...g, sub: `${g.n} devices` })),
      expCat: [...expCat.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      modes: [...modes.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      aging,
    };
  }, [sales, purchases, expenses, devices, payments, returns, range]);

  const period = `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`;

  const plSpec = () => ({
    settings,
    title: 'Profit & Loss Summary',
    filename: `profit-loss-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [['Period', period]],
    columns: [
      { header: 'Particulars', key: 'k' },
      { header: 'Amount', key: 'v', money: true },
    ],
    rows: [
      { k: `Sales (${r.bills} bills)`, v: r.grossSales },
      ...(r.srCount ? [{ k: `Less: Sales returns (${r.srCount} credit notes)`, v: r.salesReturns }] : []),
      { k: `Net sales (${r.sold} devices)`, v: r.revenue },
      { k: 'Less: GST collected', v: r.tax },
      { k: 'Less: Cost of devices sold (incl. repair)', v: r.cogs },
      ...(r.prCount ? [{ k: `${r.prGain >= 0 ? 'Add: Gain' : 'Less: Loss'} on purchase returns`, v: Math.abs(r.prGain) }] : []),
      { k: 'Gross profit', v: r.gross },
      { k: 'Less: Expenses', v: r.exp },
      { k: 'Net profit', v: r.net },
      { k: 'Purchases in period', v: r.purchGross },
      ...(r.prCount ? [{ k: `Less: Purchase returns (${r.prCount} debit notes)`, v: r.purchReturns }] : []),
      { k: `Net purchases (${r.bought} devices)`, v: r.purchTotal },
      { k: `Closing stock value (${r.stockCount} devices)`, v: r.stockValue },
    ],
  });

  const brandSpec = () => ({
    settings,
    title: 'Brand-wise Sales',
    filename: `brand-sales-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [['Period', period]],
    columns: [
      { header: 'Brand', key: 'key' },
      { header: 'Devices', key: 'n' },
      { header: 'Revenue', key: 'rev', money: true },
      { header: 'Cost', key: 'cost', money: true },
      { header: 'Profit', key: 'profit', money: true },
      { header: 'Margin', key: 'm' },
    ],
    rows: r.brands.map((b) => ({ ...b, m: pct(b.profit, b.rev) })),
    foot: { key: 'Total', n: r.sold, rev: r.brands.reduce((s, b) => s + b.rev, 0), cost: r.brands.reduce((s, b) => s + b.cost, 0), profit: r.brands.reduce((s, b) => s + b.profit, 0) },
  });

  return (
    <div className="page">
      <PageHeader title="Analysis" subtitle={period} actions={<ExportButtons build={plSpec} />} />
      <div className="stack">
        <div className="card" style={{ padding: 12 }}>
          <DateRange value={range} onChange={setRange} />
        </div>

        <div className="kpis cascade">
          <Kpi inverse icon={IndianRupee} label="Net sales" value={money(r.revenue)} sub={r.srCount ? `${r.bills} bills · less ${money(r.salesReturns)} returns` : `${r.bills} bills · ${r.sold} devices`} />
          <Kpi icon={TrendingUp} label="Gross profit" value={money(r.gross)} sub={`Margin ${pct(r.gross, r.revenue - r.tax)}`} />
          <Kpi icon={Receipt} label="Expenses" value={money(r.exp)} />
          <Kpi icon={Percent} label="Net profit" value={money(r.net)} sub="Gross profit − expenses" />
          <Kpi icon={ShoppingBag} label="Net purchases" value={money(r.purchTotal)} sub={r.prCount ? `${r.bought} devices · less ${money(r.purchReturns)} returns` : `${r.bought} devices`} />
          <Kpi icon={ShoppingCart} label="Avg. selling price" value={money(r.avg)} sub="Per device, before GST" />
          <Kpi icon={Boxes} label="Stock value" value={money(r.stockValue)} sub={`${r.stockCount} devices now`} />
        </div>

        <div className="grid grid-2">
          <section className="card card-lg">
            <h2 style={{ fontSize: 16 }}>Sales</h2>
            <p className="muted small" style={{ margin: '2px 0 12px' }}>Bill total less returns, per {r.daily ? 'day' : 'month'}</p>
            <MoneyBars data={r.revSeries} valueLabel="bill(s)" />
          </section>
          <section className="card card-lg">
            <h2 style={{ fontSize: 16 }}>Net profit</h2>
            <p className="muted small" style={{ margin: '2px 0 12px' }}>Gross profit − expenses, per {r.daily ? 'day' : 'month'}</p>
            <MoneyBars data={r.netSeries} />
          </section>
        </div>

        <section className="card card-lg">
          <div className="card-head">
            <h2>Brand-wise</h2>
            <div className="row" style={{ gap: 8 }}><ExportButtons build={brandSpec} small /></div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Brand</th><th className="num">Devices</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">Margin</th></tr>
              </thead>
              <tbody>
                {r.brands.map((b) => (
                  <tr key={b.key}>
                    <td className="cell-main">{b.key}</td>
                    <td className="num">{b.n}</td>
                    <td className="num">{money(b.rev)}</td>
                    <td className="num">{money(b.cost)}</td>
                    <td className="num cell-main">{money(b.profit)}</td>
                    <td className="num">{pct(b.profit, b.rev)}</td>
                  </tr>
                ))}
                {!r.brands.length && <tr><td colSpan={6} className="muted">No sales in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-2">
          <section className="card card-lg">
            <div className="card-head"><h2>New vs used</h2></div>
            <table className="table">
              <thead><tr><th>Condition</th><th className="num">Devices</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {r.conds.map((c) => (
                  <tr key={c.key}>
                    <td className="cell-main">{c.key}</td>
                    <td className="num">{c.n}</td>
                    <td className="num">{money(c.rev)}</td>
                    <td className="num">{money(c.profit)}</td>
                    <td className="num">{pct(c.profit, c.rev)}</td>
                  </tr>
                ))}
                {!r.conds.length && <tr><td colSpan={5} className="muted">No sales in this period.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="card card-lg">
            <div className="card-head"><h2>Top models</h2></div>
            <BarList rows={r.models.map((m) => ({ label: m.key, value: m.rev, sub: `${m.n} sold · profit ${money(m.profit)}` }))} empty="No sales in this period." />
          </section>
        </div>

        <div className="grid grid-2">
          <section className="card card-lg">
            <div className="card-head"><h2>Top customers</h2></div>
            <BarList rows={r.customers} empty="No sales in this period." />
          </section>
          <section className="card card-lg">
            <div className="card-head"><h2>Top suppliers</h2></div>
            <BarList rows={r.suppliers} empty="No purchases in this period." />
          </section>
        </div>

        <div className="grid grid-2">
          <section className="card card-lg">
            <div className="card-head"><h2>Expenses by category</h2></div>
            <BarList rows={r.expCat} empty="No expenses in this period." />
          </section>
          <section className="card card-lg">
            <div className="card-head"><h2>Money received by mode</h2></div>
            <BarList rows={r.modes} empty="No payments received in this period." />
          </section>
        </div>

        <section className="card card-lg">
          <div className="card-head">
            <h2><Clock size={16} /> Slow-moving stock</h2>
            <span className="muted small">In stock for 30+ days</span>
          </div>
          {r.aging.length ? (
            <table className="table">
              <thead><tr><th>Device</th><th>IMEI</th><th>Supplier</th><th className="num">Cost</th><th className="num">Days in stock</th></tr></thead>
              <tbody>
                {r.aging.map(({ d, age }) => (
                  <tr key={d.id}>
                    <td className="cell-main">{deviceName(d)}</td>
                    <td className="mono small">{d.imei}</td>
                    <td>{d.supplierName}</td>
                    <td className="num">{money(num(d.purchasePrice) + num(d.repairCost))}</td>
                    <td className="num"><span className={`chip ${age > 60 ? 'urgent' : 'caution'}`}>{age} days</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No device has been in stock for more than 30 days.</p>
          )}
        </section>
      </div>
    </div>
  );
}
