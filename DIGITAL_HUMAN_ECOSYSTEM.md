# Bliss Legacy Limited — Digital Human Ecosystem

This document describes the multi-persona, voice-enabled digital assistant and the
client multi-property workflow added to the existing Cloudflare-native platform.
It is an enhancement, not a rebuild: all existing pages, roles, financial
workflows, commission rules, reports and permission boundaries remain in place.

---

## 1. What is implemented

- A persistent assistant on every HTML page (43 pages), available to visitors,
  clients and authorised staff.
- Nine configurable personas with distinct names, departments, genders,
  personalities, voice profiles and professional portrait photos (with a vector fallback).
- Browser-native speech recognition and speech synthesis only. There are no paid
  AI or voice APIs, and no audio is sent to a third party by this application.
- A single continuous conversation across persona changes. History, page
  context, selected property context and user identity are preserved.
- Role-aware dashboard greetings and scoped data access for clients, marketers,
  team leads, branch managers, finance roles and executives.
- Property discovery from real published listings only.
- Lead review restricted by the existing marketer/team/branch scope.
- Verified-payment, commission and handover event announcements from the
  existing notification ledger, with read/unread state and dedupe.
- Form awareness (missing/invalid fields) without reading passwords, BVNs, OTPs
  or other secret values.
- Genuine human handover: a request is created, assigned to an available staff
  member, and only becomes “accepted” when that staff member accepts it.
- Staff availability (`available`, `busy`, `away`) used for handover routing.
- Client self-service multi-property allocation with published payment plans,
  per-property payment accounts, progress and balances.
- Phone-first password recovery for clients (SMS 6-digit code). Email remains
  optional for client registration.

---

## 2. Personas

| Persona | Gender | Portrait | Department | Role | Default for |
|---|---|---|---|---|---|
| **Adaora** | Female | `adaora.jpg` | Client Experience | Main Concierge | Visitors, general routing |
| **Solomon** | Male | `solomon.jpg` | Property Discovery | Property Discovery Specialist | Published property search |
| **Chiamaka** | Female | `chiamaka.jpg` | Sales | Sales Consultant | Sales process and buying questions |
| **Emeka** | Male | `emeka.jpg` | Rentals and Leasing | Rental and Leasing Specialist | Rental/lease questions |
| **Amara** | Female | `amara.jpg` | Client Relations | Client Relations Specialist | Client dashboards and support |
| **David** | Male | `david.jpg` | Lead Intelligence | Lead Intelligence Specialist | Marketer/team lead dashboards |
| **Ngozi** | Female | `ngozi.jpg` | Branch Operations | Branch Operations Specialist | Branch manager dashboards |
| **Daniel** | Male | `daniel.jpg` | Finance | Finance Intelligence Specialist | Finance dashboards |
| **Ifeoma** | Female | `ifeoma.jpg` | Management | Management Intelligence Specialist | MD / Super Admin dashboards |

Personas are defined in `DIGITAL_HUMAN_PERSONAS` in `src/index.js`. Adding a
persona only requires a new entry plus a role/persona mapping; the backend
returns the configuration to the browser. Each persona points at a portrait in
`assets/images/personas/`; the SVG portrait generator remains as an automatic
fallback if an image fails to load.

### Persona transformation

When an intent belongs to another specialist, the backend returns the new
persona and a natural introduction, for example:

> “Let me bring in Solomon, our Property Discovery Specialist.”

The browser then changes the portrait, name, department, voice profile and
available suggestions without clearing the conversation. A user can ask for a
persona by name (“Talk to Adaora”) to return to the concierge.

---

## 3. Voice compatibility

| Capability | Implementation | Notes |
|---|---|---|
| Speech-to-text | `SpeechRecognition` / `webkitSpeechRecognition` | Browser/OS dependent; Chrome/Edge on desktop and Android generally support it. Safari support varies. |
| Hyper-realistic speech | ElevenLabs TTS through the Worker, when `ELEVENLABS_API_KEY` is configured | Returns MP3 audio to the assistant. Falls back to browser speech if the provider is unavailable. |
| Browser fallback speech | `speechSynthesis` with available system voices | Prefers voices containing `Natural`, `Neural`, `Premium` or `Enhanced`. Works offline with local voices. |
| Male/female voice selection | ElevenLabs voice per persona, or scored browser voices | ElevenLabs public default voices are mapped per persona and can be overridden with `ELEVENLABS_VOICE_<PERSONA>`. Browser fallback reports “Nearest available voice” when an exact gender voice is unavailable. |
| Speaking / listening / thinking | CSS states, captions, status label | Approximate mouth movement, not photorealistic lip sync. |
| Interruption | Microphone start cancels speech; “Stop voice” button | Repeat uses the last response. |
| Text-only fallback | Always available | The microphone is disabled with an explanation when unsupported or denied. |
| Reduced motion | `prefers-reduced-motion` rules | Animations are disabled. |

The assistant never autoplays speech before a user interaction, and it does not
announce events aloud while the user is typing or listening.

### Premium voice setup

1. Add the provider key as a production Worker secret:

   ```bash
   npx wrangler secret put ELEVENLABS_API_KEY --env production
   ```

2. Optional per-persona voice IDs:

   ```bash
   npx wrangler secret put ELEVENLABS_VOICE_ADAORA --env production
   npx wrangler secret put ELEVENLABS_VOICE_SOLOMON --env production
   ```

3. Optional model override:

   ```bash
   npx wrangler secret put ELEVENLABS_MODEL_ID --env production
   ```

Without the key, the assistant uses browser speech. With the key, every spoken
reply requests ElevenLabs audio from `/api/assistant/speech`; text is sent to the
voice provider for synthesis. If the provider fails, the same response is spoken
using the browser voice instead.

### Voice honesty

- Nine supplied professional portraits are used, one per persona, in the
  Bliss Legacy green-and-white brand palette.
- Speaking and listening are expressed with subtle photo motion, glow and ring
  states. There is no photorealistic video or perfect lip sync.
- Voice quality depends on the operating system’s installed voices.
- No licensed background music was added. The existing logo intro remains
  visual and can be replayed with `window.BlissMotion.replay()`.

---

## 3b. Team Lead team staffing

When a Branch Manager or MD assigns a team lead, that team lead can open their
dashboard and use **Team members → + Add staff**:

- Lists active marketers in the same branch who are not already on the team.
- Adds selected staff to the team, notifies each added marketer and audits the change.
- The team lead can remove standard members, but cannot remove themselves/ the team lead.
- Cross-branch staff, clients and non-marketers are rejected server-side.
- A different team lead cannot add staff to a team they do not lead; a Branch Manager is limited to their branch; the MD can manage any team.
- Adding a marketer expands the team's normal client/lead visibility rules; it does not change roles or permissions.

## 4. Backend architecture

### Files

| File | Purpose |
|---|---|
| `src/index.js` | Persona registry, intent router, scoped data services, handover and event endpoints, multi-property endpoints |
| `migrations/0030_digital_humans.sql` | Conversations, messages, handovers, event acks, preferences, staff availability |
| `assets/js/digital-human.js` | Global widget, photo/SVG portraits, voice engine, form awareness, event polling, handover UI |
| `assets/images/personas/*.jpg` | Supplied professional persona portraits |
| `assets/css/digital-human.css` | Panel, portraits, animations, responsive layouts |
| `test_assistant_suite.mjs` | 37 backend regression tests |
| `test_browser.mjs` | Browser checks including public voice UI and persona transformation |

### Endpoints

All are same-origin and protected by the existing CSRF checks where state
changes. Sensitive data is resolved server-side with the existing role/branch
scope helpers.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/assistant/bootstrap` | Public/auth bootstrap, personas, greeting, page context, history, handovers, availability |
| POST | `/api/assistant/message` | Intent routing and scoped data response |
| POST | `/api/assistant/preferences` | Mute, voice, rate, pitch, volume, preferred persona |
| GET | `/api/assistant/events` | Unread relevant notifications, excluding already announced events |
| POST | `/api/assistant/events/ack` | Record announcement dedupe keys |
| GET | `/api/assistant/handovers` | Staff handover inbox |
| GET | `/api/assistant/handovers/:id` | Transcript (requester/assigned staff only) |
| POST | `/api/assistant/handovers/:id/accept` | Genuine acceptance by an authorised staff member |
| POST | `/api/assistant/handovers/:id/decline` | Return to the unassigned queue |
| GET | `/api/assistant/handover-status` | Requester’s latest handover state |
| POST | `/api/assistant/availability` | Staff availability for handover routing |

### Intent routing

Routing is deterministic and rule-based. It does not call an LLM. This keeps
the system free to operate and prevents the assistant from inventing records.
Every data reply is generated from a scoped SQL query or an existing helper
(`buildClientPropertyPortfolio`, `resolvePhase6Scope`, `leadScopeSql`,
`getCommissionSummary`, `assistantNotifications`, etc.).

Supported intents include:

- company introduction and capabilities
- property search, property reference lookup, rental routing
- client portfolio, payments, next payment and balance
- applied form checks and onboarding status
- lead review and follow-up review
- verified payments, outstanding transactions and commission summaries
- team, branch and management overviews
- report assistance (links to the authorised reports page; private R2 files are
  never exposed as public URLs)
- notifications and event announcements
- human handover confirmation and status
- persona transfer

---

## 5. Security and privacy

- The assistant never performs financial mutations. It cannot change prices,
  approve commissions, verify payments, reverse payments or grant permissions.
- Contract-price authority remains with the Managing Director and Branch
  Manager through the existing APIs.
- Client property self-service accepts only published properties and published
  payment plans. Extra fields such as `agreed_purchase_price` are ignored.
- Branch managers receive only their branch’s clients, leads, payments and
  branch summaries.
- Marketers receive only their assigned leads and clients.
- Clients can only read their own portfolio, payments, receipts and
  notifications.
- Handover transcripts are readable only by the requester, the assigned staff
  member, the accepting staff member, or an MD/Super Admin.
- Handover is never reported as accepted until the staff member accepts.
- Form awareness sends field names and booleans only; values are never sent.
  Secret field names are excluded from the assistant reply.
- User messages are stored with obvious secret assignments redacted
  (`password`, `OTP`, `PIN`, `BVN`, `CVV`). Audit rows do not store message text.
- Assistant message rate limiting uses audit rows (60 messages per 5 minutes per
  authenticated user/visitor). Production edge/WAF rate limiting is still
  recommended.
- Anonymous visitors can only access published properties and company
  information. They cannot create a handover, read notifications or access
  client data.

---

## 6. Notifications and payment announcements

The existing notification system already creates records for verified payments
(staff marketer/finance recipients and the client) and commission events. The
digital human reads those same notifications:

- unread only
- last seven days
- own `user_id` or own `client_id` only
- no duplicate announcements, using `assistant_event_acks` plus local storage
- visual toast always; optional speech when voice is enabled and the user has
  interacted
- no speech while the user is typing or listening

A payment is announced only when the existing backend has created a
`payment.verified` notification. Pending, failed or unverified transactions do
not produce a success announcement. Duplicate webhooks are already prevented by
the existing payment idempotency rules.

---

## 7. Client multi-property workflow

- Existing `client_properties` allocations remain authoritative for portfolios.
- A client can add a published property from the dashboard (`+ Add another
  property`).
- If the property has enabled payment plans, the client must choose one; the
  price is the published plan total.
- If there is no plan, the published sale/promotional price is used.
- A schedule is generated from the selected plan and tied to that property.
- The client cannot set or approve a contract price.
- `+ Pay for this property` creates a dynamic ALATPay account tied to the
  selected allocation, so the verified payment is attributed to the correct
  property.
- Static wallets remain a general client account and are not property-specific.
  That limitation is documented rather than hidden.
- The portfolio supports up to 10 active properties; duplicates are rejected.
- Internal/demo properties cannot be self-added.
- Branch managers, the assigned marketer and the client receive notifications.

### Password recovery without email

Client phone numbers are the recovery channel:

- `/forgot-password.html` defaults to **Client (phone)**.
- The backend sends a 6-digit SMS code through the configured SMS provider
  (Termii first, Africa’s Talking registered as an alternative, mock in
  non-production).
- Codes are hashed, single-use, expire in 10 minutes and allow 3 attempts.
- A successful reset signs out every session.
- If SMS is unavailable, the page directs the client to customer care.
- Email remains optional at registration and is not required to reset a client
  password.

Staff accounts continue to use the existing email reset path. Staff phone reset
is not implemented because staff records store phone numbers in
`staff_profiles`, not `users.phone_e164`; this is listed as outstanding work.

---

## 8. Tests and verification

| Suite | Result |
|---|---|
| Phase 5 | 62 passed |
| Phase 6 | 21 passed |
| Phase 7 | 26 passed |
| Phase 8 | 75 passed |
| Digital human / multi-property | 40 passed |
| Seed/wipe security | 5 passed |
| Browser (Chrome) | 6 passed |
| **Total** | **235 passed, 0 failed** |

The assistant suite covers anonymous access, published-listing filtering,
client isolation, phone reset guidance, registration/email-optional guidance,
form awareness, onboarding status, persona transfer and context continuity,
multi-property allocation, price-authority enforcement, duplicate/internal
property rejection, cross-client isolation, marketer/lead scope, branch finance
scope, MD management intelligence, handover confirmation/acceptance, transcript
access, event isolation/dedupe, preferences persistence, CSRF rejection,
honest no-match behaviour and global asset injection.

---

## 9. Deployment

The existing Cloudflare architecture is unchanged.

1. Apply the new migration:

   ```bash
   npx wrangler d1 migrations apply bliss-legacy-staging-db --local
   npx wrangler d1 migrations apply bliss-legacy-staging-db --remote
   ```

2. Deploy to staging only after tests pass:

   ```bash
   npx wrangler deploy
   ```

3. Production requires an explicit environment deploy and a final review:

   ```bash
   npx wrangler deploy --env production
   ```

Deployment performed for this phase:

- Migration `0030_digital_humans.sql`: applied to remote staging and production D1 on 2026-11-10.
- Staging Worker: `https://bliss-property.blisslegacyfiles.workers.dev`
- Production live URL: `https://blisspayment.com.ng/` (custom domain attached to the `bliss-legacy-limited` production Worker)
  (version `dc729136-2e84-42f3-a384-8484399cd860`).
- Production still requires external verification: ALATPay live credentials are
  present as Worker secrets, but production SMS (`TERMII_API_KEY` or Africa's
  Talking) is not present, so phone reset reports SMS unavailable until the
  provider secret is added. Confirm webhook callback URLs in the ALATPay
  dashboard match the production hostname.

No new Cloudflare bindings are required. The assistant uses the existing `DB`,
`FILES`, `ASSETS` and `TASKS` bindings.

---

## 10. Acceptance checklist

| # | Requirement | Status |
|---|---|---|
| 1 | Assistant appears throughout the public website | ✅ |
| 2 | Assistant appears across authorised dashboards | ✅ |
| 3 | Adaora welcomes a visitor | ✅ |
| 4 | Users can speak and hear responses with free browser APIs or configured premium voice | ✅ with browser fallback; ElevenLabs key required for hyper-realistic audio |
| 5 | Text fallback works | ✅ |
| 6 | Adaora can introduce Solomon | ✅ |
| 7 | Avatar and voice profile change | ✅ |
| 8 | Conversation context survives persona change | ✅ |
| 9 | Specialists can transfer between each other / back to Adaora | ✅ |
| 10 | Registration guidance works | ✅ |
| 11 | Missing form fields identified | ✅ |
| 12 | Onboarding approval status read accurately | ✅ |
| 13 | Client dashboard greeting | ✅ |
| 14 | Marketer dashboard greeting | ✅ |
| 15 | Team lead dashboard greeting | ✅ |
| 16 | Branch manager dashboard greeting | ✅ |
| 17 | Finance officer dashboard greeting | ✅ |
| 18 | MD executive assistance | ✅ |
| 19 | Super Admin administrative assistance | ✅ |
| 20a | Team lead can add existing branch marketers to their assigned team | ✅ |
| 20b | Cross-branch and non-marketer team additions are blocked | ✅ |
| 20 | Solomon searches actual property records | ✅ |
| 21 | David retrieves only authorised leads | ✅ |
| 22 | Daniel retrieves only authorised finance data | ✅ |
| 23 | Contract pricing restricted to MD/BM | ✅ |
| 24 | Verified customer payments notify staff | ✅ existing + assistant events |
| 25 | Verified client payments notify client | ✅ existing + assistant events |
| 26 | Pending/failed never announced as success | ✅ |
| 27 | Duplicate webhooks do not duplicate announcements | ✅ |
| 28 | Commission notifications respect rules | ✅ |
| 29 | PDF/CSV reporting continues to work | ✅ existing suite |
| 30 | Private R2 reports remain protected | ✅ existing suite; assistant only links |
| 31 | Human handover requires staff acceptance | ✅ |
| 32 | Branch/role restrictions enforced by backend | ✅ |
| 33 | Mute works without breaking the app | ✅ |
| 34 | Mobile/tablet/desktop layouts | ✅ |
| 35 | Existing financial/commission/lead/property workflows | ✅ |
| 36 | Existing regression tests continue to pass | ✅ 235/235 |

Items that remain operational/limitation rather than “done”:

- Photorealistic video and perfect lip sync are not claimed. Portrait photos are used; speaking is indicated by motion/glow, not mouth replacement.
- All nine personas now have unique supplied portraits.
- Browser voice availability is not universal.
- Voice is not connected to a paid LLM; intent routing is deterministic.
- No licensed background instrumental music was added.
- Payment provider live credentials and ALATPay onboarding remain external.
- Staff phone-based password reset is not implemented.
- Production edge rate limiting/WAF is recommended.
