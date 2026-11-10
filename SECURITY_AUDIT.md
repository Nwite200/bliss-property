# Bliss Legacy Limited — Phase 8 Security Audit

**Scope:** local Cloudflare Worker, D1 schema, R2 object handling, browser frontend and role model.

**Result:** no unresolved critical or high-severity defect was found in the implemented local system. Several medium issues were fixed during Phase 8. Remaining items are documented as production/operational work, not silently claimed as complete.

---

## 1. Authentication and sessions

### Verified / fixed

| Control | Status |
|---|---|
| Password hashing | PBKDF2-HMAC-SHA-256, 100,000 iterations, random 16-byte salt |
| Password comparison | Derived hash equality check; plaintext is never stored |
| Login identifiers | Email, client reference or phone; normalised input |
| Login throttling | 5 failures per account and 10 per IP in 15 minutes through audit log |
| Session ID | Cryptographically random UUID |
| Session lifetime | 8 hours; expired sessions deleted when presented |
| Cookie flags | `HttpOnly; Secure; SameSite=Lax` |
| Logout | Session row deleted and cookie expired |
| Password change | All other sessions revoked |
| Password reset | Single-use token with one-hour expiry; all sessions revoked |
| Session fixation | Existing browser session is deleted before a new login session is issued |
| Deactivated user | Session lookup rejects inactive users; deactivation deletes sessions |

### Outstanding

- Staff password-reset token delivery depends on an external email provider. The interface currently generates the token but does not send an email.
- Clients without email can reset by SMS 6-digit code to their registered phone (Termii/Africa's Talking adapter, mock outside production).
- Login throttling covers account and IP; a Cloudflare Workers rate-limit binding now adds a per-colo edge layer for login, signup, assistant messages, password reset and webhooks.
- `users.must_reset_password` is enforced for client API access: a client holding a temporary password may only read their profile or change the password until the temporary password is replaced.

---

## 2. Authorization model

Tested directly through API requests:

| Role | Scope verified |
|---|---|
| Managing Director | Company-wide management and finance |
| Branch Manager | Own branch; staff and report scopes restricted |
| Team Lead | Team-scoped clients/leads/commissions; no staff management |
| Marketer | Own/current-assignment clients, leads and commissions only |
| Finance Officer | Company-wide finance and commissions; no staff/lead management |
| Client | Own profile, properties, payments, receipts and notifications only |

Phase 7 reassignment rules remain intact:

- The previous marketer loses client/property/payment visibility when the primary assignment changes.
- A previous cross-branch Branch Manager loses visibility when the client’s branch changes.
- The current relationship manager and current branch retain access.

Property documents and unpublished property images are now explicitly branch-scoped for Branch Managers. Clients cannot download internal documents.

### Outstanding

- The `permissions` / `role_permissions` tables are present but authorization is implemented with role-name checks in the worker. The unused tables should either be removed or wired into a future permission engine; they are not a hidden bypass because no route reads them.
- Team Lead visibility still uses the existing team/created-by attribution model. It was not broadened or narrowed in Phase 8 because that would change a Phase 6 business rule without authorization.

---

## 3. CSRF, origin and request validation

### Fixed / verified

- All browser state-changing routes call `csrfOk` except `/api/setup` (secret header) and the webhook (shared secret header).
- `Origin`/`Host` comparison remains.
- `Sec-Fetch-Site` is now rejected when it is not `same-origin`, `same-site` or `none`.
- Malformed JSON now returns JSON `400` instead of surfacing an unhandled exception.
- Existing tests confirm cross-site Origin requests receive `403`.

### Outstanding

- A per-session double-submit CSRF token is now required for browser-origin state changes (`bliss_csrf` cookie + `X-CSRF-Token` header), in addition to SameSite=Lax, Origin/Host and Fetch-Metadata checks.
- Webhook authentication uses a static shared secret header, not HMAC signing with timestamp/replay protection beyond the existing timestamp window. Official Wema/ALAT signing requirements must be implemented from provider documentation when available.

---

## 4. SQL injection and query safety

- User-controlled values are passed through D1 `.bind(...)` parameters.
- Dynamic SQL fragments are limited to server-controlled field/column lists and validated enums.
- New report filters were added as bound parameters.
- The new public enquiry route and document routes use bound values.
- No string concatenation of untrusted request values into SQL was introduced in Phase 8.

### Outstanding

- A formal query-plan/performance review against production-sized data has not been performed. Existing indexes cover the main foreign keys and common filters.

---

## 5. XSS and output escaping

### Fixed

- Client detail notes, assignment history, status history and property metadata are escaped.
- Client dashboard property titles, locations, categories, references, notices and notifications are escaped.
- Property detail page document filenames are escaped.
- Finance transaction verification actions were converted from interpolated inline JavaScript to data attributes plus event listeners.

### Outstanding

- Some older pages still build HTML from API data without a shared escaping helper. The highest-risk client/staff financial views were repaired, but a full frontend templating review is still advisable before production.
- CSP is now set with per-request nonces, `script-src-attr 'none'`, `frame-ancestors 'none'`, `object-src 'none'`, strict referrer and permissions policies, HSTS and nosniff. `wasm-unsafe-eval` is allowed solely for ONNX/HeadTTS WebAssembly; bare `unsafe-eval` is not allowed.

---

## 6. File and R2 security

### Fixed / verified

- `/api/files/*` only serves keys registered as property images.
- Receipts, reports and property documents are rejected by `/api/files/*`.
- Property documents use the private `property-documents/` prefix and are served only through an authenticated, role-checked download route.
- Documents use `Content-Disposition: attachment` and `Cache-Control: private, no-store`.
- Image and document uploads verify file signatures:
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47`
  - GIF: `GIF8`
  - PDF: `%PDF`
  - WebP: RIFF/WEBP
- Size limits: images 5MB; documents 10MB.
- Filenames are sanitised.
- Unpublished images require staff authorization; cross-branch and Client access are denied.
- Published images receive public caching; unpublished images receive `private, no-store`.
- Receipt and commission-receipt R2 keys are prefix-checked before retrieval.

### Outstanding

- Signed URLs are not used; files are streamed through the Worker after authorization. This is acceptable but should be monitored for large files and Worker CPU/bandwidth limits.
- Malware scanning of uploaded documents is not implemented. If documents are accepted from the public in future, a scanning service should be added. Current document upload is staff-only.

---

## 7. Public signup and enquiry abuse controls

### Implemented locally

- Public signup still creates only Client accounts.
- Self-assigned role, branch, marketer, team lead, contract price and status are ignored.
- Duplicate email and duplicate phone/client record checks remain.
- Registration attempts are rate-limited by IP and email through audit records.
- Public enquiries create leads only, with no staff assignment and no price.
- Enquiries are IP-rate-limited.
- Password reset requests are IP-rate-limited.

### Outstanding

- Email verification is not implemented.
- CAPTCHA/Turnstile is not implemented; Cloudflare Turnstile is the recommended production option.
- Application limits use D1 audit rows and are supplemented by a Cloudflare Workers rate-limit binding. Cloudflare WAF rules are still recommended for volumetric attacks.
- Public enquiry forms do not yet send an acknowledgement email.

---

## 8. Sensitive information exposure

- Provider secrets are stored in D1 `provider_configs` and returned only to authorised MD/Finance calls; they are not embedded in frontend assets.
- `.dev.vars` remains ignored and untracked.
- No production secrets are present in the repository.
- Error responses no longer expose stack traces.
- Demo data remains labelled and excluded from live financial reports.

### Outstanding

- Provider webhook secrets are stored as plaintext D1 values. A production secret manager or encryption-at-rest strategy should be selected by the business.
- The setup endpoint accepts a bootstrap secret; production must rotate/remove it after initialization.

---

## 9. Logging and monitoring

- Login success/failure, client changes, payment verification, reversals, commission workflow, report generation and document operations write audit records.
- Queue delivery attempts are recorded in `notification_deliveries`.
- Webhook events are stored in `webhook_events`.

### Outstanding

- No external log drain or alerting is configured.
- No anomaly alert exists for repeated login failures, large refunds, commission adjustments, report downloads or document downloads.
- Cron only dispatches payment reminders. It does not clean expired sessions/reset tokens or retry failed notifications.

---

## 10. Summary

**Fixed in Phase 8:** session fixation, CSRF fetch-metadata gap, unhandled JSON errors, public enquiry persistence, public enquiry/signup/reset rate limits, property document lifecycle, magic-byte validation, private document R2 isolation, unpublished image cache leakage, receipt key-prefix validation, several frontend XSS vectors, broken auth guards, lead deep links and mobile navigation.

**Still required before production:** provider email/WhatsApp adapters, Wema/ALAT official signing/integration, email verification/Turnstile, Cloudflare WAF rules for volumetric attacks, monitoring/alerting, backup/restore validation and a full penetration test against the deployed staging environment.


---

## 8. Digital human ecosystem (added after Phase 8)

The assistant is a conversational interface over the same authorised backend. It
does not replace the permission system.

Verified controls:

| Control | Status |
|---|---|
| Session/user detection | Existing `getSessionUser` session lookup |
| Role/branch scoping | Existing `resolvePhase6Scope`, `leadScopeSql`, `clientScopeSql`, revenue/branch filters |
| Contract pricing | Assistant cannot set prices; client self-service accepts only published plans |
| Financial mutations | No assistant route verifies, reverses, approves or pays |
| Client portfolio isolation | `/api/client/properties` and payment accounts require the signed-in client |
| Handover | Created only after explicit confirmation; accepted only by an authorised staff member |
| Transcript access | Requester, assigned/accepted staff, or MD/Super Admin |
| Anonymous access | Published properties and company information only; no handover or private data |
| CSRF | All state-changing assistant routes call `csrfOk` |
| Message rate limiting | 60 messages per 5 minutes per authenticated user/visitor through audit rows |
| Secret handling | Form values are never sent; secret field names are excluded; stored messages redact obvious password/OTP/PIN/BVN/CVV assignments; audit rows do not store message text |
| Event isolation | Only the caller's own `user_id`/`client_id` notifications are returned |
| Duplicate announcements | `assistant_event_acks` plus local storage |
| Private R2 files | The assistant only links to `reports.html`; it never returns object URLs |

Outstanding production hardening:

- Edge/WAF rate limiting for anonymous visitors (visitor ids are client-generated).
- The rule-based intent router is not an LLM and will not answer arbitrary natural-language questions outside its supported intents.
- Browser voice availability and voice quality depend on the operating system.


---

## 9. Post-launch security hardening (2026-11-10)

The following controls were added after the initial Phase 8 audit and are covered by
the current 260-test suite:

| Control | Implementation |
|---|---|
| Stored XSS in staff client list | `assets/js/clients.js` now escapes every client-controlled field before `innerHTML` |
| Stored XSS in finance schedule/history views | `finance-dashboard.html` escapes client name, reference, property title, status, receipt reference, history action/author/reason |
| XSS in property selector and feature chips | `signup.html`, `client-register.js` and `property-details.js` escape property/staff text |
| XSS in client dashboard image attributes | Image URL and alt text are escaped before insertion |
| XSS in password-reset phone display | Customer-care phone is escaped before inline markup |
| Clickjacking | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` on every response |
| Script injection surface | CSP uses per-request nonces, blocks inline handlers, frames and objects, and allows only `wasm-unsafe-eval` for HeadTTS; bare `unsafe-eval` is blocked |
| HTTPS downgrade | Production `Strict-Transport-Security` and `upgrade-insecure-requests` |
| Privacy/referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin` |
| Browser feature abuse | `Permissions-Policy` limits camera/geolocation/payment/USB and allows microphone only for self |
| Private API caching | API responses without an explicit cache policy receive `Cache-Control: no-store` |
| Malformed cookie denial | Cookie parsing is exception-safe; a malformed cookie returns 401, not 500 |
| Assistant abuse | Per-user/visitor 60 messages / 5 min and per-IP 120 messages / 5 min; speech 40 requests / 5 min |
| Production header coverage | `run_worker_first = true` for production static assets so HTML/assets pass through the security wrapper |

Remaining hardening work:

- Inline style attributes still use `style-src-attr 'unsafe-inline'`; moving all styling to classes would allow removing it.
- The Cloudflare Workers rate-limit binding is enabled in code. Dashboard-level WAF rules remain recommended for volumetric/DDoS protection.
- The per-session double-submit CSRF token is enforced for browser-origin state changes.
- Add a real RUM/analytics pipeline for security anomaly detection; current observability is Worker logs/audit rows.


---

## 10. Passkey / WebAuthn authentication (2026-11-10)

Passkeys were added additively; password login, sessions, roles and permissions were not replaced.

| Control | Implementation |
|---|---|
| WebAuthn library | `@simplewebauthn/server` 14.1.0, Worker-compatible; bundle ~1.81 MiB / 324 KiB gzip |
| Challenge generation | 32 random bytes via `crypto.getRandomValues` |
| Challenge lifetime | Five minutes; expired challenges rejected |
| Challenge replay | Consumed before verification; a second use is rejected |
| Origin / RP ID | Stored challenge values plus `expectedOrigin` / `expectedRPID`; production pinned to `blisspayment.com.ng` |
| Signature | Verified server-side against the stored public key |
| User verification | Required for registration and authentication |
| Credential ownership | Registration tied to the session user; login/delete scoped to the credential owner |
| Cross-user attempt | Challenge user and credential owner must match |
| Counter | Updated from verified authentication info |
| CSRF | Existing double-submit token, Origin/Host and Fetch-Metadata checks |
| Rate limiting | Edge binding plus 10 failed passkey attempts per IP / 15 minutes |
| Session creation | Existing rotated `bliss_session`; role and account-status checks reused |
| Device removal | Current password required; ownership verified |
| Audit | Register, rename, delete, success, failure, denied removal and lockout |
| Data minimisation | Public key and WebAuthn metadata only; no biometrics, PINs, private keys or session tokens stored or logged |

Automated coverage:

- Phase 8 suite: 79 tests, including passkey registration authorization, CSRF, challenge one-time use, unknown/expired/replayed/wrong-origin/wrong-RP/cross-user assertions, ownership, password reauthentication, password recovery and rate limiting.
- Browser suite: 11 tests using Chrome CDP virtual authenticator for registration, login, role preservation, replay, tampered signature, expired challenge, wrong origin/RP ID, multiple devices, rename, removal and recovery.

Outstanding:

- Physical Touch ID, Face ID, Windows Hello and Android fingerprint acceptance must be performed on real devices and recorded. Virtual authenticators cannot validate biometric hardware.
- Browser UI cannot truthfully reveal whether the authenticator used fingerprint, face or PIN; it reports only the device label and metadata.
- Account recovery still relies on the existing password-reset/SMS/email channels.
