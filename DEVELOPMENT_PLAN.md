# Bliss Legacy Limited — Development Plan

## Current state (Phase 1 in progress)

- Static frontend (HTML/CSS/JS) with modular assets.
- Public landing page + property browsing + property details implemented.
- Design system tokens and dashboard foundation classes prepared in `assets/css/styles.css`.
- Official logo used from `assets/images/bliss-legacy-logo.png`.

## Confirmed architecture

- Frontend: static HTML/CSS/JS (no build step). Reusable components in `assets/js/components.js`.
- Data: `assets/js/data/properties.js` (demonstration content; replace with approved listings).
- Config: `window.BLIS_CONFIG` (WhatsApp number, contacts, socials).
- Future backend: introduce a Node.js/Express (or Next.js) API + PostgreSQL for auth, roles, clients, payments, audit logs. Keep frontend consuming REST endpoints.

## Phases

1. Public landing page & property browsing — **in progress / aligned to reference design**.
2. Authentication & role management (MD, BM, Team Lead, Marketer, Client, Finance).
3. MD dashboard.
4. Branch Manager dashboard.
5. Team Lead dashboard.
6. Marketer dashboard & client registration.
7. Client portal & payment tracking.
8. Office finance, virtual accounts & payment integration (Paystack/Monnify webhooks, idempotency).
9. Reporting, commission calculations & audit trails.

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

