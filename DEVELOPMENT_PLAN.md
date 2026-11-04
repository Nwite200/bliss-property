# Bliss Legacy Limited — Development Plan

## Current state (Phase 7 completed — local verification)

- Cloudflare-only stack: Workers, Static Assets, D1, R2, KV, Queues and Cron Triggers.
- Public landing page, property browsing, authentication/RBAC, property management and client management are complete (Phases 1–4).
- Phase 5 client portal, finance ledger, receipts, installment plans, notifications and the ALAT by Wema Bank integration placeholder are implemented and verified locally.
- Phase 6 staff dashboards, team management, lead pipeline, performance analytics and activity centre are implemented and verified locally.
- Phase 7 commission management, approval/payment workflow, financial reports and business intelligence are implemented and verified locally.
- No production deployment and no remote migration has been performed.

## Confirmed architecture

- Frontend: static HTML/CSS/JS (no build step). Reusable components in `assets/js/components.js`.
- Backend: single Cloudflare Worker in `src/index.js`; REST-style `/api/*` routes plus static asset fallback.
- Data: Cloudflare D1 (`DB`), file storage R2 (`FILES`), KV (`CACHE`), Queues (`TASKS`) and a daily Cron Trigger.
- Config: `window.BLIS_CONFIG` (WhatsApp number, contacts, socials).
- Money: all NGN values are stored and calculated in integer kobo; `amount`/`total_amount` REAL columns are display-compatibility mirrors only.

## Phases

1. Public landing page & property browsing — **completed**.
2. Authentication & role management (MD, BM, Team Lead, Marketer, Client, Finance) — **completed**.
3. Property management, R2 images & status history — **completed**.
4. Client registration, management and staff assignment — **completed**.
5. Client portal, payments, finance, receipts, installments & ALAT Wema integration placeholder — **completed (local verification)**.
6. Staff dashboards, team management, lead pipeline, performance analytics & activity centre — **completed (local verification)**.
7. Commission management, financial reporting & business intelligence — **completed (local verification)**.
8. Production hardening, remote infrastructure and bank onboarding — **pending external approval**.

## Shared design rules

- Tokens: `--green #00b522`, `--charcoal #414141`, `--sidebar #17231a`, `--soft #f5f8f5`.
- Reuse `.dash`, `.sidebar`, `.kpi-grid`, `.kpi`, `.card`, `.table`, `.badge`, `.chart-placeholder` for every dashboard.
- Official logo only; never AI-generated logos.

## Security notes

- Enforce RBAC on server/database, not frontend hiding.
- Never treat unverified payments as successful; use webhooks + idempotency.
- Preserve original registration attribution separately from current relationship manager.


## Infrastructure (mandatory)
- Cloudflare-only: Workers, Static Assets, D1, R2, KV, Queues, Wrangler.
- Bindings configured in `wrangler.toml`: DB (D1), FILES (R2), CACHE (KV), TASKS (Queue), ASSETS.
- Secrets via `wrangler secret` / `.dev.vars` (local). No Supabase/Firebase/Vercel/Netlify.


## Phase 2 — Completed (local verification)

### Files created
- `wrangler.toml`, `package.json`, `.assetsignore`, `.gitignore`, `.dev.vars` (local only)
- `migrations/0001_auth_org.sql`
- `src/index.js` (Cloudflare Worker API)
- `login.html`, `dashboard.html`, `forgot-password.html`

### Database
- Migration `0001_auth_org.sql` applied successfully on local D1 (`wrangler d1 migrations apply --local`): 20 commands executed.

### API endpoints
- GET /api/health
- POST /api/setup (one-time, X-Setup-Secret)
- POST /api/login, POST /api/logout
- GET /api/me
- GET/POST /api/users (MD/BM scoped)
- GET /api/branches, GET/POST /api/teams

### Roles & permissions
- Six roles seeded: Managing Director, Branch Manager, Team Lead, Marketer, Finance Officer, Client.
- Six branches seeded.
- Permission tables + role_permissions (MD gets all).
- Server-side RBAC + branch scoping on user/team creation.

### Security
- PBKDF2 password hashing (100k iters).
- HttpOnly Secure SameSite=Lax session cookies, 8h TTL, server-side sessions.
- CSRF origin check on state-changing endpoints.
- One-time setup via env secret; setup becomes unavailable after init.
- Audit logs for setup/login/logout/user.create/team.create.

### Tests executed
- wrangler dev booted successfully with D1 binding.
- /api/health -> 200; setup -> user created; login -> cookie issued; /api/me -> correct role; repeat setup -> 409. All passed.

### Remaining
- Forgot-password email delivery not wired (needs email provider).
- Client onboarding flow + activation emails pending.
- Brute-force rate limiting not yet implemented.
- Remote D1 database creation + deploy require Cloudflare account credentials.

## Phase 3 — Completed (local verification)

### Files created
- `migrations/0002_properties.sql` — property tables + seeded categories
- `properties.html`, `property-details.html`, `property-create.html` — property management UI
- `assets/js/properties.js`, `assets/js/property-details.js`, `assets/js/property-create.js` — client modules
- `assets/js/main.js` — updated to fetch published properties from `/api/properties` (public integration)

### Modified
- `src/index.js` — added property API endpoints (categories, CRUD, status, status-history, image upload/delete, file serve)

### Database migration
- `0002_properties.sql` applied locally: 12 commands. Tables: property_categories, properties, property_images, property_documents, property_status_history. Categories seeded.

### API endpoints
- GET/POST /api/property-categories
- GET /api/properties (public published + scoped for staff)
- GET/PUT /api/properties/:id
- POST /api/properties/:id/status
- GET /api/properties/:id/status-history
- POST/DELETE /api/properties/:id/images/:imgId
- GET /api/files/:key (R2 object serve)

### R2 uploads
- `FILES` binding; keys `properties/<id>/<uuid>-<name>`; type + 5MB size validation; audit logged

### Permissions (server-side enforced)
- MD: full property management all branches
- BM: manage own-branch properties only; cross-branch = 403
- Team Lead/Marketer/Finance: read-only published properties; cannot create/edit/delete
- Client: view published properties only

### Tests executed (all passed)
- Property create/list/details/update/status-change
- Image upload to R2, status history
- Marketer create → 403; public visibility; branch scoping
- Phase 2 auth re-verified (login, setup 409, RBAC)

### Remaining
- Property documents upload endpoint
- Remote D1 deploy + production secrets (no production deploy yet)
- Forgot-password email delivery, client onboarding, brute-force rate limiting


## Phase 4 — Completed (local verification)

### Files created
- `migrations/0003_clients.sql` — clients, client_assignments, client_assignment_history, client_status_history, client_notes
- `clients.html`, `client-detail.html`, `client-register.html` — client management UI
- `assets/js/clients.js`, `assets/js/client-detail.js`, `assets/js/client-register.js` — client modules

### Modified
- `src/index.js` — client API endpoints (list, create, details, update, status, assign, reassign, history, notes, /api/users)
- `DEVELOPMENT_PLAN.md`

### Database migration
- `0003_clients.sql` applied locally. Tables: clients, client_assignments, client_assignment_history, client_status_history, client_notes. Foreign keys + indexes configured.

### API endpoints
- GET /api/users (optional role/branch filter)
- GET /api/clients (scoped; q/status/branch/marketer filters, pagination)
- POST /api/clients (marketer+; duplicate phone detection; branch enforcement)
- GET /api/clients/:id (scoped)
- PUT /api/clients/:id (MD/BM/Team Lead)
- POST /api/clients/:id/status
- POST /api/clients/:id/assign
- POST /api/clients/:id/reassign
- GET /api/clients/:id/status-history, /assignment-history
- POST /api/clients/:id/notes

### Client lifecycle & attribution
- `original_marketer_id` is immutable; branch/team lead auto-inherited from registrar.
- `client_assignments` + `client_assignment_history` preserve full transfer trail (never overwritten).
- Status history + notes tables capture audit trail.

### Permissions (server-side enforced)
- MD: all clients; BM: own branch only; Team Lead: own team; Marketer: own registrations/assigned; Finance: read-only client/purchase data
- Marketer cannot change original acquisition attribution; cannot assign/transfer.

### Tests executed (all passed)
- Marketer registration; duplicate phone → 409
- Automatic branch/team-lead attribution from registrar (immutable original_marketer_id)
- Marketer cannot assign/transfer (403)
- BM scoped to own branch (cross-branch excluded)
- MD reassign + full assignment-history preserved
- Status changes + status-history; notes
- Phase 1-3 property/authentication APIs unaffected

### Remaining
- Client portal/self-service (Phase 5)
- Branding/contact configuration and testing in staging (no production deploy without approval)


## Phase 5 — Completed (local verification)

Phase 5 delivers the secure client portal and the office finance ledger, plus an
honest ALAT by Wema Bank integration placeholder (no invented endpoints,
credentials, account numbers, or claims of live integration).

### Files created
- `migrations/0004_payments.sql` — payments, receipts, payment_schedules
- `migrations/0005_phase5_enhancements.sql` — clients.user_id, kobo columns, notifications, virtual_accounts, provider_configs, financial_adjustments
- `migrations/0006_phase5_completion.sql` — schedule lifecycle/history, kobo totals, webhook_events, notification_deliveries, notification_dedupe
- `client-login.html`, `client-dashboard.html`, `client-property.html`, `client-payments.html`, `client-virtual-account.html`, `client-receipts.html`, `client-notifications.html`, `client-profile.html`
- `finance-dashboard.html`, `provider-config.html`
- `assets/images/bliss-legacy-logo.jpg` (official logo re-encoded for PDF embedding)
- `seed_phase5.py` (idempotent local demo seed), `test_phase5_suite.mjs` (62-test verification and acceptance suite)

### Modified
- `src/index.js` — client/finance APIs, hardened auth, PDF writer, webhook idempotency, queue consumer, scheduled reminders
- `wrangler.toml` — queue consumer + daily cron trigger
- `assets/css/styles.css`, `assets/js/components.js`, `DEVELOPMENT_PLAN.md`

### Database migration
- `0004_payments.sql`, `0005_phase5_enhancements.sql` and `0006_phase5_completion.sql` applied to local D1.
- `0006` executed 17 commands successfully (local only). No remote migration has been run.

### Client authentication & sessions
- Client login accepts email, client reference number, or phone; each login is linked to the client record by `clients.user_id` (email auto-link only when the client record is not already owned by another login).
- Passwords: PBKDF2-SHA256, 100,000 iterations; minimum 8 characters on reset/change.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`, 8-hour server-side expiry; logout deletes the session server-side.
- No passwords or session tokens are written to localStorage.
- Password reset tokens are server-side, single-use, expire, and invalidate all sessions. Authenticated password change invalidates all other sessions.
- Login brute-force throttling: 10 failures in 15 minutes returns 429 (audit-log backed).

### Client portal
- Dashboard: welcome/full name, client reference, profile info, allocated/reserved property (title, reference, location, contract price), verified total, outstanding balance, payment progress, next-payment section, virtual-account status and recent in-app notifications.
- Contract price comes strictly from the client purchase record; the advertised property price is never substituted.
- My Property, payment history (status + date filters), receipts (view/print/download PDF), notification centre (read one / read all), profile and password screens.
- Clients are blocked from staff finance and client-management endpoints; cross-client receipt and record access returns 404/403.

### Finance & ledger
- Overview KPIs in integer kobo: total verified, today, month, pending, failed, refund adjustments, outstanding client balances, ALAT status.
- Transactions search: status, branch, property, marketer, free-text and date range; joins client/branch/marketer/property/receipt.
- Manual payment record, verify (idempotent), mark failed, reversal/refund with immutable `financial_adjustments` row and mandatory reason.
- Only `verified` payments count; duplicate `transaction_ref` values are rejected with 409; status transitions are guarded.
- Installment plans: weekly/monthly/quarterly/custom days, create/update/cancel, due-date and amount validation, immutable `payment_schedule_history`, client notifications. Overdue plans are flagged only — no penalty or interest is applied.
- Notifications are queued to Cloudflare Queues; the consumer records configurable email/WhatsApp delivery interfaces. A daily cron creates upcoming (≤7 days) and overdue reminders with deduplication.

### Receipts & PDFs
- Official receipt PDF generated without external dependencies, with the official logo embedded via the Static Assets binding.
- Stored in R2 at `receipts/<client_reference>/<receipt_ref>.pdf`; `receipts.r2_key` records the object key.
- Client download endpoint is client-scoped; staff download endpoint is RBAC/branch-scoped.
- Demo receipts are branded `DEMO RECEIPT — NOT A VALID FINANCIAL DOCUMENT` and never appear in the client portal.

### ALAT by Wema Bank integration (placeholder only)
- `provider_configs` lifecycle: Not configured → Awaiting onboarding → Awaiting credentials → Configured → Active.
- Webhook endpoint `POST /api/webhooks/wema-alat` rejects all events until status is Configured/Active, requires a configured `X-Webhook-Secret`, matches transaction reference, exact kobo amount and NGN currency, rejects missing/expired/future event timestamps and non-success statuses, records every event once in `webhook_events`, and rejects replays.
- Virtual accounts are shown only when the provider is Active **and** a provider-issued active account exists in D1. No account numbers, endpoints or credentials are fabricated.
- `provider-config.html` exposes status/environment/non-secret metadata, integration interface states, virtual account register, recent webhook events and a read-only reconciliation matcher.
- Real bank credentials, webhook secret and account issuance remain pending Wema onboarding.

### Demo-mode separation
- Demo records use `is_demo=1`; live reports, client dashboard, payments and receipts filter them out.
- Demo financial reports require `?demo=1` and an environment guard: `ENVIRONMENT !== "production"` or explicit `DEMO_MODE_ENABLED === "true"`.
- In production, demo reports, demo payments, demo verification and demo adjustments return 403 unless explicitly enabled.
- The finance UI shows a persistent red demo banner whenever demo mode is active.

### Security & integrity
- Integer kobo arithmetic for agreed price, verified totals, outstanding balances, installments and adjustments.
- Server-side RBAC on every finance/installment/provider endpoint; Branch Manager scope enforced on clients, transactions, receipts and schedules.
- Profile edits are allow-listed; price/branch/marketer attribution cannot be changed by a client; before/after values are audited.
- Payments/receipts are never silently deleted; corrections are reversible status transitions with an immutable adjustment record and audit log.
- Webhook and verification paths are idempotent and guarded by current-status checks.
- Final acceptance hardening: restored the Phase 3 property CRUD/status/image/status-history routes and Phase 4 client detail/update/status/notes/assignment-history routes that were absent from the Phase 5 rewrite; added a strict public-file allow-list so only registered `properties/` images are served anonymously; gated receipts on `verified_at`; made demo/live outstanding ledgers mutually exclusive; and added NGN/currency, webhook timestamp, strict success-status and webhook-secret enforcement.
- Receipt PDFs are stored privately in R2; the anonymous `/api/files/*` route can never return a receipt or other private object.

### Tests executed (all passed)
- Command: `node --experimental-sqlite test_phase5_suite.mjs` against a flushed copy of local D1.
- Result: **62 passed, 0 failed, 0 skipped**.
- Covered: client login (email/reference), cookie hardening, session expiry/logout, dashboard kobo math, contract-price authority, no-plan fallback, client isolation, profile tamper protection, payment history/date filters, receipt list/PDF/logo/R2 key, demo receipt separation, virtual-account pending message, provider secret hiding, active-provider account gating, live vs demo KPIs, production demo rejection, transaction filters, idempotent verification, RBAC on verification, immutable reversal/refund, duplicate transaction reference, failed-status guards, webhook unavailable/signature/amount/currency/replay/expiry/status protection, installment create/update/cancel/history/overdue, queue delivery records, scheduled reminder dedupe, password reset/change, branch RBAC, Phase 3 property CRUD/status/image regression, Phase 4 client registration/detail/status/notes/assignment-history regression, unauthenticated endpoint checks, CSRF origin checks, secret scans, binding checks, integer-kobo rounding/overpayment, and private R2 receipt isolation.

### Remaining (production-only / external dependencies)
- Create the remote D1 database, R2 bucket, KV namespace and queue; run remote migrations; configure `SETUP_SECRET` and provider secrets. **Requires explicit approval — not performed.**
- ALAT by Wema Bank onboarding: official API documentation, credentials, webhook secret and real virtual account issuance.
- Real email/WhatsApp delivery adapters (provider selection + credentials); current queue consumer records interface state only.
- Optional scheduler refinement (timezone-aware reminder windows) and production observability/alerts.
- Phase 7 must not start until Phase 6 is accepted after local verification.

## Phase 6 — Completed (local verification)

Phase 6 adds role-specific staff dashboards, staff/team management, the lead pipeline, performance analytics and the activity centre while preserving the Phase 1–5 architecture and endpoints.

### Files created
- `migrations/0007_phase6_staff_dashboards.sql` — staff profiles, activity branch attribution, team lifecycle, leads, follow-ups and indexes.
- `dashboard.html` — role-aware staff dashboard for MD, BM, TL, Marketer and Finance.
- `performance.html` — date-filtered analytics, branch comparison, marketer/team rankings and lead funnel.
- `staff-management.html` — staff directory, account lifecycle, team management and staff activity history.
- `leads.html` — lead register, pipeline board, follow-ups and conversion flow.
- `activity-centre.html` — role-scoped audit/activity feed.
- `assets/js/staff-shell.js` — shared staff shell, role sidebar, formatting, modal/toast helpers.
- `assets/js/dashboard.js`, `assets/js/performance.js`, `assets/js/staff-management.js`, `assets/js/leads.js`, `assets/js/activity-centre.js`.
- `seed_phase6.py` — idempotent local demo staff/profile/team seed.
- `test_phase6_suite.mjs` — 21-test Phase 6 regression and acceptance suite.
- `PHASE6_WALKTHROUGH.md` — role-by-role local testing walkthrough.

### Modified
- `src/index.js` — Phase 6 dashboard, analytics, staff, team, lead, follow-up, conversion and activity APIs; audit branch attribution; staff profile fields on `/api/me`; lead/staff/team notifications through the existing queue helper.
- `assets/css/styles.css` — restored the missing Phase 1–4 dashboard foundation and added responsive Phase 6 dashboard, chart, pipeline, activity, modal and table styles.
- `package.json` — `test:phase5`, `test:phase6` and combined `test` scripts.
- `.assetsignore` — excludes Phase 6 seed, tests and walkthrough documentation from public assets.
- `DEVELOPMENT_PLAN.md`.

### Database migration
- `0007_phase6_staff_dashboards.sql` applied locally: 21 commands.
- Added `users.last_login_at`, `users.deactivated_at`, `audit_logs.branch_id`, `teams.is_active`, `staff_profiles`, `leads` and `lead_follow_ups`.
- Existing audit rows were backfilled with the actor's branch. No Phase 1–5 table was dropped or rewritten.
- No remote migration has been run.

### APIs
- `GET /api/dashboard` — role-scoped company/branch/team/personal dashboard.
- `GET /api/analytics/performance` — date/granularity filtered contract, verified, leads, conversions, branch, marketer and team analytics.
- `GET /api/activity` — role-scoped activity centre with type and date filters.
- `GET/POST /api/staff`, `GET/PUT /api/staff/:id`, `POST /api/staff/:id/status`, `PUT /api/staff/:id/teams`.
- `GET/PUT /api/teams/:id`, plus richer `/api/teams` list fields.
- `GET/POST /api/leads`, `GET/PUT /api/leads/:id`, `POST /api/leads/:id/status`, `POST/PUT /api/leads/:id/follow-ups`, `POST /api/leads/:id/convert`.

### Dashboards & analytics
- MD: company-wide property, client, staff, contract, verified, outstanding, branch comparison, marketer/team rankings and activity.
- BM: branch-only inventory, clients, collections, marketers, teams and activity.
- TL: team members, team client portfolio, team property assignments, leads, follow-ups, conversions and team rankings.
- Marketer: personal profile, assigned clients/properties, personal leads/follow-ups, pipeline, conversions and verified payment summaries.
- Finance: company-wide contract/verified/outstanding analytics with existing finance ledger access.
- Financial analytics distinguish agreed contract value from verified cash. Pending, failed and demo payments are excluded from collected revenue. Demo clients/leads are excluded from live analytics.

### Security & RBAC
- Every Phase 6 endpoint is server-side role checked.
- BM branch scope, TL team scope and Marketer personal scope are applied to dashboards, analytics, leads, staff/team management and activity.
- Marketers and Team Leads cannot enter or modify contract prices during client registration, client updates or lead conversion. Only the Managing Director and Branch Manager can establish or change contract prices. Marketers also cannot reassign leads, verify/adjust payments, or access another marketer's records.
- Only MD/BM can manage staff/teams; only MD can move leads between branches.
- Staff deactivation invalidates sessions. The last active MD cannot be deactivated and users cannot deactivate themselves.
- All sensitive Phase 6 changes are written to `audit_logs` with branch attribution.

### Tests executed (all passed)
- `node --experimental-sqlite test_phase5_suite.mjs` — **62 passed, 0 failed, 0 skipped**.
- `node --experimental-sqlite test_phase6_suite.mjs` — **21 passed, 0 failed, 0 skipped**.
- Combined total: **83 passed, 0 failed, 0 skipped**.
- Phase 6 coverage: all five staff roles, branch/team/marketer isolation, staff creation/update/deactivation, team membership, lead pipeline/follow-ups/conversion, contract-price protection, dashboard math, date filters, demo/live separation, activity scoping, API security and responsive static checks.
- Local `wrangler dev` smoke: **23/23 passed** (role dashboard APIs, analytics, staff/leads/activity/teams, shared shell and all Phase 6 pages/assets).

### Remaining (production-only / external dependencies)
- Remote D1/R2/KV/Queue creation, remote migrations and production secrets — not performed.
- ALAT/Wema onboarding and official credentials — unchanged Phase 5 boundary.
- Real email/WhatsApp delivery adapters — queue records interface state only.
- Browser screenshot capture/visual regression tooling is not installed; `PHASE6_WALKTHROUGH.md` and `PHASE7_WALKTHROUGH.md` provide the role-by-role local walkthroughs.

## Phase 7 — Completed (local verification)

Phase 7 adds governed commission management, commission attribution and calculation, approval/payment workflow, private R2 commission receipts, financial reports and business intelligence without changing the Cloudflare-only architecture.

### Files created
- `migrations/0008_phase7_commissions_reports.sql`
- `commissions.html`
- `reports.html`
- `signup.html`
- `assets/js/commissions.js`
- `assets/js/reports.js`
- `test_phase7_suite.mjs`
- `PHASE7_WALKTHROUGH.md`

### Files modified
- `src/index.js`
- `dashboard.html`, `assets/js/dashboard.js`
- `performance.html`, `assets/js/performance.js`
- `assets/js/staff-shell.js`
- `assets/js/client-register.js`, `client-register.html`
- `assets/css/styles.css`
- `package.json`, `.assetsignore`, `README.txt`, `DEVELOPMENT_PLAN.md`

### Database migration
- `0008_phase7_commissions_reports.sql` applied locally: 29 commands.
- Added `clients.sale_type`, commission plans/rules, commission entries, attribution snapshots, approvals, payments, adjustments and financial report jobs.
- Existing Phase 1–6 tables and data were preserved.

### Commission rules implemented
- Configurable plans: contract value, verified collections or fixed amount.
- Multiple role rules per plan: Marketer, Team Lead, Branch Manager.
- Optional property category, sales type, branch and team filters.
- Effective start/end dates, approval requirement and separation of duties.
- Contract-value commission uses the agreed client contract.
- Collections commission accrues per verified successful NGN payment only.
- Pending, failed and DEMO payments never generate commission.
- Fixed commission is one amount per qualifying client/plan/rule.
- Rate rules use integer basis points; commission amounts use integer kobo and half-up rounding.
- Unique source keys prevent duplicate commissions.
- Attribution snapshots preserve marketer, team lead, branch, team and relationship-manager attribution at creation. Reassigning a client does not move existing commission.

### Approval and payment workflow
- States: Draft, Calculated, Pending Approval, Approved, Partially Paid, Paid, Rejected, Reversed, Cancelled.
- MD/Finance can submit, approve, reject, pay and adjust.
- Recipients cannot approve their own commission when separation of duties is enabled.
- Partial payments and final payments update status and outstanding liability.
- Overpayment and duplicate idempotency keys are blocked.
- Commission payments generate private R2 PDF receipts with the official logo.
- Refunds/reversals of client payments create negative commission adjustments without overwriting the original entry.
- Manual corrections are traceable signed adjustments.

### Financial reports and analytics
- MD/Finance: company-wide commission and financial analytics, category sales, refunds/reversals, commission liabilities and exports.
- BM: branch commission summary, branch performance and branch-scoped reports.
- Team Lead: team commission summary and team-scoped reports.
- Marketer: personal commission summary/history and personal commission exports only.
- Reports: sales, collections, outstanding, commission, branch performance, marketer performance, refunds and commission liability.
- CSV exports are complete; PDF reports include the official logo, report reference, generation date, creator and filters.
- Generated files are stored privately in R2. Public `/api/files/*` cannot serve reports or commission receipts.

### Tests executed
- Phase 5: **62 passed, 0 failed, 0 skipped**.
- Phase 6: **21 passed, 0 failed, 0 skipped**.
- Phase 7: **26 passed, 0 failed, 0 skipped**.
- Combined total: **109 passed, 0 failed, 0 skipped**.
- Phase 7 covers plan validation, contract/collection/fixed calculations, partial accrual, duplicate prevention, attribution snapshots, approvals/rejections, self-approval prevention, partial/final payment, double-payment prevention, receipts/R2, refund/reversal adjustments, manual corrections, commission-ledger liability reconciliation, role isolation, analytics, CSV/PDF reports, report ownership/R2 security, public client sign-up assignment injection, password hashing, session cookie/logout/expiry, client isolation, official logo consistency, ten-listing landing catalogue with land and demo labels, multi-property client/staff portfolios, per-property verified/outstanding/progress balances, current-assignment property visibility revocation and Phase 1–6 regression.

### Remaining (production-only / external dependencies)
- Remote D1/R2/KV/Queue creation, remote migrations and production secrets — not performed.
- ALAT/Wema onboarding and real bank credentials — unchanged Phase 5 boundary.
- Real email/WhatsApp delivery adapters — queue records interface state only.
- No company commission rates are hard-coded; production rates must be configured and approved by management before use.

