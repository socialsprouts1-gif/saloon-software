import './tz.js';

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { DEMO_MODE, pget, prun, nowStamp, runInTenant } from './db.js';
import { listTenants, migrateLegacySalon } from './platform.js';
import { hashPassword } from './lib/auth.js';
import { startJobs, runJobsIfDue } from './lib/jobs.js';
import platformRoutes from './routes/platform.js';
import loyaltyRoutes from './routes/loyalty.js';
import { createSalon } from './routes/auth.js';
import { tenantFromSlug, tenantFromLegacyLink } from './routes/public.js';

// ---- first start ------------------------------------------------------------------------------
// Upgrade an existing single-salon install: its data becomes the first salon on the platform.
await migrateLegacySalon();
// Demo mode: build the sample salon and a demo platform admin the first time this server starts.
export const DEMO_PLATFORM_ADMIN = { email: 'admin@salonstudio.demo', password: 'Admin@1234' };
if (DEMO_MODE && !listTenants().length) {
  await createSalon({ salonName: 'Lumière Salon & Spa', slug: 'lumiere', ownerName: 'Salon Owner', email: 'owner@demo.salon', password: 'Owner@1234', city: 'Bengaluru', demo: true }, { plan: 'pro' });
  if (!pget('SELECT id FROM platform_admins LIMIT 1')) {
    prun('INSERT INTO platform_admins (name,email,password_hash,created_at) VALUES (?,?,?,?)', 'Platform Admin', DEMO_PLATFORM_ADMIN.email, hashPassword(DEMO_PLATFORM_ADMIN.password), nowStamp());
  }
}

/** Run reminder jobs for every active salon. */
export const runJobsForAllSalons = () => listTenants().filter((t) => t.status === 'active').map((t) => runInTenant(t, () => runJobsIfDue()));
import authRoutes from './routes/auth.js';
import coreRoutes, { PUBLIC_DIR } from './routes/core.js';
import appointmentRoutes, { bookingRouter } from './routes/appointments.js';
import publicRoutes from './routes/public.js';
import customerRoutes from './routes/customers.js';
import catalogRoutes from './routes/catalog.js';
import staffRoutes from './routes/staff.js';
import inventoryRoutes from './routes/inventory.js';
import billingRoutes from './routes/billing.js';
import financeRoutes from './routes/finance.js';
import aiRoutes from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
// Daily Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET" when that variable is set.
app.get('/api/cron', (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ran: runJobsForAllSalons().filter(Boolean).length });
});
app.use('/api/auth', authRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/public/s/:slug', tenantFromSlug, publicRoutes);
app.use('/api/public', tenantFromLegacyLink, publicRoutes);
app.use('/uploads', express.static(PUBLIC_DIR, { maxAge: '7d', fallthrough: false }));

// Everything below requires a signed-in user
app.use('/api', authenticate);
app.use('/api', coreRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/booking', bookingRouter);
app.use('/api/customers', customerRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/invoices', billingRoutes);
app.use('/api', financeRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// Serve the built React app (SPA fallback)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  const msg = status >= 500 ? 'Something went wrong. Please try again.' : err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB)' : err.message;
  res.status(status).json({ error: msg, details: err.details });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`Salon ERP running on http://localhost:${port}`));
  startJobs(runJobsForAllSalons);
}
