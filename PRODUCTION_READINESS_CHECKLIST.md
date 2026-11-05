# Bliss Legacy Limited — Production Readiness Checklist

Use this checklist before staging and again before production. Do not tick an item unless the action was actually performed in the target environment.

---

## A. Code and test readiness

- [x] Phase 1–7 functionality preserved.
- [x] Phase 8 integration and security suite added.
- [x] Full local regression suite passes: **145 passed, 0 failed, 0 skipped**.
- [x] JavaScript syntax checks pass.
- [x] Inline HTML scripts syntax-checked.
- [x] `git diff --check` clean.
- [x] No secrets, local databases, logs or temporary audit files in the working tree.
- [x] `.dev.vars` ignored and untracked.
- [x] All nine local migrations reproduce on a clean SQLite database.
- [x] Clean migration database passes integrity and foreign-key checks.
- [ ] Phase 8 changes committed and reviewed.
- [ ] Phase 8 pushed to GitHub after explicit authorization.
- [ ] Staging deployment completed and smoke-tested.

---

## B. Cloudflare resources

- [ ] Create production D1 database and record its ID.
- [ ] Replace `REPLACE_WITH_D1_DATABASE_ID` in production Wrangler configuration.
- [ ] Create production R2 bucket `bliss-legacy-files` (or approved name).
- [ ] Confirm R2 bucket is private.
- [ ] Create production KV namespace and replace `REPLACE_WITH_KV_NAMESPACE_ID`.
- [ ] Create Queue `bliss-legacy-tasks` for producer and consumer.
- [ ] Confirm Workers Static Assets binding `ASSETS` serves only intended files.
- [ ] Confirm `.assetsignore` excludes `src`, `migrations`, tests, docs, `.dev.vars` and local state.
- [ ] Confirm Worker compatibility date and runtime limits.
- [ ] Configure custom domain and DNS.
- [ ] Enable TLS and HTTPS-only access.
- [ ] Configure Cloudflare WAF/rate limiting for public sign-up, login, enquiry and webhook routes.

---

## C. Secrets and environment variables

Production secrets must be set through Wrangler secrets or the Cloudflare dashboard, never committed.

- [ ] `SETUP_SECRET` — strong bootstrap secret; rotate/disable after first MD setup.
- [ ] `ENVIRONMENT=production`.
- [ ] `DEMO_MODE_ENABLED=0`.
- [ ] `EMAIL_PROVIDER` — only when an email adapter is implemented.
- [ ] `WHATSAPP_PROVIDER` — only when a WhatsApp adapter is implemented.
- [ ] Email provider API key/credentials.
- [ ] WhatsApp Business provider token/credentials.
- [ ] ALAT/Wema credentials and webhook signing secret — only from official documentation.
- [ ] Confirm no provider secret is stored in frontend assets or source control.

---

## D. Database and migrations

- [ ] Back up production D1 before migration (export or snapshot).
- [ ] Review migration `0001`–`0009` against production schema.
- [ ] Apply migrations in order with `wrangler d1 migrations apply ... --remote`.
- [ ] Verify `PRAGMA foreign_key_check` / integrity through the approved operational process.
- [ ] Seed roles, branches and property categories using an approved operational script.
- [ ] Create the first MD through `/api/setup` using a temporary bootstrap secret.
- [ ] Remove/rotate `SETUP_SECRET` after initialization.
- [ ] Confirm no demo clients, demo payments or demo receipts exist in production.
- [ ] Confirm `client_properties` allocations are populated for existing clients.
- [ ] Define backup schedule and retention.
- [ ] Test restore into a non-production environment.

---

## E. R2 and file storage

- [ ] Confirm private bucket policy; no public bucket URL is enabled.
- [ ] Verify published property images are served only through the Worker.
- [ ] Verify receipts, commission receipts, reports and property documents cannot be fetched through `/api/files/*`.
- [ ] Verify object lifecycle/retention rules.
- [ ] Decide whether malware scanning is required for staff-uploaded documents.
- [ ] Confirm CORS policy (usually none for private R2).
- [ ] Test document upload/download/delete in staging with real R2.

---

## F. Queues and scheduled jobs

- [ ] Create the Queue and bind producer/consumer.
- [ ] Confirm queue retry/dead-letter policy.
- [ ] Confirm notification delivery records are written.
- [ ] Confirm email/WhatsApp adapters are either implemented or explicitly disabled.
- [ ] Confirm the cron trigger is intended (`0 6 * * *`) and timezone assumptions are approved.
- [ ] Add cleanup jobs for expired sessions/reset tokens if required.
- [ ] Add monitoring for queue backlog and repeated retries.

---

## G. Security operations

- [ ] Run a staging penetration test covering authentication, RBAC, IDOR, file access and financial mutation.
- [ ] Enable Cloudflare WAF and rate limiting.
- [ ] Add CSP, `Referrer-Policy`, `Permissions-Policy` and `X-Content-Type-Options` headers.
- [ ] Review cookie flags on the production domain.
- [ ] Confirm password-reset email delivery or disable the self-service reset until delivery exists.
- [ ] Confirm public signup email verification / CAPTCHA decision.
- [ ] Confirm webhook signature verification against official provider documentation.
- [ ] Review all staff roles and branch assignments.
- [ ] Confirm audit-log retention and access.
- [ ] Confirm no default/demo passwords remain.
- [ ] Confirm provider secrets are rotated from any local/demo values.

---

## H. Financial controls

- [ ] Confirm commission rates are configured and approved by management.
- [ ] Confirm no commission plan is active without management approval.
- [ ] Verify payment verification requires Finance/MD.
- [ ] Verify refunds/reversals require Finance/MD and are audited.
- [ ] Verify contract prices can only be set/changed by MD/BM.
- [ ] Verify marketer and client cannot change contract prices.
- [ ] Verify commission payment idempotency and outstanding liability reconciliation in staging.
- [ ] Verify demo records are excluded from live reports.
- [ ] Confirm ALAT/Wema payouts are not automated until official integration approval.

---

## I. Reporting and exports

- [ ] Verify CSV completeness on production-sized datasets.
- [ ] Verify PDF logo, reference, date, creator, filters and summary.
- [ ] Document the PDF table row cap.
- [ ] Verify report ownership and role scopes.
- [ ] Verify R2 report keys are private and prefix-checked.
- [ ] Verify branch/team/marketer filters return the expected data.
- [ ] Test download after role change or reassignment.

---

## J. UX and accessibility

- [x] 75 local renders at 1440×900, 768×1024 and 390×844 with no document-level horizontal overflow.
- [ ] Repeat visual checks on staging with production assets and live data.
- [ ] Verify mobile drawer navigation on every staff and client page.
- [ ] Verify tables scroll within their containers, not the page.
- [ ] Verify empty, loading and error states with real slow/failed APIs.
- [ ] Verify modals with keyboard and mobile touch.
- [ ] Run automated accessibility checks (axe or equivalent).
- [ ] Confirm official logo and approved brand colours across all pages, receipts and PDFs.

---

## K. Monitoring and incident response

- [ ] Configure Cloudflare analytics/alerts for Worker errors, 5xx rates and latency.
- [ ] Configure alerts for queue backlog and R2 errors.
- [ ] Configure D1 query/error monitoring.
- [ ] Define alert thresholds for repeated login failures, large refunds, manual commission adjustments and report exports.
- [ ] Define incident owner and escalation contact.
- [ ] Document rollback: Worker deployment rollback, D1 restore, R2 object restore and Queue pause.
- [ ] Keep a tested backup restoration runbook.
- [ ] Document provider outage handling (ALAT/Wema, email, WhatsApp).

---

## L. Final go/no-go

- [ ] Staging accepted by business owner.
- [ ] Production secrets and resources verified.
- [ ] D1 backup taken immediately before production migration.
- [ ] Rollback plan approved.
- [ ] Monitoring live before traffic cutover.
- [ ] Final authorization recorded.
- [ ] Deploy only after explicit written authorization.

**Current status:** local Phase 8 complete; staging-ready after review. Not authorized for production deployment.
