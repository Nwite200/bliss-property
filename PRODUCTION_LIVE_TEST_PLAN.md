# Controlled Live Payment Test — Readiness and Go/No-Go Plan

**Status:** PRODUCTION WORKER DEPLOYED; DOMAIN ATTACH AND LIVE PAYMENTS BLOCKED BY EXTERNAL ACCESS.
**Prepared:** 2026-11-06
**Branch:** `main`

## Execution update — 2026-11-06

- Production Worker deployed: `https://bliss-property-production.easterntechexpo.workers.dev`
- Production D1 migrated through `0022`.
- Pre-migration production export completed.
- Demo property marked demo/unpublished; demo staff/client/payment data hidden or deactivated.
- Real production owner account created. The generated credential is stored only in a local, untracked file outside the repository.
- Production branch list contains Ikeja, Ajah, Asaba, Ihama, Obakhavba and Head Office, and is served to the signup branch picker.
- Production Worker is in `PAYMENT_MODE=live` with live ALATPay secret, business ID and webhook secret configured.
- **ALATPay live API returned HTTP 401 on a read-only business transaction query.** Live payment provisioning is therefore not yet verified.
- `blisspayment.com.ng` is not present in the Cloudflare account used by this deployment. The existing domain still serves an older site. It cannot be attached until the zone is moved/added to this account and the token has the required zone permission.
- SMS remains disabled. No real SMS was sent.

---

## PART A — Property listing and plan upload

### What changed

- Property management is now limited to MD, Super Admin and Branch Managers on the server.
- Branch Managers are restricted to their own branch.
- Customer Care, Account Officers, Telemarketers, Marketers and the Head Accountant cannot create or edit properties or payment plans.
- Added property workflow status: `draft`, `pending_approval`, `published`, `unpublished`, `sold_out`, `archived`.
- Added the setting **“Branch manager listings need MD approval”**, default ON.
- Branch Manager publish attempts become `pending_approval`; MD/Super Admin can approve.
- Publishing is blocked when a property has no enabled payment plan.
- Payment plans now support a first-payment rule and a calculated balance-difference warning.
- Existing purchase terms remain locked at purchase time.
- Added property flags: `is_demo`, `is_internal_test`, `is_archived`.
- Added available/total unit fields.
- Added internal-test/property visibility rules:
  - Internal test properties are hidden from anonymous users and the public listing.
  - Staff can see them.
  - A named test client can see them when linked through `client_properties` or `interested_property_id`.
- Added archive action for all internal test properties, clients and payments.
- Added TEST and DEMO labels to property, client and transaction views.
- Added public site/branch contact settings in System Administration.
- Public contact and branch content now load from `/api/site-config`; static files are fallback only.
- Demo static listings are no longer merged when real listings exist, and can be disabled entirely.

### Migrations

- Existing staging database: `0022_property_listing_workflow_and_settings.sql`
- Fresh production database: apply `0001` through `0022` in order.

No production migration was applied.

### Test result

Full local suite:

| Suite | Result |
|---|---|
| Phase 5 | 62 passed, 0 failed |
| Phase 6 | 21 passed, 0 failed |
| Phase 7 | 26 passed, 0 failed |
| Phase 8 | 47 passed, 0 failed |
| Seed security | 5 passed, 0 failed |
| Browser | 3 passed, 0 failed |
| **Total** | **164 passed, 0 failed** |

### Properties currently in the database

**Staging database:**

| ID | Reference | Title | Flags | Enabled plans | Classification |
|---|---|---|---|---|---|
| 1 | `BLP-MW2SGTX8-96H2` | STAGING TEST — Ikeja Garden Estate | No demo/test flag | 5 | Seeded staging test data |
| 2 | `BLP-MW2SGU44-GVAM` | STAGING TEST — Riverside Plots | No demo/test flag | 5 | Seeded staging test data |

**Local database:**

| ID | Reference | Title | Flags | Enabled plans | Classification |
|---|---|---|---|---|---|
| 1 | `BLP-MW2B7YXE` | Ikeja Residential Estate | No demo/test flag | 0 | Seeded/placeholder — needs plans or conversion |
| 2 | `BLP-MW2BFMLA` | Luxury Ikeja Apartment | No demo/test flag | 0 | Seeded/placeholder — needs plans or conversion |

No existing property was automatically marked demo or internal test. Use the property flags/convert action to classify them before production.

### Unit-level pricing — not built

Plans are per property today. If one property contains plots of different sizes and prices, you need a separate **unit/plot table** with its own price and plan. That was not built because you asked not to build it unless approved.

---

## PART B — Production readiness gates

### Production migration order (clean database)

Run in this exact order:

`0001_auth_org.sql`, `0002_properties.sql`, `0003_clients.sql`, `0004_payments.sql`, `0005_phase5_enhancements.sql`, `0006_phase5_completion.sql`, `0007_phase6_staff_dashboards.sql`, `0008_phase7_commissions_reports.sql`, `0009_client_properties.sql`, `0010_referrals_onboarding_alatpay.sql`, `0011_super_admin_notifications_chat.sql`, `0012_revenue_hierarchy_attribution.sql`, `0013_plans_defaulting_inspections_commissions_providers.sql`, `0014_property_plans_customer_care_sms_leads.sql`, `0015_client_onboarding_otp.sql`, `0016_alatpay_webhook_static_wallets_test_mode.sql`, `0017_automatic_commission_generation.sql`, `0018_test_accounts_monthly_reactivation.sql`, `0019_client_identity_referral_branch.sql`, `0020_referral_commission_automation.sql`, `0021_terms_versions_acceptances.sql`, `0022_property_listing_workflow_and_settings.sql`.

No down migrations are provided. Take an export/snapshot before applying production migrations.

### Gate table

| # | Gate | Status | Evidence / blocker |
|---|---|---|---|
| 1 | ALATPay sandbox end-to-end with real sandbox calls | **FAIL / UNVERIFIED** | Test secret names exist: `ALATPAY_TEST_SECRET_KEY`, `ALATPAY_TEST_BUSINESS_ID`, `ALATPAY_TEST_WEBHOOK_SECRET`. No real sandbox transaction was executed in this session. Mocked tests cover static wallet, webhook signature, idempotency and commission. Earlier 401 status is not proven resolved. |
| 2 | Webhook secret is separate from API key | **PARTIAL** | A separate `ALATPAY_TEST_WEBHOOK_SECRET` secret name exists for test mode. No `ALATPAY_LIVE_WEBHOOK_SECRET` exists yet. Values cannot be compared without exposing secrets. ALATPay must confirm the signing scheme. |
| 3 | Automatic commission with idempotency/retry | **PASS** | Implemented; Phase 8 automatic commission and retry tests pass. Referral commission is also excluded from internal test data. |
| 4 | Seed password problem resolved | **PARTIAL** | `seed_guard.py` fails closed for local/staging, seed scripts randomize passwords, 14-day test expiry exists, and wipe exists. Test suites still contain fixture password `password123`, and old commits contain test passwords. Those are not production accounts, but the strict “no hardcoded passwords anywhere” gate is not fully met. |
| 5 | Clean production DB + ordered migrations + rollback | **FAIL / NOT PREPARED** | No production D1/R2/KV/Queue resources or production Wrangler configuration exist yet. All 22 migrations must run on a clean production DB. No down migrations exist; rollback requires backup/snapshot + restore. |
| 6 | Real production owner account | **FAIL / NOT PREPARED** | `/api/setup` exists and requires `X-Setup-Secret`, but no production owner has been created. You must set the password yourself. |
| 7 | Domain + HTTPS + live webhook route | **FAIL / NOT PREPARED** | Current deployment is `workers.dev` staging only. No production custom domain or live webhook URL is attached. |
| 8 | Backups + monitoring/alerting | **FAIL / PARTIAL** | D1 Time Travel is available in Cloudflare, but no scheduled export or restore test is configured here. Webhook and commission failure tables exist, but no external alerting destination is configured. |
| 9 | Login lockout/rate limiting and webhook protection | **PARTIAL** | Login is throttled after failed attempts, signup is rate-limited in D1, and webhook signature validation exists. There is no dedicated webhook route rate limit/lockout. Production edge WAF/rate rules are not configured. |
| 10 | Full test suite + earlier audit table | **PARTIAL** | Full suite is 164/164 PASS. The earlier assignment/officer work remains NOT IMPLEMENTED because only Stage 1 audit was approved. |

### Earlier audit status

| Earlier requirement | Status | Evidence |
|---|---|---|
| Manager-controlled assignment rules | **FAIL / NOT IMPLEMENTED** | Only Stage 1 audit was completed. Option A was chosen but not built. Existing assignment routes still use `relationship_manager_id`. |
| Account Officer / Telemarketer scoping | **FAIL / NOT IMPLEMENTED** | Roles and dashboards do not exist yet. |
| No commission for Account Officer/Telemarketer | **N/A today / NOT IMPLEMENTED** | Roles do not exist. Existing commission code still follows the current relationship-manager assignment. |
| Customer Care has no assignment action | **PASS** | No assign UI; `/api/clients/:id/assign` and `/reassign` reject Customer Care with 403. |
| Customer Care from/to date filter | **PASS** | API applies `c.created_at` range; Phase 8 regression test passes. |

---

## B2 — Production deployment checklist (do not run until approved)

> Current `wrangler.toml` is staging. A separate production configuration must be created and reviewed first. Never reuse staging IDs for production.

1. Approve the production resource plan.
2. Create production D1, R2, KV and Queue resources.
3. Put production IDs in a separate production Wrangler configuration, not the staging file.
4. Back up/snapshot the production D1 database before any migration.
5. Apply all migrations in order from `0001` to `0022`.
6. Confirm the production database has zero demo/test users, clients, payments, receipts, properties or commissions.
7. Set production secrets with `wrangler secret put` (values typed interactively, never committed):
   - `SETUP_SECRET`
   - `ALATPAY_LIVE_SECRET_KEY`
   - `ALATPAY_LIVE_BUSINESS_ID`
   - `ALATPAY_LIVE_WEBHOOK_SECRET`
   - `TERMII_API_KEY` (only when approved)
8. Keep `PAYMENT_MODE=test` until the go/no-go approval. Change it to `live` only at the approved moment.
9. Deploy the production Worker.
10. Attach the approved domain and verify HTTPS.
11. Register the live webhook in ALATPay:
    `https://<production-host>/api/webhooks/alatpay/live`
12. Create the production owner through the secure setup endpoint using a password you type yourself.
13. Run smoke tests: login, public site, terms, property listing, plans, one admin page and webhook health.
14. Confirm monitoring and backups are live before accepting real traffic.

### Instant rollback to test mode

- Set `PAYMENT_MODE=test`.
- Redeploy the Worker.
- Disable/hold the live webhook in ALATPay.
- Do not delete payments or audit records.
- Reconcile any payment already received through the finance reversal/adjustment workflow.

---

## B3 — SMS during the live test

Current staging SMS state:

- `sms_enabled = 0`
- provider = `termii`
- sender ID = `BlissLegacy`
- defaulting reminders = `0`
- `TERMII_API_KEY` is not present in the current secret list.

The Termii adapter uses the transactional/DND route (`channel: "dnd"`). No real SMS may be sent until you approve.

Before the test, the SMS provider must confirm:

1. Sender ID `BlissLegacy` is approved for Nigeria.
2. The transactional/DND route is enabled for the account.
3. The DND status of your named test phone number.
4. `TERMII_API_KEY` is supplied as a Worker secret.
5. Whether the sender ID must be changed to a registered short code.

There is currently no per-phone SMS allowlist in the application; the switch is global. Recommended safe test procedure: enable SMS only during the agreed test window, use only your named test phone number, then switch it off immediately.

---

## B4 — Live test checklist

Use an internal test property and a test client with your own phone number and BVN/OTP.

1. Log in as MD/Super Admin or Branch Manager.
2. Create the internal test property with tiny plan amounts.
3. Add at least one enabled plan and confirm the balance difference is zero or explicitly accepted.
4. Publish/submit and approve. Confirm it is hidden from the public site and visible to staff.
5. Register the test client under the test marketer. Choose the test plan.
6. Complete static wallet creation with BVN and OTP typed once; confirm neither is stored.
7. Pay the smallest real amount from your own bank app into the displayed wallet.
8. Watch the webhook arrive, signature validate and status re-query pass.
9. Confirm exactly one credit, correct client balance and correct schedule update.
10. Confirm revenue appears in marketer, team lead, branch manager and MD views and reconciles at each level.
11. Confirm commission entries exist for each beneficiary and no officer/telemarketer commission appears.
12. Confirm one SMS arrives with the right amount, balance and reference.
13. Pay a second small amount, then replay the webhook and confirm no double credit.
14. Send a wrong-amount case and confirm rejection.
15. Let a day pass on a daily plan and confirm defaulting detection triggers.
16. Confirm Customer Care sees the client in the clearance queue.
17. Manager assignment to an Account Officer is **blocked** until the Option A assignment model is implemented.
18. Confirm settlement timing and net amount after fees with ALATPay.
19. Archive test data and confirm real reports are clean.
20. Keep the test property, clients and payments archived; preserve audit history.

---

## B5 — Rollback and incident plan

1. Set `PAYMENT_MODE=test` and redeploy immediately.
2. Disable/remove the live webhook URL in the ALATPay dashboard.
3. Stop outbound SMS by setting `sms_enabled=0`.
4. Identify the wrongly credited payment by transaction reference and client reference.
5. Use the existing payment reversal/adjustment flow; do not delete payment rows or audit records.
6. Check commission and referral ledgers for automatic reversal.
7. Restore the database only from a verified backup if a migration or data change caused the incident.
8. Contact the ALATPay account manager/support line supplied by you.

**ALATPay contact:** `<to be supplied by owner>`

---

## Values and approvals you must provide

1. Production domain/host name.
2. Production D1, R2, KV and Queue resource IDs, or approval to create them.
3. ALATPay live secret key, live business ID and live webhook secret, entered by you with `wrangler secret put`.
4. ALATPay confirmation of:
   - correct test/live key type
   - test mode enabled for the business
   - product access for virtual accounts and static wallets
   - sandbox base URL
   - auth header format
   - webhook signature scheme and secret
5. SMS provider confirmation of sender ID, DND route and test number, plus `TERMII_API_KEY`.
6. Production owner name, email and password (you type the password).
7. Public contact values:
   - company phone
   - WhatsApp number
   - email
   - head office address
   - social URLs
8. Branch office values for each branch: name, city, state, office type, address, phone and head-office flag.
9. Backup retention and monitoring alert destination.
10. Explicit approval at each gate: sandbox, migration, owner creation, domain, live secrets, live mode, webhook registration, SMS and first real payment.

---

## Assumptions

- Staging remains `PAYMENT_MODE=test`.
- No production resource, secret, domain or database was touched.
- `workflow_status` is separate from the existing sales `status` to avoid breaking existing status semantics.
- Plans remain property-level, not unit-level.
- Internal test client access is granted through the client-property link.
- Existing published properties with zero plans are reported but were not automatically unpublished.
- Real ALATPay sandbox calls were not made because the worker holds the secrets and no approved sandbox transaction was authorized.
- Test suite totals are from the local SQLite/Node and browser harness, not from a production-like load test.
