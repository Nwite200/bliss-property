# HeadTTS / Kokoro Voice Integration — Delivery Report

Date: 2026-11-10
Status: **implemented, tested, and deployed to staging and production. Server inference is implemented locally but not hosted in production; native Pidgin listening approval remains outstanding.**

---

## 1. What changed

### New voice modules

| File | Purpose |
|---|---|
| `assets/js/voice/voice-adapter.js` | Common adapter contract and result shape |
| `assets/js/voice/headtts-browser.js` | In-browser HeadTTS/Kokoro adapter (WebGPU, WASM fallback) |
| `assets/js/voice/headtts-server.js` | Server HeadTTS adapter through the authenticated Worker |
| `assets/js/voice/voice-selector.js` | Route selection and fallback chain |
| `assets/js/voice/voice-config.js` | Persona-to-voice mapping and model settings |
| `assets/js/voice/pronunciation.js` | Nigerian names, places, currency, abbreviations, Pidgin markers |
| `assets/js/voice/viseme-controller.js` | Viseme timing to mouth overlay and speaking state |
| `assets/js/voice/stt-adapter.js` | Provider-independent STT contract (browser provider today) |
| `assets/vendor/headtts/*` | Official HeadTTS MIT modules and `en-us` dictionary |
| `assets/voice/voices/*.bin` | Nine self-hosted Kokoro voices |
| `voice-server/*` | Independently deployable Node HeadTTS service and auth proxy |
| `tests/voice/voice.test.mjs` | Voice adapter, pronunciation, routing and fallback tests |
| `migrations/0031_headtts_voice_profiles.sql` | Voice profiles, preferences, consent and language mode |

### Modified

- `src/index.js` — HeadTTS provider config, voice profiles, authenticated synthesis proxy, admin approval, Pidgin detection/replies, language preferences.
- `assets/js/digital-human.js` — HeadTTS selector integration, language selector, viseme callback, fallback.
- `assets/css/digital-human.css` — language selector, mouth sync overlay.
- `wrangler.toml` — production assets run through the security wrapper.
- `.assetsignore` / `.gitignore` / `sw.js` — voice asset handling.
- Documentation and test counts.

---

## 2. Persona voice assignments

| Persona | Kokoro voice | Speed | Gender |
|---|---|---|---|
| Adaora | `af_heart` | 0.98 | Female |
| Solomon | `am_fenrir` | 0.97 | Male |
| Chiamaka | `af_bella` | 1.00 | Female |
| Emeka | `am_michael` | 0.96 | Male |
| Amara | `af_nicole` | 0.98 | Female |
| David | `am_puck` | 1.01 | Male |
| Ngozi | `bf_emma` | 0.97 | Female |
| Daniel | `bm_george` | 0.95 | Male |
| Ifeoma | `af_aoede` | 0.97 | Female |

All nine voices are distinct. Assignments are seeded in
`assistant_voice_profiles` and can be approved/changed by an owner through
`POST /api/admin/voice-profiles/:persona`.

---

## 3. Routing and fallback

```
Auto:
  browser WebGPU (only on capable desktop) →
  server HeadTTS (if configured) →
  browser-native speech →
  text only

Manual browser:
  WebGPU/WASM browser → server → native → text

Manual server:
  server → browser → native → text
```

Browser WASM is **not** auto-downloaded on phones or devices without WebGPU,
because the model is hundreds of megabytes. A user can explicitly select
browser mode to force the WASM path.

---

## 4. Browser inference benchmark

Tested in headless Chrome on the development machine with local assets.

| Measurement | Result |
|---|---|
| WebGPU reported | Yes |
| First successful connect + model load | 59.7 s |
| First synthesis | 12.17 s |
| Audio duration | 2.775 s |
| Visemes returned | 25 |
| Model dtype | q8 (fp32 remains available for quality) |
| Second cold attempt | Failed model fetch in the sandbox; browser inference is variable and must be retested on real Chrome/Edge/Safari devices |

This is **not** a production performance sign-off. The browser model is large
and the initial load is heavy. The UI shows loading status and falls back
automatically.

---

## 5. Server inference benchmark

Local Node service, CPU inference, `fp32`, one thread:

| Test | Result |
|---|---|
| Health | 200 |
| Short warm request (`af_heart`, 32 chars) | 1.64 s |
| 4.33 s audio sample, five runs | 3.83, 6.78, 7.26, 8.94, 11.42 s |
| p50 (five runs) | 7.26 s |
| Approx. RTF | 1.67 |
| Model size on disk | ~310 MB fp32; q8 ~86 MB |
| Invalid voice | 400 |
| Missing auth | 401 |
| Anonymous Worker request | 401 |
| Oversized text | 413 |

The Node service uses `@met4citizen/headtts` 1.3.0 and
`@huggingface/transformers` 4.0.0. It warms on first use; production should
pre-warm after deployment to avoid a slow first request.

---

## 6. Nigerian Pidgin

Implemented:

- Automatic Pidgin detection from common markers (`abeg`, `wetin`, `dey`,
  `wan`, `una`, `wahala`, `don`, `fit`, etc.).
- Manual modes: Auto, Pidgin, Nigerian English, International English.
- Persistent `language_mode` per authenticated user and localStorage for
  anonymous visitors.
- Pidgin-to-English intent normalisation before the existing authorisation
  checks.
- Pidgin replies for property search, client portfolio/payments, registration,
  login/reset, form checks, handover, clarification and fallback.
- Context preserved when the user switches language.
- Pidgin pronunciation markers in the speech normalisation layer.
- Browser SpeechRecognition uses `en-NG` in Pidgin mode; the STT adapter is
  provider-independent.

**Not complete:** HeadTTS/Kokoro is documented as English-only. Spoken Pidgin
is produced through English phonetics plus the pronunciation layer, not a
native Pidgin acoustic model. **Native Nigerian Pidgin speaker listening
approval has not been performed.** Whisper-compatible STT is not deployed; the
adapter currently reports `whisperServer: false`. Do not mark Pidgin voice or
Pidgin STT complete until those tests are done.

---

## 7. Security results

- Server synthesis requires an authenticated session (`401` otherwise).
- Invalid persona IDs → 400.
- Text >500 chars → 413.
- Approved-voice allowlist enforced in the Worker and the Node service.
- Node service requires a 24+ character bearer token.
- 30 requests/minute/IP at the service; 30/5 minutes/user at the Worker.
- No raw microphone recordings are stored.
- No request text is logged by the voice service; only duration, status, voice
  and character count.
- The Worker never exposes the service token or server URL to the browser.
- Paid ElevenLabs endpoint is disabled with HTTP 410.
- CSP now uses per-request nonces for inline scripts/styles and
  `script-src-attr 'none'`; `wasm-unsafe-eval` is allowed only because ONNX
  Runtime requires WebAssembly compilation. Bare `'unsafe-eval'` is not allowed.
- Per-session double-submit CSRF token (`bliss_csrf` + `X-CSRF-Token`) is
  enforced for browser-origin state changes.
- Application-level assistant limits remain 60 messages/5 min per user and
  120/5 min per IP.

---

## 8. Tests

| Suite | Result |
|---|---|
| Phase 5 | 62 passed |
| Phase 6 | 21 passed |
| Phase 7 | 26 passed |
| Phase 8 | 75 passed |
| Assistant / multi-property / Pidgin | 44 passed |
| Voice adapters / pronunciation / fallback | 11 passed |
| Seed/wipe security | 5 passed |
| Browser (Chrome) | 6 passed |
| **Total** | **250 passed, 0 failed** |

Voice tests cover normalisation, currency/kobo, nine unique persona voices,
route selection, browser→server fallback, server→native fallback, text mode,
stop/cancel and STT capability without microphone auto-start.

Backend tests cover Pidgin intent routing, Pidgin replies, language switching,
voice profile bootstrap, anonymous/invalid/oversized synthesis rejection and
the disabled paid endpoint.

---

## 9. Dependencies and licences

- HeadTTS — MIT (`assets/vendor/headtts/LICENSE`)
- Kokoro-82M — Apache-2.0
- transformers.js / ONNX Runtime — Apache-2.0
- Nine voice files from `onnx-community/Kokoro-82M-v1.0-ONNX` — Apache-2.0
- `ws` (inside the official Node service) — MIT

No paid voice API is active.

---

## 10. Remaining blockers

1. Real-device browser inference acceptance on Chrome, Edge, Safari and mobile.
2. Deploy the `voice-server/` Node service and set
   `HEADTTS_SERVER_URL` / `HEADTTS_SERVICE_TOKEN` as Worker secrets.
3. Native Nigerian Pidgin speaker approval of spoken samples.
4. Whisper-compatible Pidgin STT evaluation/deployment (not implemented).
5. Server hosting cost and model storage/bandwidth (310 MB fp32 / 86 MB q8).
6. Server hosting for `voice-server/`; production currently has **no** `HEADTTS_SERVER_URL` or `HEADTTS_SERVICE_TOKEN`, so `server_enabled` is false and the browser/native route is used.
7. Migration 0031 and the new assets are deployed. Production currently runs version `1e0da034-ced0-4379-a03e-c0ba8ab0e3a0`; staging runs `05427c9d-0b8f-466e-a333-1c077ed135fd`.
