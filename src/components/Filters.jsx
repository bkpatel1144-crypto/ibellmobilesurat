import { useState } from 'react';
import { FileText, FileSpreadsheet } from 'lucide-react';
import { today, startOfMonth, startOfFY, addDays } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { getPref } from '../lib/prefs';

export const PRESETS = {
  today: () => ({ from: today(), to: today() }),
  '7d': () => ({ from: addDays(today(), -6), to: today() }),
  month: () => ({ from: startOfMonth(), to: today() }),
  fy: () => ({ from: startOfFY(), to: today() }),
  all: () => ({ from: '', to: '' }),
};

/** Starting range for lists, from Settings → Tables & Lists. */
export const defaultRange = () => (PRESETS[getPref('defaultRange')] || PRESETS.month)();

export function DateRange({ value, onChange }) {
  const preset = Object.keys(PRESETS).find((k) => {
    const p = PRESETS[k]();
    return p.from === value.from && p.to === value.to;
  });
  return (
    <div className="row" style={{ gap: 8 }}>
      <select
        className="select"
        style={{ width: 150 }}
        value={preset || 'custom'}
        onChange={(e) => e.target.value !== 'custom' && onChange(PRESETS[e.target.value]())}
        aria-label="Date range"
      >
        <option value="today">Today</option>
        <option value="7d">Last 7 days</option>
        <option value="month">This month</option>
        <option value="fy">This financial year</option>
        <option value="all">All time</option>
        <option value="custom">Custom</option>
      </select>
      <input className="input" type="date" style={{ width: 150 }} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From date" />
      <span className="muted">to</span>
      <input className="input" type="date" style={{ width: 150 }} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
    </div>
  );
}

/** PDF + Excel buttons; build() returns the export spec (see lib/export.js) */
export function ExportButtons({ build, small }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const run = async (kind) => {
    setBusy(kind);
    try {
      const spec = build();
      const mod = await import('../lib/export');
      if (kind === 'pdf') await mod.exportTablePdf(spec);
      else await mod.exportExcel(spec);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      setBusy('');
    }
  };
  const cls = `btn ${small ? 'btn-sm' : ''}`;
  return (
    <>
      <button type="button" className={cls} onClick={() => run('pdf')} disabled={Boolean(busy)}>
        <FileText size={16} /> {busy === 'pdf' ? '…' : 'PDF'}
      </button>
      <button type="button" className={cls} onClick={() => run('xlsx')} disabled={Boolean(busy)}>
        <FileSpreadsheet size={16} /> {busy === 'xlsx' ? '…' : 'Excel'}
      </button>
    </>
  );
}
