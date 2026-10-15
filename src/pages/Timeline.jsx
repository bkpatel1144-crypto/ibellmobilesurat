import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, History, ShoppingBag, Wrench, CircleCheckBig, ShoppingCart, Smartphone } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import { money, num, fmtDate, cleanImei, deviceName } from '../lib/format';

export default function Timeline() {
  const { imei: param } = useParams();
  const navigate = useNavigate();
  const { devices, repairs, sales, purchases } = useData();
  const [q, setQ] = useState(param || '');

  useEffect(() => setQ(param || ''), [param]);

  const imei = cleanImei(param);
  const matches = useMemo(() => {
    const s = cleanImei(q).toLowerCase();
    if (s.length < 3 || s === imei) return [];
    const seen = new Set();
    return devices
      .filter((d) => d.imei.includes(s) || (d.imei2 || '').includes(s) || deviceName(d).toLowerCase().includes(s))
      .filter((d) => (seen.has(d.imei) ? false : seen.add(d.imei)))
      .slice(0, 12);
  }, [q, devices, imei]);

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
      if (d.status === 'sold') {
        const s = sales.find((x) => x.id === d.saleId);
        const it = s?.items.find((i) => i.deviceId === d.id);
        events.push({
          date: d.saleDate,
          order: 3,
          icon: ShoppingCart,
          title: `Sold to ${d.buyerName || s?.customerName || 'customer'}`,
          amount: d.salePrice,
          link: `/sales/${d.saleId}`,
          ref: d.saleNo,
          body: (
            <>
              <div className="small muted">
                {[d.buyerPhone, it?.warranty && `Warranty: ${it.warranty}`].filter(Boolean).join(' · ')}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                Profit <b>{money(num(d.salePrice) - num(d.purchasePrice) - num(d.repairCost))}</b>
              </div>
              {(it?.buyerIdProofs?.length > 0 || it?.buyerIdType) && (
                <div style={{ marginTop: 8 }}>
                  <IdProofView ids={it.buyerIdProofs} idType={it.buyerIdType} idNumber={it.buyerIdNumber} />
                </div>
              )}
            </>
          ),
        });
      }
    }
    events.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.order - b.order);
    return { recs, events };
  }, [imei, devices, repairs, sales, purchases]);

  const go = (e) => {
    e.preventDefault();
    const v = cleanImei(q);
    if (v) navigate(`/timeline/${v}`);
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
              <input className="input mono" placeholder="Enter or scan IMEI…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus inputMode="numeric" />
            </div>
            <button className="btn btn-primary">Search</button>
          </div>
          {matches.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 12 }}>
              {matches.map((d) => (
                <button type="button" key={d.id} className="combo-item" onClick={() => navigate(`/timeline/${d.imei}`)}>
                  <span><b>{deviceName(d)}</b> <span className="mono muted small">{d.imei}</span></span>
                  <StatusChip status={d.status} />
                </button>
              ))}
            </div>
          )}
        </form>

        {!imei && <div className="card"><Empty icon={History} title="Search an IMEI">Every purchase, repair and sale of the device will show here.</Empty></div>}

        {imei && history && !history.recs.length && (
          <div className="card"><Empty icon={Smartphone} title="No record for this IMEI">{imei}</Empty></div>
        )}

        {latest && (
          <>
            <section className="card card-lg">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 22 }}>{deviceName(latest)}</h2>
                  <div className="mono muted">{[latest.imei, latest.imei2].filter(Boolean).join(' / ')}</div>
                </div>
                <StatusChip status={latest.status} />
              </div>
              <dl className="dl" style={{ marginTop: 16 }}>
                <div><dt>Times bought</dt><dd>{history.recs.length}</dd></div>
                <div><dt>Latest cost</dt><dd className="num">{money(num(latest.purchasePrice) + num(latest.repairCost))}</dd></div>
                <div><dt>Repair spent</dt><dd className="num">{money(history.recs.reduce((s, d) => s + num(d.repairCost), 0))}</dd></div>
                <div>
                  <dt>Total profit</dt>
                  <dd className="num">
                    {money(history.recs.filter((d) => d.status === 'sold').reduce((s, d) => s + num(d.salePrice) - num(d.purchasePrice) - num(d.repairCost), 0))}
                  </dd>
                </div>
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
