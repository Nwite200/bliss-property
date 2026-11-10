# Bliss Legacy Limited — Passkey / WebAuthn Authentication

**Status:** implemented, deployed to staging and production, automated suite passing.
**Real-device biometric acceptance:** pending manual verification (see §8).

This document describes the passkey feature that was added to the existing
Bliss Legacy authentication system. It does **not** replace password login,
sessions, roles or permissions.

---

## 1. Architecture

| Layer | Implementation |
|---|---|
| Server library | `@simplewebauthn/server` 14.1.0, installed as a Worker dependency |
| Worker runtime | Existing Cloudflare Worker (`src/index.js`) with `nodejs_compat` |
| Database | Existing Cloudflare D1 database, migration `0033_passkeys.sql` |
| Browser | Native `navigator.credentials.create()` / `.get()` in `assets/js/passkeys.js` |
| Session | Existing `bliss_session` HttpOnly session and cookie flags |
| Rate limiting | Existing `SENSITIVE_LIMITER` edge binding plus D1 audit-based per-IP failure lockout |
| Frontend | `login.html`, `client-login.html`, `security.html` and the shared staff/client navigation |

No Supabase, Firebase, Vercel, Netlify, Auth0, external biometric API or paid
authentication service is used.

The Worker bundle after adding SimpleWebAuthn is approximately 1.81 MiB
(324 KiB gzip).

---

## 2. Database

Migration: `migrations/0033_passkeys.sql`

### `passkey_credentials`

| Column | Purpose |
|---|---|
| `id` | Internal primary key |
| `user_id` | Owning user, `ON DELETE CASCADE` |
| `credential_id` | WebAuthn credential ID, unique |
| `public_key` | Base64url-encoded public key |
| `counter` | Signature counter |
| `transports` | JSON array reported by the authenticator |
| `device_type` | `singleDevice` or `multiDevice` |
| `backed_up` | Whether the credential is synced/backed up |
| `credential_name` | User-visible device label |
| `created_at` | Registration time |
| `last_used_at` | Last successful authentication time |

Indexes: `(user_id, created_at)` and `(user_id, last_used_at)`.

### `passkey_challenges`

One-time registration/authentication challenges. Stores the challenge,
intended user (nullable for discoverable login), type, RP ID, origin, expiry,
consumption time and creation time. Challenges expire after five minutes and
are consumed before cryptographic verification, which prevents replay.

### Never stored

- Fingerprint images or templates.
- Facial scans or biometric templates.
- Device PINs.
- Private keys.
- Session tokens in browser-readable storage.

Only the public-key credential and WebAuthn metadata are stored.

---

## 3. API endpoints

All POST/PATCH/DELETE requests use the existing CSRF checks and session rules.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/passkey/register/options` | Signed-in user | Create a registration challenge and options |
| `POST /api/passkey/register/verify` | Signed-in user | Verify attestation and store the public key |
| `POST /api/passkey/login/options` | Public | Create a discoverable or identifier-scoped authentication challenge |
| `POST /api/passkey/login/verify` | Public | Verify assertion, then create a normal application session |
| `GET /api/passkeys` | Signed-in user | List the user's credentials (no public key material returned) |
| `PATCH /api/passkeys/:id` | Signed-in user | Rename an owned credential |
| `DELETE /api/passkeys/:id` | Signed-in user + current password | Remove an owned credential |

Registration is always tied to the authenticated session user. A user cannot
register a credential for another account. Removal requires the current password
and verifies ownership.

---

## 4. Login flow

### Existing password login

Unchanged. Password login remains available for every role and is the recovery
path if a passkey is lost.

### Optional enrollment after login

After a successful password login, unless the account must change its password:

1. The browser checks for a platform authenticator.
2. It checks whether the user already has a passkey.
3. If not, an optional prompt offers “Enable now” or “Not now”.
4. “Enable now” requests registration options from the Worker.
5. The browser invokes its native WebAuthn prompt.
6. The Worker verifies the attestation and stores the public key in D1.

Enrollment is never forced.

### Returning passkey login

1. “Continue with Passkey” requests a fresh challenge.
2. The browser invokes the native WebAuthn prompt.
3. The Worker checks:
   - challenge exists, matches the challenge type and belongs to the expected user;
   - challenge has not expired and has not been consumed;
   - stored RP ID and origin match the deployment;
   - `expectedRPID` and `expectedOrigin` match;
   - the signature verifies against the stored public key;
   - user verification is present;
   - the credential belongs to the user;
   - the account is active and not an expired test/monthly-lapsed account.
4. The existing session is replaced and a normal 8-hour `bliss_session` is created.
5. The existing role and permission checks apply exactly as for password login.

The browser reporting “biometric succeeded” is never sufficient on its own.

---

## 5. Roles and permissions

Passkeys are only an authentication method. They do not alter authorization.
After passkey login the user receives the same role, branch scope, permissions
and dashboard as after password login. Financial approvals, contract-price
changes, sensitive reports and role changes continue to use the existing
authorization rules.

Existing password reauthentication requirements remain for sensitive
operations. Passkey removal specifically requires the current account password.

---

## 6. Device management

Page: `security.html` — “Security & Devices”.

Users can:

- See every registered passkey.
- See the device label, single-device/synced state, backup state, creation date,
  last-used date and reported transports.
- Rename a device without reauthentication.
- Remove a device after entering their current password.
- Add another device.
- See an empty state and an unsupported-browser explanation.

The page is available to staff through the “Account → Security & Devices”
sidebar link and to clients through the client sidebar and the client profile
card.

Device labels come from user input or generic browser/platform metadata. The UI
never claims to know whether the authenticator used a fingerprint, face scan or
PIN, because browsers do not expose that reliably.

---

## 7. Security controls

| Requirement | Implementation |
|---|---|
| Cryptographically secure challenges | 32 random bytes from `crypto.getRandomValues` |
| Expiry | Five minutes |
| One-time use | Marked consumed before verification |
| Origin validation | Stored origin and SimpleWebAuthn `expectedOrigin` |
| RP ID validation | Stored RP ID and `expectedRPID` |
| HTTPS in production | Cloudflare production domain; HSTS enabled |
| Signature verification | SimpleWebAuthn server verification |
| User verification | `userVerification: "required"` for registration and login |
| Replay protection | Consumed challenge plus signature counter update |
| Credential ownership | Registration from session; authentication/delete scoped to owner |
| Rate limiting | Edge binding plus 10 failed passkey attempts per IP / 15 minutes |
| Session security | Existing HttpOnly/Secure/SameSite cookie and session rotation |
| CSRF | Existing double-submit token, Origin/Host and Fetch-Metadata checks |
| Safe errors | Generic “Passkey authentication failed” responses |
| Audit logging | registration, rename, deletion, success, failure and lockout |
| No sensitive logging | No private keys, session tokens or biometric data logged |
| Account recovery | Password login/reset remains available |

Production configuration:

```toml
WEBAUTHN_RP_ID = "blisspayment.com.ng"
WEBAUTHN_ORIGIN = "https://blisspayment.com.ng,https://www.blisspayment.com.ng"
```

Staging and local development derive the RP ID and origin from the request host.

---

## 8. Testing

### Automated

- `test_phase8_suite.mjs` — 79 tests, including passkey endpoint authentication,
  CSRF rejection, registration challenge one-time use, unknown credentials,
  expired/replayed challenges, wrong origin/RP ID, cross-user attempts,
  ownership, rename, password reauthentication on removal, password recovery
  and per-IP rate limiting.
- `test_browser.mjs` — 11 Chrome tests, including passkey registration through
  the post-login prompt, device list, rename, discoverable passkey login, role
  preservation, replay rejection, tampered signatures, expired challenges,
  invalid origin/RP ID, unknown credentials, cross-user assertions, multiple
  devices, removal with password reauthentication and password recovery.

The browser tests use Chrome’s CDP virtual authenticator. They validate the
protocol and server logic; they cannot validate physical biometric hardware.

### Manual real-device acceptance checklist

Record device, OS, browser, date and result for each:

- [ ] macOS Safari — Touch ID
- [ ] macOS Chrome — Touch ID
- [ ] macOS Edge — Touch ID / Windows Hello equivalent
- [ ] Windows 11 Chrome — Windows Hello face
- [ ] Windows 11 Edge — Windows Hello fingerprint
- [ ] Windows 11 Edge — Windows Hello PIN
- [ ] iPhone Safari — Face ID
- [ ] iPhone Safari — Touch ID (supported models)
- [ ] iPad Safari — Face ID / Touch ID
- [ ] Android Chrome — fingerprint
- [ ] Android Chrome — device PIN/pattern
- [ ] Android Edge — fingerprint
- [ ] Unsupported browser — graceful message and password fallback
- [ ] Register, rename, sign out, passkey sign-in, remove, add again
- [ ] Lost-device recovery through password login and removal of the lost passkey

Do not mark real-device acceptance complete until these are performed on
physical hardware.

---

## 9. Deployment

Migration `0033_passkeys.sql` was applied to:

- staging D1 `bliss-legacy-staging-db` (`57cbf77c-f99e-4bf7-9a29-0a3e18a8b89a`)
- production D1 `bliss-legacy-production-db` (`91e013cd-6b82-45a7-b1f4-93c8f1b39af2`)

Deployed versions:

- staging Worker `bliss-property`: `194585f9-65a9-4def-9a23-cdaff70c0a96`
- production Worker `bliss-legacy-limited`: `112e3d37-a9ac-4de9-bc20-6aaeedd10f29`

Live verification:

- `GET /api/health` → 200 on staging and production.
- `POST /api/passkey/login/options` on production returns
  `rpId: "blisspayment.com.ng"` for both the apex and `www` hostnames.
- Production login page includes the “Continue with Passkey” control.
- Production `security.html` loads the device-management UI.

### Cost

No new paid subscription. The feature uses the existing Workers, D1, static
assets and rate-limit binding. Additional D1 storage is limited to one public
key and a few metadata fields per device, plus short-lived challenge rows.

### Rollback

1. Deploy the previous Worker version from Cloudflare.
2. Leave migration `0033` in place; the old Worker ignores the new tables.
3. If required, remove the two passkey tables manually after confirming no
   credentials are needed.

---

## 10. Known limitations

1. Real Touch ID, Face ID, Windows Hello and Android fingerprint testing is
   still manual and must be recorded before claiming full production acceptance.
2. The browser controls which authenticator is used; the UI cannot truthfully
   report whether fingerprint, face or PIN was used.
3. Some older browsers do not support discoverable credentials. The login page
   shows a graceful unsupported message and keeps password login available.
4. Passkey metadata such as transports is only as accurate as the browser’s
   WebAuthn implementation.
5. Account recovery still depends on the existing password-reset/SMS/email
   channels; no new insecure recovery shortcut was added.
