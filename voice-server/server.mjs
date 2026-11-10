import http from "node:http";
import https from "node:https";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG = process.env.HEADTTS_CONFIG || join(ROOT, "headtts-node.json");
const PUBLIC_PORT = Number(process.env.PORT || 8883);
const INTERNAL_PORT = Number(process.env.HEADTTS_INTERNAL_PORT || 8892);
const SERVICE_TOKEN = String(process.env.HEADTTS_SERVICE_TOKEN || "");
const ALLOWED_ORIGIN = String(process.env.HEADTTS_ALLOWED_ORIGIN || "");
const MAX_TEXT = 500;
const MAX_BODY = 8192;
const RATE_LIMIT = { windowMs: 60_000, max: 30, hits: new Map() };

if (!SERVICE_TOKEN || SERVICE_TOKEN.length < 24) {
  console.error("HEADTTS_SERVICE_TOKEN must be set and at least 24 characters.");
  process.exit(1);
}
if (!existsSync(CONFIG)) {
  console.error(`HeadTTS config not found: ${CONFIG}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const PACKAGE_ROOT = join(ROOT, "node_modules", "@met4citizen", "headtts");
const ASSET_ROOT = process.env.HEADTTS_ASSET_ROOT || join(ROOT, "..");
const runtimeConfigPath = join(ROOT, ".cache", "headtts-node.runtime.json");
mkdirSync(join(ROOT, ".cache"), { recursive: true });
const runtimeConfig = JSON.parse(JSON.stringify(config));
runtimeConfig.tts = Object.assign({}, runtimeConfig.tts, {
  dictionaryPath: join(ASSET_ROOT, "assets", "vendor", "headtts", "dictionaries"),
  voicePath: join(ASSET_ROOT, "assets", "voice", "voices")
});
writeFileSync(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2));
const allowedVoices = new Set(config.tts && Array.isArray(config.tts.voices) ? config.tts.voices : []);
const defaultVoice = (config.tts && config.tts.defaults && config.tts.defaults.voice) || "af_heart";

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function clientIp(req) {
  const forwarded = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function allowedByRateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
  const current = RATE_LIMIT.hits.get(key) || { count: 0, reset: now + RATE_LIMIT.windowMs };
  if (now > current.reset) { current.count = 0; current.reset = now + RATE_LIMIT.windowMs; }
  current.count += 1;
  RATE_LIMIT.hits.set(key, current);
  if (RATE_LIMIT.hits.size > 5000) {
    for (const [k, v] of RATE_LIMIT.hits) if (now > v.reset) RATE_LIMIT.hits.delete(k);
  }
  return current.count <= RATE_LIMIT.max;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Request body too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function waitForPort(port, timeoutMs = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`HeadTTS internal service did not start on ${port}`));
        else setTimeout(attempt, 750);
      });
    };
    attempt();
  });
}

const child = spawn(process.execPath, [
  join(PACKAGE_ROOT, "modules", "headtts-node.mjs"),
  "--config", runtimeConfigPath
], { cwd: PACKAGE_ROOT, stdio: ["ignore", "inherit", "inherit"], env: process.env });

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down: ${reason}`);
  try { child.kill("SIGTERM"); } catch (error) { /* ignore */ }
  setTimeout(() => process.exit(0), 500).unref();
}
child.on("exit", (code) => {
  console.error(`HeadTTS inference process exited with ${code}`);
  shutdown("inference process exited");
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await waitForPort(INTERNAL_PORT);
console.log(`HeadTTS inference ready on 127.0.0.1:${INTERNAL_PORT}`);

const server = http.createServer(async (req, res) => {
  if (ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) {
    return json(res, 403, { error: "Origin not allowed" });
  }
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "bliss-headtts", inference: "ready" });
  }
  if (req.method !== "POST" || req.url !== "/v1/synthesize") {
    return json(res, 404, { error: "Not found" });
  }
  const auth = String(req.headers.authorization || "");
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(supplied, SERVICE_TOKEN)) {
    return json(res, 401, { error: "Unauthorized" });
  }
  if (!allowedByRateLimit(req)) {
    return json(res, 429, { error: "Rate limit exceeded" });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    return json(res, error.status || 400, { error: error.status === 413 ? "Request body too large" : "Invalid JSON" });
  }
  const text = String(body.input || "").replace(/\s+/g, " ").trim();
  if (!text) return json(res, 400, { error: "Input text is required" });
  if (text.length > MAX_TEXT) return json(res, 413, { error: `Input text exceeds ${MAX_TEXT} characters` });
  const voice = String(body.voice || defaultVoice);
  if (!allowedVoices.has(voice)) return json(res, 400, { error: "Voice is not approved" });
  if (body.language && body.language !== "en-us") return json(res, 400, { error: "Only en-us is supported by this HeadTTS model" });
  const speed = Math.min(1.3, Math.max(0.7, Number(body.speed || 1) || 1));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  req.on("close", () => { if (!res.writableEnded) controller.abort(); });
  const started = Date.now();
  try {
    const upstream = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/v1/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice, language: "en-us", speed, audioEncoding: "wav" }),
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return json(res, 422, { error: (payload && payload.error) || "Synthesis failed" });
    }
    console.log(`synthesize ${upstream.status} ${Date.now() - started}ms voice=${voice} chars=${text.length}`);
    return json(res, 200, payload);
  } catch (error) {
    if (error.name === "AbortError") return json(res, 499, { error: "Synthesis cancelled" });
    console.error("Inference proxy error:", error.message);
    return json(res, 502, { error: "Inference service unavailable" });
  } finally {
    clearTimeout(timeout);
  }
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(`Bliss HeadTTS proxy listening on :${PUBLIC_PORT}`);
});
