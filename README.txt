BLISS LEGACY LIMITED — PROPERTY MANAGEMENT PLATFORM

Phases 1–8 are implemented locally on Cloudflare Workers + D1 + R2 + KV + Queues + Static Assets.

Local setup
-----------
1. npm install
2. npm run db:migrate:local
3. SEED_ENV=local python3 seed_phase5.py
4. SEED_ENV=local python3 seed_phase6.py
5. npm run dev
6. Open http://localhost:8787/login.html

Each seed run generates a strong random password per test account and prints it
to the terminal once. Only the password hash is stored; nothing is written to
the repository. The staff emails are:
- md@bliss.com — Managing Director
- bm.ikeja@bliss.com / bm.ajah@bliss.com — Branch Managers
- tl.ikeja@bliss.com / tl.ajah@bliss.com — Team Leads
- mkt.ikeja@bliss.com / mkt.ikeja2@bliss.com / mkt.ajah@bliss.com — Marketers
- finance@bliss.com — Finance Officer
- ada@example.com — Client portal

Main screens
------------
- signup.html — public client self-registration with official logo and auto-login
- dashboard.html — role-aware MD/BM/Team Lead/Marketer/Finance dashboard with commission summaries
- performance.html — date/category-filtered contract, verified, commission, branch, marketer and team analytics
- commissions.html — commission plans, generation, approvals, payments, adjustments and receipts
- reports.html — role-scoped CSV/PDF financial reports stored privately in R2
- staff-management.html — staff accounts, roles, branches, activation and teams (MD/BM)
- leads.html — lead pipeline, follow-ups and conversion
- activity-centre.html — role-scoped audit/activity feed
- clients.html / properties.html / finance-dashboard.html / provider-config.html — Phases 1–5
- client-dashboard.html — client portal with multi-property allocations, verified payments, remaining balance and per-property progress

Tests
-----
- npm run test:phase5  (62 tests)
- npm run test:phase6  (21 tests)
- npm run test:phase7  (26 tests)
- npm run test:phase8  (43 tests)
- npm run test:seed    (5 tests)
- npm run test:browser (3 browser tests; needs Google Chrome)
- npm test              (all suites, 145 tests)

Documentation
-------------
- DEVELOPMENT_PLAN.md
- PHASE6_WALKTHROUGH.md — role-by-role local testing walkthrough
- PHASE7_WALKTHROUGH.md — commission and financial-report walkthrough
- PHASE8_FINAL_AUDIT.md — Phase 8 integration/security audit
- PRODUCTION_READINESS_CHECKLIST.md
- CLOUDFLARE_DEPLOYMENT_GUIDE.md
- API_DOCUMENTATION.md
- SECURITY_AUDIT.md
- KNOWN_LIMITATIONS.md
- BLISS_LEGACY_OPERATIONAL_WORKFLOW.md
- ROLE_AND_ONBOARDING_AUDIT.md

Architecture and safety
-----------------------
- Bindings: DB, FILES, CACHE, TASKS, ASSETS.
- No Supabase, Firebase or alternative primary backend.
- Staging deployment: https://bliss-property.easterntechexpo.workers.dev
- Production deployment: https://bliss-legacy-limited.easterntechexpo.workers.dev
- PWA: installable on iPhone/iPad (Safari → Share → Add to Home Screen) and Android (Chrome → Install app)
- PWA manifest: manifest.json; service worker: sw.js; offline: offline.html
- Logo intro: assets/js/intro-config.js (INTRO_STYLE = hype | classic), assets/js/motion.js, assets/css/motion.css
- ALATPay: Worker secrets ALATPAY_SECRET_KEY and ALATPAY_BUSINESS_ID; client/staff virtual-account endpoints; webhook /api/webhooks/alatpay
- Client onboarding: alternate phone, next-of-kin name/phone/relationship/address and staff referral code
- Staff referrals: unique referral_code on users, referral link /signup?ref=CODE, referred clients remain visible to the referring staff member
- Super Admin: real role, permission-guarded /api/admin routes, configurable role_permissions and admin audit console (super-admin.html)
- Staff notifications: in-app inbox with read/unread state at staff-notifications.html
- Staff chat: Cloudflare Durable Object ChatRoom + WebSockets, persisted to D1 chat_messages, UI at staff-chat.html
- Hierarchical revenue: manager_id hierarchy, Project Manager and Head Accountant roles, immutable payment attribution snapshots, server-scoped /api/revenue APIs and revenue.html drill-down
- Every dashboard shows live "Total paid today" in the signed-in user's revenue scope
- Payment plans: outright, part payment, daily, weekly, bi-monthly, monthly with generated expected schedules
- Defaulting clients view with grace periods, follow-up owner, call notes and statuses
- Lead inspection scheduling, bulk CSV import and inspection counts
- Versioned commission plans with easy-buy commissionable basis and restricted access
- Multi-provider payment adapter layer (ALATPay first, Wema ALAT and Paystack registered)
- Property payment-plan catalogue, onboarding plan choice and purchase-term locking
- Customer Care role with branch/national scope, clearance queue and call history
- SMS provider adapter, templates, opt-out, queued delivery log and credit alerts
- Lead temperature, contact count/last contact and required lost reason
- Client onboarding OTP verification by SMS or email, with staff-assisted and self-service verification
- ALATPay documented webhook validation, transaction monitoring, static wallets and test/live separation
- See PAYMENT_PROVIDER_SECRETS.md, ALATPAY_INTEGRATION.md, SMS_PROVIDER_SETUP.md and CLIENT_OTP_VERIFICATION.md for secret/provider setup
- ALAT/Wema remains an honest placeholder until official credentials and documentation are supplied.
- Email/WhatsApp delivery adapters remain pending; the queue records interface state only.
- There is no separate Super Admin role; the Managing Director is the highest implemented role.
