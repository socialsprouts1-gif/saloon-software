import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, tx } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, startOfMonth, today } from '../lib/util.js';
import { programRow, cardOrThrow, cardDetail, cardEvents, issueCard, addStamp, removeStamp, redeemReward } from '../lib/loyalty.js';

const r = Router();
const view = requirePerm('loyalty', 'billing', 'customers');
const manage = requirePerm('loyalty');

// ---- programmes (the card design and rules) ----------------------------------------------
const programSchema = z.object({
  name: z.string().trim().min(2).max(60), stamps_required: z.coerce.number().int().min(1).max(20),
  reward: z.string().trim().min(2).max(120), reward_service_id: z.coerce.number().int().nullable().optional(),
  eligible_service_ids: z.array(z.coerce.number().int()).default([]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6d2a52'),
  terms: z.string().max(500).optional().nullable(), auto_stamp: z.boolean().default(false), min_gap_hours: z.coerce.number().int().min(0).max(72).default(2),
  is_active: z.boolean().default(true),
});
const toRow = (b) => ({ ...b, eligible_service_ids: b.eligible_service_ids ? JSON.stringify(b.eligible_service_ids) : undefined });

r.get('/programs', view, h((_req, res) => {
  res.json(all(`SELECT p.*, s.name reward_service_name,
    (SELECT COUNT(*) FROM loyalty_cards c WHERE c.program_id=p.id AND c.status='active') cards,
    (SELECT COUNT(*) FROM loyalty_cards c WHERE c.program_id=p.id AND c.status='active' AND c.stamps >= p.stamps_required) ready,
    (SELECT COALESCE(SUM(rewards_redeemed),0) FROM loyalty_cards c WHERE c.program_id=p.id) redeemed
    FROM loyalty_programs p LEFT JOIN services s ON s.id=p.reward_service_id ORDER BY p.is_active DESC, p.id`).map(programRow));
}));
r.post('/programs', manage, h((req, res) => {
  const b = parse(programSchema, req.body);
  const id = insert('loyalty_programs', toRow(b));
  audit(req, 'create', 'loyalty_program', id, b); res.json({ id });
}));
r.put('/programs/:id', manage, h((req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM loyalty_programs WHERE id=?', id)) throw new HttpError(404, 'Programme not found');
  const b = parse(programSchema.partial(), req.body);
  update('loyalty_programs', id, toRow(b));
  audit(req, 'update', 'loyalty_program', id, b); res.json({ ok: true });
}));

// ---- cards -------------------------------------------------------------------------------
r.get('/stats', view, h((_req, res) => {
  const m = startOfMonth(), t = today();
  res.json({
    active_cards: get(`SELECT COUNT(*) n FROM loyalty_cards WHERE status='active'`).n,
    ready: get(`SELECT COUNT(*) n FROM loyalty_cards c JOIN loyalty_programs p ON p.id=c.program_id WHERE c.status='active' AND c.stamps >= p.stamps_required`).n,
    stamps_month: get(`SELECT COUNT(*) n FROM loyalty_events WHERE type='stamp' AND substr(created_at,1,10) BETWEEN ? AND ?`, m, t).n,
    rewards_month: get(`SELECT COUNT(*) n FROM loyalty_events WHERE type='redeem' AND substr(created_at,1,10) BETWEEN ? AND ?`, m, t).n,
  });
}));

r.get('/cards', view, h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const w = ['1=1'], p = [];
  if (req.query.q) { w.push('(c.name LIKE ? OR c.phone LIKE ? OR lc.code LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  if (req.query.program_id) { w.push('lc.program_id=?'); p.push(Number(req.query.program_id)); }
  if (req.query.customer_id) { w.push('lc.customer_id=?'); p.push(Number(req.query.customer_id)); }
  w.push(`lc.status=?`); p.push(req.query.status || 'active');
  if (req.query.ready) w.push('lc.stamps >= pr.stamps_required');
  const base = `FROM loyalty_cards lc JOIN customers c ON c.id=lc.customer_id JOIN loyalty_programs pr ON pr.id=lc.program_id WHERE ${w.join(' AND ')}`;
  res.json({
    data: all(`SELECT lc.*, c.name customer_name, c.phone customer_phone, pr.name program_name, pr.stamps_required, pr.reward, pr.color, pr.reward_service_id, pr.eligible_service_ids ${base}
      ORDER BY COALESCE(lc.last_stamp_at, lc.created_at) DESC LIMIT ? OFFSET ?`, ...p, limit, offset).map((x) => ({ ...x, eligible_service_ids: JSON.parse(x.eligible_service_ids || '[]'), reward_ready: x.stamps >= x.stamps_required })),
    total: get(`SELECT COUNT(*) n ${base}`, ...p).n, page, pageSize,
  });
}));

r.post('/cards', view, h((req, res) => {
  const b = parse(z.object({ customer_id: z.coerce.number().int(), program_id: z.coerce.number().int() }), req.body);
  const out = tx(() => issueCard(b.customer_id, b.program_id));
  if (out.created) audit(req, 'issue', 'loyalty_card', null, { code: out.code, customer_id: b.customer_id });
  res.json(cardDetail(out.code));
}));

r.get('/cards/:code', view, h((req, res) => {
  const c = cardOrThrow(req.params.code);
  res.json({ ...c, events: cardEvents(c.id) });
}));

r.post('/cards/:code/stamp', view, h((req, res) => {
  const b = parse(z.object({ note: z.string().max(200).optional(), force: z.boolean().optional() }), req.body);
  const c = tx(() => addStamp(req.params.code, { user: req.user, note: b.note, force: b.force }));
  audit(req, 'stamp', 'loyalty_card', c.id, { code: c.code, stamps: c.stamps });
  res.json({ ...c, events: cardEvents(c.id) });
}));
r.post('/cards/:code/redeem', view, h((req, res) => {
  const b = parse(z.object({ note: z.string().max(200).optional() }), req.body);
  const c = tx(() => redeemReward(req.params.code, { user: req.user, note: b.note }));
  audit(req, 'redeem', 'loyalty_card', c.id, { code: c.code });
  res.json({ ...c, events: cardEvents(c.id) });
}));
r.post('/cards/:code/unstamp', manage, h((req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
  const c = tx(() => removeStamp(req.params.code, { user: req.user, reason: b.reason }));
  audit(req, 'unstamp', 'loyalty_card', c.id, { code: c.code, reason: b.reason });
  res.json({ ...c, events: cardEvents(c.id) });
}));
r.put('/cards/:code', manage, h((req, res) => {
  const b = parse(z.object({ status: z.enum(['active', 'archived']) }), req.body);
  const c = cardOrThrow(req.params.code);
  update('loyalty_cards', c.id, { status: b.status });
  audit(req, b.status === 'archived' ? 'archive' : 'restore', 'loyalty_card', c.id, { code: c.code });
  res.json(cardDetail(c.code));
}));

export default r;
