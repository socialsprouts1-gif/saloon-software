import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, QrCode, Receipt, Users, Scissors, Gift, TicketPercent, UserCog, Clock, Wallet, Package, CreditCard,
  BarChart3, Bell, Building2, Settings, Sparkles, Menu, Sun, Moon, Monitor, LogOut, KeyRound, ShoppingBag, FileText,
} from 'lucide-react';
import { useAuth, useTheme, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { relTime } from '../lib/format.js';
import { Avatar, Button, Dropdown, Modal, Input } from './ui.jsx';
import AIPanel from './AIPanel.jsx';

const NAV = [
  ['Overview', [['/', 'Dashboard', LayoutDashboard, 'dashboard']]],
  ['Front desk', [
    ['/appointments', 'Appointments', CalendarDays, 'appointments'], ['/pos', 'Billing / POS', ShoppingBag, 'billing'], ['/invoices', 'Invoices', FileText, 'billing'],
    ['/customers', 'Customers', Users, 'customers'], ['/booking', 'QR Booking', QrCode, 'booking'],
  ]],
  ['Catalogue', [['/services', 'Services', Scissors, 'services'], ['/packages', 'Packages', Gift, 'packages'], ['/coupons', 'Coupons', TicketPercent, 'coupons'], ['/inventory', 'Inventory', Package, 'inventory']]],
  ['Team', [['/employees', 'Employees', UserCog, 'employees'], ['/attendance', 'Attendance', Clock, 'attendance'], ['/payroll', 'Payroll', Wallet, 'payroll']]],
  ['Finance', [['/expenses', 'Expenses', CreditCard, 'expenses'], ['/reports', 'Reports', BarChart3, 'reports']]],
  ['Admin', [['/assistant', 'AI Assistant', Sparkles, 'ai'], ['/notifications', 'Notifications', Bell, 'notifications'], ['/branches', 'Branches', Building2, 'branches'], ['/settings', 'Settings', Settings, 'settings']]],
];

export default function Layout() {
  const { user, salon, branches, branch, switchBranch, can, logout, branchName } = useAuth();
  const [theme, setTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">{salon?.logo ? <img src={salon.logo} alt="" /> : (salon?.name || 'S')[0]}</div>
          <div><div className="brand-name">{salon?.name}</div><div className="brand-sub">Salon Studio ERP</div></div>
        </div>
        <nav className="nav">
          {NAV.map(([group, items]) => {
            const visible = items.filter(([, , , perm]) => can(perm));
            if (!visible.length) return null;
            return (
              <div key={group}>
                <div className="nav-group">{group}</div>
                {visible.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'}><Icon />{label}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">Signed in as <b style={{ color: '#fff' }}>{user.name}</b><br />{user.role[0].toUpperCase() + user.role.slice(1)}</div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar no-print">
          <Button variant="ghost" icon={Menu} className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu" />
          {!user.branch_id && branches.length > 1 ? (
            <div className="row" style={{ gap: 6 }}>
              <Building2 size={16} className="faint" />
              <select className="input sm" style={{ width: 'auto', minWidth: 150 }} value={branch} onChange={(e) => switchBranch(e.target.value)} aria-label="Branch">
                <option value="all">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          ) : <span className="badge plain plum hide-sm"><Building2 size={12} /> {branchName}</span>}
          <div className="grow" />
          {can('billing') && <Button variant="primary" size="sm" icon={Receipt} onClick={() => navigate('/pos')} className="hide-sm">New bill</Button>}
          <Dropdown trigger={({ toggle }) => <Button variant="ghost" icon={ThemeIcon} onClick={toggle} aria-label="Theme" />}>
            {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]].map(([k, l, I]) => <button key={k} className="item" onClick={() => setTheme(k)}><I size={15} />{l}{theme === k && ' ✓'}</button>)}
          </Dropdown>
          <NotificationBell />
          <Dropdown trigger={({ toggle }) => <button className="btn ghost" onClick={toggle} style={{ paddingLeft: 4 }}><Avatar name={user.name} size="sm" /><span className="hide-sm">{user.name.split(' ')[0]}</span></button>}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}><b>{user.name}</b><div className="faint small">{user.email}</div></div>
            <button className="item" onClick={() => setPwOpen(true)}><KeyRound size={15} />Change password</button>
            <button className="item" onClick={logout}><LogOut size={15} />Sign out</button>
          </Dropdown>
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {can('ai') && <>
        {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
        <button className="ai-fab no-print" onClick={() => setAiOpen((o) => !o)} aria-label="Open AI assistant" title="AI assistant"><Sparkles /></button>
      </>}
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function NotificationBell() {
  const [data, setData] = useState({ data: [], unread: 0 });
  const nav = useNavigate();
  const { version } = useAuth();
  const load = () => api.get('/api/notifications', { pageSize: 8 }).then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [version]);
  return (
    <Dropdown trigger={({ toggle }) => (
      <button className="btn ghost icon" onClick={() => { toggle(); load(); }} aria-label={`Notifications (${data.unread} unread)`} style={{ position: 'relative' }}>
        <Bell />{data.unread > 0 && <span style={{ position: 'absolute', top: 3, right: 3, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, minWidth: 16, height: 16, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
    )}>
      <div style={{ width: 340, maxWidth: '86vw' }}>
        <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <b>Notifications</b>
          <button className="btn ghost sm" onClick={async () => { await api.post('/api/notifications/read'); load(); }}>Mark all read</button>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {data.data.length ? data.data.map((n) => (
            <button key={n.id} className="item" style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', background: n.is_read ? undefined : 'var(--primary-soft)' }}
              onClick={async () => { await api.post('/api/notifications/read', { ids: [n.id] }); if (n.link) nav(n.link); }}>
              <div className="grow"><div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>{n.message && <div className="faint small">{n.message}</div>}<div className="faint tiny">{relTime(n.created_at)}</div></div>
            </button>
          )) : <div className="empty small">You're all caught up</div>}
        </div>
        <button className="item" style={{ justifyContent: 'center', fontWeight: 600, color: 'var(--primary)' }} onClick={() => nav('/notifications')}>View all</button>
      </div>
    </Dropdown>
  );
}

function ChangePassword({ open, onClose }) {
  const [f, setF] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try { await api.post('/api/auth/change-password', f); toast.success('Password updated'); onClose(); setF({ current: '', next: '' }); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change password" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.next.length < 8} onClick={submit}>Update</Button></>}>
      <div className="col"><Input type="password" label="Current password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /><Input type="password" label="New password" hint="At least 8 characters" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></div>
    </Modal>
  );
}
