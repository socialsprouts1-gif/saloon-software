import { insert, run, nowStamp } from '../db.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

// ---- dates (salon local time; TZ set at boot) --------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const localISO = (d = new Date()) => `${ymd(d)}T${hm(d)}`;
export const today = () => ymd(new Date());
export const parseDate = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const parseDT = (s) => { const [dp, tp = '00:00'] = s.split('T'); const d = parseDate(dp); const [h, mi] = tp.split(':').map(Number); d.setHours(h, mi, 0, 0); return d; };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
export const addMinutes = (s, n) => localISO(new Date(parseDT(s).getTime() + n * 60000));
export const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export function startOfWeek(s = today()) { const d = parseDate(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); }
export const startOfMonth = (s = today()) => `${s.slice(0, 7)}-01`;
export const endOfMonth = (s = today()) => `${s.slice(0, 7)}-${pad(daysInMonth(s.slice(0, 7)))}`;
export const startOfYear = (s = today()) => `${s.slice(0, 4)}-01-01`;
export function dateRange(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

/** Resolve a named period or explicit range to {from,to}. */
export function resolveRange(q = {}) {
  const t = today();
  if (q.from && q.to) return { from: q.from, to: q.to };
  switch (q.period) {
    case 'today': return { from: t, to: t };
    case 'yesterday': return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'week': return { from: startOfWeek(t), to: t };
    case 'last30': return { from: addDays(t, -29), to: t };
    case 'year': return { from: startOfYear(t), to: t };
    case 'last_month': { const s = startOfMonth(addDays(startOfMonth(t), -1)); return { from: s, to: endOfMonth(s) }; }
    case 'month': default: return { from: startOfMonth(t), to: t };
  }
}

export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---- request helpers ----------------------------------------------------------
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, `${issue.path.join('.') || 'input'}: ${issue.message}`, r.error.issues);
  }
  return r.data;
}
export function paginate(q) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}
/** Wrap an async/sync route handler so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } };

/** SQL fragment + params for branch scoping. */
export function branchFilter(req, col = 'branch_id') {
  return req.branchId ? { sql: ` AND ${col} = ?`, params: [req.branchId] } : { sql: '', params: [] };
}

export function audit(req, action, entity, entityId, details) {
  try {
    insert('audit_logs', {
      user_id: req?.user?.id ?? null, user_name: req?.user?.name ?? 'public', action, entity,
      entity_id: entityId ?? null, details: details ? JSON.stringify(details).slice(0, 4000) : null,
      branch_id: req?.branchId ?? null, ip: req?.ip ?? null,
    });
  } catch (e) { console.error('audit failed', e.message); }
}

/** Create an in-app notification. dedupeKey prevents repeats from scheduled jobs. */
export function notify({ type, title, message, link, branchId = null, dedupeKey = null }) {
  try {
    run(`INSERT OR IGNORE INTO notifications (type,title,message,link,branch_id,dedupe_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      type, title, message ?? null, link ?? null, branchId, dedupeKey, nowStamp(), nowStamp());
  } catch (e) { console.error('notify failed', e.message); }
}
