import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, History, ShoppingBag, Wrench, CircleCheckBig, ShoppingCart, Smartphone, ChevronRight, Undo2, Redo2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import { money, num, fmtDate, cleanImei, deviceName } from '../lib/format';

export default function Timeline() {
  const { imei: param } = useParams();
  const navigate = useNavigate();
  const { devices, repairs, sales, purchases, returns, can } = useData();
  const canProfit = can('viewProfit');
  const [q, setQ] = useState(param || '');

  useEffect(() => setQ(param || ''), [param]);

  // an IMEI, IMEI 2 or SN (e.g. G-523) that matches a phone exactly
  const findExact = (v) => {
    const l = v.toLowerCase();
    return v ? devices.find((d) => d.imei.toLowerCase() === l || (d.imei2 || '').toLowerCase() === l || (d.sn || '').toLowerCase() === l) : null;
  };
  const typed = cleanImei(q);
  const fromUrl = cleanImei(param);
  const exact = findExact(typed);
  // show the history as soon as the typed text matches a phone; otherwise what was searched
  const imei = exact ? exact.imei : typed && typed === fromUrl ? findExact(fromUrl)?.imei || fromUrl : '';

  const matches = useMemo(() => {
    const s = typed.toLowerCase();
    if (s.length < 3 || exact) return [];
    const seen = new Set();
    return devices
      .filter((d) => d.imei.toLowerCase().includes(s) || (d.imei2 || '').toLowerCase().includes(s) || (d.sn || '').toLowerCase().includes(s) || deviceName(d).toLowerCase().includes(s))
      .filter((d) => (seen.has(d.imei) ? false : seen.add(d.imei)))
      .slice(0, 12);
  }, [typed, devices, exact]);

  const history = useMemo(() => {
    if (!imei) return null;
    const recs = devices
      .filter((d) => d.imei === imei || d.imei2 === imei)
      .sort((a, b) => (a.purchaseDate || '').localeCompare(b.purchaseDate || ''));
    if (!recs.length) return { recs, events: [] };
    const events = [];
    for (const d of recs) {
      const p = purchases.find((x) => x.id === d.purchaseId);
      const line = p?.items.find((i) => i.deviceId === d.id);
      events.push({
        date: d.purchaseDate,
        order: 0,
        icon: ShoppingBag,
        title: `Purchased from ${d.supplierName}`,
        amount: d.purchasePrice,
        link: `/purchases/${d.purchaseId}`,
        ref: d.purchaseNo,
        body: (
          <>
            <div className="small muted">
              {d.condition} · {[d.variant, d.color].filter(Boolean).join(' · ')}
              {d.notes && ` · ${d.notes}`}
            </div>
            {(line?.idProofs?.length || d.sellerIdType) && (
              <div style={{ marginTop: 8 }}>
                <IdProofView ids={d.sellerIdProofs} idType={d.sellerIdType} idNumber={d.sellerIdNumber} />
              </div>
            )}
          </>
        ),
      });
      for (const r of repairs.filter((x) => x.deviceId === d.id)) {
        events.push({
          date: r.sentDate,
          order: 1,
          icon: Wrench,
          title: `Sent to repair · ${r.partyName || r.repairer || 'Repairer'}`,
          body: r.issue && <div className="small muted">{r.issue}</div>,
        });
        if (r.status === 'done') {
          events.push({
            date: r.doneDate,
            order: 2,
            icon: CircleCheckBig,
            title: 'Repair done',
            amount: r.cost,
            body: r.doneNotes && <div className="small muted">{r.doneNotes}</div>,
          });
        }
      }
      // every bill this phone was on (it can be sold, returned and sold again)
      for (const s of sales.filter((x) => x.items.some((i) => i.deviceId === d.id))) {
        const it = s.items.find((i) => i.deviceId === d.id);
        const current = d.status === 'sold' && d.saleId === s.id;
        events.push({
          date: s.date,
          order: 3,
          icon: ShoppingCart,
          title: `Sold to ${s.customerName || 'customer'}`,
          amount: it.price,
          link: `/sales/${s.id}`,
          ref: s.invoiceNo,
          body: (
            <>
              <div className="small muted">
                {[s.customerPhone, it.warranty && `Warranty: ${it.warranty}`].filter(Boolean).join(' · ')}
              </div>
              {canProfit && current && (
                <div className="small" style={{ marginTop: 4 }}>
                  Profit <b>{money(num(d.salePrice) - num(d.purchasePrice) - num(d.repairCost))}</b>
                </div>
              )}
              {(it.buyerIdProofs?.length > 0 || it.buyerIdType) && (
                <div style={{ marginTop: 8 }}>
                  <IdProofView ids={it.buyerIdProofs} idType={it.buyerIdType} idNumber={it.buyerIdNumber} />
                </div>
              )}
            </>
          ),
        });
      }
      for (const x of returns.filter((r) => r.items.some((i) => i.deviceId === d.id))) {
        const it = x.items.find((i) => i.deviceId === d.id);
        const fromCustomer = x.kind === 'sale';
        events.push({
          date: x.date,
          order: fromCustomer ? 4 : 2.5,
          icon: fromCustomer ? Undo2 : Redo2,
          title: fromCustomer ? `Returned by ${x.partyName || 'customer'} · back in stock` : `Returned to ${x.partyName || 'supplier'}`,
          amount: it.value,
          link: `/returns/${x.id}`,
          ref: x.returnNo,
          body: <div className="small muted">{[x.reason, x.notes, `against ${x.billNo}`].filter(Boolean).join(' · ')}</div>,
        });
      }
    }
    events.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.order - b.order);
    return { recs, events };
  }, [imei, devices, repairs, sales, purchases, returns, canProfit]);

  const go = (e) => {
    e.preventDefault();
    const v = cleanImei(q);
    if (v) navigate(`/timeline/${encodeURIComponent(exact?.imei || v)}`);
  };

  const latest = history?.recs[history.recs.length - 1];

  return (
    <div className="page">
      <PageHeader title="IMEI Timeline" subtitle="Full history of any device" />
      <div className="stack">
        <form className="card" onSubmit={go}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="input-group grow">
              <Search size={16} />
              <input className="input mono" placeholder="Enter or scan IMEI or SN…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-primary">Search</button>
          </div>
          {matches.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <span className="xs muted">{matches.length} matching phone{matches.length === 1 ? '' : 's'} - tap one to see its history</span>
              {matches.map((d) => (
                <button type="button" key={d.id} className="combo-item timeline-pick" onClick={() => navigate(`/timeline/${encodeURIComponent(d.imei)}`)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="cell-main">{deviceName(d)}</span>
                    <span className="cell-sub mono" style={{ display: 'block' }}>{[d.sn, d.imei].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <StatusChip status={d.status} />
                    <ChevronRight size={18} aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        {!typed && <div className="card"><Empty icon={History} title="Search an IMEI">Type or scan an IMEI or SN. Every purchase, repair and sale of the phone shows here.</Empty></div>}

        {typed && !imei && !matches.length && typed.length >= 3 && (
          <div className="card"><Empty icon={Smartphone} title="No phone matches">{typed}</Empty></div>
        )}

        {imei && history && !history.recs.length && (
          <div className="card"><Empty icon={Smartphone} title="No record for this IMEI">{imei}</Empty></div>
        )}

        {latest && (
          <>
            <section className="card card-lg">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 22 }}>{deviceName(latest)}</h2>
                  <div className="mono muted">
                    {[latest.sn && `SN ${latest.sn}`, [latest.imei, latest.imei2].filter(Boolean).join(' / '), latest.battery != null && `BH ${latest.battery}%`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <StatusChip status={latest.status} />
              </div>
              <dl className="dl" style={{ marginTop: 16 }}>
                <div><dt>Times bought</dt><dd>{history.recs.length}</dd></div>
                {canProfit && <div><dt>Latest cost</dt><dd className="num">{money(num(latest.purchasePrice) + num(latest.repairCost))}</dd></div>}
                <div><dt>Repair spent</dt><dd className="num">{money(history.recs.reduce((s, d) => s + num(d.repairCost), 0))}</dd></div>
                {canProfit && (
                  <div>
                    <dt>Total profit</dt>
                    <dd className="num">
                      {money(history.recs.filter((d) => d.status === 'sold').reduce((s, d) => s + num(d.salePrice) - num(d.purchasePrice) - num(d.repairCost), 0))}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="card card-lg">
              <div className="card-head"><h2>History</h2></div>
              <div className="timeline">
                {history.events.map((ev, i) => {
                  const Icon = ev.icon;
                  return (
                    <div className="tl-item" key={i}>
                      <span className="tl-dot"><Icon size={14} /></span>
                      <div className="tl-card">
                        <div className="row-between">
                          <div>
                            <div className="cell-main">{ev.title}</div>
                            <div className="cell-sub">
                              {fmtDate(ev.date)}
                              {ev.ref && <> · <Link to={ev.link}>{ev.ref}</Link></>}
                            </div>
                          </div>
                          {ev.amount !== undefined && <div className="cell-main num">{money(ev.amount)}</div>}
                        </div>
                        {ev.body && <div style={{ marginTop: 6 }}>{ev.body}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
