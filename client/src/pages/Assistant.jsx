import { Sparkles, RefreshCw } from 'lucide-react';
import { useApi, useAuth } from '../context.jsx';
import { PageHead, Card, Button, Loader, Badge } from '../components/ui.jsx';
import { ChatView, InsightList, useChat } from '../components/AIPanel.jsx';

export default function Assistant() {
  const chat = useChat();
  const status = useApi('/api/ai/status');
  const insights = useApi('/api/ai/insights');
  const { can } = useAuth();
  return (
    <div>
      <PageHead title="AI Salon Assistant" sub="Ask questions in plain language — every answer is computed from your live salon data">
        {status.data && <Badge tone={status.data.mode === 'claude' ? 'plum' : 'blue'}>{status.data.mode === 'claude' ? `Claude · ${status.data.model}` : 'Built-in engine'}</Badge>}
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 18 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', minHeight: 480 }}>
          <div className="row between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}><b className="row" style={{ gap: 8 }}><Sparkles size={16} style={{ color: 'var(--accent)' }} />Conversation</b>{chat.messages.length > 0 && <Button size="sm" variant="ghost" onClick={chat.reset}>New chat</Button>}</div>
          <ChatView chat={chat} />
        </div>
        <div className="col" style={{ gap: 18 }}>
          <Card title="Business insights" actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={insights.reload} aria-label="Refresh" />}>{insights.data ? <InsightList items={insights.data} /> : <Loader rows={4} />}</Card>
          {status.data?.mode === 'built_in' && can('settings') && <Card title="Want deeper answers?"><p className="muted small">The built-in engine answers common questions instantly. Add an Anthropic API key in <b>Settings → AI assistant</b> to let Claude answer any question — it still only uses figures from your own data.</p></Card>}
        </div>
      </div>
      <style>{`@media (max-width: 1024px){ .grid[style*="1.5fr"]{ grid-template-columns: 1fr !important } }`}</style>
    </div>
  );
}
