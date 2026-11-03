import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Receipt, FileText } from 'lucide-react';
import { useApi, useAuth, useDebounced } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtDate, payLabel, titleCase } from '../lib/format.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Button, SearchInput, Badge, Pager, Empty, Loader, ErrorState, ExportMenu, Kpi } from '../components/ui.jsx';

export default function Invoices() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { salon } = useAuth();
  const [f, setF] = useState({ q: '', status: sp.get('status') || '', from: '', to: '', page: 1 });
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/invoices', { ...f, q, pageSize: 25 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, page: 1 });
  const cols = [
    { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'customer_name', label: 'Customer', format: (v) => v || 'Walk-in' },
    { key: 'total', label: 'Total', align: 'right', format: money, raw: (v) => v }, { key: 'paid_amount', label: 'Paid', align: 'right', format: money, raw: (v) => v },
    { key: 'balance', label: 'Balance', align: 'right', format: money, raw: (v) => v }, { key: 'status', label: 'Status', format: titleCase }, { key: 'methods', label: 'Methods', format: (v) => (v || '').split(',').filter(Boolean).map(payLabel).join(', ') },
  ];
  const all = async () => (await api.get('/api/invoices', { ...f, q, pageSize: 200, page: 1 })).data;
  return (
    <div>
      <PageHead title="Invoices" sub="Billing history, dues and payments">
        <ExportMenu onCSV={async () => exportCSV('invoices', cols, await all())} onExcel={async () => exportXLSX('invoices', [{ name: 'Invoices', columns: cols, rows: await all() }])}
          onPDF={async () => exportPDF('invoices', 'Invoices', [f.from, f.to].filter(Boolean).join(' to ') || 'Latest', [{ columns: cols, rows: await all(), summary: data ? [['Total billed', money(data.sums.total)], ['Collected', money(data.sums.paid)], ['Outstanding', money(data.sums.balance)]] : null }], salon?.name)} />
        <Button variant="primary" icon={Receipt} onClick={() => nav('/pos')}>New bill</Button>
      </PageHead>
      {data && <div className="grid g3 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi label="Billed (filtered)" value={money(data.sums.total)} /><Kpi tone="success" label="Collected" value={money(data.sums.paid)} /><Kpi tone="warning" label="Outstanding" value={money(data.sums.balance)} />
      </div>}
      <Card pad={false}>
        <div className="toolbar">
          <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Invoice #, customer or mobile" />
          <select className="input" style={{ width: 150 }} value={f.status} onChange={set('status')} aria-label="Status">
            <option value="">All statuses</option><option value="due">Due (unpaid + partial)</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option><option value="void">Void</option>
          </select>
          <input type="date" className="input" style={{ width: 150 }} value={f.from} onChange={set('from')} aria-label="From" /><input type="date" className="input" style={{ width: 150 }} value={f.to} onChange={set('to')} aria-label="To" />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader rows={8} /> : !data.data.length ? <Empty icon={FileText} title="No invoices found" action={<Button variant="primary" onClick={() => nav('/pos')}>Create a bill</Button>} /> : (
          <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Payment</th><th className="right">Total</th><th className="right">Balance</th><th>Status</th></tr></thead>
            <tbody>{data.data.map((i) => (
              <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}>
                <td><b>{i.invoice_no}</b>{i.source === 'online' && <Badge tone="blue">online</Badge>}</td><td className="nowrap">{fmtDate(i.date)}</td>
                <td>{i.customer_name || <span className="faint">Walk-in</span>}<div className="faint tiny">{i.customer_phone}</div></td>
                <td className="small muted">{(i.methods || '').split(',').filter(Boolean).map(payLabel).join(', ') || '—'}</td>
                <td className="num">{money(i.total)}</td><td className="num" style={{ color: i.balance > 0 ? 'var(--warning)' : undefined }}>{i.balance > 0 ? money(i.balance) : '—'}</td><td><Badge status={i.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
      </Card>
    </div>
  );
}
