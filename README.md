# Salon Studio ERP

A complete salon management system: appointments, QR online booking, POS billing, staff, attendance, payroll, inventory, expenses, CRM, memberships, coupons, multi-branch analytics and an AI assistant — all on one database, so every action updates every related number.

## Quick start

Requires **Node.js 20+**. Locally the data lives in a single SQLite file; on Vercel it lives in a hosted Turso database.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:4000. On first launch you create the salon and owner account; tick **Load realistic demo data** to explore with ~6 months of sample activity.

To reset to demo data at any time (wipes the database):

```bash
npm run seed
```

**No login needed for local testing:** when you open the app on the same computer that runs it, you're signed in as the owner automatically. Visitors from other machines still see the login page. Sign out to try other roles; set `AUTO_LOGIN=0` to turn this off.

Demo logins (password `Demo@1234` for staff, `Owner@1234` for the owner created by `npm run seed`):

| Role | Email |
| --- | --- |
| Owner | owner@demo.salon |
| Manager | manager@demo.salon |
| Receptionist (Indiranagar only) | reception@demo.salon |
| Accountant | accounts@demo.salon |
| Stylist (self-service) | stylist@demo.salon |

### Development

Run the API and the Vite dev server (with hot reload) in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

The client runs on http://localhost:5173 and proxies `/api` to port 4000.

### Tests

```bash
npm test
```

End-to-end workflow tests run against a throwaway database: double-booking prevention, QR booking, POS → stock/revenue/commission/coupons/loyalty, invoice voiding, package credits, audited attendance corrections, the payroll example (₹15,000 + ₹2,000 + ₹500 − ₹500 = ₹17,000), salary → expense → profit, role isolation and the AI assistant.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `DATA_DIR` | `./data` | Database, uploads and signing secret |
| `SALON_TZ` | `Asia/Kolkata` | Salon time zone for all date maths |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | — | Hosted database (required on Vercel) |
| `BLOB_READ_WRITE_TOKEN` | — | Vercel Blob store for logos, photos and receipts (added automatically when you connect a Blob store) |
| `CRON_SECRET` | — | Optional; protects the daily `/api/cron` reminder job |
| `JWT_SECRET` | auto-generated and stored in the database | Session signing key |
| `AUTO_LOGIN` | on for this computer only | `0` disables automatic owner sign-in; `1` allows it from any machine (testing only) |
| `ANTHROPIC_API_KEY` | — | Optional; enables Claude for the AI assistant (can also be set in Settings) |

**Backups:** everything lives in `data/` — copy `data/salon.db` (SQLite, WAL mode) and `data/uploads/`. Owners can also download a full JSON export from **Settings → Data & backup**.

## Architecture

```
server/            Express 5 API + SQLite (node:sqlite)
  db.js            Schema, migrations, settings
  lib/             Business logic shared by every route
    scheduling.js  Slot engine & double-booking guard
    billing.js     Pricing, coupons, GST, loyalty, commissions, stock deduction, voids
    hr.js          Attendance maths & payroll calculation
    analytics.js   Every dashboard/report figure, computed from records
    ai.js          AI tools (Claude tool use) + built-in answer engine + insights
    jobs.js        Recurring expenses & reminder notifications (every 5 min)
  routes/          REST endpoints, zod-validated, permission-checked, audit-logged
  seed.js          Demo data generator (uses the same business logic)
  test/            End-to-end workflow tests
client/            React 18 + Vite SPA (Recharts, jsPDF, SheetJS, qrcode)
```

How modules connect:

- **QR booking** → appointment saved through the same slot engine as the front desk → appears in the calendar, raises a notification, counts toward booking analytics.
- **Completing a bill** → revenue, customer lifetime value & loyalty points, appointment marked completed, stock deducted with a movement record, commissions stored per line item, coupon usage counted.
- **Attendance** (check-in/out or audited corrections) → working, late, early, overtime and half-day figures → payroll.
- **Payroll paid / salary advance / stock purchase** → expense records → profit reports.
- **Voiding an invoice** reverses stock, coupon usage, package credits and loyalty points.

### Security

- scrypt password hashing, HMAC-signed session tokens, login throttling
- Role-based permissions per module (customisable by the owner); a separate **finance** permission hides money figures from roles without it
- Branch isolation: users pinned to a branch only ever see that branch
- Server-side validation (zod) on every write; parameterised SQL throughout
- Uploads restricted by type and size; receipts are served only to authorised users
- Audit log for every create/update/delete, login, payment, void and export

## AI assistant

Without an API key, a built-in engine answers the common questions (revenue, top employee, expenses, popular services, restocking, visits, inactive customers, profit estimate) directly from the database. With an Anthropic API key, Claude answers free-form questions by calling the same read-only reporting functions — it cannot change data and is instructed to use only the figures those functions return.

## WhatsApp

By default the app creates ready-to-send WhatsApp click-to-chat links (invoice sharing, confirmations). Add a WhatsApp Cloud API phone number ID and token in **Settings → WhatsApp** to send booking confirmations automatically.

## Deploying to Vercel

The whole app (screens + API) deploys as one Vercel project. `vercel.json` builds the client, serves the API from `api/index.js`, and schedules a daily reminder job.

1. **Database (Turso, free tier):** create a database at turso.tech, choosing the region closest to your Vercel functions (e.g. Mumbai for `bom1`). Copy its URL (`libsql://…`) and create an auth token.
2. **Vercel project:** import this repo with **Root Directory left empty** (the repository root, not `client`). Framework preset: Other.
3. **Environment variables** (Settings → Environment Variables): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and a long random `JWT_SECRET`. Optionally `ANTHROPIC_API_KEY` and `CRON_SECRET`.
4. **File uploads:** Storage → Create → Blob → connect it to the project (adds `BLOB_READ_WRITE_TOKEN`).
5. **Deploy**, open the site and complete “Set up your salon”. Ticking demo data loads ~90 days of sample activity.

Notes:
- Reminders (upcoming appointments, low stock, birthdays, recurring expenses) run whenever staff use the app (at most every 5 minutes) plus once a day via Vercel Cron.
- Uploads are limited to 4 MB on Vercel.
- Automatic owner sign-in never applies on Vercel; staff log in normally.
- To load demo data into an existing hosted database from your computer: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run seed` (this wipes it first).

The app also runs on any Node host with a persistent disk (no Turso needed): `npm install && npm run build && npm start`, with `DATA_DIR` pointing at the disk.
