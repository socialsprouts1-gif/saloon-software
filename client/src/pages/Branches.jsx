import { useState } from 'react';
import { Plus, Building2, Pencil, MapPin, Phone, Users } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { compact } from '../lib/format.js';
import { PageHead, Card, Button, Badge, Loader, Modal, Input, Switch, Kpi, ErrorState } from '../components/ui.jsx';
import { rangeFor as rf } from '../components/ui.jsx';

export default function Branches() {
  const { data, reload, error } = useApi('/api/branches');
  const r = rf('month');
  const report = useApi('/api/reports/revenue', { from: r.from, to: r.to });
  const { refresh, switchBranch, can } = useAuth();
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const save = async () => {
    try { const { id, employees, created_at, updated_at, ...b } = edit; if (id) await api.put(`/api/branches/${id}`, { ...b, is_active: !!b.is_active }); else await api.post('/api/branches', b); toast.success('Branch saved'); setEdit(null); reload(); refresh(); } catch (e) { toast.error(e); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const byName = Object.fromEntries((report.data?.by_branch || []).map((b) => [b.name, b]));
  return (
    <div>
      <PageHead title="Branches" sub="Each branch keeps its own staff, stock, appointments, sales and expenses. Use the branch switcher at the top to view one branch or all combined.">
        <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', is_active: true })}>Add branch</Button>
      </PageHead>
      {!data ? <Loader /> : (
        <div className="grid g3">{data.map((b) => {
          const s = byName[b.name];
          return (
            <div key={b.id} className="card card-pad col" style={{ gap: 10, opacity: b.is_active ? 1 : .6 }}>
              <div className="row between"><div className="row"><span className="kpi" style={{ padding: 0 }}><span className="ico"><Building2 size={16} /></span></span><h3 className="display" style={{ fontSize: 19 }}>{b.name}</h3></div><Badge status={b.is_active ? 'active' : 'inactive'} /></div>
              {b.address && <div className="muted small row" style={{ gap: 6 }}><MapPin size={13} />{b.address}</div>}
              {b.phone && <div className="muted small row" style={{ gap: 6 }}><Phone size={13} />{b.phone}</div>}
              <div className="muted small row" style={{ gap: 6 }}><Users size={13} />{b.employees} active staff</div>
              {s && can('finance') && <div className="grid g2" style={{ gap: 8, marginTop: 4 }}><div className="card" style={{ padding: 10, background: 'var(--bg-elev)' }}><div className="faint tiny">Revenue this month</div><b>{compact(s.total)}</b></div><div className="card" style={{ padding: 10, background: 'var(--bg-elev)' }}><div className="faint tiny">Expenses this month</div><b>{compact(s.expenses)}</b></div></div>}
              <div className="row mt-sm"><Button size="sm" onClick={() => switchBranch(String(b.id))}>View dashboard</Button><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...b })}>Edit</Button></div>
            </div>
          );
        })}</div>
      )}
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit branch' : 'Add branch'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={(edit.name || '').length < 2} onClick={save}>Save</Button></>}>
        <div className="form-grid">
          <Input label="Branch name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Input label="Phone" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
          <Input label="Email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          <Input label="Address" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
          {edit.id && <Switch label="Active" checked={!!edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} />}
        </div>
      </Modal>}
    </div>
  );
}
