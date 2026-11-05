# Bliss Legacy Limited — Staging Deployment Record

**Worker:** `bliss-property`

**Staging URL:** `https://bliss-property.easterntechexpo.workers.dev`

**Branch:** `staging` (see the final response for the exact tip)

**Environment:** `staging`

**Demo mode:** disabled (`DEMO_MODE_ENABLED=0`); all staging records are explicitly labelled `STAGING TEST` and are fictional.

---

## 1. Staging Cloudflare resources

| Binding | Resource | Identifier |
|---|---|---|
| `DB` | D1 `bliss-legacy-staging-db` | `294d118f-96c1-4878-ad56-a33d0b866958` |
| `FILES` | R2 `bliss-legacy-staging-files` | bucket name |
| `CACHE` | KV `CACHE_STAGING` | `c8968754a05a4b38b29320e79b8ee3ba` |
| `TASKS` | Queue `bliss-legacy-staging-tasks` | producer + consumer |
| `ASSETS` | Workers Static Assets | repository root filtered by `.assetsignore` |

These are separate from the production resources. Staging is not connected to `bliss-legacy-db`, `bliss-legacy-files`, `CACHE` production namespace or `bliss-legacy-tasks`.

---

## 2. Migration status

All eighteen migrations were applied to `bliss-legacy-staging-db` only:

- `0001_auth_org.sql`
- `0002_properties.sql`
- `0003_clients.sql`
- `0004_payments.sql`
- `0005_phase5_enhancements.sql`
- `0006_phase5_completion.sql`
- `0007_phase6_staff_dashboards.sql`
- `0008_phase7_commissions_reports.sql`
- `0009_client_properties.sql`
- `0010_referrals_onboarding_alatpay.sql`
- `0011_super_admin_notifications_chat.sql`
- `0012_revenue_hierarchy_attribution.sql`
- `0013_plans_defaulting_inspections_commissions_providers.sql`
- `0014_property_plans_customer_care_sms_leads.sql`
- `0015_client_onboarding_otp.sql`
- `0016_alatpay_webhook_static_wallets_test_mode.sql`
- `0017_automatic_commission_generation.sql`
- `0018_test_accounts_monthly_reactivation.sql`

`wrangler d1 migrations list bliss-legacy-staging-db --remote` reports no pending migrations.

---

## 3. Tests

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Phase 5 | 62 | 0 | 0 |
| Phase 6 | 21 | 0 | 0 |
| Phase 7 | 26 | 0 | 0 |
| Phase 8 | 43 | 0 | 0 |
| Seed/wipe security | 5 | 0 | 0 |
| Browser (breadcrumbs, colours, WebSocket chat) | 3 | 0 | 0 |
| **Total** | **160** | **0** | **0** |

Also passed: `node --check` for the Worker, all external JS and all test suites; inline HTML script checks; `git diff --check`.

---

## 4. Live staging verification

Verified against `https://bliss-property.easterntechexpo.workers.dev`:

- `/api/health` returns 200.
- Public homepage returns 200 and renders live D1 staging property cards.
- `GET /api/properties` returns the two staging properties.
- Public published image returns 200.
- Private property document returns 401 anonymously and 200 for the Branch Manager; it is 404 through `/api/files/*`.
- All six implemented roles log in and load their dashboards.
- Marketer is denied company finance (`403`).
- Finance is denied lead management (`403`).
- Client is denied staff APIs (`403`) and sees own property/payment/notification data.
- Public enquiry creates a real staging lead.
- Client registration creates a staging client.
- Assignment and contract price update succeed.
- Manual payment verification succeeds.
- Commission generation succeeds.
- Sales, collections, outstanding and commission CSV reports generate.
- Commission PDF report generates and begins with `%PDF-`.
- CSV and PDF downloads return 200.
- Desktop 1440×900 and mobile 390×844 renders for MD, BM, TL, Marketer, Finance and Client show no document-level horizontal overflow.

---

## 5. Staging seed coverage

The staging seed is idempotent, refuses any database other than the known staging ID, and stores only PBKDF2 hashes. Generated passwords are printed once at run time and are not written to the repository.

| Data | Count |
|---|---:|
| Test staff accounts (`is_test=1`) | 3 new |
| Seeded clients (`TEST-STG-*`) | 9 |
| Enabled property plans (5 types × 2 properties) | 10 |
| Payment schedules | 9 |
| Schedule items | 19 |
| SMS log rows (queued / sent / delivered / failed / opted_out / skipped) | 6 |
| Leads across every pipeline stage | 7 |
| Lead follow-up contacts | 14 |
| Client care records (pending + cleared) | 4 |

Structure seeded:

- Ikeja branch has a Team Lead and a marketer in that team.
- Ajah branch has a Branch Manager and a marketer with **no Team Lead**, reporting directly to the Branch Manager.
- A Finance Officer account holds `commission_access=1` only (no other elevated access).
- Both staging properties carry outright, part-payment, daily, weekly and monthly plans.
- Clients cover performing and defaulting schedules across all five plan types.
- Two clients intentionally have bad/missing phone numbers for the read-only cleanup report.

## 6. Clear fictional staging data

| Record | Value |
|---|---|
| MD | `staging.md@blisslegacy.test` |
| Branch Manager | `staging.bm@blisslegacy.test` |
| Team Lead | `staging.tl@blisslegacy.test` |
| Marketer | `staging.marketer@blisslegacy.test` |
| Finance | `staging.finance@blisslegacy.test` |
| Client | `staging.client@blisslegacy.test` |
| Property 1 | `STAGING TEST — Ikeja Garden Estate` |
| Property 2 | `STAGING TEST — Riverside Plots` |
| Payment reference | `STG-DEMO-PAY-001` |
| Public enquiry | `STAGING TEST Enquiry` |

Passwords are generated by the seed script and printed once to the operator terminal. They are never committed or written to disk.

---

## 7. Workers Builds status

The existing `bliss-property` Worker was deployed manually with Wrangler using the staging configuration.

Cloudflare Workers Builds configuration could **not** be changed from this environment because the authenticated Wrangler OAuth token lacks the required `workers_builds:write` scope. The Builds API returned:

```text
403 Authentication error
```

Required owner action in the Cloudflare dashboard:

1. Open **Workers & Pages → bliss-property → Settings → Builds**.
2. Connect/confirm GitHub repository `Nwite200/bliss-property`.
3. Set the production/deployment branch to `staging`.
4. Set build command to the project’s normal install/build command (there is no separate build step required for this static-assets Worker).
5. Set deploy command to `npx wrangler deploy`.
6. Confirm the build uses this branch’s `wrangler.toml` staging bindings.
7. Do not point it at the production branch or production resources.

Until that dashboard step is completed, Git pushes will not automatically trigger a staging deployment, even though the Worker itself is live from the manual Wrangler deployment.

---

## 8. PWA and motion

- `manifest.json` is served with HTTP 200 and Chrome reports no installability errors.
- Service worker `sw.js` registers at scope `/` with cache `bliss-pwa-v5-static`.
- Install UI supports Android `beforeinstallprompt` and iOS Safari **Add to Home Screen** instructions.
- Offline fallback: `/offline`.
- Logo intro uses `assets/js/intro-config.js` with `INTRO_STYLE='hype'` by default and a `classic` variant available by changing one constant.
- Full hype sequence is 3.0 s; short internal/Back-Forward hype is 1.0 s; classic is 2.7 s full and 1.35 s short.
- Intro replays on page loads, refresh, direct URLs, Back/Forward and dashboard tab view changes; non-navigation clicks do not replay it.
- PWA icons are generated from the official `assets/images/bliss-legacy-logo.png` file.
- No ODATANO asset or brand string exists in the repository. The intro therefore uses the actual Bliss Legacy logo; `LOGO_SRC` in `assets/js/intro-config.js` is the single swap point if a real ODATANO file is supplied.

## 9. ALATPay and referrals

### ALATPay

- Server-side secret configured as Worker secret `ALATPAY_SECRET_KEY`.
- Staging business ID configured as Worker secret `ALATPAY_BUSINESS_ID` and in provider metadata.
- Base URL: `https://apibox.alatpay.ng`.
- Virtual account endpoint: `POST /bank-transfer/api/v1/bankTransfer/virtualAccount`.
- Client endpoint: `POST /api/client/virtual-account`; staff-assisted endpoint: `POST /api/finance/clients/:id/virtual-account`.
- Webhook: `POST /api/webhooks/alatpay`, verified by re-querying ALATPay with the secret key.
- A live staging virtual account was successfully issued for ₦1,000 and stored; the account number is masked in logs/final reporting.
- The ALATPay dashboard must have its callback URL set to `https://bliss-property.easterntechexpo.workers.dev/api/webhooks/alatpay`.

### Referrals

- Every staff user has a unique `referral_code`; existing users were backfilled by migration `0010`.
- `/api/me` returns `referral_code` and `referral_link`.
- Signup supports `?ref=CODE`; valid codes attribute the client to the referrer and branch.
- New client onboarding stores alternate phone and next-of-kin name, phone, relationship and address.
- Referred clients are visible to the referrer through the role-scoped client queries.

## 9. Super Admin, staff notifications and chat

### Super Admin

- `Super Admin` is a real role seeded by migration `0011`.
- Existing MD-style authorisation is inherited for compatibility; the actual role is returned as `actual_role`.
- Admin APIs are permission-guarded:
  - `GET /api/admin/overview` — `admin.system`
  - `GET /api/admin/roles` — `admin.roles`
  - `PUT /api/admin/roles/:id/permissions` — `admin.permissions` + actual Super Admin
  - `GET /api/admin/audit` — `admin.audit`
- Permission changes are written to `role_permissions` and `audit_logs`.
- System Administration UI: `/super-admin.html`

Staging Super Admin account:

```text
staging.superadmin@blisslegacy.test
```

Additional hierarchy staging accounts use the main staging demo password:

```text
staging.pm@blisslegacy.test        Project Manager, Ikeja
staging.accountant@blisslegacy.test Head Accountant, Head Office
care.branch.staging@blisslegacy.test   Customer Care, branch scope
care.national.staging@blisslegacy.test Customer Care, national scope
```

The Super Admin temporary password is supplied only in the secure handover/final response.

### Staff notifications

- In-app staff inbox: `/staff-notifications.html`
- `GET /api/staff/notifications`
- `POST /api/staff/notifications/:id/read`
- `POST /api/staff/notifications/read-all`
- Read/unread state is stored in the existing `notifications` table.
- New-client and verified-payment events notify the relevant branch manager, marketer, team lead, referrer and finance users.

### Staff chat

- UI: `/staff-chat.html`
- Durable Object binding: `CHAT_ROOM` (`ChatRoom` class)
- WebSocket route: `/api/chat/rooms/:id/socket`
- REST fallback/history: `/api/chat/rooms`, `/api/chat/rooms/:id/messages`
- Messages persist to D1 `chat_messages`.
- Branch rooms are created by migration `0011`; direct rooms are created by staff.
- Verified locally: WebSocket connected, room history loaded, message sent and persisted.

## 10. Hierarchical revenue

- `users.manager_id` stores the reporting parent.
- `Project Manager` and `Head Accountant` roles are seeded.
- `payments` store an immutable revenue attribution snapshot:
  - `revenue_staff_id`
  - `revenue_team_lead_id`
  - `revenue_pm_id`
  - `revenue_branch_id`
  - attribution metadata and timestamp
- Revenue APIs:
  - `GET /api/revenue/overview`
  - `GET /api/revenue/breakdown`
  - `GET /api/revenue/payments`
- Scope is server-derived:
  - Staff: personally registered clients only
  - Team Lead: team revenue
  - PM / Branch Manager: branch revenue
  - MD / Super Admin / Head Accountant / Finance: national revenue
- New revenue drill-down page: `/revenue.html`
- Dashboard now shows a live **Total paid today** card in each role's scope.
- Existing dashboard branch selector passes the selected branch into the revenue card and live dashboard queries.
- Roll-up responses include `reconciles` and `children_total_kobo` so parent/child totals can be checked.

## 11. Payment plans, defaulting, inspections, commission versions and providers

- Payment plan types: outright, part payment, daily, weekly, bi-monthly, monthly.
  Daily/weekly/bi-monthly/monthly are easy-buy plans.
- Expected schedule items are generated in `payment_schedule_items`; plan
  type, start date, grace period and schedule version are stored on the plan.
- Defaulting clients compare expected-to-date with verified paid-to-date and
  clear automatically when the client catches up.
- Defaulting follow-up tools store owner, call note, next date and status.
- Lead inspections store date, time, property and notes, with today/next-7-day
  counts by branch and marketer. Bulk CSV/paste import is available.
- Lead conversion now keeps the lead marketer as both `created_by` and
  `original_marketer_id` so revenue and commission attribution stay with them.
- Commission plans are versioned in `commission_plan_versions`; past entries
  keep their original plan version, commissionable amount and rate.
- Easy-buy commissionable basis supports: full payment, first N months,
  percentage of each payment, or a fixed cap per sale.
- `users.commission_access` gates all commission APIs and navigation. MD,
  Head Accountant and Super Admin get it by default; staff/team leads do not.
- Payment providers are adapter-based with per-provider webhook routes and
  idempotent event storage. ALATPay is the first adapter; Wema ALAT and
  Paystack adapters are registered. Secrets are Worker secrets only.
- See `PAYMENT_PROVIDER_SECRETS.md` for the ALATPay secret checklist.

## 12. Property plans, customer care, SMS and lead refinements

- Property payment-plan catalogue (`property_payment_plans`) with outright,
  part payment, daily, weekly, bi-monthly and monthly plans.
- Onboarding can only choose enabled plans; the chosen terms are locked onto
  the client, allocation and payment schedule so later property edits do not
  change existing clients.
- Customer Care role with branch or national scope, pending-clearance queue,
  cleared status and call history. No commission access.
- SMS provider adapters (Termii first, Africa's Talking alternative, mock for
  tests) behind Worker secrets, queued delivery, retries, idempotency, opt-out,
  editable templates, delivery log, credit balance and low-balance alerts.
- Lead temperature (Hot/Warm/Cold), contact history count/last contact, referrer
  and required lost reason.
- See `SMS_PROVIDER_SETUP.md` for SMS account and secret setup.

## 13. Client onboarding OTP

- New clients start `unverified`; existing clients were backfilled `verified`.
- Staff onboarding auto-sends a 6-digit code to email (if configured) or SMS.
- Public signup redirects to `client-verify.html`.
- Staff can resend and verify from the client detail page.
- Codes expire in 10 minutes, allow five attempts and are stored hashed.
- See `CLIENT_OTP_VERIFICATION.md` for email/SMS provider setup.

## 14. ALATPay documented integration

- Webhook validation now uses `x-signature` = Base64(HMAC-SHA256(raw body, webhook secret)).
- Webhook payload supports documented `Value.Data` envelope.
- Transaction status uses `/alatpaytransaction/api/v1/transactions/{id}` before credit.
- Static wallets use `/alatpay-wallet/api/v1/staticaccount` and `validateAndCreate`.
- Test/live mode is controlled by `PAYMENT_MODE` with separate secrets and webhook routes.
- Staff sidebar shows a TEST MODE banner when `PAYMENT_MODE=test`.
- Dynamic amount-specific accounts remain available.
- See `ALATPAY_INTEGRATION.md`.

## 15. Deployment version

Current staging deployment version ID: `ad6e4447-3476-4c0a-ab45-e24bf409553f`

---

## 8. Safety notes

- `SETUP_SECRET` is set on the staging Worker; rotate or delete it after initial account creation.
- Staging demo passwords must be rotated after the demonstration.
- No production D1/R2/KV/Queue resource was modified by the staging deployment.
- No production migration was applied.
- No production data was used.
