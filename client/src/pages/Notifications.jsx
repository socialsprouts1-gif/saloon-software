import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarPlus, CalendarX, Clock, PackageMinus, UserX, Wallet, Gift, Cake, IndianRupee, CheckCheck } from 'lucide-react';
import { useApi } from '../context.jsx';
import { api } from '../lib/api.js';
import { relTime } from '../lib/format.js';
import { PageHead, Card, Button, Empty, Loader, Pager, Tabs } from '../components/ui.jsx';

const ICONS = { booking: CalendarPlus, cancellation: CalendarX, upcoming: Clock, low_stock: PackageMinus, absence: UserX, salary: Wallet, membership: Gift, birthday: Cake, payment: IndianRupee };
const TYPES = [['', 'All'], ['booking', 'Bookings'], ['upcoming', 'Upcoming'], ['cancellation', 'Cancellations'], ['low_stock', 'Stock'], ['absence', 'Absences'], ['salary', 'Salary'], ['membership', 'Memberships'], ['birthday', 'Birthdays'], ['payment', 'Payments']];

export default function Notifications() {
  const [f, setF] = useState({ type: '', unread: '', page: 1 });
  const { data, reload } = useApi('/api/notifications', { ...f, pageSize: 30 });
  const nav = useNavigate();
  const open = async (n) => { await api.post('/api/notifications/read', { ids: [n.id] }); if (n.link) nav(n.link); else reload(); };
  return (
    <div>
      <PageHead title="Notifications" sub={data ? `${data.unread} unread` : ''}>
        <label className="check small"><input type="checkbox" checked={!!f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked ? 1 : '', page: 1 })} />Unread only</label>
        <Button icon={CheckCheck} onClick={async () => { await api.post('/api/notifications/read'); reload(); }}>Mark all read</Button>
      </PageHead>
      <Card pad={false}>
        <div style={{ padding: '6px 16px 0' }}><Tabs value={f.type} onChange={(v) => setF({ ...f, type: v, page: 1 })} tabs={TYPES} /></div>
        {!data ? <Loader rows={8} /> : !data.data.length ? <Empty icon={Bell} title="No notifications" text="New bookings, stock alerts, absences and reminders will appear here." /> : data.data.map((n) => {
          const I = ICONS[n.type] || Bell;
          return (
            <div key={n.id} className="row" onClick={() => open(n)} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: n.is_read ? undefined : 'color-mix(in srgb, var(--primary-soft) 60%, transparent)' }}>
              <span className="kpi" style={{ padding: 0 }}><span className="ico"><I size={16} /></span></span>
              <div className="grow"><b>{n.title}</b>{n.message && <div className="muted small">{n.message}</div>}</div>
              <span className="faint tiny nowrap">{relTime(n.created_at)}</span>
              {!n.is_read && <span className="dot" style={{ background: 'var(--primary)' }} />}
            </div>
          );
        })}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
      </Card>
    </div>
  );
}
