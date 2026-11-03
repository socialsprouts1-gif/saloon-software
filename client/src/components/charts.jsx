import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { compact, money, fmtDate, parseDate } from '../lib/format.js';

export const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const axis = { stroke: 'var(--text-3)', fontSize: 11, tickLine: false, axisLine: false };

export function periodLabel(p, gran) {
  if (gran === 'hour') { const h = Number(p); return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`; }
  if (gran === 'year' || /^\d{4}$/.test(p)) return p;
  if (gran === 'month' || /^\d{4}-\d{2}$/.test(p)) return parseDate(`${p}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  if (gran === 'week') return `Wk ${fmtDate(p, { day: 'numeric', month: 'short' })}`;
  return fmtDate(p, { day: 'numeric', month: 'short' });
}

function Tip({ active, payload, label, gran, fmt = money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t">{periodLabel(label, gran)}</div>
      {payload.map((p) => <div key={p.dataKey} className="row" style={{ gap: 8 }}><i className="dot" style={{ background: p.color }} />{p.name}: <b className="num">{fmt(p.value)}</b></div>)}
    </div>
  );
}

/** Revenue vs expenses area chart. series: [{key,name,color}] */
export function TrendChart({ data, series, gran, height = 280, type = 'area', fmt = money, yFmt = compact }) {
  const Chart = type === 'bar' ? BarChart : type === 'line' ? LineChart : AreaChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs>{series.map((s) => <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.28} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="period" {...axis} tickFormatter={(v) => periodLabel(v, gran)} minTickGap={18} />
        <YAxis {...axis} tickFormatter={yFmt} width={58} />
        <Tooltip content={<Tip gran={gran} fmt={fmt} />} cursor={{ fill: 'var(--surface-2)', stroke: 'var(--border-strong)' }} />
        {series.map((s) => type === 'bar'
          ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[5, 5, 0, 0]} maxBarSize={34} />
          : type === 'line'
            ? <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.2} dot={false} type="monotone" />
            : <Area key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.2} fill={`url(#g-${s.key})`} type="monotone" />)}
      </Chart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey = 'name', valueKey = 'value', height = 220, fmt = money }) {
  const total = data.reduce((a, d) => a + Number(d[valueKey] || 0), 0);
  return (
    <div className="row wrap" style={{ gap: 18 }}>
      <div style={{ width: height, height, position: 'relative', flexShrink: 0 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5 }} itemStyle={{ color: 'var(--text)' }} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <div><div className="faint tiny">Total</div><div className="display" style={{ fontSize: 18, fontWeight: 600 }}>{fmt === money ? compact(total) : fmt(total)}</div></div>
        </div>
      </div>
      <div className="col grow" style={{ gap: 7, minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={i} className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8 }}><i className="dot" style={{ background: CHART[i % CHART.length] }} />{d[nameKey]}</span>
            <span className="num"><b>{fmt(d[valueKey])}</b> <span className="faint">{total ? `${Math.round((d[valueKey] / total) * 100)}%` : ''}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, valueKey = 'value', labelKey = 'name', fmt = (v) => v, color = 'var(--primary)' }) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0));
  return (
    <div>
      {items.map((it, i) => (
        <div className="bar-row" key={i}>
          <span className="truncate">{it[labelKey]}</span><b className="num">{fmt(it[valueKey], it)}</b>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(it[valueKey]) / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}
