process.env.TZ ||= 'Asia/Kolkata'; // salon-local time for all date maths

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { startJobs } from './lib/jobs.js';
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
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
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
  startJobs();
}
