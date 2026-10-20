import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, History, ShoppingBag, Wrench, CircleCheckBig, ShoppingCart, Smartphone, ChevronRight, Undo2, Redo2, Headphones, ShieldCheck, SlidersHorizontal, PackageOpen } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import { money, num, fmtDate, cleanImei, deviceName, today } from '../lib/format';
import { cleanSerial, serialHistory, warrantyEnd } from '../lib/accessories';

export default function Timeline() {
  const { imei: param } = useParams();
  const navigate = useNavigate();
  const data = useData();
  const { devices, repairs, sales, purchases, returns, can, accessories, accStock } = data;
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

  // accessory serial numbers (chargers, AirPods…): warranty check
  const acc = useMemo(() => (!exact && typed ? serialHistory(typed, data) : null), [exact, typed, data]);
  const accMatches = useMemo(() => {
    const s = cleanSerial(typed);
    if (s.length < 3 || exact || acc) return [];
    const out = [];
    for (const a of accessories) {
      const st = accStock.get(a.id);
      for (const k of st?.serials.keys() || []) if (k.includes(s) && out.length < 12) out.push({ a, serial: k, inStock: st.serials.get(k).count > 0 });
    }
    return out;
  }, [typed, exact, acc, accessories, accStock]);

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
      <PageHeader title="IMEI Timeline" subtitle="Full history of any phone - and warranty check for accessory serial numbers" />
      <div className="stack">
        <form className="card" onSubmit={go}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="input-group grow">
              <Search size={16} />
              <input className="input mono" placeholder="Enter or scan IMEI, SN or accessory serial…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="IMEI or serial" />
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
          {accMatches.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <span className="xs muted">{accMatches.length} matching accessory serial{accMatches.length === 1 ? '' : 's'}</span>
              {accMatches.map((m) => (
                <button type="button" key={m.serial} className="combo-item timeline-pick" onClick={() => navigate(`/timeline/${encodeURIComponent(m.serial)}`)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="cell-main">{m.a.name}</span>
                    <span className="cell-sub mono" style={{ display: 'block' }}>{m.serial}</span>
                  </span>
                  <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span className={`chip ${m.inStock ? 'success' : ''}`}>{m.inStock ? 'In stock' : 'Not in stock'}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        {!typed && <div className="card"><Empty icon={History} title="Search an IMEI or serial">Type or scan an IMEI or SN - every purchase, repair and sale of the phone shows here. Accessory serial numbers show their sale and warranty.</Empty></div>}

        {acc && <AccessorySerial h={acc} canProfit={canProfit} />}

        {typed && !imei && !acc && !matches.length && !accMatches.length && typed.length >= 3 && (
          <div className="card"><Empty icon={Smartphone} title="No phone matches">{typed}</Empty></div>
        )}

        {imei && !acc && history && !history.recs.length && (
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

/** Warranty check for one accessory serial: bought, sold (with warranty), returned, adjusted. */
function AccessorySerial({ h, canProfit }) {
  const { accStock } = useData();
  const st = h.accessory ? accStock.get(h.accessory.id) : null;
  const inStock = st?.serials.get(h.serial)?.count > 0;
  const lastSale = [...h.events].reverse().find((e) => e.type === 'sale');
  const returnedAfter = lastSale && h.events.some((e) => e.type === 'saleReturn' && e.date >= lastSale.date && h.events.indexOf(e) > h.events.indexOf(lastSale));
  const sold = lastSale && !inStock && !returnedAfter;
  const end = sold ? warrantyEnd(lastSale.date, lastSale.line.warranty) : '';
  const active = end && end >= today();
  const ICON = { opening: PackageOpen, purchase: ShoppingBag, sale: ShoppingCart, saleReturn: Undo2, purchaseReturn: Redo2, adjust: SlidersHorizontal };
  const TITLE = {
    opening: () => 'Opening stock',
    purchase: (e) => `Bought from ${e.doc.partyName}`,
    sale: (e) => `Sold to ${e.doc.customerName}`,
    saleReturn: (e) => `Returned by ${e.doc.partyName}`,
    purchaseReturn: (e) => `Returned to ${e.doc.partyName}`,
    adjust: (e) => `Stock ${num(e.doc.qty) < 0 ? 'removed' : 'added'} · ${e.doc.reason || 'adjustment'}`,
  };
  const LINK = { purchase: (e) => `/purchases/${e.doc.id}`, sale: (e) => `/sales/${e.doc.id}`, saleReturn: (e) => `/returns/${e.doc.id}`, purchaseReturn: (e) => `/returns/${e.doc.id}` };
  const REF = { purchase: (e) => e.doc.purchaseNo, sale: (e) => e.doc.invoiceNo, saleReturn: (e) => e.doc.returnNo, purchaseReturn: (e) => e.doc.returnNo };
  const AMT = { purchase: (e) => (canProfit ? num(e.line.rate) : undefined), sale: (e) => num(e.line.rate), saleReturn: (e) => (num(e.line.qty) ? num(e.line.value) / num(e.line.qty) : undefined) };
  return (
    <>
      <section className="card card-lg">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 22 }}><Headphones size={20} /> {h.accessory?.name || 'Accessory'}</h2>
            <div className="mono muted">Serial {h.serial}{h.accessory?.code ? ` · ${h.accessory.code}` : ''}</div>
          </div>
          {inStock ? <span className="chip success">In stock</span> : sold ? <span className="chip">Sold</span> : <span className="chip urgent">Not in stock</span>}
        </div>
        {sold && (
          <div className={`sub-box ${active ? '' : ''}`} style={{ marginTop: 16 }}>
            <div className="row" style={{ gap: 10 }}>
              <ShieldCheck size={20} />
              <div>
                <div className="cell-main">
                  {end ? (active ? 'Under warranty' : 'Warranty expired') : 'Warranty'}
                  {end && <span className={`chip ${active ? 'success' : 'urgent'}`} style={{ marginLeft: 8 }}>{active ? 'Active' : 'Expired'}</span>}
                </div>
                <div className="small muted">
                  {lastSale.line.warranty || 'No warranty given'}
                  {end && ` · from ${fmtDate(lastSale.date)} till ${fmtDate(end)}`}
                  {' · '}
                  <Link to={`/sales/${lastSale.doc.id}`}>{lastSale.doc.invoiceNo}</Link> to {lastSale.doc.customerName}
                  {lastSale.doc.customerPhone && ` (${lastSale.doc.customerPhone})`}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
      <section className="card card-lg">
        <div className="card-head"><h2>History</h2></div>
        <div className="timeline">
          {h.events.map((e, i) => {
            const Icon = ICON[e.type];
            const amt = AMT[e.type]?.(e);
            return (
              <div className="tl-item" key={i}>
                <span className="tl-dot"><Icon size={14} /></span>
                <div className="tl-card">
                  <div className="row-between">
                    <div>
                      <div className="cell-main">{TITLE[e.type](e)}</div>
                      <div className="cell-sub">
                        {fmtDate(e.date)}
                        {LINK[e.type] && <> · <Link to={LINK[e.type](e)}>{REF[e.type](e)}</Link></>}
                        {e.type === 'sale' && e.line.warranty && ` · warranty ${e.line.warranty}`}
                      </div>
                    </div>
                    {amt !== undefined && <div className="cell-main num">{money(amt)}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {h.accessory && <Link className="btn btn-sm" style={{ marginTop: 12 }} to={`/accessories/${h.accessory.id}`}><Headphones size={15} /> Open {h.accessory.name}</Link>}
      </section>
    </>
  );
}
