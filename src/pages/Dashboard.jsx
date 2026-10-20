import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  ShoppingBag,
  TrendingUp,
  Boxes,
  Wrench,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Plus,
  IndianRupee,
  Headphones,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Kpi, Empty } from '../components/ui';
import { MoneyBars, BarList } from '../components/Charts';
import { money, num, today, addDays, startOfMonth, fmtDate, fmtDateShort, byDateDesc } from '../lib/format';
import { partyBalances, accountBalances } from '../lib/ledger';
import { accLines, billCountText, billItemsText, lineQty } from '../lib/accessories';

export default function Dashboard() {
  const data = useData();
  const { sales, purchases, devices, repairs, expenses, parties, accounts, returns } = data;
  const navigate = useNavigate();

  const s = useMemo(() => {
    const t = today();
    const m0 = startOfMonth();
    const sum = (arr, f) => arr.reduce((a, x) => a + num(f(x)), 0);

    const todaySales = sales.filter((x) => x.date === t);
    const monthSales = sales.filter((x) => x.date >= m0);
    const monthPurch = purchases.filter((x) => x.date >= m0);
    const monthExp = expenses.filter((x) => x.date >= m0);
    // returns count in the period they happen (like the GST credit note)
    const monthSR = returns.filter((x) => x.kind === 'sale' && x.date >= m0);
    const monthPR = returns.filter((x) => x.kind === 'purchase' && x.date >= m0);
    const todaySR = returns.filter((x) => x.kind === 'sale' && x.date === t);
    const stock = devices.filter((d) => d.status === 'in_stock');
    const inRepair = devices.filter((d) => d.status === 'in_repair');

    const bal = partyBalances(parties, data);
    let receive = 0;
    let pay = 0;
    bal.forEach((v) => (v > 0 ? (receive += v) : (pay -= v)));
    const accBal = accountBalances(accounts, data);
    let cash = 0;
    accBal.forEach((v) => (cash += v));

    // last 30 days
    const days = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = addDays(t, -i);
      const daySales = sales.filter((x) => x.date === d);
      const dayBack = returns.filter((x) => x.kind === 'sale' && x.date === d);
      days.push({ label: fmtDateShort(d), fullLabel: fmtDate(d), value: sum(daySales, (x) => x.total) - sum(dayBack, (x) => x.total), count: daySales.length });
    }

    const brand = new Map();
    for (const x of monthSales)
      for (const it of x.items) {
        const b = brand.get(it.brand) || { value: 0, count: 0 };
        b.value += num(it.price);
        b.count += 1;
        brand.set(it.brand, b);
      }

    for (const x of monthSR)
      for (const it of x.items) {
        const b = brand.get(it.brand);
        if (b) {
          b.value -= num(it.value);
          b.count -= 1;
        }
      }
    // accessories sold this month as one row
    for (const x of monthSales)
      for (const l of accLines(x)) {
        const b = brand.get('Accessories') || { value: 0, count: 0 };
        b.value += num(l.amount);
        b.count += lineQty(l);
        brand.set('Accessories', b);
      }
    for (const x of monthSR)
      for (const l of accLines(x)) {
        const b = brand.get('Accessories');
        if (b) {
          b.value -= num(l.value);
          b.count -= lineQty(l);
        }
      }

    // sales returns take their profit back; purchase returns add their gain / loss
    // accessory stock found (+) / damaged or lost (−), at cost, is part of the month's result
    const monthAdj = sum(data.stockAdjustments.filter((x) => x.date >= m0), (x) => (num(x.qty) < 0 ? -num(x.value) : num(x.value)));
    const monthProfit = sum(monthSales, (x) => x.profit) - sum(monthSR, (x) => x.profit) + sum(monthPR, (x) => x.profit) + monthAdj;

    // accessories in stock
    let accPieces = 0;
    let accValue = 0;
    let accLow = 0;
    for (const a of data.accessories) {
      const st = data.accStock.get(a.id);
      if (!st) continue;
      accPieces += Math.max(0, st.qty);
      accValue += st.value;
      if (st.low || st.qty <= 0) accLow += 1;
    }
    const monthExpenses = sum(monthExp, (x) => x.amount);

    return {
      todayTotal: sum(todaySales, (x) => x.total) - sum(todaySR, (x) => x.total),
      todayReturns: todaySR.length,
      monthReturns: sum(monthSR, (x) => x.total),
      todayCount: todaySales.length,
      monthTotal: sum(monthSales, (x) => x.total) - sum(monthSR, (x) => x.total),
      monthCount: monthSales.length,
      monthProfit,
      monthAdj,
      accPieces,
      accValue,
      accLow,
      monthExpenses,
      monthNet: monthProfit - monthExpenses,
      monthPurchTotal: sum(monthPurch, (x) => x.total) - sum(monthPR, (x) => x.total),
      stockCount: stock.length,
      stockValue: sum(stock, (d) => num(d.purchasePrice) + num(d.repairCost)),
      newCount: stock.filter((d) => d.condition === 'New').length,
      repairCount: inRepair.length,
      receive,
      pay,
      cash,
      days,
      brands: [...brand.entries()]
        .filter(([, v]) => v.count > 0)
        .map(([label, v]) => ({ label, value: v.value, sub: `${v.count} sold` }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
      recentSales: [...sales].sort(byDateDesc).slice(0, 6),
      recentPurch: [...purchases].sort(byDateDesc).slice(0, 5),
      openRepairs: repairs.filter((r) => r.status === 'in_repair').slice(0, 5),
    };
  }, [data, sales, purchases, devices, repairs, expenses, parties, accounts, returns]);

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            <Link to="/purchases/new" className="btn">
              <ShoppingBag size={16} /> Purchase
            </Link>
            <Link to="/sales/new" className="btn btn-primary">
              <Plus size={16} /> New Sale
            </Link>
          </>
        }
      />

      <div className="stack">
        <div className="kpis cascade">
          <Kpi inverse icon={ShoppingCart} label="Today's sales" value={money(s.todayTotal)} sub={`${s.todayCount} bill(s)${s.todayReturns ? ` · ${s.todayReturns} return(s)` : ''}`} />
          <Kpi icon={IndianRupee} label="This month sales" value={money(s.monthTotal)} sub={`${s.monthCount} bill(s)${s.monthReturns ? ` · net of ${money(s.monthReturns)} returns` : ''}`} />
          {data.can('viewProfit') && (
            <Kpi
              icon={TrendingUp}
              label="Month net profit"
              value={money(s.monthNet)}
              sub={`Gross ${money(s.monthProfit)} − exp. ${money(s.monthExpenses)}${s.monthAdj ? ` · stock adj. ${money(s.monthAdj)}` : ''}`}
            />
          )}
          <Kpi
            icon={Boxes}
            label="Stock"
            value={`${s.stockCount} ${s.stockCount === 1 ? 'device' : 'devices'}`}
            sub={data.can('viewProfit') ? `Value ${money(s.stockValue)} · ${s.newCount} new` : `${s.newCount} new`}
          />
          <Kpi
            icon={Headphones}
            label="Accessories"
            value={`${s.accPieces} pieces`}
            sub={[data.can('viewProfit') && `Value ${money(s.accValue)}`, s.accLow > 0 && `${s.accLow} low / out`].filter(Boolean).join(' · ') || `${data.accessories.length} items`}
          />
          <Kpi icon={Wrench} label="In repair" value={s.repairCount} sub="Devices at repair" />
          <Kpi icon={ArrowDownLeft} label="To receive" value={money(s.receive)} sub="From parties" />
          <Kpi icon={ArrowUpRight} label="To pay" value={money(s.pay)} sub="To parties" />
          {data.can('banks') && <Kpi icon={Wallet} label="Cash + Bank" value={money(s.cash)} sub={`${accounts.length} account(s)`} />}
        </div>

        <div className="grid grid-main-side">
          <section className="card card-lg">
            <div className="card-head">
              <div>
                <h2>Sales · last 30 days</h2>
                <p className="muted small" style={{ margin: 0 }}>Bill total per day</p>
              </div>
            </div>
            <MoneyBars data={s.days} valueLabel="bill(s)" />
          </section>
          <section className="card card-lg">
            <div className="card-head">
              <h2>Top brands this month</h2>
            </div>
            <BarList rows={s.brands} empty="No sales this month yet." />
          </section>
        </div>

        <div className="grid grid-2">
          <section className="card card-lg">
            <div className="card-head">
              <h2>Recent sales</h2>
              <Link to="/sales" className="btn btn-ghost btn-sm">View all</Link>
            </div>
            {s.recentSales.length ? (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {s.recentSales.map((x) => (
                      <tr key={x.id} className="clickable" onClick={() => navigate(`/sales/${x.id}`)}>
                        <td>
                          <div className="cell-main">{x.customerName}</div>
                          <div className="cell-sub">{x.invoiceNo} · {fmtDate(x.date)}</div>
                        </td>
                        <td className="small muted">{billItemsText(x, 3)}</td>
                        <td className="num cell-main">{money(x.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={ShoppingCart} title="No sales yet" />
            )}
          </section>

          <section className="card card-lg">
            <div className="card-head">
              <h2>Recent purchases</h2>
              <Link to="/purchases" className="btn btn-ghost btn-sm">View all</Link>
            </div>
            {s.recentPurch.length ? (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {s.recentPurch.map((x) => (
                      <tr key={x.id} className="clickable" onClick={() => navigate(`/purchases/${x.id}`)}>
                        <td>
                          <div className="cell-main">{x.partyName}</div>
                          <div className="cell-sub">{x.purchaseNo} · {fmtDate(x.date)}</div>
                        </td>
                        <td className="small muted">{billCountText(x)}</td>
                        <td className="num cell-main">{money(x.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={ShoppingBag} title="No purchases yet" />
            )}
            {s.openRepairs.length > 0 && (
              <>
                <div className="card-head" style={{ marginTop: 20 }}>
                  <h3>At repair</h3>
                  <Link to="/repairs" className="btn btn-ghost btn-sm">Repairs</Link>
                </div>
                <div className="stack-sm">
                  {s.openRepairs.map((r) => (
                    <div key={r.id} className="row-between small">
                      <span>
                        <b>{r.deviceName}</b> <span className="muted mono">{r.imei}</span>
                      </span>
                      <span className="chip caution">{r.partyName || r.repairer || 'Repair'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
