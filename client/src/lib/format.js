let symbol = '₹';
export const setCurrencySymbol = (s) => { symbol = s || '₹'; };
export const money = (n, { decimals } = {}) => {
  const v = Number(n || 0);
  const d = decimals ?? (Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
  return `${v < 0 ? '-' : ''}${symbol}${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const compact = (n) => {
  const v = Number(n || 0), a = Math.abs(v);
  if (a >= 1e7) return `${symbol}${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${symbol}${(v / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${symbol}${(v / 1e3).toFixed(1)}K`;
  return money(v);
};
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
export const startOfWeek = (s = today()) => { const d = parseDate(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
export const startOfMonth = (s = today()) => `${s.slice(0, 7)}-01`;
export const endOfMonth = (s = today()) => { const d = parseDate(s); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export const monthLabel = (m) => parseDate(`${m}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (s ? parseDate(s).toLocaleDateString('en-IN', opts) : '—');
export const fmtTime = (hhmm) => {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
};
export const fmtDT = (s) => (s ? `${fmtDate(s, { day: 'numeric', month: 'short' })}, ${fmtTime(s.slice(11, 16))}` : '—');
export const fmtStamp = (s) => (s ? `${fmtDate(s.slice(0, 10))} ${s.slice(11, 16)}` : '—');
export const minsToH = (m) => `${Math.floor((m || 0) / 60)}h ${pad((m || 0) % 60)}m`;
export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const relTime = (s) => {
  const t = new Date(s.replace(' ', 'T')).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(s.slice(0, 10));
};
export const PAY_METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['other', 'Other']];
export const payLabel = (m) => Object.fromEntries(PAY_METHODS)[m] || titleCase(m);
