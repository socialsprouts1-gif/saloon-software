import { useState } from 'react';
import { Plus, Wallet, Pencil, Trash2, Paperclip, Repeat } from 'lucide-react';
import { useApi, useAuth, useDebounced, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, compact, fmtDate, payLabel, today, PAY_METHODS, titleCase } from '../lib/format.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Kpi, SearchInput, Pager, ExportMenu, Switch, Field, Spinner, useConfirm } from '../components/ui.jsx';

export default function Expenses() {
  const { salon } = useAuth();
  const [f, setF] = useState({ q: '', category: '', from: '', to: '', recurring: '', page: 1 });
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/expenses', { ...f, q, pageSize: 25 });
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const del = async (x) => { if (!(await confirm({ title: 'Delete this expense?', text: `${x.category} · ${money(x.amount)} on ${fmtDate(x.date)}`, danger: true, confirmText: 'Delete' }))) return; try { await api.del(`/api/expenses/${x.id}`); toast.success('Expense deleted'); reload(); } catch (e) { toast.error(e); } };
  const openReceipt = async (name) => { try { const b = await api.blob(`/api/files/${encodeURIComponent(name)}`); window.open(URL.createObjectURL(b), '_blank'); } catch (e) { toast.error(e); } };
  const cols = [{ key: 'date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'payment_method', label: 'Method', format: payLabel }, { key: 'amount', label: 'Amount', align: 'right', format: money, raw: (v) => v }, { key: 'branch_name', label: 'Branch' }, { key: 'is_recurring', label: 'Recurring', format: (v, r) => (v ? titleCase(r.recurrence) : '') }];
  const all = async () => (await api.get('/api/expenses', { ...f, q, pageSize: 200, page: 1 })).data;
  const s = data?.summary;
  return (
    <div>
      <PageHead title="Expenses" sub="Rent, utilities, salaries, purchases and more — feeds profit reports">
        {data && <ExportMenu onCSV={async () => exportCSV('expenses', cols, await all())} onExcel={async () => exportXLSX('expenses', [{ name: 'Expenses', columns: cols, rows: await all() }])} onPDF={async () => exportPDF('expenses', 'Expense report', [f.from, f.to].filter(Boolean).join(' to ') || 'Latest', [{ summary: [['Filtered total', money(data.filtered_sum)]], columns: cols, rows: await all() }], salon?.name)} />}
        <Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Add expense</Button>
      </PageHead>
      {s && <div className="grid g4 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi tone="danger" icon={Wallet} label="Today" value={money(s.today)} /><Kpi tone="danger" label="This week" value={compact(s.week)} /><Kpi tone="danger" label="This month" value={compact(s.month)} /><Kpi tone="danger" label="This year" value={compact(s.year)} />
      </div>}
      <Card pad={false}>
        <div className="toolbar">
          <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Search description" />
          <select className="input" style={{ width: 170 }} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, page: 1 })} aria-label="Category"><option value="">All categories</option>{(data?.categories || []).map((c) => <option key={c}>{c}</option>)}</select>
          <input type="date" className="input" style={{ width: 150 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} aria-label="From" /><input type="date" className="input" style={{ width: 150 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} aria-label="To" />
          <label className="check small"><input type="checkbox" checked={!!f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked ? 1 : '', page: 1 })} />Recurring only</label>
          {data && <span className="faint small" style={{ marginLeft: 'auto' }}>Filtered total <b style={{ color: 'var(--text)' }}>{money(data.filtered_sum)}</b></span>}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader rows={8} /> : !data.data.length ? <Empty icon={Wallet} title="No expenses recorded" action={<Button variant="primary" onClick={() => setEdit({})}>Add expense</Button>} /> : (
          <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Branch</th><th className="right">Amount</th><th /></tr></thead>
            <tbody>{data.data.map((x) => (
              <tr key={x.id}>
                <td className="nowrap">{fmtDate(x.date)}</td><td><Badge tone="rose">{x.category}</Badge>{x.is_recurring ? <Badge tone="blue"><Repeat size={10} />{titleCase(x.recurrence)}</Badge> : null}</td>
                <td className="small">{x.description}{x.is_recurring && x.next_due ? <div className="faint tiny">Next on {fmtDate(x.next_due)}</div> : null}</td><td className="small">{payLabel(x.payment_method)}</td><td className="small">{x.branch_name}</td>
                <td className="num"><b>{money(x.amount)}</b></td>
                <td className="nowrap right">{x.receipt && <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => openReceipt(x.receipt)} aria-label="Receipt" />}{!x.payroll_id && <><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(x)} aria-label="Edit" /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(x)} aria-label="Delete" /></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
      </Card>
      {edit && <ExpenseForm initial={edit} categories={data?.categories || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ExpenseForm({ initial, categories, onClose, onSaved }) {
  const { branches, branch } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ category: categories[0] || 'Rent', amount: '', date: today(), payment_method: 'cash', description: '', receipt: null, is_recurring: false, recurrence: 'monthly', branch_id: branch !== 'all' ? branch : branches[0]?.id, ...initial, is_recurring: !!initial.is_recurring });
  const [custom, setCustom] = useState(false);
  const [uploading, setUploading] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUploading(true);
    try { const r = await api.upload('/api/uploads/receipt', file); setF((x) => ({ ...x, receipt: r.file })); } catch (err) { toast.error(err); } finally { setUploading(false); }
  };
  const save = async () => {
    try {
      const body = { category: f.category, amount: Number(f.amount), date: f.date, payment_method: f.payment_method, description: f.description, receipt: f.receipt, is_recurring: f.is_recurring, recurrence: f.is_recurring ? f.recurrence : null, branch_id: Number(f.branch_id) };
      if (initial.id) await api.put(`/api/expenses/${initial.id}`, body); else await api.post('/api/expenses', body);
      toast.success('Expense saved'); onSaved();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit expense' : 'Add expense'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!(Number(f.amount) > 0) || !f.category} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        {custom ? <Input label="New category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /> : <Select label="Category" value={f.category} onChange={(e) => (e.target.value === '__new' ? (setCustom(true), setF({ ...f, category: '' })) : setF({ ...f, category: e.target.value }))} options={[...categories.map((c) => [c, c]), ['__new', '+ Custom category…']]} />}
        <Input label="Amount (₹)" type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Select label="Payment method" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} options={PAY_METHODS} />
        {!initial.id && branches.length > 1 && <Select label="Branch" value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })} options={branches.map((b) => [b.id, b.name])} />}
        <Input label="Description" fieldClass="full" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Field label="Receipt (image or PDF, max 5 MB)" className="full">
          <div className="row">{f.receipt ? <Badge tone="green"><Paperclip size={11} />Attached</Badge> : <span className="faint small">No receipt</span>}
            <label className="btn sm" style={{ cursor: 'pointer' }}>{uploading ? <Spinner size={14} /> : f.receipt ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={upload} /></label>
            {f.receipt && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, receipt: null })}>Remove</Button>}</div>
        </Field>
        <div className="full"><Switch label="Recurring expense" hint="Automatically posted on each due date" checked={f.is_recurring} onChange={(v) => setF({ ...f, is_recurring: v })} /></div>
        {f.is_recurring && <Select label="Repeats" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })} options={[['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]} />}
      </div>
    </Modal>
  );
}
