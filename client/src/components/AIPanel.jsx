import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Spinner } from './ui.jsx';

/** Minimal, safe markdown: **bold**, lists, paragraphs. Renders React nodes (no innerHTML). */
export function Markdown({ text }) {
  const blocks = String(text || '').split(/\n{2,}/);
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b> : p));
  return blocks.map((b, bi) => {
    const lines = b.split('\n');
    const isList = lines.filter(Boolean).every((l) => /^\s*([-*]|\d+\.)\s/.test(l)) || (lines.length > 1 && lines.slice(1).every((l) => /^\s*([-*]|\d+\.)\s/.test(l)));
    if (isList) {
      const head = /^\s*([-*]|\d+\.)\s/.test(lines[0]) ? null : lines.shift();
      const ordered = /^\s*\d+\./.test(lines[0]);
      const L = ordered ? 'ol' : 'ul';
      return <div key={bi}>{head && <p>{inline(head, `h${bi}`)}</p>}<L>{lines.filter(Boolean).map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''), `${bi}-${li}`)}</li>)}</L></div>;
    }
    return <p key={bi}>{lines.map((l, li) => <span key={li}>{inline(l, `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>;
  });
}

export const SUGGESTIONS = [
  'How much revenue did we generate this month?', 'Which employee generated the highest revenue?', 'What are our total expenses this month?',
  'Which services are most popular?', 'Which products need restocking?', 'How many customers visited today?',
  "Which customers haven't visited in 60 days?", 'What is our estimated monthly profit?',
];

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const ask = async (q) => {
    if (!q.trim() || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const r = await api.post('/api/ai/ask', { question: q, history });
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, mode: r.mode }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally { setBusy(false); }
  };
  return { messages, busy, ask, reset: () => setMessages([]) };
}

export function ChatView({ chat, compact }) {
  const [q, setQ] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.messages, chat.busy]);
  const submit = (e) => { e?.preventDefault(); chat.ask(q); setQ(''); };
  return (
    <>
      <div className="chat">
        {!chat.messages.length && (
          <div className="col">
            <p className="muted small">Ask about your salon — answers come from your live business data.</p>
            <div className="chips">{SUGGESTIONS.slice(0, compact ? 5 : 8).map((s) => <button key={s} className="chip" onClick={() => chat.ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {chat.messages.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>{m.role === 'user' ? m.content : <Markdown text={m.content} />}</div>)}
        {chat.busy && <div className="msg bot row"><Spinner size={14} /> Looking at your data…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="row" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your business…" aria-label="Question" maxLength={1000} />
        <Button variant="primary" icon={Send} type="submit" disabled={!q.trim() || chat.busy} aria-label="Send" />
      </form>
    </>
  );
}

export function InsightList({ items }) {
  const I = { good: TrendingUp, warn: AlertTriangle, info: Info };
  if (!items?.length) return <p className="faint small">Insights appear once you have some sales, appointments and stock recorded.</p>;
  return <div className="col">{items.map((x, i) => { const Icon = I[x.tone] || Info; return <div key={i} className={`insight ${x.tone}`}><span className="i"><Icon size={15} /></span><div><b style={{ fontSize: 13.5 }}>{x.title}</b><div className="muted small">{x.text}</div></div></div>; })}</div>;
}

export default function AIPanel({ onClose }) {
  const chat = useChat();
  return (
    <div className="card ai-panel no-print" role="dialog" aria-label="AI assistant">
      <div className="row between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="row"><span className="brand-mark" style={{ width: 30, height: 30, fontSize: 14 }}><Sparkles size={15} /></span><div><b>Salon Assistant</b><div className="faint tiny">Answers from your live data</div></div></div>
        <div className="row" style={{ gap: 4 }}>{chat.messages.length > 0 && <Button size="sm" variant="ghost" onClick={chat.reset}>Clear</Button>}<Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close" /></div>
      </div>
      <ChatView chat={chat} compact />
    </div>
  );
}
