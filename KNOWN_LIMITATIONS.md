# Bliss Legacy Limited — Known Limitations and Outstanding Work

This is an honest list of what the current implementation does **not** provide. It is not a promise that an earlier plan item is complete.

---

## 1. Organisation and permissions

1. **Super Admin role exists**, with permission-guarded admin routes and a system administration page. It inherits MD business scope for legacy routes; granular permissions apply to `/api/admin/*`.
2. **No staff invitation or approval workflow.** Staff accounts are created with a password and are active immediately.
3. **No employee self-application.** Marketers and other staff cannot apply for an account. Seeded test accounts expire after 14 days and can be wiped with `wipe_test_data.py`.
4. **No email verification** for staff or clients.
5. **No forced first-login password reset.** `users.must_reset_password` is not enforced.
6. **No staff deletion or anonymisation.** Deactivation retains all records.
7. **No branch CRUD UI.** Branches are migration-seeded.
8. **No MD-created MD.** Only the bootstrap setup endpoint creates an MD.
9. **No configurable permission UI for business routes.** The permission matrix currently covers the `/api/admin/*` admin routes; existing business routes retain role-based enforcement.
10. **Staff notifications and chat exist in-app.** Email/WhatsApp delivery is still pending; chat moderation, attachments and retention policy are not implemented.

---

## 2. Public registration and onboarding

1. Public signup creates active Prospect accounts; there is no approval queue.
2. Email verification is not implemented.
3. CAPTCHA/Turnstile is not implemented.
4. Rate limiting uses D1 audit rows; production-scale edge rate limiting/WAF is still required.
5. Password-reset token delivery requires an email adapter that is not implemented.
6. Public enquiries create leads but do not send an acknowledgement email.

---

## 3. Payments and banking

1. **ALATPay dynamic virtual accounts are implemented** and verified live on staging. Permanent static NUBAN provisioning still requires ALATPay BVN/OTP onboarding.
2. No real bank payout or bulk collection reconciliation integration.
3. Provider webhooks use per-provider verification: ALATPay server re-query, Wema shared secret header, Paystack HMAC-SHA512. Additional providers need their own adapter and secret.
4. No automated commission bank payouts.
5. Payment receipts are generated on verification; there is no bank-grade receipt verification service.
6. Payment plans support outright, part payment, daily, weekly, bi-monthly and monthly. Schedule edits regenerate expected items and keep immutable history.
7. Defaulting is calculated on read from the generated schedule and verified payments; it clears automatically on catch-up. It is not a nightly materialised balance table.
8. Commission generation is automatic on every verified payment and idempotent. Failures are flagged for retry, and a dry-run backfill report is available; creating backfill entries still requires owner approval.
9. Commission plan edits create versions, and new versions do not retroactively commission payments from before the version was created.
10. Property payment plans support enabled/disabled catalogues and lock purchase terms at onboarding. Editing a property plan does not migrate existing clients; this is intentional.
11. SMS delivery is adapter-based. Termii is the first production adapter; Africa's Talking is registered as an alternative. Delivery receipts from the provider are not yet ingested, so `delivered` is currently confirmed only by the mock adapter.
12. Customer Care uses a dedicated dashboard and only branch/national client-care scope. It has no commission, lead or finance access.
13. Client OTP verification marks trust status but does not currently block portal access. Login/payment access remains available to unverified clients.
14. Email OTP delivery uses the Resend adapter only; another email provider needs a new adapter and secrets.
15. ALATPay static individual wallets require each client's BVN and OTP. The portal never stores BVN/OTP. Clients can now start and finish wallet activation themselves from the virtual-account page; provisioning still cannot complete without the BVN OTP step.
16. Dynamic amount-specific ALATPay virtual accounts remain enabled. They can be retired after every client has an active static wallet and open balances are reviewed.
17. Real ALATPay sandbox/live delivery still needs dashboard webhook URL registration, test/live secrets and a real test transfer.

---

## 4. Notifications and communication

1. Email delivery adapters are not implemented.
2. WhatsApp delivery adapters are not implemented.
3. Queue consumers record `pending_provider`/`skipped`; they do not send messages.
4. Staff meeting notifications are not a dedicated workflow; the generic staff notification inbox can carry them once an event producer exists.
5. Staff-to-staff and MD/Super Admin-to-staff chat are implemented through `/api/chat` and the `ChatRoom` Durable Object.
6. No chat moderation, attachments, read receipts or retention policy.

---

## 5. Reports and client statements

1. No team-performance report export (dashboard ranking exists).
2. No customer-performance report or “best customer” ranking.
3. No named branch-transactions report export (the finance ledger lists transactions).
4. No client transaction-statement PDF.
5. No client outstanding-balance statement PDF.
6. No separate commission-payments report type; individual commission receipts exist.
7. PDF tables are capped for layout. CSV is the complete dataset.
8. Reports are generated synchronously; `financial_report_jobs` status/error fields are not used for queued retries.

---

## 6. Property and document management

1. No property hard delete; use status/unpublish.
2. No bulk upload.
3. No image reordering UI beyond main-image selection.
4. No malware scanning for uploaded documents.
5. No version history for documents.
6. No client-visible document download by design (internal documents are staff-only).

---

## 7. Analytics

1. Marketer rankings use original marketer/creator attribution, while client visibility and commission attribution use current assignment. This is a policy inconsistency to resolve.
2. Team rankings use team lead/member attribution.
3. No customer ranking.
4. No configurable ranking metric UI.
5. No historical snapshot/ranking trend export.

---

## 8. Security and operations

1. No per-session CSRF token (origin/fetch-metadata/SameSite protections are present).
2. No Content-Security-Policy or full security-header set.
3. No production WAF/rate-limit rules.
4. No external log drain or alerting.
5. No automated backup/restore test.
6. Provider secrets are stored in D1 plaintext; a secret-management decision is required.
7. No documented penetration test against staging.
8. Some older frontend views still interpolate API data without a shared escaping helper.
9. `CACHE` KV is provisioned but currently unused.
10. Cron does not clean expired sessions/reset tokens or retry failed notifications.

---

## 9. Client portal

1. `/api/client/property` returns the primary property only; the dashboard shows all allocations.
2. No client transaction-statement PDF.
3. No client outstanding-balance PDF.
4. Virtual account remains pending until Wema/ALAT is live.
5. No client-to-staff messaging.

---

## 10. Deployment

1. Live deployment currently uses a `workers.dev` URL; no custom domain is attached.
2. Preview URLs are enabled by default in Wrangler.
3. Production secrets beyond `SETUP_SECRET` are not configured.
4. Email/WhatsApp/ALAT credentials are not configured.
5. The live demo accounts are temporary and must be rotated/removed after testing.
6. No formal staging environment separate from the live demo deployment.

---

## 11. Documentation and testing

1. Phase 8 local tests cover the new integration/security paths; a full browser automation suite for every button/modal is not committed.
2. No visual-regression screenshots are committed as a test baseline.
3. No load/performance test against production-sized D1/R2 data.
4. No accessibility audit (axe/WCAG) has been completed.
