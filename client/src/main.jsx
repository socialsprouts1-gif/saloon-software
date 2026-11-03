import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AuthProvider, ToastProvider, useAuth, applyTheme } from './context.jsx';
import { ConfirmProvider, Empty, Loader } from './components/ui.jsx';
import { store } from './lib/api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import { ShieldOff } from 'lucide-react';

applyTheme(store.get('salon.theme') || 'system');

const P = (f) => lazy(f);
const Dashboard = P(() => import('./pages/Dashboard.jsx'));
const Appointments = P(() => import('./pages/Appointments.jsx'));
const Booking = P(() => import('./pages/Booking.jsx'));
const PublicBooking = P(() => import('./pages/PublicBooking.jsx'));
const POS = P(() => import('./pages/POS.jsx'));
const Invoices = P(() => import('./pages/Invoices.jsx'));
const InvoiceView = P(() => import('./pages/InvoiceView.jsx'));
const Customers = P(() => import('./pages/Customers.jsx'));
const CustomerDetail = P(() => import('./pages/CustomerDetail.jsx'));
const Services = P(() => import('./pages/Services.jsx'));
const Packages = P(() => import('./pages/Packages.jsx'));
const Coupons = P(() => import('./pages/Coupons.jsx'));
const Employees = P(() => import('./pages/Employees.jsx'));
const EmployeeDetail = P(() => import('./pages/EmployeeDetail.jsx'));
const Attendance = P(() => import('./pages/Attendance.jsx'));
const Payroll = P(() => import('./pages/Payroll.jsx'));
const Inventory = P(() => import('./pages/Inventory.jsx'));
const Expenses = P(() => import('./pages/Expenses.jsx'));
const Reports = P(() => import('./pages/Reports.jsx'));
const Notifications = P(() => import('./pages/Notifications.jsx'));
const Branches = P(() => import('./pages/Branches.jsx'));
const Settings = P(() => import('./pages/Settings.jsx'));
const Assistant = P(() => import('./pages/Assistant.jsx'));

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && ![].concat(perm).some(can)) return <Empty icon={ShieldOff} title="You don't have access to this page" text="Ask the salon owner to update your role permissions." />;
  return children;
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

const page = (el, perm) => <Guard perm={perm}><Suspense fallback={<div className="card"><Loader /></div>}>{el}</Suspense></Guard>;

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/book/:token" element={<Suspense fallback={null}><PublicBooking /></Suspense>} />
      <Route path="/i/:token" element={<Suspense fallback={null}><InvoiceView publicView /></Suspense>} />
      <Route element={<Protected />}>
        <Route index element={page(<Dashboard />, 'dashboard')} />
        <Route path="appointments" element={page(<Appointments />, 'appointments')} />
        <Route path="booking" element={page(<Booking />, 'booking')} />
        <Route path="pos" element={page(<POS />, 'billing')} />
        <Route path="invoices" element={page(<Invoices />, 'billing')} />
        <Route path="invoices/:id" element={page(<InvoiceView />, 'billing')} />
        <Route path="customers" element={page(<Customers />, ['customers', 'billing', 'appointments'])} />
        <Route path="customers/:id" element={page(<CustomerDetail />, ['customers', 'billing', 'appointments'])} />
        <Route path="services" element={page(<Services />, 'services')} />
        <Route path="packages" element={page(<Packages />, 'packages')} />
        <Route path="coupons" element={page(<Coupons />, 'coupons')} />
        <Route path="employees" element={page(<Employees />, 'employees')} />
        <Route path="employees/:id" element={page(<EmployeeDetail />, ['employees', 'payroll'])} />
        <Route path="attendance" element={page(<Attendance />, 'attendance')} />
        <Route path="payroll" element={page(<Payroll />, 'payroll')} />
        <Route path="inventory" element={page(<Inventory />, 'inventory')} />
        <Route path="expenses" element={page(<Expenses />, 'expenses')} />
        <Route path="reports" element={page(<Reports />, 'reports')} />
        <Route path="notifications" element={page(<Notifications />, 'notifications')} />
        <Route path="branches" element={page(<Branches />, 'branches')} />
        <Route path="settings" element={page(<Settings />, 'settings')} />
        <Route path="assistant" element={page(<Assistant />, 'ai')} />
        <Route path="*" element={<Empty title="Page not found" />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider><AuthProvider><ConfirmProvider><App /></ConfirmProvider></AuthProvider></ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
