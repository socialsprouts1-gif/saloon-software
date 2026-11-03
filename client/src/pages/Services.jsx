import { useState } from 'react';
import { Plus, Scissors, Pencil, Trash2, FolderPlus } from 'lucide-react';
import { useApi, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { PageHead, Card, Button, SearchInput, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Textarea, Switch, Field, ImageUpload, Avatar, useConfirm } from '../components/ui.jsx';

export default function Services() {
  const { data, loading, error, reload } = useApi('/api/catalog/services');
  const cats = useApi('/api/catalog/categories');
  const emps = useApi('/api/staff/employees');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [catModal, setCatModal] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const list = (data || []).filter((s) => (!cat || String(s.category_id) === cat) && s.name.toLowerCase().includes(q.toLowerCase()));
  const groups = list.reduce((g, s) => { (g[s.category || 'Uncategorised'] ||= []).push(s); return g; }, {});
  const remove = async (s) => {
    if (!(await confirm({ title: `Delete ${s.name}?`, text: 'Services with booking or sales history are deactivated instead of deleted.', danger: true, confirmText: 'Delete' }))) return;
    try { const r = await api.del(`/api/catalog/services/${s.id}`); toast.success(r.archived ? 'Service deactivated (has history)' : 'Service deleted'); reload(); } catch (e) { toast.error(e); }
  };
  return (
    <div>
      <PageHead title="Services & pricing" sub="Menu, prices, durations, commissions and who can perform each service">
        <Button icon={FolderPlus} onClick={() => setCatModal(true)}>Categories</Button>
        <Button variant="primary" icon={Plus} onClick={() => setEdit({})}>New service</Button>
      </PageHead>
      <Card pad={false}>
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search services" />
          <div className="chips"><button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All</button>{(cats.data || []).map((c) => <button key={c.id} className={`chip ${cat === String(c.id) ? 'on' : ''}`} onClick={() => setCat(String(c.id))}>{c.name}</button>)}</div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loader rows={8} /> : !list.length ? <Empty icon={Scissors} title="No services yet" action={<Button variant="primary" onClick={() => setEdit({})}>Add your first service</Button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Service</th><th className="right">Price</th><th className="right">Duration</th><th className="right">Commission</th><th>Stylists</th><th>Status</th><th /></tr></thead>
            {Object.entries(groups).map(([g, items]) => (
              <tbody key={g}>
                <tr><td colSpan={7} style={{ background: 'var(--bg-elev)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-2)' }}>{g} <span className="faint">· {items.length}</span></td></tr>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td><div className="row">{s.image ? <img src={s.image} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} /> : null}<div><b>{s.name}</b>{s.description && <div className="faint tiny truncate" style={{ maxWidth: 320 }}>{s.description}</div>}</div></div></td>
                    <td className="num"><b>{money(s.price)}</b></td><td className="num">{s.duration_min} min</td><td className="num">{s.commission_pct != null ? `${s.commission_pct}%` : <span className="faint">Staff rate</span>}</td>
                    <td><div className="row" style={{ gap: 0 }}>{s.employees.slice(0, 5).map((e) => <span key={e.id} title={e.name} style={{ marginLeft: -6 }}><Avatar name={e.name} size="sm" /></span>)}{s.employees.length > 5 && <span className="faint tiny" style={{ marginLeft: 4 }}>+{s.employees.length - 5}</span>}{!s.employees.length && <span className="faint small">None</span>}</div></td>
                    <td><div className="row" style={{ gap: 4 }}><Badge status={s.is_active ? 'active' : 'inactive'} />{s.online_bookable && s.is_active ? <Badge tone="blue">Online</Badge> : null}</div></td>
                    <td className="nowrap right"><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(s)} aria-label="Edit" /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(s)} aria-label="Delete" /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table></div>
        )}
      </Card>
      {edit && <ServiceForm initial={edit} cats={cats.data || []} emps={emps.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {catModal && <CategoryModal cats={cats} onClose={() => { setCatModal(false); reload(); }} />}
    </div>
  );
}

function ServiceForm({ initial, cats, emps, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', category_id: cats[0]?.id || '', description: '', price: '', duration_min: 30, commission_pct: '', image: null, is_active: true, online_bookable: true, ...initial, employee_ids: initial.employees?.map((e) => e.id) || [] });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, category_id: f.category_id ? Number(f.category_id) : null, description: f.description, price: Number(f.price), duration_min: Number(f.duration_min), commission_pct: f.commission_pct === '' || f.commission_pct == null ? null : Number(f.commission_pct), image: f.image, is_active: !!f.is_active, online_bookable: !!f.online_bookable, employee_ids: f.employee_ids };
      if (initial.id) await api.put(`/api/catalog/services/${initial.id}`, body); else await api.post('/api/catalog/services', body);
      toast.success('Service saved'); onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const stylists = emps.filter((e) => !['receptionist', 'accountant'].includes(e.role));
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit service' : 'New service'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2 || f.price === ''} onClick={save}>Save service</Button></>}>
      <div className="form-grid">
        <Input label="Service name" value={f.name} onChange={set('name')} />
        <Select label="Category" value={f.category_id || ''} onChange={set('category_id')} placeholder="Uncategorised" options={cats.map((c) => [c.id, c.name])} />
        <Input label="Price (₹)" type="number" min="0" value={f.price} onChange={set('price')} />
        <Input label="Duration (minutes)" type="number" min="5" step="5" value={f.duration_min} onChange={set('duration_min')} />
        <Input label="Commission % (optional)" type="number" min="0" max="100" value={f.commission_pct ?? ''} onChange={set('commission_pct')} hint="Overrides the stylist's default service commission" />
        <ImageUpload label="Service image" value={f.image} onChange={(v) => setF({ ...f, image: v })} />
        <Textarea label="Description" fieldClass="full" rows={2} value={f.description || ''} onChange={set('description')} />
        <Field label={`Stylists who perform this (${f.employee_ids.length})`} className="full">
          <div className="chips">{stylists.map((e) => <button type="button" key={e.id} className={`chip ${f.employee_ids.includes(e.id) ? 'on' : ''}`} onClick={() => setF({ ...f, employee_ids: f.employee_ids.includes(e.id) ? f.employee_ids.filter((x) => x !== e.id) : [...f.employee_ids, e.id] })}>{e.name}{e.branch_name ? ` · ${e.branch_name}` : ''}</button>)}</div>
        </Field>
        <Switch label="Available" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
        <Switch label="Bookable online / QR" checked={f.online_bookable} onChange={(v) => setF({ ...f, online_bookable: v })} />
      </div>
    </Modal>
  );
}

function CategoryModal({ cats, onClose }) {
  const [name, setName] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const add = async () => { try { await api.post('/api/catalog/categories', { name }); setName(''); cats.reload(); } catch (e) { toast.error(e); } };
  const rename = async (c) => { const n = window.prompt('Rename category', c.name); if (!n || n === c.name) return; try { await api.put(`/api/catalog/categories/${c.id}`, { name: n }); cats.reload(); } catch (e) { toast.error(e); } };
  const del = async (c) => { if (!(await confirm({ title: `Delete ${c.name}?`, danger: true }))) return; try { await api.del(`/api/catalog/categories/${c.id}`); cats.reload(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title="Service categories" size="narrow" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="row mb" style={{ marginBottom: 12 }}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === 'Enter' && name.length > 1 && add()} /><Button variant="primary" disabled={name.length < 2} onClick={add}>Add</Button></div>
      {(cats.data || []).map((c) => <div key={c.id} className="mini-stat"><span>{c.name} <span className="faint small">· {c.services}</span></span><span><Button size="sm" variant="ghost" icon={Pencil} onClick={() => rename(c)} aria-label="Rename" /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(c)} aria-label="Delete" /></span></div>)}
    </Modal>
  );
}
