import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ClipboardCheck,
  ScanBarcode,
  Play,
  Flag,
  Trash2,
  Volume2,
  VolumeX,
  CircleCheck,
  CircleX,
  CircleHelp,
  Hand,
  Undo2,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi, Segmented, useConfirm } from '../components/ui';
import { ExportButtons } from '../components/Filters';
import { startAudit, addAuditScan, removeAuditScans, completeAudit, deleteAudit, AUDIT_KEEP_DAYS } from '../lib/db';
import { auditResult, findExpected, normCode, daysLeft, EXTRA_LABEL } from '../lib/audit';
import { beep } from '../lib/beep';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { fmtDate, cleanImei, deviceName, tsMillis } from '../lib/format';

const SOUND_KEY = 'ibell-audit-sound';

export default function Audit() {
  const { id } = useParams();
  return id ? <AuditSession id={id} /> : <AuditHome />;
}

/* ------------------------------------------------------------------ list + start */

function AuditHome() {
  const { audits, devices } = useData();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const inStock = devices.filter((d) => d.status === 'in_stock').length;
  const open = audits.find((a) => a.status === 'in_progress');
  const history = [...audits].sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt) || (b.date || '').localeCompare(a.date || ''));
  const last = history.find((a) => a.status === 'completed');

  const start = async () => {
    setBusy(true);
    try {
      const id = await startAudit({ devices, by: user?.email });
      navigate(`/audit/${id}`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Stock Audit"
        subtitle={`Scan every phone on the shelf · reports are kept ${AUDIT_KEEP_DAYS} days, then deleted automatically`}
        actions={
          open ? (
            <Link className="btn btn-primary" to={`/audit/${open.id}`}>
              <ScanBarcode size={16} /> Resume audit
            </Link>
          ) : (
            <button className="btn btn-primary" onClick={start} disabled={busy || !inStock}>
              <Play size={16} /> {busy ? 'Starting…' : 'Start audit'}
            </button>
          )
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={ClipboardCheck} label="Phones to check" value={inStock} sub="In stock right now" />
          <Kpi
            label="Last audit"
            value={last ? fmtDate(last.date) : '—'}
            sub={last ? `${last.summary?.found ?? 0} found · ${last.summary?.missing ?? 0} missing` : 'No audit yet'}
          />
          <Kpi label="Saved reports" value={history.length} sub={`Last ${AUDIT_KEEP_DAYS} days`} />
        </div>

        {open && (
          <section className="card card-lg">
            <div className="row-between">
              <div>
                <h2 style={{ fontSize: 16 }}>Audit in progress</h2>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  Started {fmtDate(open.date)} by {open.startedBy || '—'} · {open.scans?.length || 0} scans so far
                </p>
              </div>
              <Link className="btn btn-primary" to={`/audit/${open.id}`}>
                <ScanBarcode size={16} /> Continue scanning
              </Link>
            </div>
          </section>
        )}

        <section className="card card-lg">
          <div className="card-head">
            <h2>Audit history</h2>
            <span className="muted small">Each report deletes itself {AUDIT_KEEP_DAYS} days after it is completed</span>
          </div>
          {history.length ? (
            <HistoryTable rows={history} navigate={navigate} />
          ) : (
            <Empty icon={ClipboardCheck} title="No audits yet">
              Start an audit, then scan the barcode label of every phone in the shop.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ scanning + report */

function AuditSession({ id }) {
  const data = useData();
  const { audits, devices, raw, settings } = data;
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [code, setCode] = useState('');
  const [last, setLast] = useState(null); // { kind: ok|warn|error, title, sub, key }
  const [tab, setTab] = useState('missing');
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const input = useRef();

  const audit = audits.find((a) => a.id === id);
  const result = useMemo(() => (audit ? auditResult(audit, devices, raw.devices) : null), [audit, devices, raw.devices]);
  const live = audit?.status === 'in_progress';

  useEffect(() => {
    if (live) input.current?.focus();
  }, [live]);

  if (!audit || !result) {
    return (
      <div className="page">
        <PageHeader title="Stock Audit" />
        <div className="card">
          <Empty icon={ClipboardCheck} title="Audit not found">
            It may have been deleted, or removed automatically after {AUDIT_KEEP_DAYS} days.
          </Empty>
          <div style={{ textAlign: 'center', paddingBottom: 24 }}>
            <Link className="btn" to="/audit">Back to audits</Link>
          </div>
        </div>
      </div>
    );
  }

  const expectedCount = result.found.length + result.missing.length + result.soldDuring.length;
  const pct = expectedCount ? Math.round((result.found.length / expectedCount) * 100) : 0;
  const left = daysLeft(audit);

  const feedback = (kind, title, sub) => {
    setLast({ kind, title, sub, key: Date.now() });
    if (sound) beep(kind);
  };

  const scan = async (e) => {
    e?.preventDefault();
    const c = cleanImei(code);
    setCode('');
    input.current?.focus();
    if (!c) return;
    const n = normCode(c);
    const exp = findExpected(audit, c);
    const already = exp
      ? result.found.some((f) => f.deviceId === exp.deviceId)
      : (audit.scans || []).some((s) => normCode(s.code) === n);
    if (already) {
      feedback('warn', 'Already scanned', exp ? `${exp.name}${exp.sn ? ` · ${exp.sn}` : ''}` : c);
      return;
    }
    try {
      await addAuditScan(id, { code: c, at: Date.now(), by: user?.email || '' });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    if (exp) {
      feedback('ok', `Found · ${exp.name}`, [exp.sn && `SN ${exp.sn}`, exp.imei, exp.color].filter(Boolean).join(' · '));
      return;
    }
    const hit = devices.find((d) => d.imei === c || d.imei2 === c || (d.sn && d.sn.toLowerCase() === n));
    if (!hit) feedback('error', 'Not in system', `${c} - this phone was never purchased in IBELL`);
    else if (hit.status === 'sold') feedback('error', `Already sold · ${deviceName(hit)}`, `${hit.saleNo || ''} ${hit.saleDate ? `on ${fmtDate(hit.saleDate)}` : ''}`.trim());
    else if (hit.status === 'in_repair') feedback('error', `Marked at repair · ${deviceName(hit)}`, 'It is on the shelf but the app says it is at repair');
    else feedback('error', `Not in this audit · ${deviceName(hit)}`, 'Bought after the audit started');
  };

  const markFound = async (e) => {
    await addAuditScan(id, { code: e.imei || e.sn, at: Date.now(), by: user?.email || '', manual: true });
    feedback('ok', `Marked found · ${e.name}`, 'Checked by hand (label not scanned)');
  };

  const undoFound = async (e) => {
    const codes = new Set([e.imei, e.imei2, e.sn].filter(Boolean).map((x) => x.toLowerCase()));
    const scans = (audit.scans || []).filter((s) => codes.has(normCode(s.code)));
    if (scans.length) await removeAuditScans(id, scans);
    input.current?.focus();
  };

  const removeExtra = async (x) => {
    const scans = (audit.scans || []).filter((s) => normCode(s.code) === normCode(x.code));
    if (scans.length) await removeAuditScans(id, scans);
    input.current?.focus();
  };

  const finish = async () => {
    const ok = await confirm({
      title: 'Complete this audit?',
      message: result.missing.length
        ? `${result.missing.length} phone(s) were not scanned and will be reported as missing. The report is kept for ${AUDIT_KEEP_DAYS} days.`
        : `All phones were found. The report is kept for ${AUDIT_KEEP_DAYS} days.`,
      confirmText: 'Complete audit',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await completeAudit(id, result, user?.email);
      toast('Audit completed');
      setTab(result.missing.length ? 'missing' : 'found');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this audit?',
      message: 'All scans and the report will be removed. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteAudit(id);
    toast('Audit deleted');
    navigate('/audit');
  };

  const toggleSound = () => {
    setSound((s) => {
      try {
        localStorage.setItem(SOUND_KEY, s ? 'off' : 'on');
      } catch {
        /* preference just won't persist */
      }
      return !s;
    });
    input.current?.focus();
  };

  const exportSpec = () => ({
    settings,
    title: 'Stock Audit Report',
    rightLines: [`Date: ${fmtDate(audit.date)}`, audit.status === 'completed' ? 'Completed' : 'In progress'],
    filename: `stock-audit-${audit.date}`,
    meta: [
      ['Started by', audit.startedBy || '—'],
      ...(audit.completedBy ? [['Completed by', audit.completedBy]] : []),
    ],
    columns: [
      { header: 'Status', key: 'status' },
      { header: 'Device', key: 'name' },
      { header: 'SN', key: 'sn' },
      { header: 'IMEI', key: 'imei' },
      { header: 'Note', key: 'note' },
    ],
    rows: [
      ...result.missing.map((e) => ({ status: 'MISSING', name: e.name, sn: e.sn, imei: e.imei, note: e.note || '' })),
      ...result.extras.map((x) => ({ status: 'EXTRA', name: x.name || '—', sn: x.sn, imei: x.code, note: `${EXTRA_LABEL[x.kind]}${x.ref ? ` (${x.ref})` : ''}` })),
      ...result.soldDuring.map((e) => ({ status: 'SOLD DURING', name: e.name, sn: e.sn, imei: e.imei, note: e.ref || e.status })),
      ...result.found.map((e) => ({ status: 'FOUND', name: e.name, sn: e.sn, imei: e.imei, note: e.manual ? 'Checked by hand' : '' })),
    ],
    summary: [
      ['Expected', String(expectedCount)],
      ['Found', String(result.found.length)],
      ['Missing', String(result.missing.length)],
      ['Sold during audit', String(result.soldDuring.length)],
      ['Extra (not in stock)', String(result.extras.length)],
    ],
  });

  const tabs = [
    { value: 'missing', label: `Missing (${result.missing.length})` },
    { value: 'found', label: `Found (${result.found.length})` },
    { value: 'extra', label: `Extra (${result.extras.length})` },
    ...(result.soldDuring.length ? [{ value: 'sold', label: `Sold during (${result.soldDuring.length})` }] : []),
  ];

  const FeedbackIcon = last?.kind === 'ok' ? CircleCheck : last?.kind === 'warn' ? CircleHelp : CircleX;

  return (
    <div className="page">
      <PageHeader
        title={live ? 'Stock Audit · scanning' : 'Stock Audit report'}
        subtitle={
          live
            ? `Started ${fmtDate(audit.date)} by ${audit.startedBy || '—'}`
            : `${fmtDate(audit.date)} · completed by ${audit.completedBy || '—'} · deletes automatically in ${left ?? '—'} day(s)`
        }
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate('/audit')} aria-label="Back to audits"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <button className="btn btn-danger" onClick={remove} aria-label="Delete audit"><Trash2 size={16} /></button>
            {live ? (
              <button className="btn btn-primary" onClick={finish} disabled={busy}>
                <Flag size={16} /> {busy ? 'Saving…' : 'Complete audit'}
              </button>
            ) : (
              <ExportButtons build={exportSpec} />
            )}
          </>
        }
      />

      <div className="stack">
        <div className="kpis">
          <Kpi inverse label="Found" value={`${result.found.length} / ${expectedCount}`} sub={`${pct}% checked`} />
          <Kpi label="Missing" value={result.missing.length} sub={live ? 'Not scanned yet' : 'Not found on shelf'} />
          <Kpi label="Extra" value={result.extras.length} sub="Scanned but not in stock" />
          {result.soldDuring.length > 0 && <Kpi label="Sold during audit" value={result.soldDuring.length} sub="Left before scanning" />}
        </div>

        {live && (
          <section className="card card-lg">
            <div className="audit-progress" aria-hidden="true">
              <div style={{ width: `${pct}%` }} />
            </div>
            <form onSubmit={scan} className="row" style={{ flexWrap: 'nowrap', marginTop: 16 }}>
              <div className="input-group grow">
                <ScanBarcode size={18} />
                <input
                  ref={input}
                  className="input audit-input mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Scan barcode or type IMEI / SN, then Enter"
                  aria-label="Scan code"
                  autoComplete="off"
                />
              </div>
              <button className="btn btn-primary">Add</button>
              <button type="button" className="btn btn-icon" onClick={toggleSound} aria-label={sound ? 'Turn sound off' : 'Turn sound on'} title={sound ? 'Sound on' : 'Sound off'}>
                {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
            </form>
            {last && (
              <div key={last.key} className={`audit-feedback ${last.kind}`} role="status">
                <FeedbackIcon size={26} />
                <div style={{ minWidth: 0 }}>
                  <div className="audit-feedback-title">{last.title}</div>
                  {last.sub && <div className="small">{last.sub}</div>}
                </div>
              </div>
            )}
          </section>
        )}

        <section className="card card-lg">
          <div className="toolbar">
            <Segmented label="Audit list" value={tab} onChange={setTab} options={tabs} />
          </div>

          {tab === 'missing' &&
            (result.missing.length ? (
              <AuditTable
                rows={result.missing}
                action={live ? (e) => (
                  <button className="btn btn-sm" onClick={() => markFound(e)} title="Label damaged? Mark it found by hand">
                    <Hand size={14} /> Mark found
                  </button>
                ) : null}
                note={(e) => e.note}
              />
            ) : (
              <Empty icon={CircleCheck} title={live ? 'Nothing left to scan' : 'Nothing missing'}>
                {live ? 'Every phone in stock has been scanned. Complete the audit to save the report.' : 'Every phone was found on the shelf.'}
              </Empty>
            ))}

          {tab === 'found' &&
            (result.found.length ? (
              <AuditTable
                rows={[...result.found].sort((a, b) => (b.at || 0) - (a.at || 0))}
                note={(e) => [e.manual && 'Checked by hand', e.at && new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                action={live ? (e) => (
                  <button className="btn btn-sm btn-icon" onClick={() => undoFound(e)} aria-label="Undo scan" title="Undo scan">
                    <Undo2 size={14} />
                  </button>
                ) : null}
              />
            ) : (
              <Empty icon={ScanBarcode} title="Nothing scanned yet" />
            ))}

          {tab === 'extra' &&
            (result.extras.length ? (
              <ExtrasTable rows={result.extras} live={live} onRemove={removeExtra} />
            ) : (
              <Empty icon={CircleCheck} title="No extra phones">Every scanned phone belongs to the stock.</Empty>
            ))}

          {tab === 'sold' && (
            <AuditTable rows={result.soldDuring} note={(e) => (e.status === 'sold' ? `Sold${e.ref ? ` · ${e.ref}` : ''}` : e.status === 'in_repair' ? 'Sent to repair' : e.status)} />
          )}
        </section>
      </div>
      {confirmDialog}
    </div>
  );
}

function ExtrasTable({ rows, live, onRemove }) {
  const pg = usePaged(rows, { sort: [(x) => x.code, (x) => x.name, (x) => EXTRA_LABEL[x.kind], null] });
  return (
    <div className="table-wrap">
      <table className="table" {...pg.tableProps}>
        <thead>
          <tr><th>Scanned code</th><th>Device</th><th>Why it is extra</th>{live && <th />}</tr>
        </thead>
        <tbody>
          {pg.rows.map((x) => (
            <tr key={x.code}>
              <td className="mono">{x.code}</td>
              <td>{x.name || '—'}{x.sn && <div className="cell-sub">SN {x.sn}</div>}</td>
              <td><span className={`chip ${x.kind === 'unknown' ? 'urgent' : 'caution'}`}>{EXTRA_LABEL[x.kind]}{x.ref ? ` · ${x.ref}` : ''}</span></td>
              {live && (
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-sm btn-icon" onClick={() => onRemove(x)} aria-label="Remove scan"><Undo2 size={14} /></button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...pg.pager} />
    </div>
  );
}

function AuditTable({ rows, action, note }) {
  const pg = usePaged(rows, { sort: [(e) => e.name, (e) => e.sn, (e) => e.imei, (e) => note?.(e) || '', null] });
  return (
    <div className="table-wrap">
      <table className="table" {...pg.tableProps}>
        <thead>
          <tr><th>Device</th><th>SN</th><th>IMEI</th><th>Note</th>{action && <th />}</tr>
        </thead>
        <tbody>
          {pg.rows.map((e) => (
            <tr key={e.deviceId}>
              <td>
                <div className="cell-main">{e.name}</div>
                <div className="cell-sub">{[e.color, e.condition].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="mono small">{e.sn || '—'}</td>
              <td className="mono small">{e.imei}</td>
              <td className="small muted">{note?.(e) || ''}</td>
              {action && <td style={{ textAlign: 'right' }}>{action(e)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...pg.pager} />
    </div>
  );
}

function HistoryTable({ rows, navigate }) {
  const done = (a) => a.status === 'completed';
  const pg = usePaged(rows, {
    sort: [
      (a) => a.date,
      (a) => a.status,
      (a) => a.completedBy || a.startedBy,
      (a) => (done(a) ? a.summary?.expected : a.expected?.length),
      (a) => (done(a) ? a.summary?.found : null),
      (a) => (done(a) ? a.summary?.missing : null),
      (a) => (done(a) ? a.summary?.extra : null),
      (a) => daysLeft(a),
    ],
  });
  return (
    <div className="table-wrap">
      <table className="table" {...pg.tableProps}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>By</th>
            <th className="num">Expected</th>
            <th className="num">Found</th>
            <th className="num">Missing</th>
            <th className="num">Extra</th>
            <th className="num">Deletes in</th>
          </tr>
        </thead>
        <tbody>
          {pg.rows.map((a) => {
            const left = daysLeft(a);
            return (
              <tr key={a.id} className="clickable" onClick={() => navigate(`/audit/${a.id}`)}>
                <td className="tnum">{fmtDate(a.date)}</td>
                <td>{done(a) ? <span className="chip success">Completed</span> : <span className="chip caution">In progress</span>}</td>
                <td className="small">{a.completedBy || a.startedBy || '—'}</td>
                <td className="num">{done(a) ? a.summary?.expected : a.expected?.length}</td>
                <td className="num">{done(a) ? a.summary?.found : '—'}</td>
                <td className="num">{done(a) ? (a.summary?.missing ? <span className="chip urgent">{a.summary.missing}</span> : 0) : '—'}</td>
                <td className="num">{done(a) ? a.summary?.extra : '—'}</td>
                <td className="num muted">{left == null ? '—' : `${left} day${left === 1 ? '' : 's'}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pager {...pg.pager} />
    </div>
  );
}
