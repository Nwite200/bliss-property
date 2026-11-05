# Bliss Legacy Limited — Phase 7 Local Walkthrough

Phase 7 adds commission plans, commission calculation and attribution, approval/payment workflow, commission payment receipts, financial reports and management analytics.

No company commission percentages or rates are hard-coded. All rates in this walkthrough are **local test values only** and must not be treated as an approved company policy.

## 1. Local setup

```bash
cd "/Users/a/bliss estate project "
npm install
npm run db:migrate:local
SEED_ENV=local python3 seed_phase5.py
SEED_ENV=local python3 seed_phase6.py
npm run dev
```

Open `http://localhost:8787/login.html`.

Each seed run generates a strong random password per account and prints it to
the terminal once. Store it securely; only the hash is stored. Seeds refuse to
run unless `SEED_ENV` is `local` or `staging` and the database ID matches.

### Client sign-up and branding

- Open `signup.html` or click **Create an account** from either login screen.
- Complete full name, email, phone, optional property and password.
- Successful sign-up creates a Client user, a Prospect client record in Head Office, an auto-login session and redirects to the client dashboard.
- Clients cannot choose or change their branch, marketer or team. Authorised staff assign these after registration.
- Public sign-up never sets a contract price and does not assign a marketer commission.
- The official `assets/images/bliss-legacy-logo.png` is used across all pages and portal login screens.
- `assets/images/bliss-legacy-logo.jpg` is used in receipt, commission payment and PDF report generation.

### Property portfolio visibility

- The landing page shows the official logo and up to ten listings, blending live D1 properties with the curated demonstration catalogue, including land opportunities. Demonstration cards carry a **Sample** label.
- A client can hold multiple property allocations through `client_properties`. The client dashboard lists every allocation with agreed price, verified payments, remaining balance and a per-property progress bar, plus portfolio totals.
- Current marketers, managers and Branch Managers see the same property and payment progress on the staff client detail page.
- When a client is reassigned, the previous marketer and any previous cross-branch Branch Manager lose access to the client, property and payment data. The current relationship manager and current branch retain access.

## 2. Create a commission plan

Sign in as `md@bliss.com` or `finance@bliss.com`.

1. Open `commissions.html`.
2. Select **Commission plans**.
3. Click **+ New commission plan**.
4. Enter a plan name.
5. Select a calculation basis:
   - **Contract value** — percentage of the agreed contract price.
   - **Verified collections** — percentage of each verified successful NGN payment.
   - **Fixed amount** — one fixed amount per qualifying client.
6. Set effective dates, approval requirement and separation-of-duties.
7. Add one or more eligibility rules:
   - Eligible role: Marketer, Team Lead or Branch Manager.
   - Percentage or fixed amount.
   - Optional property category.
   - Optional sales type.
   - Optional branch or team.
8. Save the plan.

Use controlled test values only. Example for local testing: 5% Marketer rule on contract value, or 2% Marketer rule on verified collections.

## 3. Calculate commissions

Still as MD or Finance:

1. Click **Generate commissions**.
2. Select a plan and optionally a client.
3. Choose a date range and optionally generate as Draft.
4. Generate.

The engine:

- Uses integer kobo and basis-point rounding.
- Uses contract value only for contract-value plans.
- Uses only `verified`, `is_demo=0`, NGN payments for collection plans.
- Excludes pending, failed and DEMO transactions.
- Creates one contract/fixed entry per plan/client/rule.
- Creates one collection entry per plan/payment/rule.
- Prevents duplicate entries through a unique source key.
- Snapshots marketer, team lead, branch and team at creation time.
- Does not move an existing commission when a client is reassigned.

## 4. Review and approval workflow

1. Open a commission entry.
2. Submit it for approval if required.
3. The status moves through:
   - Draft
   - Calculated
   - Pending Approval
   - Approved
   - Partially Paid
   - Paid
   - Rejected
   - Reversed
   - Cancelled
4. Approve or reject as MD/Finance.
5. A recipient cannot approve their own commission when separation of duties is enabled.

## 5. Record commission payments

1. Open an approved commission.
2. Click **Record payment**.
3. Enter amount, method, external reference and optional evidence/notes.
4. Partial payments move the entry to **Partially Paid**.
5. The final payment moves it to **Paid**.
6. Overpayment and duplicate idempotency keys are blocked.
7. Each payment generates a PDF commission receipt stored privately in R2.

Download the receipt from the payment row. Public `/api/files/*` cannot serve commission receipts.

## 6. Reversals, refunds and adjustments

When a verified client payment is reversed or refunded:

- A negative commission adjustment is created automatically for collection-based commission entries.
- The original commission entry and original amount remain unchanged.
- The adjustment appears in the commission detail and activity trail.
- Manual corrections can be recorded by MD/Finance with a mandatory reason.

## 7. Role walkthrough

### Managing Director

- `dashboard.html` — company commission summary and recent entries.
- `commissions.html` — plans, generation, approvals, payments and adjustments.
- `performance.html` — commission earned/approved/paid/outstanding, category sales, refunds and company analytics.
- `reports.html` — all financial reports.

### Finance Officer

- Company-wide commission and financial workspace.
- Can create plans, generate entries, approve/reject, record payments and adjustments.
- Cannot access staff/lead/team management.
- Financial reports are company-wide.

### Branch Manager

- Sees only branch commission entries on `commissions.html`.
- Cannot create plans, generate commissions, approve, pay or adjust.
- Team-lead and marketer performance remains branch-scoped.
- Can generate reports within branch scope.

### Team Lead

- Sees only team commission entries.
- Cannot approve or pay commissions.
- Can generate team-scoped reports where allowed.
- Cannot generate branch performance reports.

### Marketer

- Sees only personal commission information on `dashboard.html` and `commissions.html`.
- Can view personal history and download personal commission receipts.
- Cannot create plans, generate, approve, pay or adjust.
- Can export own commission CSV/PDF report.
- Cannot access other marketers' commission records.

### Client

- Existing client portal only.
- Commission and report endpoints return 403.

## 8. Financial reports

Open `reports.html`.

Available reports:

- Sales.
- Collections.
- Outstanding balances.
- Commission.
- Branch performance.
- Marketer performance.
- Refunds and reversals.
- Commission liability.

CSV exports include the full dataset. PDF reports include the official logo, report reference, generation date, creator and selected filters. PDFs show a summary and a capped table; CSV is the complete export.

Reports are stored privately in R2 under `reports/`. Download is limited to the creator or MD/Finance. Public file routes cannot serve them.

## 9. Responsive checks

Test at:

- Desktop `1440 × 900`
- Tablet `768 × 1024`
- Mobile `390 × 844`

The Phase 7 pages reuse the existing off-canvas sidebar, responsive KPI grids, horizontally scrolling tables and single-column forms.

## 10. Automated verification

```bash
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm test
```

Expected local results:

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Phase 5 regression/security | 62 | 0 | 0 |
| Phase 6 dashboards/analytics | 21 | 0 | 0 |
| Phase 7 commissions/reports/portfolio | 26 | 0 | 0 |
| **Total** | **109** | **0** | **0** |

## 11. ALAT/Wema boundary

Phase 7 uses the existing Phase 5 payment records and verification architecture. No live Wema/ALAT endpoints, credentials, account numbers or webhook behavior are invented. Commission payments are recorded through the authorized finance workflow with external references and evidence.

## 12. Restrictions

No commit, push, deployment, remote migration, production secret or live bank connection is part of this local walkthrough.
