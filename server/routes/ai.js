import { Router } from 'express';
import { z } from 'zod';
import { getSettings } from '../db.js';
import { requirePerm, can } from '../lib/auth.js';
import { h, parse, HttpError, audit } from '../lib/util.js';
import { insights, localAnswer, claudeAnswer } from '../lib/ai.js';

const r = Router();
r.use(requirePerm('ai'));

r.get('/insights', h((req, res) => res.json(insights(req.branchId, can(req.user, 'finance')))));

r.get('/status', h((_req, res) => {
  const s = getSettings().ai;
  res.json({ enabled: s.enabled, mode: s.api_key || process.env.ANTHROPIC_API_KEY ? 'claude' : 'built_in', model: s.model });
}));

r.post('/ask', h(async (req, res) => {
  const s = getSettings().ai;
  if (!s.enabled) throw new HttpError(400, 'The AI assistant is turned off in Settings');
  const b = parse(z.object({ question: z.string().trim().min(2).max(1000), history: z.array(z.object({ role: z.string(), content: z.string() })).max(20).optional() }), req.body);
  const finance = can(req.user, 'finance');
  const apiKey = s.api_key || process.env.ANTHROPIC_API_KEY;
  audit(req, 'ask', 'ai', null, { q: b.question.slice(0, 200) });
  if (apiKey) {
    try {
      const answer = await claudeAnswer({ question: b.question, history: b.history, branchId: req.branchId, finance, apiKey, model: s.model });
      return res.json({ answer, mode: 'claude' });
    } catch (e) {
      console.error('Claude request failed, using built-in engine:', e.status || '', e.message);
      return res.json({ answer: localAnswer(b.question, req.branchId, finance), mode: 'built_in', warning: 'Claude was unreachable, answered with the built-in engine.' });
    }
  }
  res.json({ answer: localAnswer(b.question, req.branchId, finance), mode: 'built_in' });
}));

export default r;
