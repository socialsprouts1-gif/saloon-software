import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users, Crown, Sparkle, Moon, Repeat } from 'lucide-react';
import { useApi, useAuth, useDebounced, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtDate, titleCase } from '../lib/format.js';
import { exportCSV, exportXLSX } from '../lib/export.js';
import { PageHead, Card, Button, SearchInput, Badge, Pager, Empty, Loader, ErrorState, Avatar, Kpi, Tabs, ExportMenu, Modal, Input, Select, Textarea } from '../components/ui.jsx';

export function CustomerForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const emps = useApi('/api/staff/employees');
  const [f, setF] = useState({ name: '', phone: '', email: '', birthday: '', gender: '', notes: '', preferred_employee_id: '', ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, phone: f.phone, email: f.email || null, birthday: f.birthday || null, gender: f.gender || null, notes: f.notes || null, preferred_employee_id: f.preferred_employee_id ? Number(f.preferred_employee_id) : null };
      const r = initial?.id ? await api.put(`/api/customers/${initial.id}`, body) : await api.post('/api/customers', body);
      toast.success(initial?.id ? 'Customer updated' : 'Customer added'); onSaved(r.id || initial.id);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial?.id ? 'Edit customer' : 'New customer'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2 || f.phone.length < 10} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Input label="Full name" value={f.name} onChange={set('name')} />
        <Input label="Mobile number" value={f.phone} onChange={set('phone')} inputMode="tel" />
        <Input label="Email" type="email" value={f.email || ''} onChange={set('email')} />
        <Input label="Birthday" type="date" value={f.birthday || ''} onChange={set('birthday')} />
        <Select label="Gender (optional)" value={f.gender || ''} onChange={set('gender')} placeholder="Prefer not to say" options={[['female', 'Female'], ['male', 'Male'], ['other', 'Other']]} />
        <Select label="Preferred stylist" value={f.preferred_employee_id || ''} onChange={set('preferred_employee_id')} placeholder="None" options={(emps.data || []).filter((e) => e.service_ids?.length).map((e) => [e.id, e.name])} />
        <Textarea label="Notes" fieldClass="full" rows={3} value={f.notes || ''} onChange={set('notes')} placeholder="Allergies, preferences, formulas…" />
      </div>
    </Modal>
  );
}

export default function Customers() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [f, setF] = useState({ q: '', segment: '', sort: 'recent', page: 1 });
  const [adding, setAdding] = useState(false);
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/customers', { ...f, q, pageSize: 25 });
  const seg = useApi('/api/customers/segments');
  const finance = can('finance') || can('billing');
  const cols = [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Mobile' }, { key: 'email', label: 'Email' }, { key: 'segment', label: 'Segment', format: titleCase }, { key: 'visits', label: 'Visits' },
    ...(finance ? [{ key: 'spent', label: 'Total spent', format: money, raw: (v) => v }] : []), { key: 'last_visit', label: 'Last visit' }, { key: 'loyalty_points', label: 'Points' }, { key: 'birthday', label: 'Birthday' }];
  const allRows = async () => (await api.get('/api/customers', { ...f, q, pageSize: 200, page: 1 })).data;
  const s = seg.data;
  return (
    <div>
      <PageHead title="Customers" sub="Profiles, visit history, loyalty and segments">
        <ExportMenu onCSV={async () => exportCSV('customers', cols, await allRows())} onExcel={async () => exportXLSX('customers', [{ name: 'Customers', columns: cols, rows: await allRows() }])} />
        <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>New customer</Button>
      </PageHead>
      {s && <div className="grid g4 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi icon={Users} label="All customers" value={s.total} />
        <Kpi icon={Crown} tone="accent" label="VIP" value={s.vip} />
        <Kpi icon={Repeat} tone="info" label="Regular" value={s.regular} />
        <Kpi icon={Moon} tone="warning" label="Inactive" value={s.inactive} meta={`${s.new} new`} />
      </div>}
      <Card pad={false}>
        <div style={{ padding: '6px 16px 0' }}><Tabs value={f.segment} onChange={(v) => setF({ ...f, segment: v, page: 1 })} tabs={[['', 'All'], ['new', 'New'], ['regular', 'Regular'], ['vip', 'VIP'], ['inactive', 'Inactive'], ['due', 'Payment due'], ['birthday', 'Birthdays this month']]} /></div>
        <div className="toolbar">
          <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Name, mobile or email" />
          <select className="input" style={{ width: 170 }} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} aria-label="Sort"><option value="recent">Newest first</option><option value="name">Name A–Z</option>{finance && <option value="spent">Top spenders</option>}<option value="visits">Most visits</option><option value="last_visit">Recent visit</option></select>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader rows={8} /> : !data.data.length ? <Empty icon={Users} title="No customers found" action={<Button variant="primary" onClick={() => setAdding(true)}>Add a customer</Button>} /> : (
          <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
            <thead><tr><th>Customer</th><th>Segment</th><th className="right">Visits</th>{finance && <th className="right">Lifetime value</th>}<th>Last visit</th><th className="right">Points</th>{finance && <th className="right">Due</th>}</tr></thead>
            <tbody>{data.data.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/customers/${c.id}`)}>
                <td><div className="row"><Avatar name={c.name} size="sm" /><div><b>{c.name}</b><div className="faint tiny">{c.phone}</div></div></div></td>
                <td><Badge status={c.segment} /></td><td className="num">{c.visits}</td>{finance && <td className="num">{money(c.spent)}</td>}
                <td className="nowrap">{c.last_visit ? fmtDate(c.last_visit) : <span className="faint">Never</span>}</td><td className="num">{c.loyalty_points}</td>
                {finance && <td className="num" style={{ color: c.due > 0 ? 'var(--warning)' : undefined }}>{c.due > 0 ? money(c.due) : '—'}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
      </Card>
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); nav(`/customers/${id}`); }} />}
    </div>
  );
}
