import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Package, PackageMinus, PackageX, Boxes, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Pencil, Archive, Truck, History, ShoppingCart } from 'lucide-react';
import { useApi, useAuth, useDebounced, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, compact, fmtDate, fmtStamp, titleCase, today, PAY_METHODS } from '../lib/format.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Kpi, Tabs, SearchInput, Pager, ExportMenu, Switch, useConfirm } from '../components/ui.jsx';
import { BarList } from '../components/charts.jsx';

export default function Inventory() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState('products');
  const summary = useApi('/api/inventory/products/summary');
  const s = summary.data;
  return (
    <div>
      <PageHead title="Inventory" sub="Stock levels, purchases, suppliers and product sales" />
      {s && <div className="grid g4 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi icon={Boxes} label="Stock value (cost)" value={compact(s.value)} meta={`Retail value ${compact(s.retail_value)}`} />
        <Kpi icon={Package} tone="info" label="Products" value={s.products} meta={`${s.sold_today} sold today`} />
        <Kpi icon={PackageMinus} tone="warning" label="Low stock" value={s.low_stock} />
        <Kpi icon={PackageX} tone="danger" label="Out of stock" value={s.out_of_stock} />
      </div>}
      <Tabs value={tab} onChange={setTab} tabs={[['products', 'Products'], ['movements', 'Stock history'], ['suppliers', 'Suppliers'], ['top', 'Best sellers']]} />
      <div className="mt">{tab === 'products' ? <Products initialFilter={sp.get('filter') || ''} onChange={summary.reload} /> : tab === 'movements' ? <Movements /> : tab === 'suppliers' ? <Suppliers /> : <TopSellers data={s} />}</div>
    </div>
  );
}

function Products({ initialFilter, onChange }) {
  const { salon } = useAuth();
  const [f, setF] = useState({ q: '', filter: initialFilter, category: '', archived: '', page: 1 });
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/inventory/products', { ...f, q, pageSize: 50 });
  const [edit, setEdit] = useState(null);
  const [stock, setStock] = useState(null);
  const [hist, setHist] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const refresh = () => { reload(); onChange(); };
  const archive = async (p, restore) => { if (!restore && !(await confirm({ title: `Archive ${p.name}?`, text: 'It will be hidden from POS and stock lists. History is kept.' }))) return; try { await api.post(`/api/inventory/products/${p.id}/archive`, { restore }); toast.success(restore ? 'Restored' : 'Archived'); refresh(); } catch (e) { toast.error(e); } };
  const cols = [{ key: 'name', label: 'Product' }, { key: 'brand', label: 'Brand' }, { key: 'category', label: 'Category' }, { key: 'sku', label: 'SKU' }, { key: 'stock', label: 'Stock' }, { key: 'min_stock', label: 'Min' },
    { key: 'purchase_price', label: 'Cost', format: money, raw: (v) => v }, { key: 'selling_price', label: 'Price', format: money, raw: (v) => v }, { key: (r) => r.stock * r.purchase_price, label: 'Value', format: money, raw: (v) => v }, { key: 'supplier', label: 'Supplier' }, { key: 'expiry_date', label: 'Expiry' }, { key: 'branch_name', label: 'Branch' }];
  return (
    <Card pad={false}>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Name, brand, SKU, barcode" />
        <select className="input" style={{ width: 150 }} value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value, page: 1 })} aria-label="Stock filter"><option value="">All stock levels</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="expiring">Expiring ≤ 60 days</option></select>
        <select className="input" style={{ width: 150 }} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, page: 1 })} aria-label="Category"><option value="">All categories</option>{(data?.categories || []).map((c) => <option key={c}>{c}</option>)}</select>
        <label className="check small"><input type="checkbox" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked ? 1 : '', page: 1 })} />Archived</label>
        <div className="grow" />
        {data && <ExportMenu onCSV={() => exportCSV('inventory', cols, data.data)} onExcel={() => exportXLSX('inventory', [{ name: 'Stock', columns: cols, rows: data.data }])} onPDF={() => exportPDF('inventory', 'Stock valuation', today(), [{ columns: cols.filter((c) => !['sku', 'supplier', 'expiry_date'].includes(c.key)), rows: data.data }], salon?.name)} />}
        <Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Add product</Button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader rows={8} /> : !data.data.length ? <Empty icon={Package} title="No products found" action={<Button variant="primary" onClick={() => setEdit({})}>Add product</Button>} /> : (
        <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
          <thead><tr><th>Product</th><th>Category</th><th className="right">Stock</th><th className="right">Cost</th><th className="right">Price</th><th className="right">Value</th><th>Supplier</th><th>Expiry</th><th /></tr></thead>
          <tbody>{data.data.map((p) => (
            <tr key={p.id}>
              <td><b className="click" style={{ cursor: 'pointer' }} onClick={() => setHist(p)}>{p.name}</b><div className="faint tiny">{[p.brand, p.sku, p.branch_name].filter(Boolean).join(' · ')}</div></td>
              <td className="small">{p.category}</td>
              <td className="num"><Badge tone={p.stock <= 0 ? 'red' : p.stock <= p.min_stock ? 'amber' : 'green'}>{p.stock}</Badge><div className="faint tiny">min {p.min_stock}</div></td>
              <td className="num">{money(p.purchase_price)}</td><td className="num">{money(p.selling_price)}</td><td className="num">{money(p.stock * p.purchase_price)}</td>
              <td className="small">{p.supplier || '—'}</td><td className="small" style={{ color: p.expiry_date && p.expiry_date < today() ? 'var(--danger)' : undefined }}>{p.expiry_date ? fmtDate(p.expiry_date) : '—'}</td>
              <td className="nowrap right">
                {!p.is_archived && <><Button size="sm" icon={ShoppingCart} onClick={() => setStock({ p, type: 'purchase' })}>Purchase</Button><Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => setStock({ p, type: 'adjust' })} aria-label="Adjust stock" /><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(p)} aria-label="Edit" /><Button size="sm" variant="ghost" icon={Archive} onClick={() => archive(p)} aria-label="Archive" /></>}
                {p.is_archived ? <Button size="sm" onClick={() => archive(p, true)}>Restore</Button> : null}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
      {edit && <ProductForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {stock && <StockModal {...stock} onClose={() => setStock(null)} onSaved={() => { setStock(null); refresh(); }} />}
      {hist && <HistoryModal product={hist} onClose={() => setHist(null)} />}
    </Card>
  );
}

function ProductForm({ initial, onClose, onSaved }) {
  const { branches, branch } = useAuth();
  const sups = useApi('/api/inventory/suppliers');
  const toast = useToast();
  const [f, setF] = useState({ name: '', category: '', brand: '', sku: '', barcode: '', purchase_price: '', selling_price: '', stock: 0, min_stock: 5, supplier_id: '', purchase_date: today(), expiry_date: '', branch_id: branch !== 'all' ? branch : branches[0]?.id, ...initial });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = { name: f.name, category: f.category, brand: f.brand, sku: f.sku, barcode: f.barcode, purchase_price: Number(f.purchase_price) || 0, selling_price: Number(f.selling_price) || 0, min_stock: Number(f.min_stock) || 0, supplier_id: f.supplier_id ? Number(f.supplier_id) : null, purchase_date: f.purchase_date || null, expiry_date: f.expiry_date || null };
      if (initial.id) await api.put(`/api/inventory/products/${initial.id}`, body);
      else await api.post('/api/inventory/products', { ...body, stock: Number(f.stock) || 0, branch_id: Number(f.branch_id) });
      toast.success('Product saved'); onSaved();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit product' : 'Add product'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.name.length < 2} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Input label="Product name" value={f.name} onChange={set('name')} />
        <Input label="Brand" value={f.brand || ''} onChange={set('brand')} />
        <Input label="Category" value={f.category || ''} onChange={set('category')} placeholder="Hair Care, Skin Care, Salon Use…" />
        {!initial.id && <Select label="Branch" value={f.branch_id || ''} onChange={set('branch_id')} options={branches.map((b) => [b.id, b.name])} />}
        <Input label="SKU" value={f.sku || ''} onChange={set('sku')} />
        <Input label="Barcode" value={f.barcode || ''} onChange={set('barcode')} />
        <Input label="Purchase price (₹)" type="number" min="0" value={f.purchase_price} onChange={set('purchase_price')} />
        <Input label="Selling price (₹)" type="number" min="0" value={f.selling_price} onChange={set('selling_price')} hint="Set 0 for salon-use consumables" />
        {!initial.id && <Input label="Opening stock" type="number" min="0" value={f.stock} onChange={set('stock')} />}
        <Input label="Minimum stock level" type="number" min="0" value={f.min_stock} onChange={set('min_stock')} hint="Alert when stock falls to this level" />
        <Select label="Supplier" value={f.supplier_id || ''} onChange={set('supplier_id')} placeholder="None" options={(sups.data || []).map((s) => [s.id, s.name])} />
        <Input label="Purchase date" type="date" value={f.purchase_date || ''} onChange={set('purchase_date')} />
        <Input label="Expiry date (if applicable)" type="date" value={f.expiry_date || ''} onChange={set('expiry_date')} />
      </div>
    </Modal>
  );
}

function StockModal({ p, type: initialType, onClose, onSaved }) {
  const sups = useApi('/api/inventory/suppliers');
  const toast = useToast();
  const [f, setF] = useState({ type: initialType, qty: initialType === 'adjust' ? p.stock : '', reason: '', unit_cost: p.purchase_price, supplier_id: p.supplier_id || '', record_expense: true, payment_method: 'bank_transfer', date: today() });
  const save = async () => {
    try {
      const r = await api.post(`/api/inventory/products/${p.id}/stock`, { ...f, qty: Number(f.qty), unit_cost: Number(f.unit_cost), supplier_id: f.supplier_id ? Number(f.supplier_id) : null });
      toast.success(`Stock is now ${r.stock}`); onSaved();
    } catch (e) { toast.error(e); }
  };
  const T = [['purchase', 'Purchase', ShoppingCart], ['in', 'Stock in', ArrowDownToLine], ['out', 'Stock out', ArrowUpFromLine], ['adjust', 'Adjust (count)', SlidersHorizontal]];
  return (
    <Modal open onClose={onClose} title={p.name} size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.qty === '' || (f.type === 'adjust' && f.reason.length < 2)} onClick={save}>Save</Button></>}>
      <div className="col">
        <div className="chips">{T.map(([k, l, I]) => <button key={k} className={`chip ${f.type === k ? 'on' : ''}`} onClick={() => setF({ ...f, type: k, qty: k === 'adjust' ? p.stock : '' })}><I size={13} />{l}</button>)}</div>
        <p className="muted small">Current stock: <b>{p.stock}</b></p>
        <Input label={f.type === 'adjust' ? 'Counted quantity (new stock level)' : 'Quantity'} type="number" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        {f.type === 'purchase' && <>
          <div className="form-grid"><Input label="Unit cost (₹)" type="number" min="0" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} /><Input label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <Select label="Supplier" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} placeholder="None" options={(sups.data || []).map((s) => [s.id, s.name])} />
          <Switch label="Record as expense" hint={`${money((Number(f.qty) || 0) * (Number(f.unit_cost) || 0))} under Product purchases`} checked={f.record_expense} onChange={(v) => setF({ ...f, record_expense: v })} />
          {f.record_expense && <Select label="Paid via" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} options={PAY_METHODS} />}
        </>}
        <Input label={f.type === 'adjust' ? 'Reason (required)' : 'Note'} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={f.type === 'out' ? 'e.g. Used in salon, damaged' : f.type === 'adjust' ? 'e.g. Monthly stock count' : ''} />
      </div>
    </Modal>
  );
}

function HistoryModal({ product, onClose }) {
  const { data } = useApi(`/api/inventory/products/${product.id}`);
  return (
    <Modal open onClose={onClose} title={product.name} size="wide" footer={<Button onClick={onClose}>Close</Button>}>
      {!data ? <Loader /> : <>
        <div className="grid g3 kpis mb" style={{ marginBottom: 14 }}><Kpi label="In stock" value={data.stock} /><Kpi tone="success" label="Units sold (all time)" value={data.sales.qty} /><Kpi tone="accent" label="Sales revenue" value={money(data.sales.revenue)} /></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Type</th><th className="right">Qty</th><th className="right">Balance</th><th>Details</th><th>By</th></tr></thead><tbody>
          {data.movements.map((m) => <tr key={m.id}><td className="small nowrap">{fmtStamp(m.created_at)}</td><td><Badge tone={m.qty > 0 ? 'green' : 'red'}>{titleCase(m.type)}</Badge></td><td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td><td className="num">{m.balance_after}</td><td className="small muted">{[m.reason, m.invoice_no, m.supplier].filter(Boolean).join(' · ')}</td><td className="small">{m.user || '—'}</td></tr>)}
        </tbody></table></div>
      </>}
    </Modal>
  );
}

function Movements() {
  const [f, setF] = useState({ type: '', from: '', to: '', page: 1 });
  const { data, loading } = useApi('/api/inventory/movements', { ...f, pageSize: 30 });
  return (
    <Card pad={false} title={<h2 className="row" style={{ gap: 8 }}><History size={16} />Stock movements</h2>}>
      <div className="toolbar">
        <select className="input" style={{ width: 150 }} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, page: 1 })} aria-label="Type"><option value="">All types</option>{['sale', 'purchase', 'in', 'out', 'adjust', 'return', 'opening'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select>
        <input type="date" className="input" style={{ width: 150 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} aria-label="From" /><input type="date" className="input" style={{ width: 150 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} aria-label="To" />
      </div>
      {!data ? <Loader /> : !data.data.length ? <Empty title="No stock movements" /> : (
        <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table"><thead><tr><th>When</th><th>Product</th><th>Type</th><th className="right">Qty</th><th className="right">Balance</th><th>Details</th><th>By</th></tr></thead><tbody>
          {data.data.map((m) => <tr key={m.id}><td className="small nowrap">{fmtStamp(m.created_at)}</td><td>{m.product}</td><td><Badge tone={m.qty > 0 ? 'green' : 'red'}>{titleCase(m.type)}</Badge></td><td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td><td className="num">{m.balance_after}</td><td className="small muted">{[m.reason, m.invoice_no, m.supplier].filter(Boolean).join(' · ')}</td><td className="small">{m.user || '—'}</td></tr>)}
        </tbody></table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
    </Card>
  );
}

function Suppliers() {
  const { data, reload } = useApi('/api/inventory/suppliers');
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const save = async () => { try { const { id, products, purchased, created_at, updated_at, ...b } = edit; if (id) await api.put(`/api/inventory/suppliers/${id}`, b); else await api.post('/api/inventory/suppliers', b); toast.success('Supplier saved'); setEdit(null); reload(); } catch (e) { toast.error(e); } };
  return (
    <Card pad={false} title={<h2 className="row" style={{ gap: 8 }}><Truck size={16} />Suppliers</h2>} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEdit({ name: '' })}>Add supplier</Button>}>
      <div style={{ height: 10 }} />
      {!data ? <Loader /> : !data.length ? <Empty icon={Truck} title="No suppliers yet" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>GSTIN</th><th className="right">Products</th><th className="right">Purchased</th><th /></tr></thead><tbody>
          {data.map((s) => <tr key={s.id}><td><b>{s.name}</b><div className="faint tiny">{s.address}</div></td><td>{s.contact_person}</td><td>{s.phone}<div className="faint tiny">{s.email}</div></td><td className="small">{s.gstin || '—'}</td><td className="num">{s.products}</td><td className="num">{money(s.purchased)}</td><td><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...s, is_active: !!s.is_active })} aria-label="Edit" /></td></tr>)}
        </tbody></table></div>
      )}
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit supplier' : 'Add supplier'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={(edit.name || '').length < 2} onClick={save}>Save</Button></>}>
        <div className="form-grid">{[['name', 'Company name'], ['contact_person', 'Contact person'], ['phone', 'Phone'], ['email', 'Email'], ['gstin', 'GSTIN'], ['address', 'Address']].map(([k, l]) => <Input key={k} label={l} value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />)}</div>
      </Modal>}
    </Card>
  );
}

function TopSellers({ data }) {
  if (!data) return <Loader />;
  return (
    <Card title="Best-selling products this month">
      {data.top_selling.length ? <BarList items={data.top_selling} valueKey="qty" fmt={(v, it) => `${v} sold · ${money(it.revenue)}`} /> : <Empty icon={Package} title="No product sales this month yet" />}
    </Card>
  );
}
