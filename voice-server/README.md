# Bliss Legacy HeadTTS Server

Separate Node.js inference service for the Bliss digital humans. The neural
model is **not** part of the Cloudflare Worker bundle.

## Requirements

- Node.js 20+
- CPU inference by default; optional WebGPU/GPU only after explicit approval
- The Kokoro model is downloaded by `@huggingface/transformers` on first use

## Setup

```bash
cd voice-server
npm install
node scripts/download-voices.mjs
export HEADTTS_SERVICE_TOKEN="$(openssl rand -hex 32)"
npm start
```

The service listens on `http://127.0.0.1:8883` and starts the official HeadTTS
Node REST server on `127.0.0.1:8892`.

## Authentication

Every synthesis request must include:

```http
Authorization: Bearer <HEADTTS_SERVICE_TOKEN>
```

The public proxy also applies:

- 30 requests / minute / IP
- 8 KB body limit
- 500-character text limit
- approved voice allowlist
- 60-second inference timeout and cancellation
- no request-text logging (only duration, status, voice and character count)

## Endpoint

`POST /v1/synthesize`

```json
{
  "input": "Welcome to Bliss Legacy Limited.",
  "voice": "af_heart",
  "language": "en-us",
  "speed": 1,
  "audioEncoding": "wav"
}
```

Returns the HeadTTS REST response: base64 WAV plus `words`, `wtimes`,
`visemes`, `vtimes`, `vdurations` and `phonemes`.

## Cloudflare configuration

Store the service URL and token as Worker secrets:

```bash
npx wrangler secret put HEADTTS_SERVER_URL --env production
npx wrangler secret put HEADTTS_SERVICE_TOKEN --env production
```

`HEADTTS_SERVER_URL` is the public HTTPS URL of this Node service. The Worker
requires an authenticated session and proxies tts requests; it does not expose
the service token to the browser.

## Licences

- HeadTTS: MIT
- Kokoro-82M: Apache-2.0
- transformers.js / ONNX Runtime: Apache-2.0

## Pidgin and language scope

This model is documented as English (`en-us`) only. The Bliss pronunciation
layer handles Nigerian names, places, currency and terms, but spoken Nigerian
Pidgin has **not** been certified by native speakers. Do not mark Pidgin voice
support complete until listening tests are approved.
