# Bliss Legacy Limited — Local Demonstration Guide

**Purpose:** guide a management demonstration using the real local application and real seeded accounts.

**Local application URL:** `http://localhost:8787`

**Live staging URL:** `https://bliss-property.easterntechexpo.workers.dev`

**Staging accounts:** `staging.md@blisslegacy.test`, `staging.bm@blisslegacy.test`, `staging.tl@blisslegacy.test`, `staging.marketer@blisslegacy.test`, `staging.finance@blisslegacy.test`, `staging.client@blisslegacy.test`. The staging password is supplied in the secure handover/final response only.

**Local demo passwords:** deliberately **not stored in this repository**. The temporary local password is provided in the secure handover/final response. Do not commit it.

**Local data:** only the local D1 database under `.wrangler/state/`. No production client data is used.

---

## 1. Roles that actually exist

| Role | Exists? | Local login URL | Dashboard URL |
|---|---|---|---|
| Super Admin | **NO** | — | — |
| Managing Director | Yes | `http://localhost:8787/login.html` | `http://localhost:8787/dashboard.html` |
| Branch Manager | Yes | `http://localhost:8787/login.html` | `http://localhost:8787/dashboard.html` |
| Team Lead | Yes | `http://localhost:8787/login.html` | `http://localhost:8787/dashboard.html` |
| Marketer | Yes | `http://localhost:8787/login.html` | `http://localhost:8787/dashboard.html` |
| Finance Officer | Yes | `http://localhost:8787/login.html` | `http://localhost:8787/dashboard.html` |
| Client | Yes | `http://localhost:8787/client-login.html` | `http://localhost:8787/client-dashboard.html` |

All roles can also use the unified login at `login.html`. The client portal has a dedicated login page.

**Super Admin:** there is no separate role, dashboard or permission console. The Managing Director is the highest implemented role. Do not present MD as Super Admin.

---

## 2. Local demonstration accounts

| Role | Email | Branch / team |
|---|---|---|
| Managing Director | `md@bliss.com` | Company-wide |
| Branch Manager | `bm.ikeja@bliss.com` | Ikeja |
| Branch Manager (second branch) | `bm.ajah@bliss.com` | Ajah |
| Team Lead | `tl.ikeja@bliss.com` | Ikeja Team Alpha |
| Team Lead (second branch) | `tl.ajah@bliss.com` | Ajah Team |
| Marketer | `mkt.ikeja@bliss.com` | Ikeja Team Alpha |
| Marketer | `mkt.ikeja2@bliss.com` | Ikeja Team Alpha |
| Marketer (second branch) | `mkt.ajah@bliss.com` | Ajah Team |
| Finance Officer | `finance@bliss.com` | Company-wide finance |
| Client | `ada@example.com` | Ikeja |
| Client | `musa@example.com` | Ikeja |
| Demo client | `demo@bliss.com` | Demo-only records |

**Password:** supplied separately in the secure handover. It is a local-only temporary password. It is not in this file, source code or Git.

### Reset the local demo password

If the local password is lost:

```bash
cd "/Users/a/bliss estate project "
python3 seed_phase5.py
python3 seed_phase6.py
```

This resets local seeded demo data to the documented development password. Do not use the seed scripts against production.

---

## 3. Recommended demonstration sequence

### Step 1 — Public website (no login)

Open `http://localhost:8787/`.

Show:

- Official Bliss Legacy branding.
- Ten property listings, including land and sample labels.
- Property search/filter.
- Property detail page.
- Public enquiry form (creates a real New Lead).
- Client sign-up link.

### Step 2 — Managing Director

Log in as `md@bliss.com`.

Show:

- Company-wide dashboard and KPIs.
- Contract value vs verified collections vs outstanding balance.
- Branch comparison.
- Marketer rankings and team rankings.
- Lead pipeline and follow-ups.
- Recent clients/properties/activity.
- Staff & Teams.
- Property management and private documents.
- Commissions and financial reports.
- Audit activity.

### Step 3 — Branch Manager

Log in as `bm.ikeja@bliss.com`.

Show:

- Branch-only dashboard.
- Branch clients, properties, leads, teams and marketers.
- Branch rankings.
- Branch reports.
- Staff creation for Team Lead/Marketer/Finance within Ikeja.
- Attempt to open an Ajah client/property (should fail).

### Step 4 — Team Lead

Log in as `tl.ikeja@bliss.com`.

Show:

- Team clients/properties.
- Team leads, conversions and follow-ups.
- Team commission.
- Team-scoped reports.
- No Staff & Teams module.
- Cannot access Finance.

### Step 5 — Marketer

Log in as `mkt.ikeja@bliss.com`.

Show:

- Personal clients and assigned properties.
- Personal leads and follow-ups.
- Personal conversion performance.
- Personal commission.
- Personal commission report only.
- Cannot access another marketer’s client.
- Cannot access company finance.

### Step 6 — Finance Officer

Log in as `finance@bliss.com`.

Show:

- Company finance overview.
- Transaction ledger.
- Manual payment verification.
- Refund/reversal.
- Installment schedules.
- Provider configuration.
- Commission approvals/payments.
- Financial reports.
- No staff or lead management.

### Step 7 — Client

Log in as `ada@example.com` at `client-login.html`.

Show:

- Own property/properties.
- Contract price, amount paid, remaining balance and progress.
- Payment history.
- Receipts and receipt PDF.
- Installment schedule.
- Notifications.
- Profile editing.
- Cannot open another client record.
- Cannot access staff/finance APIs.

---

## 4. Example workflows to demonstrate

### A. Public enquiry to lead

1. Open the homepage contact form.
2. Submit a fictional enquiry.
3. Log in as MD/BM and open Lead Pipeline.
4. Show the new lead in `New Lead` with no self-assigned marketer.

### B. Staff creation

1. MD opens **Staff & Teams**.
2. Creates a fictional Team Lead in Ikeja.
3. Show the account is active immediately and appears in the staff list.
4. Deactivate and reactivate the account.

There is no invitation or approval step yet.

### C. Property image and private document

1. Open a property detail as MD/BM.
2. Upload an image.
3. Upload a private PDF document.
4. Download it as authorized staff.
5. Show public `/api/files/...` cannot retrieve the document.
6. Show a cross-branch manager cannot download it.

### D. Client payment and receipt

1. Finance records a pending payment.
2. Finance verifies it.
3. Client logs in and sees the payment, balance and receipt.
4. Show pending payments do not count until verified.

### E. Commission

1. MD/Finance opens a commission plan.
2. Generate an entry for a client.
3. Submit/approve.
4. Record a partial payment.
5. Show the outstanding liability reconciles.
6. Show duplicate generation/payment is blocked.

### F. Reassignment isolation

1. MD reassigns a client from Marketer A to Marketer B.
2. Marketer A can no longer open the client or property data.
3. Marketer B can.
4. Previous cross-branch Branch Manager loses access.

---

## 5. Features that are incomplete or missing

- Super Admin role and system console.
- Staff invitation/approval workflow.
- Configurable permission matrix.
- Email verification and CAPTCHA.
- Password-reset email delivery.
- Staff notification inbox.
- Staff-to-staff chat / MD-to-staff chat.
- Team-performance report export.
- Customer-performance ranking.
- Client transaction-statement PDF.
- Client outstanding-balance PDF.
- Live ALAT/Wema virtual account and payouts.
- Email/WhatsApp delivery adapters.
- Custom production domain.

---

## 6. Known demonstration cautions

- Do not present the MD as a Super Admin.
- Do not imply staff accounts require approval; they do not.
- Do not imply clients are manually approved; they are active Prospects immediately.
- Do not imply chat or staff notifications exist.
- Do not imply customer statements can be downloaded; only individual receipts are downloadable.
- The live demo deployment is separate from local; use local URLs for this guide.
- Local seeded records are fictional and must not be treated as real business data.

---

## 7. Install as an app (PWA)

The staging site is installable on iPhone, iPad and Android.

- **iPhone/iPad:** open the site in Safari → Share → **Add to Home Screen** → Add.
- **Android:** open in Chrome → browser menu → **Install app** / **Add to Home screen**.
- The site also shows an **Install app** / **Add to Home Screen** button when the browser supports installation.
- Installed mode opens without browser chrome and caches the app shell for the branded offline fallback.
- Live API data, receipts, reports and financial records are **not** cached.
- Offline fallback: `https://bliss-property.easterntechexpo.workers.dev/offline`

PWA files:

- `manifest.json`
- `sw.js`
- `assets/js/pwa.js`
- `assets/css/pwa` styles are injected by `pwa.js`
- `assets/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`
- `offline.html`

---

## 8. If a demo account fails to log in

1. Confirm `npm run dev` is running at `http://localhost:8787`.
2. Confirm the local password from the secure handover.
3. Re-run the local seed scripts to reset demo accounts.
4. Confirm the account is active in local D1.
5. Do not weaken authorization to force a login.

---

## 8. Current evidence

- All six implemented roles logged in successfully against local D1.
- Each role loaded its real dashboard at desktop and mobile widths with no document-level horizontal overflow.
- API restrictions were checked directly:
  - Marketer: `/api/staff` 403, `/api/finance/overview` 403.
  - Team Lead: `/api/staff` 403, `/api/finance/overview` 403.
  - Finance: `/api/staff` 403, `/api/leads` 403.
  - Client: all staff/finance endpoints 403; own dashboard 200.
  - Branch Manager: own-branch access 200; cross-branch checks remain enforced.
- Full suite: **134 passed, 0 failed, 0 skipped**.
