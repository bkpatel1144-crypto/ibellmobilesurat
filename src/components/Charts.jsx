import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { money } from '../lib/format';

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
  if (a >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (a >= 1000) return `${(v / 1000).toFixed(0)}k`;
  return String(v);
};

function Tip({ active, payload, label, valueLabel }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="muted xs">{p.fullLabel || label}</div>
      <div style={{ fontWeight: 700 }} className="num">{money(payload[0].value)}</div>
      {p.count !== undefined && <div className="muted xs">{p.count} {valueLabel || 'items'}</div>}
    </div>
  );
}

/**
 * Single-series bar chart. Monochrome by design: the bars use the primary ink
 * (black in light mode, white in dark), so no categorical palette is needed.
 */
export function MoneyBars({ data, dataKey = 'value', height = 280, valueLabel, negative }) {
  return (
    <div className="chart-box" style={{ height, color: 'var(--color-primary)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--color-outline-variant)" strokeDasharray="0" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--color-outline-variant)' }}
            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            tickFormatter={compact}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }}
          />
          <Tooltip cursor={{ fill: 'var(--hover-overlay)' }} content={<Tip valueLabel={valueLabel} />} isAnimationActive={false} />
          <Bar
            dataKey={dataKey}
            fill={negative ? 'var(--color-status-urgent)' : 'currentColor'}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars rendered in plain HTML - label, track, value. */
export function BarList({ rows, format = money, empty = 'No data' }) {
  if (!rows.length) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div style={{ minWidth: 0 }}>
            <div className="cell-main" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
            {r.sub && <div className="cell-sub">{r.sub}</div>}
          </div>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
          <div className="num" style={{ fontWeight: 600, textAlign: 'right' }}>{format(r.value)}</div>
        </div>
      ))}
    </div>
  );
}
