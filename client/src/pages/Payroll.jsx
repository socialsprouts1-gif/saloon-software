import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Wallet, FileDown, CheckCircle2, HandCoins, Pencil } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, today, monthLabel, titleCase, fmtDate, payLabel, PAY_METHODS, addDays } from '../lib/format.js';
import { salarySlipPDF } from '../lib/pdf.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Kpi, Tabs, ExportMenu, Avatar } from '../components/ui.jsx';

export default function Payroll() {
  const [sp] = useSearchParams();
  const { salon } = useAuth();
  const [month, setMonth] = useState(sp.get('month') || addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7));
  const [tab, setTab] = useState('payroll');
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApi('/api/staff/payroll', { month, status });
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState(null);
  const [pay, setPay] = useState(null);
  const toast = useToast();
  const generate = async () => {
    setBusy(true);
    try { const r = await api.post('/api/staff/payroll/generate', { month }); toast.success(`Calculated ${r.generated} salaries${r.skipped ? ` (${r.skipped} already paid, unchanged)` : ''}`); reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const cols = [{ key: 'name', label: 'Employee' }, { key: 'salary_type', label: 'Type', format: titleCase }, { key: 'present_days', label: 'Present' }, { key: 'absent_days', label: 'Absent' },
    ...['earned_base', 'overtime_pay', 'service_commission', 'product_commission', 'incentives', 'bonus', 'deductions', 'advance', 'net_payable'].map((k) => ({ key: k, label: titleCase(k), align: 'right', format: money, raw: (v) => v })), { key: 'status', label: 'Status', format: titleCase }];
  return (
    <div>
      <PageHead title="Payroll & commission" sub="Salaries calculated from attendance, sales commissions and adjustments">
        <input type="month" className="input" style={{ width: 170 }} value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        {data?.rows.length > 0 && <ExportMenu onCSV={() => exportCSV(`payroll-${month}`, cols, data.rows)} onExcel={() => exportXLSX(`payroll-${month}`, [{ name: 'Payroll', columns: cols, rows: data.rows }])} onPDF={() => exportPDF(`payroll-${month}`, 'Monthly payroll report', monthLabel(month), [{ summary: [['Total payable', money(data.totals.net)], ['Paid', money(data.totals.paid)], ['Pending', money(data.totals.pending)]], columns: cols.filter((c) => !['salary_type'].includes(c.key)), rows: data.rows }], salon?.name)} />}
        <Button variant="primary" icon={RefreshCw} loading={busy} onClick={generate}>{data?.rows.length ? 'Recalculate' : 'Generate payroll'}</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[['payroll', monthLabel(month)], ['advances', 'Salary advances']]} />
      <div className="mt" />
      {tab === 'advances' ? <Advances /> : error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader /> : <>
        <div className="grid g3 kpis mb" style={{ marginBottom: 16 }}>
          <Kpi icon={Wallet} label="Total payable" value={money(data.totals.net)} meta={`${data.rows.length} employees`} />
          <Kpi icon={CheckCircle2} tone="success" label="Paid" value={money(data.totals.paid)} />
          <Kpi icon={HandCoins} tone="warning" label="Pending" value={money(data.totals.pending)} meta={`${data.rows.filter((r) => r.status === 'pending').length} pending`} />
        </div>
        <Card pad={false}>
          <div className="toolbar"><select className="input sm" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option></select><span className="faint small">Recalculating keeps incentives, bonuses and deductions you've entered. Paid rows are locked.</span></div>
          {!data.rows.length ? <Empty icon={Wallet} title={`No payroll for ${monthLabel(month)} yet`} text="Generate it to calculate every salary from attendance and sales." action={<Button variant="primary" loading={busy} onClick={generate}>Generate payroll</Button>} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Employee</th><th className="right">Days</th><th className="right">Base earned</th><th className="right">Overtime</th><th className="right">Commission</th><th className="right">Incentive + bonus</th><th className="right">Deductions</th><th className="right">Net payable</th><th>Status</th><th /></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="row"><Avatar name={r.name} src={r.photo} size="sm" /><div><b>{r.name}</b><div className="faint tiny">{titleCase(r.salary_type)}</div></div></div></td>
                  <td className="num small">{r.present_days}/{r.working_days}{r.absent_days > 0 && <div className="tiny" style={{ color: 'var(--danger)' }}>{r.absent_days} absent</div>}</td>
                  <td className="num">{money(r.earned_base)}{r.base_salary > 0 && r.earned_base < r.base_salary && <div className="faint tiny">of {money(r.base_salary)}</div>}</td>
                  <td className="num">{r.overtime_pay ? money(r.overtime_pay) : '—'}{r.overtime_hours > 0 && <div className="faint tiny">{r.overtime_hours}h</div>}</td>
                  <td className="num">{money(r.service_commission + r.product_commission)}{r.product_commission > 0 && <div className="faint tiny">{money(r.product_commission)} products</div>}</td>
                  <td className="num">{money(r.incentives + r.bonus)}</td><td className="num">{r.deductions + r.advance ? `−${money(r.deductions + r.advance)}` : '—'}{r.advance > 0 && <div className="faint tiny">advance {money(r.advance)}</div>}</td>
                  <td className="num"><b>{money(r.net_payable)}</b></td>
                  <td><Badge status={r.status} />{r.paid_at && <div className="faint tiny">{fmtDate(r.paid_at)} · {payLabel(r.payment_method)}</div>}</td>
                  <td className="nowrap right">
                    {r.status === 'pending' && <><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRow(r)} aria-label="Adjust" /><Button size="sm" variant="primary" onClick={() => setPay(r)}>Mark paid</Button></>}
                    <Button size="sm" variant="ghost" icon={FileDown} onClick={() => salarySlipPDF(r, r, salon)} aria-label="Salary slip" />
                  </td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={7}>Total</td><td className="num">{money(data.totals.net)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
          )}
        </Card>
      </>}
      {row && <AdjustModal row={row} onClose={() => setRow(null)} onSaved={() => { setRow(null); reload(); }} />}
      {pay && <PayModal row={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />}
    </div>
  );
}

function AdjustModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({ incentives: row.incentives, bonus: row.bonus, deductions: row.deductions, notes: row.notes || '' });
  const toast = useToast();
  const save = async () => { try { await api.put(`/api/staff/payroll/${row.id}`, { incentives: Number(f.incentives) || 0, bonus: Number(f.bonus) || 0, deductions: Number(f.deductions) || 0, notes: f.notes }); toast.success('Payroll updated'); onSaved(); } catch (e) { toast.error(e); } };
  const preview = row.net_payable - row.incentives - row.bonus + row.deductions + (Number(f.incentives) || 0) + (Number(f.bonus) || 0) - (Number(f.deductions) || 0);
  return (
    <Modal open onClose={onClose} title={`Adjust ${row.name}'s salary`} size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="col">
        <div className="card card-pad" style={{ background: 'var(--bg-elev)' }}>
          {[['Base earned', row.earned_base], ['Overtime', row.overtime_pay], ['Service commission', row.service_commission], ['Product commission', row.product_commission], ['Advance recovery', -row.advance]].map(([l, v]) => <div key={l} className="mini-stat small"><span className="muted">{l}</span><span className="num">{money(v)}</span></div>)}
        </div>
        <div className="form-grid"><Input label="Incentives (₹)" type="number" min="0" value={f.incentives} onChange={(e) => setF({ ...f, incentives: e.target.value })} /><Input label="Bonus (₹)" type="number" min="0" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} /></div>
        <Input label="Deductions (₹)" type="number" min="0" value={f.deductions} onChange={(e) => setF({ ...f, deductions: e.target.value })} hint="Fines, damages, PF etc." />
        <Input label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <div className="row between"><b>New net payable</b><span className="display" style={{ fontSize: 22 }}>{money(Math.max(0, preview))}</span></div>
      </div>
    </Modal>
  );
}
function PayModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({ paid_at: today(), payment_method: 'bank_transfer', notes: '' });
  const toast = useToast();
  const save = async () => { try { await api.post(`/api/staff/payroll/${row.id}/pay`, f); toast.success(`${row.name} marked as paid`); onSaved(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title="Record salary payment" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Mark as paid</Button></>}>
      <div className="col">
        <p>Pay <b>{money(row.net_payable)}</b> to <b>{row.name}</b> for {monthLabel(row.month)}.</p>
        <Input label="Payment date" type="date" value={f.paid_at} max={today()} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />
        <Select label="Payment method" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} options={PAY_METHODS} />
        <Input label="Reference / note" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <p className="faint small">This is recorded as an “Employee salaries” expense automatically.</p>
      </div>
    </Modal>
  );
}

function Advances() {
  const { data, reload } = useApi('/api/staff/advances');
  const emps = useApi('/api/staff/employees');
  const [f, setF] = useState({ employee_id: '', amount: '', date: today(), note: '', payment_method: 'cash' });
  const toast = useToast();
  const add = async () => { try { await api.post('/api/staff/advances', { ...f, employee_id: Number(f.employee_id), amount: Number(f.amount) }); toast.success('Advance recorded — it will be recovered in the next payroll'); setF({ ...f, amount: '', note: '' }); reload(); } catch (e) { toast.error(e); } };
  return (
    <Card title="Salary advances" actions={<span className="faint small">Automatically deducted in the next unpaid payroll</span>}>
      <div className="row wrap mb" style={{ marginBottom: 14 }}>
        <select className="input" style={{ width: 200 }} value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} aria-label="Employee"><option value="">Employee…</option>{(emps.data || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <input className="input" type="number" min="0" style={{ width: 120 }} placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Amount" />
        <input className="input" type="date" style={{ width: 160 }} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <select className="input" style={{ width: 140 }} value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} aria-label="Method">{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" style={{ width: 200 }} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />
        <Button variant="primary" disabled={!f.employee_id || !(Number(f.amount) > 0)} onClick={add}>Record advance</Button>
      </div>
      {!data ? <Loader /> : !data.length ? <p className="faint">No advances given.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Employee</th><th className="right">Amount</th><th>Note</th><th>Recovered in</th></tr></thead><tbody>
        {data.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td>{a.employee}</td><td className="num">{money(a.amount)}</td><td className="muted small">{a.note}</td><td>{a.recovered_month ? monthLabel(a.recovered_month) : <Badge status="pending">Outstanding</Badge>}</td></tr>)}
      </tbody></table></div>}
    </Card>
  );
}
