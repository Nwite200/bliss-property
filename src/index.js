const SESSION_COOKIE = "bliss_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

const WEMA_PENDING_MESSAGE =
  "Your dedicated payment account will be available once our Wema Bank payment integration is activated. Please contact our finance team for payment assistance.";
const WEMA_NO_SCHEDULE_MESSAGE =
  "Your next payment information will appear here once your payment schedule has been configured.";
const MIN_PASSWORD_LENGTH = 8;
const SUPPORTED_CURRENCY = "NGN";
const WEBHOOK_MAX_AGE_MS = 15 * 60 * 1000;
const WEBHOOK_FUTURE_SKEW_MS = 2 * 60 * 1000;
const SUCCESS_EVENT_STATUSES = new Set([
  "success", "successful", "completed", "verified", "paid", "approved",
  "payment.success", "payment.successful", "payment.completed",
  "transfer.success", "transfer.successful", "transfer.completed"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("Cookie") || "";
  raw.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `pbkdf2$100000$${saltB64}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
  const expected = parts[3];
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return hash === expected;
}

const IDENTITY_HASH_SALT = "bliss-legacy-identity-v1:";

function normalizeIdentityType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return {
    "nin": "NIN",
    "national identification number": "NIN",
    "national id": "NIN",
    "international passport": "International Passport",
    "passport": "International Passport",
    "driver's license": "Driver's License",
    "drivers license": "Driver's License",
    "driver licence": "Driver's License",
    "permanent voter's card": "Permanent Voter's Card",
    "voter's card": "Permanent Voter's Card",
    "voters card": "Permanent Voter's Card",
    "pvc": "Permanent Voter's Card"
  }[raw] || null;
}

function cleanIdentityNumber(value) {
  return String(value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function validateIdentityNumber(type, value) {
  const raw = cleanIdentityNumber(value);
  if (!raw) return "Identity number is required";
  if (type === "NIN" && !/^\d{11}$/.test(raw)) return "NIN must be exactly 11 digits";
  if (type === "International Passport" && !/^[A-Z0-9]{6,12}$/.test(raw)) return "Passport number is invalid";
  if (type === "Driver's License" && !/^[A-Z0-9]{6,20}$/.test(raw)) return "Driver's licence number is invalid";
  if (type === "Permanent Voter's Card" && !/^[A-Z0-9]{10,20}$/.test(raw)) return "Voter's card number is invalid";
  return null;
}

function maskIdentityNumber(value) {
  const raw = cleanIdentityNumber(value);
  if (!raw) return null;
  if (raw.length <= 4) return "*".repeat(raw.length);
  return `${raw.slice(0, 2)}${"*".repeat(Math.max(2, raw.length - 6))}${raw.slice(-4)}`;
}

async function hashIdentityNumber(value) {
  const bytes = new TextEncoder().encode(IDENTITY_HASH_SALT + cleanIdentityNumber(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function cleanBvn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

function newSessionId() {
  return crypto.randomUUID();
}

async function createSession(env, userId) {
  const id = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires)
    .run();
  return { id, expires };
}

async function getSessionUser(env, request) {
  const cookies = parseCookies(request);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = await env.DB.prepare(
    "SELECT s.id AS sid, s.expires_at, u.id, u.email, u.full_name, u.role_id, u.branch_id, u.is_active, u.referral_code, u.commission_access, u.property_plans_access, u.sms_access, u.care_scope, r.name AS role_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.id=?"
  ).bind(sid).first();
  if (!row) return null;
  if (parseDbDate(row.expires_at) < new Date()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    return null;
  }
  if (!row.is_active) return null;
  // Super Admin inherits the MD business scope for existing routes, but keeps
  // its actual role for the admin permissions API and UI.
  row.actual_role_name = row.role_name;
  if (row.role_name === "Super Admin") row.role_name = "Managing Director";
  else if (row.role_name === "Project Manager") row.role_name = "Branch Manager";
  else if (row.role_name === "Head Accountant") row.role_name = "Finance Officer";
  return row;
}

async function roleHasPermission(env, roleId, permission) {
  const row = await env.DB.prepare(`
    SELECT rp.role_id FROM role_permissions rp
    JOIN permissions p ON p.id=rp.permission_id
    WHERE rp.role_id=? AND p.name=?
  `).bind(roleId, permission).first();
  return Boolean(row);
}

async function audit(env, actorId, action, targetType, targetId, metadata, branchId) {
  let resolvedBranchId = branchId === undefined ? null : branchId;
  if (branchId === undefined && actorId) {
    const actor = await env.DB.prepare("SELECT branch_id FROM users WHERE id=?").bind(actorId).first();
    resolvedBranchId = actor ? actor.branch_id : null;
  }
  await env.DB.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, branch_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    actorId,
    action,
    targetType,
    targetId,
    metadata ? JSON.stringify(metadata) : null,
    resolvedBranchId
  ).run();
}

function csrfOk(request) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

function sanitizeFilename(name, fallback = "document") {
  const base = String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 160);
  return base || fallback;
}

function detectFileType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
}

async function recentAuditCount(env, action, targetId, minutes) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE action=? AND target_id=? AND created_at >= datetime('now', ?)"
  ).bind(action, targetId, `-${minutes} minutes`).first();
  return row ? Number(row.c || 0) : 0;
}

function referralCodeCandidate() {
  return "BL-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function allocateReferralCode(env) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = referralCodeCandidate();
    const existing = await env.DB.prepare("SELECT id FROM users WHERE referral_code=?").bind(code).first();
    if (!existing) return code;
  }
  return "BL-" + Date.now().toString(36).toUpperCase().slice(-8);
}

async function resolveReferralStaff(env, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return null;
  return env.DB.prepare(`
    SELECT u.id, u.full_name, u.branch_id, u.referral_code, r.name AS role_name
    FROM users u JOIN roles r ON r.id=u.role_id
    WHERE UPPER(u.referral_code)=? AND u.is_active=1 AND r.name<>'Client'
    LIMIT 1
  `).bind(code).first();
}

async function inferManagerId(env, roleName, branchId, teamId) {
  if (roleName === "Super Admin") return null;
  if (roleName === "Head Accountant") {
    const md = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE r.name='Managing Director' AND u.is_active=1 ORDER BY u.id LIMIT 1
    `).first();
    return md ? md.id : null;
  }
  if (["Project Manager", "Branch Manager"].includes(roleName)) {
    const md = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE r.name='Managing Director' AND u.is_active=1 ORDER BY u.id LIMIT 1
    `).first();
    return md ? md.id : null;
  }
  if (roleName === "Team Lead") {
    const bm = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE r.name IN ('Project Manager','Branch Manager') AND u.branch_id=? AND u.is_active=1
      ORDER BY u.id LIMIT 1
    `).bind(branchId).first();
    return bm ? bm.id : null;
  }
  if (teamId) {
    const team = await env.DB.prepare("SELECT team_lead_user_id FROM teams WHERE id=? AND is_active=1").bind(teamId).first();
    if (team && team.team_lead_user_id) return team.team_lead_user_id;
  }
  const bm = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name IN ('Project Manager','Branch Manager') AND u.branch_id=? AND u.is_active=1
    ORDER BY u.id LIMIT 1
  `).bind(branchId).first();
  return bm ? bm.id : null;
}

async function buildReferralAttribution(env, referrer, fallbackUserId) {
  const headOffice = await env.DB.prepare(
    "SELECT id FROM branches ORDER BY CASE WHEN name='Head Office' THEN 0 ELSE 1 END, id LIMIT 1"
  ).first();
  const branchId = referrer && referrer.branch_id ? referrer.branch_id : (headOffice ? headOffice.id : null);
  let teamLeadId = null;
  if (referrer && referrer.role_name === "Team Lead") teamLeadId = referrer.id;
  if (referrer && referrer.role_name === "Marketer") {
    const team = await env.DB.prepare(`
      SELECT t.team_lead_user_id FROM teams t
      JOIN team_members tm ON tm.team_id=t.id
      WHERE tm.user_id=? AND t.is_active=1 AND t.team_lead_user_id IS NOT NULL
      ORDER BY t.id LIMIT 1
    `).bind(referrer.id).first();
    teamLeadId = team ? team.team_lead_user_id : null;
  }
  const assignedToReferrer = Boolean(referrer);
  return {
    branchId,
    teamLeadId,
    relationshipManagerId: assignedToReferrer ? referrer.id : fallbackUserId,
    originalMarketerId: referrer && referrer.role_name === "Marketer" ? referrer.id : fallbackUserId,
    referredByStaffId: referrer ? referrer.id : null,
    referralCodeUsed: referrer ? referrer.referral_code : null
  };
}

const ALATPAY_DEFAULT_BASE = "https://apibox.alatpay.ng";

function getPaymentMode(env) {
  return String(env.PAYMENT_MODE || "test").trim().toLowerCase() === "live" ? "live" : "test";
}

function alatpayWebhookPath(env, mode) {
  return `/api/webhooks/alatpay/${mode || getPaymentMode(env)}`;
}

async function getAlatpaySettings(env, modeOverride) {
  const mode = modeOverride === "live" ? "live" : (modeOverride === "test" ? "test" : getPaymentMode(env));
  const prefix = mode === "live" ? "ALATPAY_LIVE" : "ALATPAY_TEST";
  const row = await env.DB.prepare(
    "SELECT status, environment, config_json FROM provider_configs WHERE provider_key='wema_alat'"
  ).first();
  let config = {};
  if (row && row.config_json) {
    try { config = JSON.parse(row.config_json) || {}; } catch { config = {}; }
  }
  const secret = env[`${prefix}_SECRET_KEY`] || "";
  const businessId = env[`${prefix}_BUSINESS_ID`] || "";
  const webhookSecret = env[`${prefix}_WEBHOOK_SECRET`] || "";
  const baseUrl = String(env[`${prefix}_BASE_URL`] || env.ALATPAY_BASE_URL || config.base_url || ALATPAY_DEFAULT_BASE).replace(/\/+$/, "");
  return {
    row,
    config,
    mode,
    secret,
    businessId,
    webhookSecret,
    baseUrl,
    ready: Boolean(secret && businessId),
    webhookReady: Boolean(webhookSecret),
    status: secret && businessId ? "Configured" : (secret ? "Awaiting business ID" : "Awaiting credentials"),
    providerName: "ALATPay by Wema Bank",
    webhookPath: `/api/webhooks/alatpay/${mode}`
  };
}

async function alatpayRequest(env, path, options = {}) {
  const settings = await getAlatpaySettings(env, options.mode);
  if (!settings.secret) {
    throw Object.assign(new Error(`ALATPay ${settings.mode} secret key is not configured`), { status: 503 });
  }
  let response;
  try {
    response = await fetch(settings.baseUrl + path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": settings.secret
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    throw Object.assign(new Error("Unable to reach ALATPay"), { status: 503 });
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok || payload.status === false) {
    throw Object.assign(new Error(payload.message || `ALATPay request failed (${response.status})`), {
      status: response.status === 401 || response.status === 403 ? 502 : 502,
      payload
    });
  }
  return payload.data === undefined ? payload : payload.data;
}

async function hmacBase64(secret, message, hash = "SHA-256") {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message || "")));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function hmacHex(secret, message, hash = "SHA-512") {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message || "")));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const PAYMENT_PROVIDER_ADAPTERS = {
  alatpay: {
    key: "alatpay",
    name: "ALATPay by Wema Bank",
    requiresConfig: false,
    webhookPath: "/api/webhooks/alatpay/test",
    async createVirtualAccount(env, client, amountKobo, actorId) {
      return createAlatpayVirtualAccount(env, client, amountKobo, actorId);
    },
    async createStaticWallet(env, client, bvn, actorId) {
      return initiateAlatpayStaticWallet(env, client, bvn, actorId);
    },
    async validateStaticWallet(env, client, otp, actorId) {
      return validateAlatpayStaticWallet(env, client, otp, actorId);
    },
    async verifyTransaction(env, reference, mode) {
      return alatpayRequest(env, `/alatpaytransaction/api/v1/transactions/${encodeURIComponent(reference)}`, { mode });
    },
    async verifyWebhook(env, request, body, rawText, mode) {
      const settings = await getAlatpaySettings(env, mode);
      if (!settings.webhookSecret) {
        throw Object.assign(new Error(`ALATPay ${settings.mode} webhook secret is not configured`), { status: 503 });
      }
      const supplied = request.headers.get("x-signature") || "";
      const expected = await hmacBase64(settings.webhookSecret, rawText || JSON.stringify(body), "SHA-256");
      if (!secureCompare(supplied, expected)) {
        throw Object.assign(new Error("Invalid webhook signature"), { status: 401 });
      }
      const envelope = body.Value || body;
      const data = envelope.Data || body.Data || body.data || body;
      const transactionId = data.Id || data.id || data.TransactionId || data.transactionId;
      if (!transactionId) throw Object.assign(new Error("Missing ALATPay transaction ID"), { status: 400 });
      const remote = await this.verifyTransaction(env, transactionId, settings.mode);
      return { remote, transactionId, data, settings };
    },
    normalizeEvent(body, verification) {
      const data = verification.remote.data || verification.remote;
      const source = verification.data || body.data || body;
      const statusText = String(data.status || data.Status || source.Status || source.status || "").trim().toLowerCase();
      const orderId = data.orderId || data.OrderId || source.orderId || source.OrderId || body.orderId;
      const amountKobo = data.amount !== undefined ? toKobo(data.amount)
        : (data.Amount !== undefined ? toKobo(data.Amount) : null);
      const currency = String(data.currency || data.Currency || source.Currency || source.currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      const transactionId = verification.transactionId;
      return {
        providerKey: "alatpay",
        eventId: `alatpay:${verification.settings ? verification.settings.mode : getPaymentMode({})}:${transactionId}:${statusText}:${amountKobo}`,
        eventType: statusText,
        reference: orderId,
        providerReference: transactionId,
        amountKobo,
        currency,
        success: SUCCESS_EVENT_STATUSES.has(statusText),
        occurredAt: data.updatedAt || data.UpdatedAt || data.createdAt || data.CreatedAt || null,
        payload: { body, remote: verification.remote }
      };
    }
  },
  wema_alat: {
    key: "wema_alat",
    name: "ALAT by Wema Bank",
    requiresConfig: true,
    webhookPath: "/api/webhooks/wema-alat",
    async verifyWebhook(env, request, body) {
      const conf = await env.DB.prepare("SELECT status, webhook_secret FROM provider_configs WHERE provider_key='wema_alat'").first();
      if (!conf || !["Configured", "Active"].includes(conf.status)) {
        throw Object.assign(new Error("Wema ALAT integration is not configured"), { status: 503 });
      }
      if (!conf.webhook_secret) {
        throw Object.assign(new Error("Webhook verification is not configured"), { status: 503 });
      }
      const supplied = request.headers.get("X-Webhook-Secret") || "";
      if (!secureCompare(supplied, conf.webhook_secret)) {
        throw Object.assign(new Error("Invalid webhook signature"), { status: 401 });
      }
      return { conf };
    },
    normalizeEvent(body) {
      const data = body.data || {};
      const txRef = data.transaction_reference || data.tx_ref;
      const amountKobo = data.amount_kobo !== undefined
        ? Number(data.amount_kobo)
        : (data.amount !== undefined ? toKobo(data.amount) : null);
      const currency = String(data.currency || body.currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      const statusText = String(data.status || body.status || body.event || "").trim().toLowerCase();
      const eventId = String(body.id || body.event_id || data.event_id || `${txRef}:${statusText}:${amountKobo || 0}`);
      return {
        providerKey: "wema_alat",
        eventId,
        eventType: body.event || statusText,
        reference: txRef,
        providerReference: data.provider_reference || data.transaction_id || txRef,
        amountKobo,
        currency,
        success: SUCCESS_EVENT_STATUSES.has(statusText),
        statusText,
        occurredAt: body.timestamp ?? body.created_at ?? body.event_time ??
          data.timestamp ?? data.created_at ?? data.event_time,
        requireTimestamp: true,
        payload: body
      };
    }
  },
  paystack: {
    key: "paystack",
    name: "Paystack",
    requiresConfig: true,
    webhookPath: "/api/webhooks/paystack",
    async verifyWebhook(env, request, body, rawText) {
      const conf = await env.DB.prepare("SELECT status, webhook_secret, config_json FROM provider_configs WHERE provider_key='paystack'").first();
      if (!conf || !["Configured", "Active"].includes(conf.status)) {
        throw Object.assign(new Error("Paystack integration is not configured"), { status: 503 });
      }
      let config = {};
      try { config = conf.config_json ? JSON.parse(conf.config_json) : {}; } catch { config = {}; }
      const secret = env.PAYSTACK_SECRET_KEY || config.secret_key || conf.webhook_secret;
      if (!secret) throw Object.assign(new Error("Paystack webhook secret is not configured"), { status: 503 });
      const supplied = request.headers.get("x-paystack-signature") || "";
      const expected = await hmacHex(secret, rawText || JSON.stringify(body));
      if (!secureCompare(supplied, expected)) {
        throw Object.assign(new Error("Invalid webhook signature"), { status: 401 });
      }
      return { conf };
    },
    normalizeEvent(body) {
      const data = body.data || {};
      const eventName = String(body.event || data.status || "").toLowerCase();
      const amountKobo = data.amount !== undefined ? Number(data.amount) : null;
      return {
        providerKey: "paystack",
        eventId: `paystack:${data.id || data.reference}:${eventName}`,
        eventType: eventName,
        reference: data.reference,
        providerReference: data.id ? String(data.id) : data.reference,
        amountKobo,
        currency: String(data.currency || "NGN").toUpperCase(),
        success: eventName === "charge.success",
        statusText: eventName,
        occurredAt: data.paid_at || data.created_at || body.created_at || null,
        payload: body
      };
    }
  }
};

function getPaymentProviderAdapter(key) {
  return PAYMENT_PROVIDER_ADAPTERS[String(key || "").trim().toLowerCase()] || null;
}

async function getDefaultPaymentProvider(env) {
  const row = await env.DB.prepare("SELECT provider_key, adapter_key FROM provider_configs WHERE is_default=1 ORDER BY provider_key LIMIT 1").first();
  if (row) return row.adapter_key || row.provider_key;
  return "wema_alat";
}

async function createAlatpayVirtualAccount(env, client, amountKobo, actorId) {
  const settings = await getAlatpaySettings(env);
  if (!settings.ready) {
    const error = new Error(settings.businessId
      ? "ALATPay secret key is not configured"
      : "ALATPay business ID is not configured. Add it in Payment Provider settings.");
    error.status = 503;
    throw error;
  }
  const amount = Number(amountKobo) / 100;
  if (!Number.isFinite(amount) || amount < 100) {
    throw Object.assign(new Error("ALATPay requires a payment amount of at least ₦100"), { status: 400 });
  }
  const parts = String(client.full_name || "Bliss Client").trim().split(/\s+/);
  const firstName = parts.shift() || "Bliss";
  const lastName = parts.join(" ") || "Client";
  const orderId = "BL-" + String(client.client_reference || client.id) + "-" + Date.now().toString(36).toUpperCase();
  const payload = {
    businessId: settings.businessId,
    amount,
    currency: "NGN",
    orderId,
    description: "Bliss Legacy property payment",
    customer: {
      email: client.email_address || env.ALATPAY_DEFAULT_EMAIL || "hrblisslegacy@gmail.com",
      phone: client.phone_number || "",
      firstName,
      lastName,
      metadata: JSON.stringify({ client_id: client.id, client_reference: client.client_reference })
    }
  };
  const data = await alatpayRequest(env, "/bank-transfer/api/v1/bankTransfer/virtualAccount", {
    method: "POST",
    body: payload
  });
  const accountNumber = data.virtualBankAccountNumber || data.accountNumber ||
    data.virtualAccountNumber || data.account_number || data.accountNo;
  if (!accountNumber) {
    throw Object.assign(new Error("ALATPay did not return a virtual account number"), { status: 502 });
  }
  const transactionId = data.transactionId || data.transaction_id || null;
  const bankName = data.bankName || data.bank_name || "Wema Bank";
  const accountName = clientVirtualAccountName(client);
  const expiresAt = data.expiredAt || data.expiresAt || null;
  await env.DB.prepare(`
    INSERT INTO virtual_accounts
      (client_id, provider, provider_key, bank_name, account_name, account_number, account_status,
       provider_reference, transaction_id, order_id, expires_at, amount_kobo, metadata, updated_by, updated_at, payment_mode)
    VALUES (?, 'alatpay', 'alatpay', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(client_id) DO UPDATE SET
      provider='alatpay', provider_key='alatpay', bank_name=excluded.bank_name, account_name=excluded.account_name,
      account_number=excluded.account_number, account_status='active',
      provider_reference=excluded.provider_reference, transaction_id=excluded.transaction_id,
      order_id=excluded.order_id, expires_at=excluded.expires_at, amount_kobo=excluded.amount_kobo,
      metadata=excluded.metadata, updated_by=excluded.updated_by, updated_at=datetime('now'),
      payment_mode=excluded.payment_mode
  `).bind(
    client.id, bankName, accountName, String(accountNumber), transactionId || String(accountNumber),
    transactionId || null, orderId, expiresAt, Number(amountKobo),
    JSON.stringify({ response: data, request: payload }).slice(0, 5000), actorId || null, settings.mode
  ).run();
  await audit(env, actorId || null, "provider.virtual_account.create", "client", String(client.id), {
    provider: "alatpay", order_id: orderId, transaction_id: transactionId, amount_kobo: Number(amountKobo)
  }, client.assigned_branch_id);
  return {
    provider: "ALATPay by Wema Bank",
    payment_mode: settings.mode,
    bank_name: bankName,
    account_name: accountName,
    account_number: String(accountNumber),
    account_status: "active",
    transaction_id: transactionId,
    order_id: orderId,
    expires_at: expiresAt,
    amount_kobo: Number(amountKobo)
  };
}


async function finalizeAlatpayCredit(env, payment, remoteData, mode, reference) {
  if (!payment) return { skipped: true, reason: "payment_missing" };
  if (payment.status === "verified") return { skipped: true, reason: "already_verified" };
  if (payment.status !== "pending") return { skipped: true, reason: "not_pending" };
  const amountKobo = remoteData?.Amount !== undefined ? toKobo(remoteData.Amount)
    : (remoteData?.amount !== undefined ? toKobo(remoteData.amount) : Number(payment.amount_kobo || 0));
  const transactionId = remoteData?.Id || remoteData?.id || payment.provider_reference || payment.transaction_ref;
  const accountNumber = remoteData?.NgnVirtualBankAccountNumber || remoteData?.ngnVirtualBankAccountNumber || payment.provider_account_number || null;
  const now = new Date().toISOString();
  const updated = await env.DB.prepare(`
    UPDATE payments SET status='verified', verified_at=?, verified_by=NULL, provider='alatpay',
      provider_reference=?, provider_account_number=?, payment_mode=? WHERE id=? AND status='pending'
  `).bind(now, String(transactionId), accountNumber ? String(accountNumber) : null, mode, payment.id).run();
  if (!updated.meta || Number(updated.meta.changes) === 0) return { skipped: true, reason: "already_verified" };
  await stampPaymentAttribution(env, payment.id, payment.client_id);
  const client = await env.DB.prepare("SELECT id, agreed_purchase_price FROM clients WHERE id=?").bind(payment.client_id).first();
  const totalRow = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount_kobo),0) AS total_kobo FROM payments
    WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
  `).bind(payment.client_id).first();
  const remainingKobo = Math.max(0, toKobo(client?.agreed_purchase_price || 0) - Number(totalRow ? totalRow.total_kobo : 0));
  let receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
  if (!receipt) {
    const receiptRef = newReceiptRef(false);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo, remaining_balance_kobo, is_demo, created_at)
      VALUES (?, ?, ?, ?, 'NGN', ?, ?, 0, datetime('now'))
    `).bind(payment.id, payment.client_id, receiptRef, fromKobo(amountKobo), amountKobo, remainingKobo).run();
    receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
  }
  await ensureReceiptPdf(env, { ...payment, ...receipt, payment_status: "verified", payment_date: now }).catch(() => {});
  await createNotification(env, {
    clientId: payment.client_id,
    type: "payment.verified",
    title: "Payment Successfully Verified",
    message: `Your ALATPay payment of ${formatNGN(amountKobo)} has been verified. Official Receipt #${receipt.receipt_ref} is now available.`,
    metadata: { payment_id: payment.id, receipt_ref: receipt.receipt_ref, reference, source: "alatpay_reconciliation", mode }
  });
  await notifyPaymentVerified(env, payment, null);
  await sendPaymentReceivedSms(env, payment.id);
  await autoGenerateCommissionForPayment(env, payment);
  await audit(env, null, "payment.reconciled", "payment", String(payment.id), { provider: "alatpay", mode, reference, amount_kobo: amountKobo });
  return { ok: true, payment_id: payment.id, receipt_ref: receipt.receipt_ref };
}

async function reconcileAlatpayPayments(env) {
  const mode = getPaymentMode(env);
  const settings = await getAlatpaySettings(env, mode);
  if (!settings.ready) return { skipped: true, reason: "not_configured", mode };
  let payload;
  try {
    payload = await alatpayRequest(env,
      `/alatpaytransaction/api/v1/transactions?BusinessId=${encodeURIComponent(settings.businessId)}&Page=1&Limit=100&Status=completed`,
      { mode });
  } catch (error) {
    return { error: error.message || "Unable to list ALATPay transactions", mode };
  }
  const rows = Array.isArray(payload) ? payload : (payload?.data || payload?.transactions || []);
  const results = [];
  for (const remote of rows) {
    const transactionId = remote.Id || remote.id || remote.TransactionId || remote.transactionId;
    const orderId = remote.OrderId || remote.orderId || transactionId;
    if (!transactionId) continue;
    const accountNumber = remote.NgnVirtualBankAccountNumber || remote.ngnVirtualBankAccountNumber || null;
    let payment = await env.DB.prepare(`
      SELECT p.* FROM payments p WHERE p.provider='alatpay' AND p.payment_mode=?
        AND (p.transaction_ref=? OR p.provider_reference=?)
      ORDER BY p.id DESC LIMIT 1
    `).bind(mode, String(orderId), String(transactionId)).first();
    if (!payment && accountNumber) {
      const wallet = await env.DB.prepare("SELECT * FROM client_static_wallets WHERE account_number=? AND payment_mode=? AND status='active'")
        .bind(String(accountNumber), mode).first();
      if (wallet) {
        const client = await env.DB.prepare("SELECT id, interested_property_id FROM clients WHERE id=? AND is_deleted=0").bind(wallet.client_id).first();
        if (client) {
          const inserted = await env.DB.prepare(`
            INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo,
              is_demo, provider, provider_reference, provider_account_number, payment_mode)
            VALUES (?, ?, ?, ?, 'NGN', 'ALATPay Static Wallet', 'pending', ?, 0, 'alatpay', ?, ?, ?)
          `).bind(client.id, client.interested_property_id || null, String(orderId), fromKobo(toKobo(remote.Amount ?? remote.amount)),
            toKobo(remote.Amount ?? remote.amount), String(transactionId), String(accountNumber), mode).run();
          payment = await env.DB.prepare("SELECT * FROM payments WHERE id=?").bind(inserted.meta.last_row_id).first();
        }
      }
    }
    if (!payment) { results.push({ transaction_id: transactionId, status: "unmatched" }); continue; }
    const result = await finalizeAlatpayCredit(env, payment, remote, mode, orderId);
    results.push({ transaction_id: transactionId, order_id: orderId, ...result });
  }
  return { mode, scanned: rows.length, results };
}

async function getClientStaticWallet(env, clientId, mode) {
  const paymentMode = mode || getPaymentMode(env);
  return env.DB.prepare("SELECT * FROM client_static_wallets WHERE client_id=? AND payment_mode=? ORDER BY id DESC LIMIT 1")
    .bind(clientId, paymentMode).first();
}

async function initiateAlatpayStaticWallet(env, client, bvn, actorId) {
  const settings = await getAlatpaySettings(env);
  if (!settings.ready) throw Object.assign(new Error(`ALATPay ${settings.mode} credentials are not configured`), { status: 503 });
  const cleanedBvn = String(bvn || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(cleanedBvn)) throw Object.assign(new Error("A valid BVN is required to create a static wallet"), { status: 400 });
  const existing = await getClientStaticWallet(env, client.id, settings.mode);
  if (existing && existing.status === "active") return { existing: true, wallet: existing };
  if (existing && existing.status === "otp_pending") return { existing: true, wallet: existing, pending_otp: true };
  const data = await alatpayRequest(env, "/alatpay-wallet/api/v1/staticaccount", {
    method: "POST",
    mode: settings.mode,
    body: {
      businessId: settings.businessId,
      staticWalletType: 1,
      bvn: cleanedBvn,
      email: client.email_address || undefined
    }
  });
  const walletReference = data.id || data.staticWalletId || data.staticWalletID;
  if (!walletReference) throw Object.assign(new Error("ALATPay did not return a static wallet reference"), { status: 502 });
  const otpTrackingId = data.otpTrackingID || data.trackingId || data.trackingID || null;
  const maskedPhone = String(data.message || "").replace(/\d/g, "*");
  await env.DB.prepare(`
    INSERT INTO client_static_wallets
      (client_id, provider, payment_mode, business_id, wallet_type, wallet_reference, otp_tracking_id,
       status, provider_status, metadata_json, created_by, updated_by)
    VALUES (?, 'alatpay', ?, ?, 1, ?, ?, 'otp_pending', 'otp_pending', ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET payment_mode=excluded.payment_mode, business_id=excluded.business_id,
      wallet_type=excluded.wallet_type, wallet_reference=excluded.wallet_reference,
      otp_tracking_id=excluded.otp_tracking_id, status='otp_pending', provider_status='otp_pending',
      metadata_json=excluded.metadata_json, updated_by=excluded.updated_by, updated_at=datetime('now')
  `).bind(client.id, settings.mode, settings.businessId, walletReference, otpTrackingId,
    JSON.stringify({ message: maskedPhone, wallet_type: 1 }).slice(0, 1000), actorId || null, actorId || null).run();
  await audit(env, actorId || null, "provider.static_wallet.initiate", "client", String(client.id), {
    provider: "alatpay", mode: settings.mode, wallet_reference: walletReference
  }, client.assigned_branch_id);
  return {
    ok: true,
    status: "otp_pending",
    wallet_reference: walletReference,
    message: data.message || "An OTP has been sent to the BVN phone number."
  };
}

async function validateAlatpayStaticWallet(env, client, otp, actorId) {
  const settings = await getAlatpaySettings(env);
  const wallet = await getClientStaticWallet(env, client.id, settings.mode);
  if (!wallet) throw Object.assign(new Error("No static wallet has been initiated for this client"), { status: 404 });
  if (wallet.status === "active" && wallet.account_number) return { ok: true, status: "active", wallet };
  if (!wallet.wallet_reference || !wallet.otp_tracking_id) {
    throw Object.assign(new Error("Static wallet initiation is incomplete; initiate again"), { status: 409 });
  }
  const cleanedOtp = String(otp || "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(cleanedOtp)) throw Object.assign(new Error("A valid static wallet OTP is required"), { status: 400 });
  const data = await alatpayRequest(env, "/alatpay-wallet/api/v1/staticaccount/validateAndCreate", {
    method: "POST",
    mode: settings.mode,
    body: {
      staticWalletId: wallet.wallet_reference,
      businessId: settings.businessId,
      otp: cleanedOtp,
      trackingId: wallet.otp_tracking_id
    }
  });
  const accountNumber = data.accountNumber || data.account_number;
  if (!accountNumber) throw Object.assign(new Error("ALATPay did not return a static account number"), { status: 502 });
  const displayAccountName = clientVirtualAccountName(client);
  await env.DB.prepare(`
    UPDATE client_static_wallets SET account_number=?, account_name=?, bank_name=?, status='active',
      provider_status='active', wallet_reference=COALESCE(?, wallet_reference), updated_by=?, updated_at=datetime('now')
    WHERE id=?
  `).bind(String(accountNumber), displayAccountName, data.bankName || data.bank_name || "Wema Bank",
    data.id || null, actorId || null, wallet.id).run();
  await audit(env, actorId || null, "provider.static_wallet.active", "client", String(client.id), {
    provider: "alatpay", mode: settings.mode, account_number: String(accountNumber)
  }, client.assigned_branch_id);
  await enqueueSms(env, {
    clientId: client.id,
    templateKey: "static_wallet_ready",
    phone: client.phone_number,
    body: `Your permanent ALATPay account is ${accountNumber} (${data.bankName || data.bank_name || "Wema Bank"}). Use it for any amount. Bliss Legacy.`,
    idempotencyKey: `client:${client.id}:static_wallet_ready`,
    createdBy: actorId || null
  }).catch(() => {});
  return { ok: true, status: "active", account_number: String(accountNumber), account_name: displayAccountName };
}

function revenueScopeSql(actor, alias = "p") {
  const actualRole = actor.actual_role_name || actor.role_name;
  if (["Super Admin", "Managing Director", "Head Accountant", "Finance Officer"].includes(actualRole)) {
    return { clause: "1=1", binds: [] };
  }
  if (["Project Manager", "Branch Manager"].includes(actualRole)) {
    return { clause: `${alias}.revenue_branch_id = ?`, binds: [actor.branch_id] };
  }
  if (actualRole === "Team Lead") {
    return {
      clause: `(${alias}.revenue_team_lead_id = ? OR ${alias}.revenue_staff_id IN (SELECT id FROM users WHERE manager_id = ?))`,
      binds: [actor.id, actor.id]
    };
  }
  return { clause: `${alias}.revenue_staff_id = ?`, binds: [actor.id] };
}

async function buildPaymentAttribution(env, clientId) {
  const client = await env.DB.prepare(`
    SELECT id, client_reference, assigned_branch_id, team_lead_id, created_by, original_marketer_id, referred_by_staff_id
    FROM clients WHERE id=?
  `).bind(clientId).first();
  if (!client) return null;
  const staffId = client.created_by || client.original_marketer_id || client.referred_by_staff_id || null;
  let staff = null;
  if (staffId) {
    staff = await env.DB.prepare(`
      SELECT u.id, u.full_name, u.branch_id, u.manager_id, r.name AS role_name
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?
    `).bind(staffId).first();
  }
  let teamLeadId = null;
  let pmId = null;
  let branchId = client.assigned_branch_id || (staff ? staff.branch_id : null);
  if (staff) {
    if (staff.role_name === "Team Lead") teamLeadId = staff.id;
    if (["Project Manager", "Branch Manager"].includes(staff.role_name)) pmId = staff.id;
    let current = staff;
    let depth = 0;
    while (current && current.manager_id && depth < 8) {
      const manager = await env.DB.prepare(`
        SELECT u.id, u.full_name, u.branch_id, u.manager_id, r.name AS role_name
        FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?
      `).bind(current.manager_id).first();
      if (!manager) break;
      if (!teamLeadId && manager.role_name === "Team Lead") teamLeadId = manager.id;
      if (!pmId && ["Project Manager", "Branch Manager"].includes(manager.role_name)) pmId = manager.id;
      current = manager;
      depth += 1;
    }
    if (!branchId) branchId = staff.branch_id;
  }
  if (!teamLeadId && client.team_lead_id) {
    const tl = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='Team Lead'
    `).bind(client.team_lead_id).first();
    if (tl) teamLeadId = tl.id;
  }
  if (!pmId && branchId) {
    const bm = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE r.name IN ('Project Manager','Branch Manager') AND u.branch_id=? AND u.is_active=1
      ORDER BY u.id LIMIT 1
    `).bind(branchId).first();
    if (bm) pmId = bm.id;
  }
  const teamLead = teamLeadId ? await env.DB.prepare("SELECT full_name FROM users WHERE id=?").bind(teamLeadId).first() : null;
  const pm = pmId ? await env.DB.prepare("SELECT full_name FROM users WHERE id=?").bind(pmId).first() : null;
  const branch = branchId ? await env.DB.prepare("SELECT name FROM branches WHERE id=?").bind(branchId).first() : null;
  return {
    staffId: staff ? staff.id : null,
    staffName: staff ? staff.full_name : null,
    staffRole: staff ? staff.role_name : null,
    teamLeadId,
    teamLeadName: teamLead ? teamLead.full_name : null,
    pmId,
    pmName: pm ? pm.full_name : null,
    branchId,
    branchName: branch ? branch.name : null
  };
}

async function stampPaymentAttribution(env, paymentId, clientId) {
  const snapshot = await buildPaymentAttribution(env, clientId);
  if (!snapshot) return null;
  await env.DB.prepare(`
    UPDATE payments SET revenue_staff_id=?, revenue_team_lead_id=?, revenue_pm_id=?,
      revenue_branch_id=?, revenue_attribution_json=?, revenue_attributed_at=datetime('now')
    WHERE id=?
  `).bind(
    snapshot.staffId, snapshot.teamLeadId, snapshot.pmId, snapshot.branchId,
    JSON.stringify(snapshot), paymentId
  ).run();
  return snapshot;
}

async function outstandingForClient(env, client) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_kobo),0) AS verified FROM payments WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'"
  ).bind(client.id).first();
  const contract = toKobo(client.agreed_purchase_price || 0);
  return Math.max(0, contract - Number(row ? row.verified : 0));
}

// Financial integer kobo helpers. Decimal strings are parsed directly so
// values such as 100.005 round half-up to 10001 kobo instead of being
// corrupted by binary floating-point representation.
function toKobo(n) {
  if (n === undefined || n === null || n === "") return 0;
  const value = Number(n);
  if (!Number.isFinite(value)) return NaN;
  const raw = typeof n === "string" ? n.trim() : String(n);
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return Math.round(value * 100);
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = (match[3] || "") + "000";
  let kobo = whole * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) kobo += 1;
  return sign * kobo;
}
function fromKobo(kobo) {
  if (!kobo) return 0;
  return Number(kobo) / 100;
}

function isTruthy(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["1", "true"].includes(value.trim().toLowerCase());
  return false;
}

function secureCompare(a, b) {
  const left = String(a === undefined || a === null ? "" : a);
  const right = String(b === undefined || b === null ? "" : b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function parseWebhookTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    // Providers commonly use seconds; accept milliseconds as well.
    const parsed = new Date(num > 1e12 ? num : num * 1000);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = parseDbDate(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function newReceiptRef(isDemo) {
  return (isDemo ? "DEMO-RCP-" : "RCP-") +
    Date.now().toString(36).toUpperCase() + "-" +
    crypto.randomUUID().slice(0, 8).toUpperCase();
}

function isDemoClientReference(reference) {
  return /^DEMO-/i.test(String(reference || ""));
}

// ---------------------------------------------------------------------------
// Phase 6: staff dashboards, lead pipeline, scopes and analytics helpers
// ---------------------------------------------------------------------------
const LEAD_STATUSES = [
  "New Lead", "Contacted", "Interested", "Inspection Scheduled",
  "Negotiation", "Converted", "Lost"
];
const LEAD_OPEN_STATUSES = ["New Lead", "Contacted", "Interested", "Inspection Scheduled", "Negotiation"];

function normalizeLeadStatus(value, fallback = null) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const map = {
    "new": "New Lead", "new lead": "New Lead", "lead": "New Lead",
    "contacted": "Contacted", "contact": "Contacted",
    "interested": "Interested", "interest": "Interested",
    "inspection": "Inspection Scheduled", "inspection scheduled": "Inspection Scheduled", "scheduled": "Inspection Scheduled",
    "negotiation": "Negotiation", "negotiating": "Negotiation",
    "converted": "Converted", "won": "Converted",
    "lost": "Lost", "closed lost": "Lost"
  };
  return map[raw] || fallback;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseLeadCsv(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    .filter(line => line.trim().length);
  if (!lines.length) return [];
  const headerCells = parseCsvLine(lines[0]).map(cell => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const known = ["full_name", "name", "phone", "phone_number", "email", "email_address", "source", "status", "property", "property_id", "marketer", "marketer_id", "owner", "assigned_marketer_id", "branch", "branch_id", "estimated_value", "value", "notes", "next_follow_up_date", "follow_up"];
  const hasHeader = headerCells.some(cell => known.includes(cell));
  const rows = [];
  if (hasHeader) {
    for (let index = 1; index < lines.length; index++) {
      const cells = parseCsvLine(lines[index]);
      const row = {};
      headerCells.forEach((header, cellIndex) => { row[header] = cells[cellIndex] || ""; });
      rows.push(row);
    }
  } else {
    const defaults = ["full_name", "phone_number", "email_address", "source", "status", "assigned_marketer_id", "branch_id", "estimated_value", "notes"];
    for (const line of lines) {
      const cells = parseCsvLine(line);
      const row = {};
      defaults.forEach((key, index) => { row[key] = cells[index] || ""; });
      rows.push(row);
    }
  }
  return rows;
}

function normalizeLeadImportRow(raw) {
  const row = {};
  for (const [key, value] of Object.entries(raw || {})) {
    row[String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = value;
  }
  const pick = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return String(row[key]).trim();
    }
    return "";
  };
  return {
    full_name: pick("full_name", "name", "client_name", "lead_name"),
    phone_number: pick("phone_number", "phone", "mobile", "telephone"),
    email_address: pick("email_address", "email"),
    source: pick("source", "campaign", "ad_campaign", "lead_source"),
    referrer: pick("referrer", "referral", "referred_by"),
    status: pick("status", "stage"),
    lead_temperature: pick("lead_temperature", "temperature"),
    property_id: pick("property_id", "property"),
    assigned_marketer_id: pick("assigned_marketer_id", "marketer_id", "marketer", "owner", "owner_marketer_id"),
    team_lead_id: pick("team_lead_id", "team_lead"),
    branch_id: pick("branch_id", "branch"),
    estimated_value: pick("estimated_value", "value", "budget"),
    notes: pick("notes", "note", "comments"),
    next_follow_up_date: pick("next_follow_up_date", "follow_up_date", "follow_up")
  };
}
const STAFF_ROLES = ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"];
const GRANULARITIES = ["day", "week", "month", "year"];
const COMMISSION_BASES = ["contract_value", "verified_collections", "fixed"];
const COMMISSION_STATUSES = ["Draft", "Calculated", "Pending Approval", "Approved", "Partially Paid", "Paid", "Rejected", "Reversed", "Cancelled"];
const COMMISSION_ROLES = ["Marketer", "Team Lead", "Branch Manager"];
const SALE_TYPES = ["New Sale", "Resale", "Referral", "Other"];
const PAYMENT_PLAN_TYPES = ["outright", "part_payment", "daily", "weekly", "bi_monthly", "monthly"];
const EASY_BUY_PLAN_TYPES = ["daily", "weekly", "bi_monthly", "monthly"];
const COMMISSIONABLE_MODES = ["full", "first_months", "percentage", "capped_amount"];
const DEFAULT_FOLLOW_UP_STATUSES = ["contacted", "promised", "escalated"];
const LEAD_TEMPERATURES = ["Hot", "Warm", "Cold"];
const CARE_SCOPES = ["branch", "national"];
const CARE_CALL_TYPES = ["call", "whatsapp", "visit", "sms", "other"];
const SMS_FINAL_STATUSES = ["sent", "delivered", "failed", "opted_out", "skipped"];
const REPORT_TYPES = [
  "sales", "collections", "outstanding", "commission",
  "branch_performance", "marketer_performance", "refunds", "commission_liability"
];

function normalizeNigerianPhone(value) {
  let raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return null;
  raw = raw.replace(/[^\d+]/g, "");
  if (raw.startsWith("+")) raw = raw.slice(1);
  if (raw.startsWith("00")) raw = raw.slice(2);
  if (raw.startsWith("234") && raw.length === 13) return "+" + raw;
  if (raw.startsWith("0") && raw.length === 11) return "+234" + raw.slice(1);
  if (/^[789]\d{9}$/.test(raw)) return "+234" + raw;
  return null;
}

function isValidLeadPhone(value) {
  return Boolean(normalizeNigerianPhone(value));
}

function normalizeTemperature(value, fallback = null) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hot") return "Hot";
  if (raw === "warm") return "Warm";
  if (raw === "cold") return "Cold";
  return fallback;
}

function canManagePropertyPlans(actor) {
  if (!actor) return false;
  const actual = actor.actual_role_name || actor.role_name;
  return ["Super Admin", "Managing Director", "Branch Manager"].includes(actual);
}

function isPropertyManager(actor) {
  if (!actor) return false;
  const actual = actor.actual_role_name || actor.role_name;
  return ["Super Admin", "Managing Director", "Branch Manager"].includes(actual);
}

function canManagePropertyRecord(actor, property) {
  if (!actor || !property) return false;
  const actual = actor.actual_role_name || actor.role_name;
  if (["Super Admin", "Managing Director"].includes(actual)) return true;
  if (actual === "Branch Manager") return Number(property.branch_id) === Number(actor.branch_id);
  return false;
}

async function getAppSetting(env, key, fallback = null) {
  const row = await env.DB.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").bind(key).first();
  return row && row.setting_value !== null && row.setting_value !== undefined ? row.setting_value : fallback;
}

async function setAppSetting(env, key, value, actorId) {
  await env.DB.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,
      updated_by=excluded.updated_by, updated_at=datetime('now')
  `).bind(key, value === undefined || value === null ? null : String(value), actorId || null).run();
}

async function getSiteConfig(env) {
  const raw = await getAppSetting(env, "site_config", "{}");
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function propertyEnabledPlanCount(env, propertyId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM property_payment_plans WHERE property_id=? AND is_enabled=1"
  ).bind(propertyId).first();
  return Number(row ? row.c : 0);
}

function canManageSms(actor) {
  if (!actor) return false;
  const actual = actor.actual_role_name || actor.role_name;
  if (["Super Admin", "Managing Director", "Head Accountant"].includes(actual)) return true;
  return Number(actor.sms_access || 0) === 1;
}

function careScopeSql(actor, alias = "c") {
  const actual = actor.actual_role_name || actor.role_name;
  if (actual !== "Customer Care") return { clause: "1=0", binds: [] };
  if (String(actor.care_scope || "").toLowerCase() === "national") return { clause: "1=1", binds: [] };
  return { clause: `${alias}.assigned_branch_id = ?`, binds: [actor.branch_id] };
}


function dateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !isNaN(new Date(text + "T00:00:00Z").getTime()) ? text : null;
}

function todayOnly() {
  return new Date().toISOString().slice(0, 10);
}

function currentDate(env) {
  return dateOnly(env && env.TEST_NOW) || todayOnly();
}

function endOfMonth(dateText) {
  const date = new Date(String(dateText).slice(0, 10) + "T00:00:00Z");
  if (isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function defaultDateRange(url) {
  const today = todayOnly();
  const fallbackFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = dateOnly(url.searchParams.get("from")) || fallbackFrom;
  const to = dateOnly(url.searchParams.get("to")) || today;
  const safeFrom = from <= to ? from : to;
  const safeTo = from <= to ? to : from;
  const requested = String(url.searchParams.get("granularity") || "").toLowerCase();
  const days = Math.max(1, Math.round((new Date(safeTo + "T00:00:00Z") - new Date(safeFrom + "T00:00:00Z")) / 86400000) + 1);
  const granularity = GRANULARITIES.includes(requested)
    ? requested
    : (days <= 62 ? "day" : "month");
  return { from: safeFrom, to: safeTo, granularity };
}

function periodSql(expression, granularity) {
  if (granularity === "day") return `date(${expression})`;
  if (granularity === "week") return `strftime('%Y-W%W', ${expression})`;
  if (granularity === "year") return `strftime('%Y', ${expression})`;
  return `strftime('%Y-%m', ${expression})`;
}

function buildPeriodKeys(from, to, granularity) {
  const keys = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return keys;
  if (granularity === "year") {
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) keys.push(String(y));
    return keys;
  }
  if (granularity === "month") {
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (d <= end) {
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    return keys;
  }
  if (granularity === "week") {
    // Let SQLite own week bucketing; the UI can still render the returned keys.
    return keys;
  }
  let d = new Date(start);
  while (d <= end) {
    keys.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return keys;
}

function placeholders(values) {
  return values.map(() => "?").join(",") || "NULL";
}

async function resolvePhase6Scope(env, actor) {
  const scope = {
    role: actor.role_name,
    actualRole: actor.actual_role_name || actor.role_name,
    actorId: actor.id,
    branchId: actor.branch_id,
    teamIds: [],
    memberIds: [actor.id],
    teamLeadIds: [],
    commissionAccess: canAccessCommissions(actor)
  };
  if (actor.role_name === "Team Lead") {
    const { results: teams } = await env.DB.prepare(
      "SELECT id FROM teams WHERE team_lead_user_id=? AND is_active=1"
    ).bind(actor.id).all();
    scope.teamIds = teams.map(t => t.id);
    if (scope.teamIds.length) {
      const { results: members } = await env.DB.prepare(
        `SELECT DISTINCT user_id FROM team_members WHERE team_id IN (${placeholders(scope.teamIds)})`
      ).bind(...scope.teamIds).all();
      scope.memberIds = [...new Set([actor.id, ...members.map(m => m.user_id)])];
    }
  }
  if (actor.role_name === "Marketer") {
    const { results: teams } = await env.DB.prepare(`
      SELECT t.id, t.team_lead_user_id FROM teams t
      JOIN team_members tm ON tm.team_id=t.id
      WHERE tm.user_id=? AND t.is_active=1
    `).bind(actor.id).all();
    scope.teamIds = teams.map(t => t.id);
    scope.teamLeadIds = [...new Set(teams.map(t => t.team_lead_user_id).filter(Boolean))];
  }
  return scope;
}

function clientScopeSql(scope, alias = "c") {
  if (["Managing Director", "Finance Officer"].includes(scope.role)) return { clause: "1=1", binds: [] };
  if (scope.role === "Branch Manager") return { clause: `${alias}.assigned_branch_id = ?`, binds: [scope.branchId] };
  if (scope.role === "Team Lead") {
    const ph = placeholders(scope.memberIds);
    return {
      clause: `(${alias}.team_lead_id = ? OR ${alias}.original_marketer_id IN (${ph}) OR ${alias}.created_by IN (${ph}) OR ${alias}.referred_by_staff_id = ? OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=${alias}.id AND ca.is_primary=1 AND ca.relationship_manager_id IN (${ph})))`,
      binds: [scope.actorId, ...scope.memberIds, ...scope.memberIds, scope.actorId, ...scope.memberIds]
    };
  }
  if (scope.role === "Marketer") {
    return {
      clause: `(
        (EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=${alias}.id AND ca.is_primary=1)
         AND EXISTS (SELECT 1 FROM client_assignments ca2 WHERE ca2.client_id=${alias}.id AND ca2.is_primary=1 AND ca2.relationship_manager_id = ?))
        OR
        (NOT EXISTS (SELECT 1 FROM client_assignments ca3 WHERE ca3.client_id=${alias}.id AND ca3.is_primary=1)
         AND (${alias}.original_marketer_id = ? OR ${alias}.created_by = ?))
        OR ${alias}.referred_by_staff_id = ?
      )`,
      binds: [scope.actorId, scope.actorId, scope.actorId, scope.actorId]
    };
  }
  return { clause: "1=0", binds: [] };
}

function leadScopeSql(scope, alias = "l") {
  if (["Managing Director", "Finance Officer"].includes(scope.role)) return { clause: "1=1", binds: [] };
  if (scope.role === "Branch Manager") return { clause: `${alias}.branch_id = ?`, binds: [scope.branchId] };
  if (scope.role === "Team Lead") {
    return {
      clause: `(${alias}.team_lead_id = ? OR ${alias}.assigned_marketer_id IN (${placeholders(scope.memberIds)}))`,
      binds: [scope.actorId, ...scope.memberIds]
    };
  }
  if (scope.role === "Marketer") return { clause: `${alias}.assigned_marketer_id = ?`, binds: [scope.actorId] };
  return { clause: "1=0", binds: [] };
}

function activityScopeSql(scope, alias = "al") {
  if (scope.role === "Managing Director") return { clause: "1=1", binds: [] };
  if (scope.role === "Finance Officer") {
    return {
      clause: `(${alias}.action LIKE 'payment%' OR ${alias}.action LIKE 'installment%' OR ${alias}.action LIKE 'provider%' OR ${alias}.action LIKE 'webhook%' OR ${alias}.action LIKE 'commission%' OR ${alias}.action LIKE 'report%')`,
      binds: []
    };
  }
  if (scope.role === "Branch Manager") return { clause: `${alias}.branch_id = ?`, binds: [scope.branchId] };
  if (scope.role === "Team Lead") {
    return { clause: `${alias}.actor_user_id IN (${placeholders(scope.memberIds)})`, binds: [...scope.memberIds] };
  }
  if (scope.role === "Marketer") return { clause: `${alias}.actor_user_id = ?`, binds: [scope.actorId] };
  return { clause: "1=0", binds: [] };
}

function canAccessLeadScope(scope, lead) {
  if (["Managing Director", "Finance Officer"].includes(scope.role)) return true;
  if (scope.role === "Branch Manager") return Number(lead.branch_id) === Number(scope.branchId);
  if (scope.role === "Team Lead") {
    return Number(lead.team_lead_id) === Number(scope.actorId) || scope.memberIds.includes(lead.assigned_marketer_id);
  }
  if (scope.role === "Marketer") return Number(lead.assigned_marketer_id) === Number(scope.actorId);
  return false;
}

function canManageLeads(role) {
  return ["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(role);
}

function canManageStaff(role) {
  return ["Managing Director", "Branch Manager"].includes(role);
}

async function monthlyReactivationEnabled(env, roleName) {
  const row = await env.DB.prepare("SELECT monthly_reactivation_enabled FROM role_access_settings WHERE role_name=?")
    .bind(roleName).first();
  return Boolean(row && Number(row.monthly_reactivation_enabled) === 1);
}

function testAccountExpired(user, env) {
  return Number(user.is_test || 0) === 1 && user.test_expires_at && String(user.test_expires_at).slice(0, 10) < currentDate(env);
}

function monthlyAccessLapsed(user, env) {
  return user.access_valid_until && String(user.access_valid_until).slice(0, 10) < currentDate(env);
}

function canAccessCommissions(actor) {
  if (!actor) return false;
  const actualRole = actor.actual_role_name || actor.role_name;
  if (["Managing Director", "Super Admin", "Head Accountant"].includes(actualRole)) return true;
  return Number(actor.commission_access || 0) === 1;
}

function canViewOwnCommission(actor) {
  const actualRole = actor && (actor.actual_role_name || actor.role_name);
  return ["Marketer", "Team Lead", "Project Manager", "Branch Manager"].includes(actualRole);
}

function canViewReferralCommissions(actor) {
  if (!actor) return false;
  const actualRole = actor.actual_role_name || actor.role_name;
  if (["Managing Director", "Super Admin", "Head Accountant", "Finance Officer", "Branch Manager", "Project Manager", "Team Lead", "Marketer"].includes(actualRole)) return true;
  return Number(actor.commission_access || 0) === 1;
}

function canManageReferralCommissions(actor) {
  if (!actor) return false;
  const actualRole = actor.actual_role_name || actor.role_name;
  return ["Managing Director", "Super Admin", "Head Accountant", "Finance Officer"].includes(actualRole);
}

function ownCommissionEntry(entry) {
  const earned = Number(entry.commission_kobo || 0);
  const adjusted = Number(entry.adjusted_kobo || 0);
  const expected = Math.max(0, earned + adjusted);
  const paid = Number(entry.paid_kobo || 0);
  return {
    id: entry.id,
    commission_ref: entry.commission_ref,
    client_name: entry.client_name || null,
    client_reference: entry.client_reference || null,
    status: entry.status,
    earned_kobo: earned,
    expected_kobo: expected,
    adjusted_kobo: adjusted,
    paid_kobo: paid,
    outstanding_kobo: Math.max(0, expected - paid),
    created_at: entry.created_at
  };
}

function ownCommissionSummary(entries) {
  const list = entries || [];
  return {
    total_count: list.length,
    earned_kobo: list.reduce((sum, row) => sum + Number(row.earned_kobo || 0), 0),
    expected_kobo: list.reduce((sum, row) => sum + Number(row.expected_kobo || 0), 0),
    paid_kobo: list.reduce((sum, row) => sum + Number(row.paid_kobo || 0), 0),
    outstanding_kobo: list.reduce((sum, row) => sum + Number(row.outstanding_kobo || 0), 0)
  };
}

function commissionAmount(amountKobo, rateBps) {
  if (!Number.isInteger(amountKobo) || !Number.isInteger(rateBps) || rateBps <= 0) return 0;
  // Integer basis-point rounding: half-up to the nearest kobo.
  return Math.floor((amountKobo * rateBps + 5000) / 10000);
}

function commissionNet(entry) {
  return Number(entry.commission_kobo || 0) + Number(entry.adjusted_kobo || 0);
}

function commissionOutstanding(entry) {
  return Math.max(0, commissionNet(entry) - Number(entry.paid_kobo || 0));
}

// ---------------------------------------------------------------------------
// ELPIS referral commission engine
// ---------------------------------------------------------------------------
const REFERRAL_COMMISSION_STATUSES = [
  "Pending", "Earned", "Partially Paid", "Paid", "Reversed", "Configuration Required"
];
const REFERRAL_LONG_TERM_STAGE_KOBO = 6000000; // ₦60,000
const REFERRAL_LONG_TERM_MAX_KOBO = 3500000;   // ₦35,000
const REFERRAL_SHORT_TERM_RATE_BPS = 1000;     // 10.00%

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function referralStructureLabel(structure, planType, months) {
  if (structure === "two_stage") return "Long-term (two stage)";
  if (structure === "flat") return planType === "outright"
    ? "Outright (10%)"
    : `Short-term${months !== null && months !== undefined ? ` (${months} months)` : ""} (10%)`;
  if (structure === "configuration_required") return "Configuration required";
  return structure || "Pending";
}

async function getReferralCommissionRules(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM referral_commission_rules WHERE is_active=1 ORDER BY id"
  ).all();
  const map = {};
  for (const row of results) map[row.rule_key] = row;
  return map;
}

async function resolveReferralCommissionPlan(env, client) {
  const schedule = await env.DB.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM payment_schedule_items i WHERE i.schedule_id=s.id) AS item_count,
      (SELECT MIN(i.due_date) FROM payment_schedule_items i WHERE i.schedule_id=s.id) AS first_due_date,
      (SELECT MAX(i.due_date) FROM payment_schedule_items i WHERE i.schedule_id=s.id) AS last_due_date
    FROM payment_schedules s
    WHERE s.client_id=?
    ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END, s.id DESC
    LIMIT 1
  `).bind(client.id).first();

  let planType = client.payment_plan_type
    ? normalizePlanType(client.payment_plan_type, "part_payment")
    : null;
  let months = client.payment_plan_duration_months === null || client.payment_plan_duration_months === undefined
    ? null
    : Number(client.payment_plan_duration_months);

  const locked = safeJsonParse(client.payment_plan_locked_json)
    || (schedule ? safeJsonParse(schedule.locked_plan_json) : null);
  if ((months === null || !Number.isFinite(months)) && locked && locked.duration_months !== null && locked.duration_months !== undefined) {
    months = Number(locked.duration_months);
  }
  if (!planType && schedule) planType = normalizePlanType(schedule.plan_type, "part_payment");
  if (!Number.isFinite(months)) months = null;

  if (months === null && schedule) {
    const schedulePlanType = normalizePlanType(schedule.plan_type, "part_payment");
    const installments = Number(schedule.number_of_installments || 0);
    const frequencyDays = Number(schedule.frequency_days || 0);
    if (schedulePlanType === "outright") {
      months = 0;
    } else if (installments > 0 && frequencyDays > 0) {
      months = Math.max(1, Math.round((installments * frequencyDays) / 30));
    } else if (Number(schedule.item_count || 0) > 1 && schedule.first_due_date && schedule.last_due_date) {
      months = Math.max(1, Math.round((diffDays(schedule.first_due_date, schedule.last_due_date) + (frequencyDays || 30)) / 30));
    }
  }

  if (planType === "outright") months = 0;
  const base = {
    schedule,
    scheduleId: schedule ? schedule.id : null,
    planType,
    months: months === null || Number.isFinite(months) ? months : null
  };

  if (!planType) {
    return {
      ...base,
      structure: "configuration_required",
      ruleKey: null,
      flagReason: "No payment plan is attached to this client",
      label: referralStructureLabel("configuration_required", planType, months)
    };
  }
  if (planType === "outright") {
    return { ...base, structure: "flat", ruleKey: "outright", flagReason: null, label: referralStructureLabel("flat", "outright", 0) };
  }
  if (months === null) {
    return {
      ...base,
      structure: "configuration_required",
      ruleKey: null,
      flagReason: "Payment plan duration is missing",
      label: referralStructureLabel("configuration_required", planType, months)
    };
  }
  if (months === 8) {
    return {
      ...base,
      structure: "configuration_required",
      ruleKey: "exact_8",
      flagReason: "An 8-month payment plan has no approved referral commission structure",
      label: referralStructureLabel("configuration_required", planType, months)
    };
  }
  if (months <= 7) {
    return { ...base, structure: "flat", ruleKey: "short_term", flagReason: null, label: referralStructureLabel("flat", planType, months) };
  }
  if (months > 8) {
    return { ...base, structure: "two_stage", ruleKey: "long_term", flagReason: null, label: referralStructureLabel("two_stage", planType, months) };
  }
  return {
    ...base,
    structure: "configuration_required",
    ruleKey: null,
    flagReason: "Payment plan duration is outside the approved referral structures",
    label: referralStructureLabel("configuration_required", planType, months)
  };
}

function calculateReferralCommissionKobo(structure, rule, totalPaidKobo) {
  const paid = Math.max(0, Math.floor(Number(totalPaidKobo || 0)));
  if (structure === "flat") {
    const rateBps = Number(rule && rule.flat_rate_bps !== undefined ? rule.flat_rate_bps : REFERRAL_SHORT_TERM_RATE_BPS);
    return {
      totalKobo: Math.floor((paid * rateBps + 5000) / 10000),
      qualifyingKobo: paid,
      stage1PaidKobo: 0,
      stage2PaidKobo: 0,
      stage1CommissionKobo: 0,
      stage2CommissionKobo: 0,
      stageAmountKobo: 0,
      rateBps
    };
  }
  if (structure === "two_stage") {
    const stageAmount = Math.max(1, Number(rule && rule.stage_amount_kobo ? rule.stage_amount_kobo : REFERRAL_LONG_TERM_STAGE_KOBO));
    const cap1 = Math.max(0, Number(rule && rule.stage1_commission_cap_kobo ? rule.stage1_commission_cap_kobo : 2000000));
    const cap2 = Math.max(0, Number(rule && rule.stage2_commission_cap_kobo ? rule.stage2_commission_cap_kobo : 1500000));
    const max = Math.max(0, Number(rule && rule.max_commission_kobo ? rule.max_commission_kobo : REFERRAL_LONG_TERM_MAX_KOBO));
    const stage1Paid = Math.min(paid, stageAmount);
    const stage2Paid = Math.min(Math.max(paid - stageAmount, 0), stageAmount);
    // Stage 1 uses the fixed ₦20,000 cap, not a rounded 33.333% rate.
    const stage1Commission = Math.min(cap1, Math.floor((stage1Paid * cap1) / stageAmount));
    const stage2Commission = Math.min(cap2, Math.floor((stage2Paid * cap2) / stageAmount));
    return {
      totalKobo: Math.min(max, stage1Commission + stage2Commission),
      qualifyingKobo: Math.min(paid, stageAmount * 2),
      stage1PaidKobo: stage1Paid,
      stage2PaidKobo: stage2Paid,
      stage1CommissionKobo: stage1Commission,
      stage2CommissionKobo: stage2Commission,
      stageAmountKobo: stageAmount,
      rateBps: 0
    };
  }
  return {
    totalKobo: 0,
    qualifyingKobo: paid,
    stage1PaidKobo: 0,
    stage2PaidKobo: 0,
    stage1CommissionKobo: 0,
    stage2CommissionKobo: 0,
    stageAmountKobo: 0,
    rateBps: 0
  };
}

async function recalculateReferralCommissionForClient(env, clientId, actorId, trigger = {}) {
  const client = await env.DB.prepare(`
    SELECT c.*, b.name AS branch_name
    FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id
    WHERE c.id=? AND c.is_deleted=0
  `).bind(clientId).first();
  if (!client) return { skipped: true, reason: "client_not_found" };

  const rules = await getReferralCommissionRules(env);
  const plan = await resolveReferralCommissionPlan(env, client);
  const rule = plan.ruleKey ? rules[plan.ruleKey] : null;
  const { results: payments } = await env.DB.prepare(`
    SELECT id, amount_kobo, verified_at
    FROM payments
    WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
      AND COALESCE(is_internal_test,0)=0 AND COALESCE(is_archived,0)=0
    ORDER BY verified_at, id
  `).bind(client.id).all();
  const totalPaidKobo = payments.reduce((sum, payment) => sum + Number(payment.amount_kobo || 0), 0);
  const calc = calculateReferralCommissionKobo(plan.structure, rule, totalPaidKobo);
  const existing = await env.DB.prepare(
    "SELECT * FROM referral_commission_accounts WHERE client_id=?"
  ).bind(client.id).first();
  const recipient = await resolveCommissionRecipient(env, client, "Marketer");
  // Preserve an existing attribution if the marketer is temporarily inactive.
  const marketerId = recipient ? recipient.userId : (existing ? existing.marketer_id : null);
  const branchId = (recipient && recipient.branchId) || (existing ? existing.branch_id : null) || client.assigned_branch_id || null;
  const teamId = recipient ? (recipient.teamId || null) : (existing ? existing.team_id : null);

  if (!payments.length && !existing) return { skipped: true, reason: "no_verified_payments", client_id: client.id };

  const previousTotal = existing ? Number(existing.total_commission_kobo || 0) : 0;
  const adjusted = existing ? Number(existing.adjusted_kobo || 0) : 0;
  const paid = existing ? Number(existing.paid_kobo || 0) : 0;
  const net = calc.totalKobo + adjusted;
  let status = "Pending";
  if (plan.structure === "configuration_required") status = "Configuration Required";
  else if (net <= 0) {
    status = existing && ["Earned", "Partially Paid", "Paid"].includes(existing.status) ? "Reversed" : "Pending";
  } else if (!marketerId) status = "Pending";
  else if (paid >= net) status = "Paid";
  else if (paid > 0) status = "Partially Paid";
  else status = "Earned";

  const flagReason = plan.flagReason || (!marketerId ? "No eligible marketer is assigned to this client" : null);
  const lastPaymentId = payments.length ? payments[payments.length - 1].id : (existing ? existing.last_payment_id : null);
  const values = [
    marketerId, branchId, teamId, plan.planType, plan.months, plan.structure, plan.ruleKey,
    totalPaidKobo, calc.qualifyingKobo, calc.stage1PaidKobo, calc.stage2PaidKobo,
    calc.stage1CommissionKobo, calc.stage2CommissionKobo, calc.totalKobo,
    adjusted, paid, status, flagReason, lastPaymentId
  ];

  let accountId;
  if (!existing) {
    const inserted = await env.DB.prepare(`
      INSERT INTO referral_commission_accounts
        (client_id, marketer_id, branch_id, team_id, plan_type, plan_duration_months, structure, rule_key,
         total_paid_kobo, qualifying_paid_kobo, stage1_paid_kobo, stage2_paid_kobo,
         stage1_commission_kobo, stage2_commission_kobo, total_commission_kobo,
         adjusted_kobo, paid_kobo, status, flag_reason, last_payment_id, last_calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(client.id, ...values).run();
    accountId = inserted.meta.last_row_id;
  } else {
    accountId = existing.id;
    await env.DB.prepare(`
      UPDATE referral_commission_accounts SET
        marketer_id=?, branch_id=?, team_id=?, plan_type=?, plan_duration_months=?, structure=?, rule_key=?,
        total_paid_kobo=?, qualifying_paid_kobo=?, stage1_paid_kobo=?, stage2_paid_kobo=?,
        stage1_commission_kobo=?, stage2_commission_kobo=?, total_commission_kobo=?,
        adjusted_kobo=?, paid_kobo=?, status=?, flag_reason=?, last_payment_id=?,
        last_calculated_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).bind(...values, accountId).run();
  }

  const delta = calc.totalKobo - previousTotal;
  const structureChanged = Boolean(existing) && (
    existing.structure !== plan.structure ||
    Number(existing.marketer_id || 0) !== Number(marketerId || 0) ||
    Number(existing.plan_duration_months === null ? -1 : existing.plan_duration_months) !== Number(plan.months === null ? -1 : plan.months)
  );
  const needsFlagEvent = plan.structure === "configuration_required" && (!existing || existing.status !== "Configuration Required");
  const shouldRecord = !existing || delta !== 0 || structureChanged || needsFlagEvent ||
    Boolean(trigger.forceEvent) || ["reversal", "adjustment"].includes(trigger.eventType);

  if (shouldRecord) {
    const defaultSourceKey = `referral:client:${client.id}:calc:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
    const sourceKey = trigger.sourceKey || defaultSourceKey;
    let eventType = trigger.eventType || (delta > 0 ? "accrual" : delta < 0 ? "reversal" : "recalculation");
    if (plan.structure === "configuration_required" && needsFlagEvent) eventType = "flagged";
    const eventRef = "RCE-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    const eventRes = await env.DB.prepare(`
      INSERT OR IGNORE INTO referral_commission_events
        (event_ref, source_key, account_id, client_id, payment_id, marketer_id, event_type,
         amount_kobo, total_paid_kobo, qualifying_paid_kobo, net_commission_kobo, reason,
         metadata, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      eventRef, sourceKey, accountId, client.id, trigger.paymentId || lastPaymentId || null,
      marketerId, eventType, delta, totalPaidKobo, calc.qualifyingKobo, net,
      trigger.reason || plan.flagReason || null,
      JSON.stringify({
        structure: plan.structure, rule_key: plan.ruleKey, plan_type: plan.planType,
        plan_duration_months: plan.months, stage1_paid_kobo: calc.stage1PaidKobo,
        stage2_paid_kobo: calc.stage2PaidKobo, stage1_commission_kobo: calc.stage1CommissionKobo,
        stage2_commission_kobo: calc.stage2CommissionKobo, total_commission_kobo: calc.totalKobo,
        adjusted_kobo: adjusted, paid_kobo: paid, status
      }),
      actorId || null
    ).run();

    if (eventRes.meta && Number(eventRes.meta.changes) > 0) {
      await audit(env, actorId || null, eventType === "flagged" ? "referral_commission.flagged" : "referral_commission.calculated",
        "referral_commission", String(accountId), {
          client_id: client.id, client_reference: client.client_reference, event_type: eventType,
          delta_kobo: delta, total_commission_kobo: calc.totalKobo, qualifying_paid_kobo: calc.qualifyingKobo,
          structure: plan.structure, rule_key: plan.ruleKey, plan_duration_months: plan.months,
          marketer_id: marketerId, flag_reason: flagReason
        }, branchId);
      if (delta > 0 && marketerId) {
        await createNotification(env, {
          userId: marketerId,
          type: "referral_commission.earned",
          title: "Referral commission earned",
          message: `${formatNGN(delta)} referral commission was earned from ${client.full_name} (${client.client_reference}).`,
          metadata: { account_id: accountId, client_id: client.id, amount_kobo: delta }
        }).catch(() => {});
      }
      if (plan.structure === "configuration_required") {
        const managers = await env.DB.prepare(`
          SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.is_active=1 AND r.name IN ('Managing Director','Super Admin','Finance Officer','Head Accountant')
          ORDER BY u.id LIMIT 20
        `).all();
        for (const manager of managers.results || []) {
          await createNotification(env, {
            userId: manager.id,
            type: "referral_commission.configuration_required",
            title: "Referral commission needs configuration",
            message: `${client.full_name} (${client.client_reference}): ${flagReason || "payment plan requires referral commission configuration"}.`,
            metadata: { account_id: accountId, client_id: client.id }
          }).catch(() => {});
        }
      }
    }
  }

  return {
    ok: true,
    account_id: accountId,
    client_id: client.id,
    structure: plan.structure,
    rule_key: plan.ruleKey,
    plan_type: plan.planType,
    plan_duration_months: plan.months,
    total_paid_kobo: totalPaidKobo,
    qualifying_paid_kobo: calc.qualifyingKobo,
    total_commission_kobo: calc.totalKobo,
    net_commission_kobo: net,
    paid_kobo: paid,
    outstanding_kobo: Math.max(0, net - paid),
    status,
    flag_reason: flagReason,
    delta_kobo: delta
  };
}

async function backfillReferralCommissions(env, actorId, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  const onlyStale = options.onlyStale !== false;
  const { results: clients } = await env.DB.prepare(`
    SELECT c.id,
      (SELECT MAX(p.verified_at) FROM payments p
        WHERE p.client_id=c.id AND p.status='verified' AND p.is_demo=0 AND p.currency='NGN') AS latest_verified_at
    FROM clients c
    LEFT JOIN referral_commission_accounts a ON a.client_id=c.id
    WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
      AND EXISTS (SELECT 1 FROM payments p
        WHERE p.client_id=c.id AND p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
          AND COALESCE(p.is_internal_test,0)=0 AND COALESCE(p.is_archived,0)=0)
      ${onlyStale ? "AND (a.id IS NULL OR a.last_calculated_at IS NULL OR datetime(a.last_calculated_at) < datetime((SELECT MAX(p2.verified_at) FROM payments p2 WHERE p2.client_id=c.id AND p2.status='verified' AND p2.is_demo=0 AND p2.currency='NGN' AND COALESCE(p2.is_internal_test,0)=0 AND COALESCE(p2.is_archived,0)=0)))" : ""}
    ORDER BY c.id LIMIT ?
  `).bind(limit).all();

  let processed = 0;
  let skipped = 0;
  let flagged = 0;
  let earnedKobo = 0;
  const runKey = options.sourceKey || `referral:backfill:${todayOnly()}:${crypto.randomUUID().slice(0, 8)}`;
  for (const row of clients) {
    const result = await recalculateReferralCommissionForClient(env, row.id, actorId, {
      sourceKey: `${runKey}:client:${row.id}`,
      eventType: "recalculation",
      reason: options.reason || "Automatic referral commission backfill"
    });
    if (result.skipped) { skipped++; continue; }
    processed++;
    earnedKobo += Number(result.delta_kobo || 0);
    if (result.structure === "configuration_required") flagged++;
  }
  return { processed, skipped, flagged, earned_kobo: earnedKobo, examined: clients.length };
}

function referralCommissionScopeSql(scope, alias = "a") {
  const actualRole = scope.actualRole || scope.role;
  if (["Managing Director", "Super Admin", "Head Accountant", "Finance Officer"].includes(actualRole)) {
    return { clause: "1=1", binds: [] };
  }
  if (["Branch Manager", "Project Manager"].includes(actualRole)) {
    return { clause: `${alias}.branch_id = ?`, binds: [scope.branchId] };
  }
  if (actualRole === "Team Lead") {
    const ids = (scope.memberIds && scope.memberIds.length ? scope.memberIds : [scope.actorId]);
    return { clause: `${alias}.marketer_id IN (${placeholders(ids)})`, binds: ids };
  }
  if (actualRole === "Marketer") {
    return { clause: `${alias}.marketer_id = ?`, binds: [scope.actorId] };
  }
  return { clause: "1=0", binds: [] };
}

function commissionScopeSql(scope, alias = "ce") {
  if (scope.commissionAccess) return { clause: "1=1", binds: [] };
  if (["Marketer", "Team Lead", "Project Manager", "Branch Manager"].includes(scope.actualRole || scope.role)) {
    return { clause: `${alias}.recipient_user_id = ?`, binds: [scope.actorId] };
  }
  return { clause: "1=0", binds: [] };
}

async function getCommissionSummary(env, scope) {
  const scoped = commissionScopeSql(scope, "ce");
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN ce.status IN ('Calculated','Pending Approval','Approved','Partially Paid','Paid','Reversed')
        THEN MAX(0, ce.commission_kobo + ce.adjusted_kobo) ELSE 0 END),0) AS earned_kobo,
      COALESCE(SUM(CASE WHEN ce.status IN ('Calculated','Pending Approval','Approved','Partially Paid','Paid','Reversed')
        THEN ce.commission_kobo ELSE 0 END),0) AS gross_earned_kobo,
      COALESCE(SUM(CASE WHEN ce.status='Draft' THEN ce.commission_kobo ELSE 0 END),0) AS draft_kobo,
      COALESCE(SUM(CASE WHEN ce.status='Pending Approval' THEN ce.commission_kobo + ce.adjusted_kobo ELSE 0 END),0) AS pending_approval_kobo,
      COALESCE(SUM(CASE WHEN ce.status IN ('Approved','Partially Paid','Paid')
        THEN MAX(0, ce.commission_kobo + ce.adjusted_kobo) ELSE 0 END),0) AS approved_kobo,
      COALESCE(SUM(ce.paid_kobo),0) AS paid_kobo,
      COALESCE(SUM(CASE WHEN ce.status IN ('Approved','Partially Paid','Paid','Reversed')
        THEN MAX(0, ce.commission_kobo + ce.adjusted_kobo - ce.paid_kobo) ELSE 0 END),0) AS outstanding_kobo,
      COALESCE(SUM(CASE WHEN ce.adjusted_kobo < 0 THEN -ce.adjusted_kobo ELSE 0 END),0) AS adjusted_kobo
    FROM commission_entries ce WHERE ${scoped.clause}
  `).bind(...scoped.binds).first();
  return {
    total_count: Number(row ? row.total_count : 0),
    earned_kobo: Number(row ? row.earned_kobo : 0),
    gross_earned_kobo: Number(row ? row.gross_earned_kobo : 0),
    draft_kobo: Number(row ? row.draft_kobo : 0),
    pending_approval_kobo: Number(row ? row.pending_approval_kobo : 0),
    approved_kobo: Number(row ? row.approved_kobo : 0),
    paid_kobo: Number(row ? row.paid_kobo : 0),
    outstanding_kobo: Number(row ? row.outstanding_kobo : 0),
    adjusted_kobo: Number(row ? row.adjusted_kobo : 0)
  };
}

async function getRecipientTeamId(env, userId, branchId) {
  if (!userId) return null;
  const team = await env.DB.prepare(`
    SELECT t.id FROM teams t
    LEFT JOIN team_members tm ON tm.team_id=t.id
    WHERE t.is_active=1 AND (t.team_lead_user_id=? OR tm.user_id=?)
      AND (? IS NULL OR t.branch_id=?)
    ORDER BY CASE WHEN t.team_lead_user_id=? THEN 0 ELSE 1 END, t.id
    LIMIT 1
  `).bind(userId, userId, branchId, branchId, userId).first();
  return team ? team.id : null;
}

async function resolveCommissionRecipient(env, client, roleName) {
  if (!COMMISSION_ROLES.includes(roleName)) return null;
  const assignment = await env.DB.prepare(`
    SELECT relationship_manager_id, team_lead_id, branch_id
    FROM client_assignments WHERE client_id=? AND is_primary=1
    ORDER BY assigned_at DESC LIMIT 1
  `).bind(client.id).first();
  const branchId = assignment && assignment.branch_id ? assignment.branch_id : client.assigned_branch_id;
  const relationshipManagerId = assignment ? assignment.relationship_manager_id : null;
  const currentTeamLeadId = assignment && assignment.team_lead_id ? assignment.team_lead_id : client.team_lead_id;
  const marketerId = relationshipManagerId || client.original_marketer_id;
  let userId = null;
  let source = "current_assignment";

  if (roleName === "Marketer") {
    if (relationshipManagerId) {
      const current = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND u.is_active=1 AND r.name='Marketer'
      `).bind(relationshipManagerId).first();
      if (current) userId = current.id;
    }
    if (!userId && client.original_marketer_id) {
      const original = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND u.is_active=1 AND r.name='Marketer'
      `).bind(client.original_marketer_id).first();
      if (original) { userId = original.id; source = "original_attribution"; }
    }
  } else if (roleName === "Team Lead") {
    const candidate = currentTeamLeadId || client.team_lead_id;
    if (candidate) {
      const lead = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND u.is_active=1 AND r.name='Team Lead'
      `).bind(candidate).first();
      if (lead) userId = lead.id;
    }
  } else if (roleName === "Branch Manager") {
    const manager = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.branch_id=? AND u.is_active=1 AND r.name='Branch Manager'
      ORDER BY u.id LIMIT 1
    `).bind(branchId).first();
    if (manager) { userId = manager.id; source = "branch_manager"; }
  }

  if (!userId) return null;
  return {
    userId,
    role: roleName,
    branchId,
    teamId: await getRecipientTeamId(env, userId, branchId),
    marketerId: marketerId || null,
    teamLeadId: currentTeamLeadId || client.team_lead_id || null,
    relationshipManagerId: relationshipManagerId || null,
    source
  };
}

function withinCommissionPeriod(sourceDate, plan) {
  const date = String(sourceDate || "").slice(0, 10);
  if (!date) return false;
  if (plan.effective_from && date < String(plan.effective_from).slice(0, 10)) return false;
  if (plan.effective_to && date > String(plan.effective_to).slice(0, 10)) return false;
  return true;
}

async function createCommissionPlanVersion(env, planId, versionNo, plan, rules, changeReason, actorId) {
  const snapshot = (rules || []).map(rule => ({
    id: rule.id || null,
    role_name: rule.role_name,
    rate_bps: Number(rule.rate_bps || 0),
    fixed_amount_kobo: Number(rule.fixed_amount_kobo || 0),
    property_category_id: rule.property_category_id || null,
    sales_type: rule.sales_type || null,
    branch_id: rule.branch_id || null,
    team_id: rule.team_id || null,
    is_active: Number(rule.is_active === undefined ? 1 : rule.is_active)
  }));
  const res = await env.DB.prepare(`
    INSERT OR IGNORE INTO commission_plan_versions
      (plan_id, version_no, name, description, calculation_basis, effective_from, effective_to,
       commissionable_mode, commissionable_first_months, commissionable_percent_bps,
       commissionable_cap_kobo, rules_json, change_reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).bind(
    planId, versionNo, plan.name, plan.description || null, plan.calculation_basis,
    plan.effective_from || null, plan.effective_to || null,
    plan.commissionable_mode || "full",
    Number(plan.commissionable_first_months === undefined ? 2 : plan.commissionable_first_months),
    Number(plan.commissionable_percent_bps === undefined ? 10000 : plan.commissionable_percent_bps),
    Number(plan.commissionable_cap_kobo || 0), JSON.stringify(snapshot),
    changeReason || null, actorId
  ).run();
  return res.meta ? res.meta.last_row_id : null;
}

async function commissionableBasisForPayment(env, client, payment, plan) {
  const paymentAmountKobo = Number(payment.amount_kobo || toKobo(payment.amount) || 0);
  const schedule = await env.DB.prepare(`
    SELECT * FROM payment_schedules WHERE client_id=? AND status='active'
    ORDER BY id DESC LIMIT 1
  `).bind(client.id).first();
  const planType = normalizePlanType(schedule ? schedule.plan_type : "outright");
  const easyBuy = isEasyBuyPlan(planType);
  const mode = COMMISSIONABLE_MODES.includes(plan.commissionable_mode) ? plan.commissionable_mode : "full";
  if (!easyBuy || mode === "full") {
    return { commissionableKobo: paymentAmountKobo, paymentAmountKobo, planType, mode };
  }
  const startDate = dateOnly(schedule.start_date) || dateOnly(schedule.created_at) || todayOnly();  if (mode === "first_months") {
    const months = Math.max(0, Number(plan.commissionable_first_months === undefined ? 2 : plan.commissionable_first_months));
    const cutoff = addMonths(startDate, months);
    const paidDate = String(payment.verified_at || "").slice(0, 10);
    const within = paidDate && months > 0 && paidDate <= cutoff;
    return { commissionableKobo: within ? paymentAmountKobo : 0, paymentAmountKobo, planType, mode, cutoff };
  }
  if (mode === "percentage") {
    const bps = Math.min(10000, Math.max(0, Number(plan.commissionable_percent_bps === undefined ? 10000 : plan.commissionable_percent_bps)));
    return {
      commissionableKobo: Math.floor((paymentAmountKobo * bps + 5000) / 10000),
      paymentAmountKobo, planType, mode, percent_bps: bps
    };
  }
  if (mode === "capped_amount") {
    const cap = Math.max(0, Number(plan.commissionable_cap_kobo || 0));
    const priorRow = await env.DB.prepare(`
      SELECT COALESCE(SUM(amount_kobo),0) AS prior FROM payments
      WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
        AND (verified_at < ? OR (verified_at = ? AND id < ?))
    `).bind(client.id, payment.verified_at || "", payment.verified_at || "", payment.id).first();
    const prior = Number(priorRow ? priorRow.prior : 0);
    const before = Math.min(cap, prior);
    const after = Math.min(cap, prior + paymentAmountKobo);
    return {
      commissionableKobo: Math.max(0, after - before),
      paymentAmountKobo, planType, mode, cap_kobo: cap, cumulative_before_kobo: prior
    };
  }
  return { commissionableKobo: paymentAmountKobo, paymentAmountKobo, planType, mode };
}

async function generateCommissionEntries(env, actor, body) {
  const draft = isTruthy(body.draft);
  const planId = body.plan_id ? Number(body.plan_id) : null;
  const clientId = body.client_id ? Number(body.client_id) : null;
  const from = body.from ? dateOnly(body.from) : null;
  const to = body.to ? dateOnly(body.to) : null;
  if (body.from && !from) throw new Error("Invalid from date");
  if (body.to && !to) throw new Error("Invalid to date");

  const planClauses = ["p.is_active=1"];
  const planBinds = [];
  if (planId) { planClauses.push("p.id=?"); planBinds.push(planId); }
  const { results: plans } = await env.DB.prepare(`
    SELECT p.* FROM commission_plans p WHERE ${planClauses.join(" AND ")} ORDER BY p.id
  `).bind(...planBinds).all();

  const clientClauses = [
    "c.is_deleted=0", "c.client_reference NOT LIKE 'DEMO-%'",
    "COALESCE(c.is_internal_test,0)=0", "COALESCE(c.is_archived,0)=0",
    "c.agreed_purchase_price IS NOT NULL", "c.agreed_purchase_price > 0",
    "c.status NOT IN ('Cancelled','Inactive')"
  ];
  const clientBinds = [];
  if (clientId) { clientClauses.push("c.id=?"); clientBinds.push(clientId); }
  const { results: clients } = await env.DB.prepare(`
    SELECT c.*, p.category_id, p.title AS property_title, p.reference AS property_reference
    FROM clients c LEFT JOIN properties p ON p.id=c.interested_property_id
    WHERE ${clientClauses.join(" AND ")}
  `).bind(...clientBinds).all();

  let created = 0;
  let skipped = 0;
  const createdRefs = [];

  for (const client of clients) {
    for (const plan of plans) {
      const { results: planRules } = await env.DB.prepare(`
        SELECT * FROM commission_plan_rules WHERE plan_id=? AND is_active=1 ORDER BY id
      `).bind(plan.id).all();
      if (!planRules.length) continue;
      const currentVersion = await env.DB.prepare(`
        SELECT * FROM commission_plan_versions WHERE plan_id=? ORDER BY version_no DESC LIMIT 1
      `).bind(plan.id).first();
      const planVersionNo = Number(plan.current_version_no || (currentVersion ? currentVersion.version_no : 1) || 1);
      const planVersionId = currentVersion ? currentVersion.id : null;
      // A new plan version never retroactively commissions payments that were
      // already covered by an earlier version.
      const versionCutoff = planVersionNo > 1 && currentVersion ? currentVersion.created_at : null;

      const { results: verifiedPayments } = await env.DB.prepare(`
        SELECT id, amount_kobo, verified_at FROM payments
        WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
          AND COALESCE(is_internal_test,0)=0 AND COALESCE(is_archived,0)=0
        ORDER BY verified_at, id
      `).bind(client.id).all();

      for (const rule of planRules) {
        const recipient = await resolveCommissionRecipient(env, client, rule.role_name);
        if (!recipient) { skipped++; continue; }
        const clientBranch = recipient.branchId || client.assigned_branch_id;
        const clientSaleType = client.sale_type || "New Sale";
        if (rule.branch_id && Number(rule.branch_id) !== Number(clientBranch)) { skipped++; continue; }
        if (rule.team_id && (!recipient.teamId || Number(rule.team_id) !== Number(recipient.teamId))) { skipped++; continue; }
        if (rule.property_category_id && Number(rule.property_category_id) !== Number(client.category_id)) { skipped++; continue; }
        if (rule.sales_type && rule.sales_type !== clientSaleType) { skipped++; continue; }

        const makeEntry = async ({ sourceType, sourceKey, paymentId, qualifyingKobo, sourceDate, metadata, paymentAmountKobo, commissionableMode }) => {
          if (from && String(sourceDate).slice(0, 10) < from) return;
          if (to && String(sourceDate).slice(0, 10) > to) return;
          if (versionCutoff && sourceDate && parseDbDate(sourceDate) < parseDbDate(versionCutoff)) return;
          if (!withinCommissionPeriod(sourceDate, plan)) return;
          const fixed = plan.calculation_basis === "fixed";
          const amount = fixed ? Number(rule.fixed_amount_kobo || 0) : commissionAmount(qualifyingKobo, Number(rule.rate_bps || 0));
          if (!Number.isInteger(amount) || amount <= 0) return;
          const commissionRef = "COM-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
          const status = draft ? "Draft" : "Calculated";
          const res = await env.DB.prepare(`
            INSERT OR IGNORE INTO commission_entries (
              commission_ref, plan_id, rule_id, client_id, property_id, payment_id,
              recipient_user_id, recipient_role, branch_id, team_id, marketer_id, team_lead_id,
              source_type, source_key, basis, qualifying_amount_kobo, rate_bps, commission_kobo,
              status, approval_required, metadata, created_by,
              plan_version_id, plan_version_no, payment_amount_kobo, commissionable_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            commissionRef, plan.id, rule.id, client.id, client.interested_property_id || null, paymentId || null,
            recipient.userId, recipient.role, recipient.branchId, recipient.teamId || null,
            recipient.marketerId, recipient.teamLeadId, sourceType, sourceKey,
            plan.calculation_basis, qualifyingKobo, fixed ? 0 : Number(rule.rate_bps || 0), amount,
            status, plan.approval_required ? 1 : 0,
            metadata ? JSON.stringify(metadata) : null, actor.id,
            planVersionId, planVersionNo, Number(paymentAmountKobo || qualifyingKobo || 0),
            commissionableMode || plan.commissionable_mode || "full"
          ).run();
          if (!res.meta || Number(res.meta.changes) === 0) { skipped++; return; }
          const entryId = res.meta.last_row_id;
          await env.DB.prepare(`
            INSERT INTO commission_attributions (entry_id, marketer_id, team_lead_id, branch_id, team_id,
              relationship_manager_id, source, snapshot_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            entryId, recipient.marketerId, recipient.teamLeadId, recipient.branchId, recipient.teamId || null,
            recipient.relationshipManagerId, recipient.source, JSON.stringify({
              client_id: client.id, client_reference: client.client_reference,
              marketer_id: recipient.marketerId, team_lead_id: recipient.teamLeadId,
              branch_id: recipient.branchId, team_id: recipient.teamId, relationship_manager_id: recipient.relationshipManagerId
            })
          ).run();
          await audit(env, actor.id, "commission.generated", "commission", String(entryId), {
            commission_ref: commissionRef, plan_id: plan.id, rule_id: rule.id,
            recipient_user_id: recipient.userId, recipient_role: recipient.role,
            basis: plan.calculation_basis, commission_kobo: amount, source_type: sourceType
          }, recipient.branchId);
          await createNotification(env, {
            userId: recipient.userId,
            type: "commission.generated",
            title: "Commission Calculated",
            message: `Commission ${commissionRef} of ${formatNGN(amount)} has been calculated for ${client.full_name}.`,
            metadata: { commission_id: entryId, commission_ref: commissionRef }
          });
          created++;
          createdRefs.push(commissionRef);
        };

        if (plan.calculation_basis === "contract_value" || plan.calculation_basis === "fixed") {
          const sourceDate = plan.calculation_basis === "fixed"
            ? (verifiedPayments[0] && verifiedPayments[0].verified_at) || client.created_at
            : client.created_at;
          if (plan.calculation_basis === "fixed" && !verifiedPayments.length) { skipped++; continue; }
          const qualifying = toKobo(client.agreed_purchase_price || 0);
          await makeEntry({
            sourceType: plan.calculation_basis === "fixed" ? "fixed" : "contract",
            sourceKey: `plan:${plan.id}:rule:${rule.id}:client:${client.id}:${plan.calculation_basis}`,
            paymentId: null,
            qualifyingKobo: qualifying,
            sourceDate,
            metadata: { first_payment_id: verifiedPayments[0] ? verifiedPayments[0].id : null }
          });
        } else if (plan.calculation_basis === "verified_collections") {
          for (const payment of verifiedPayments) {
            const basis = await commissionableBasisForPayment(env, client, payment, plan);
            if (!basis.commissionableKobo || basis.commissionableKobo <= 0) { skipped++; continue; }
            await makeEntry({
              sourceType: "payment",
              sourceKey: `plan:${plan.id}:rule:${rule.id}:payment:${payment.id}`,
              paymentId: payment.id,
              qualifyingKobo: basis.commissionableKobo,
              paymentAmountKobo: basis.paymentAmountKobo,
              commissionableMode: basis.mode,
              sourceDate: payment.verified_at,
              metadata: {
                payment_id: payment.id,
                plan_type: basis.planType,
                payment_amount_kobo: basis.paymentAmountKobo,
                commissionable_kobo: basis.commissionableKobo,
                commissionable_mode: basis.mode
              }
            });
          }
        }
      }
    }
  }
  return { created, skipped, created_refs: createdRefs };
}

async function systemCommissionActor(env) {
  const row = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name IN ('Managing Director','Super Admin') AND u.is_active=1
    ORDER BY CASE r.name WHEN 'Managing Director' THEN 0 ELSE 1 END, u.id LIMIT 1
  `).first();
  return row ? { id: row.id } : null;
}

async function autoGenerateCommissionForPayment(env, payment) {
  if (!payment || !payment.id || !payment.client_id) return { skipped: true };
  const actor = await systemCommissionActor(env);
  if (!actor) {
    await markCommissionGenerationFailure(env, payment, "No active MD/Super Admin available for commission actor");
    return { ok: false, error: "No system actor" };
  }

  // The ELPIS referral commission ledger is always recalculated from verified
  // payments, so a failure in a configurable commission plan cannot block it.
  let referralResult = null;
  try {
    referralResult = await recalculateReferralCommissionForClient(env, payment.client_id, actor.id, {
      paymentId: payment.id,
      sourceKey: `referral:client:${payment.client_id}:payment:${payment.id}:verified`,
      eventType: "accrual",
      reason: "Verified payment"
    });
  } catch (referralError) {
    await audit(env, actor.id, "referral_commission.failed", "payment", String(payment.id), {
      client_id: payment.client_id,
      error: String(referralError.message || "Referral commission calculation failed").slice(0, 1000)
    }, null);
  }

  try {
    const result = await generateCommissionEntries(env, actor, { client_id: payment.client_id });
    await env.DB.prepare(`
      UPDATE payments SET commission_state='generated', commission_processed_at=datetime('now'), commission_error=NULL
      WHERE id=?
    `).bind(payment.id).run();
    await env.DB.prepare(`
      UPDATE commission_generation_failures SET resolved_at=datetime('now'), updated_at=datetime('now')
      WHERE payment_id=? AND resolved_at IS NULL
    `).bind(payment.id).run();
    return { ok: true, referral: referralResult, ...result };
  } catch (error) {
    await markCommissionGenerationFailure(env, payment, error.message || "Commission generation failed");
    return { ok: false, error: error.message || "Commission generation failed", referral: referralResult };
  }
}

async function markCommissionGenerationFailure(env, payment, message) {
  const text = String(message || "Commission generation failed").slice(0, 1000);
  await env.DB.prepare(`
    UPDATE payments SET commission_state='failed', commission_error=?, commission_processed_at=datetime('now')
    WHERE id=?
  `).bind(text, payment.id).run();
  await env.DB.prepare(`
    INSERT INTO commission_generation_failures (payment_id, client_id, attempts, last_error, next_retry_at)
    VALUES (?, ?, 1, ?, datetime('now','+15 minutes'))
    ON CONFLICT(payment_id) DO UPDATE SET attempts=attempts+1, last_error=excluded.last_error,
      next_retry_at=datetime('now','+15 minutes'), resolved_at=NULL, updated_at=datetime('now')
  `).bind(payment.id, payment.client_id, text).run();
  await audit(env, null, "commission.generation_failed", "payment", String(payment.id), {
    error: text, client_id: payment.client_id
  }, null);
}

async function retryCommissionGeneration(env) {
  const { results: failures } = await env.DB.prepare(`
    SELECT f.*, p.client_id, p.status AS payment_status
    FROM commission_generation_failures f JOIN payments p ON p.id=f.payment_id
    WHERE f.resolved_at IS NULL AND (f.next_retry_at IS NULL OR f.next_retry_at <= datetime('now'))
    ORDER BY f.id LIMIT 50
  `).all();
  let resolved = 0;
  for (const failure of failures) {
    if (failure.payment_status !== "verified") continue;
    const result = await autoGenerateCommissionForPayment(env, { id: failure.payment_id, client_id: failure.client_id });
    if (result.ok) resolved++;
    else {
      await env.DB.prepare(`
        UPDATE commission_generation_failures SET attempts=attempts+1,
          next_retry_at=datetime('now','+30 minutes'), updated_at=datetime('now') WHERE id=?
      `).bind(failure.id).run();
    }
  }
  return { examined: failures.length, resolved };
}

async function expireTestAccounts(env) {
  const today = currentDate(env);
  const { results } = await env.DB.prepare(`
    SELECT id FROM users WHERE is_test=1 AND is_active=1 AND test_expires_at IS NOT NULL AND date(test_expires_at) < date(?)
  `).bind(today).all();
  for (const row of results) {
    await env.DB.prepare("UPDATE users SET is_active=0, deactivated_at=datetime('now') WHERE id=?").bind(row.id).run();
    await audit(env, null, "test_account.expired", "user", String(row.id), { reason: "14_day_expiry" });
  }
  return { expired: results.length };
}

async function expireMonthlyMarketerAccess(env) {
  const enabled = await monthlyReactivationEnabled(env, "Marketer");
  if (!enabled) return { skipped: true, reason: "setting_off" };
  const today = currentDate(env);
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.branch_id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name='Marketer' AND u.is_active=1 AND u.access_valid_until IS NOT NULL
      AND date(u.access_valid_until) < date(?)
  `).bind(today).all();
  for (const row of results) {
    await env.DB.prepare(`
      UPDATE users SET is_active=0, access_lapsed_at=COALESCE(access_lapsed_at, datetime('now')), updated_at=datetime('now')
      WHERE id=?
    `).bind(row.id).run();
    await audit(env, null, "marketer.access_lapsed", "user", String(row.id), { reason: "month_end" }, row.branch_id);
  }
  return { lapsed: results.length };
}



async function applyPaymentCommissionAdjustments(env, payment, adjustmentType, actorId, reason) {
  const { results: entries } = await env.DB.prepare(`
    SELECT ce.* FROM commission_entries ce
    WHERE ce.payment_id=? AND ce.basis='verified_collections'
      AND ce.status NOT IN ('Rejected','Cancelled')
  `).bind(payment.id).all();
  for (const entry of entries) {
    const sourceKey = `payment:${payment.id}:entry:${entry.id}:${adjustmentType}`;
    const adjustment = await env.DB.prepare(`
      INSERT OR IGNORE INTO commission_adjustments
        (entry_id, adjustment_type, amount_kobo, reason, source_payment_id, source_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(entry.id, adjustmentType, -Number(entry.commission_kobo || 0), reason || "Client payment adjusted", payment.id, sourceKey, actorId).run();
    if (!adjustment.meta || Number(adjustment.meta.changes) === 0) continue;
    const newAdjusted = Number(entry.adjusted_kobo || 0) - Number(entry.commission_kobo || 0);
    const net = Number(entry.commission_kobo || 0) + newAdjusted;
    const newStatus = net <= 0 ? "Reversed" : entry.status;
    await env.DB.prepare(`
      UPDATE commission_entries SET adjusted_kobo=?, status=?, updated_at=datetime('now') WHERE id=?
    `).bind(newAdjusted, newStatus, entry.id).run();
    await audit(env, actorId, "commission.adjusted", "commission", String(entry.id), {
      adjustment_type: adjustmentType, amount_kobo: -Number(entry.commission_kobo || 0),
      source_payment_id: payment.id, reason
    }, entry.branch_id);
    await createNotification(env, {
      userId: entry.recipient_user_id,
      type: "commission.adjusted",
      title: "Commission Adjusted",
      message: `Commission ${entry.commission_ref} was adjusted by ${formatNGN(-Number(entry.commission_kobo || 0))} after a payment ${adjustmentType}.`,
      metadata: { commission_id: entry.id, source_payment_id: payment.id }
    });
  }

  // Recalculate the ELPIS referral ledger from verified payments. Reversed or
  // refunded transactions disappear from the cumulative total automatically.
  try {
    await recalculateReferralCommissionForClient(env, payment.client_id, actorId, {
      paymentId: payment.id,
      sourceKey: `referral:client:${payment.client_id}:payment:${payment.id}:${adjustmentType}`,
      eventType: adjustmentType === "refund" ? "adjustment" : "reversal",
      reason: reason || `Client payment ${adjustmentType}`
    });
  } catch (error) {
    await audit(env, actorId, "referral_commission.reversal_failed", "payment", String(payment.id), {
      error: String(error.message || "Referral commission reversal failed").slice(0, 1000)
    }, payment.client_branch_id || null);
  }
}

function reportDateRange(filters) {
  const today = todayOnly();
  const from = dateOnly(filters.from) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = dateOnly(filters.to) || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

async function buildReportDataset(env, actor, scope, filters) {
  const type = filters.report_type;
  const range = reportDateRange(filters);
  const clientScope = clientScopeSql(scope, "c");
  const commissionScope = commissionScopeSql(scope, "ce");
  const clientBinds = [...clientScope.binds];
  const branchFilter = ["Managing Director", "Finance Officer"].includes(scope.role) && filters.branch_id ? " AND c.assigned_branch_id=?" : "";
  if (branchFilter) clientBinds.push(Number(filters.branch_id));
  let clientExtraFilter = "";
  const clientExtraBinds = [];
  if (["Managing Director", "Finance Officer", "Branch Manager"].includes(scope.role)) {
    if (filters.marketer_id) {
      clientExtraFilter += " AND c.original_marketer_id=?";
      clientExtraBinds.push(Number(filters.marketer_id));
    }
    if (filters.team_id) {
      clientExtraFilter += " AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id=c.original_marketer_id AND tm.team_id=?)";
      clientExtraBinds.push(Number(filters.team_id));
    }
  }
  const commissionBinds = [...commissionScope.binds];
  let commissionExtra = "";
  if (["Managing Director", "Finance Officer"].includes(scope.role)) {
    if (filters.branch_id) { commissionExtra += " AND ce.branch_id=?"; commissionBinds.push(Number(filters.branch_id)); }
    if (filters.team_id) { commissionExtra += " AND ce.team_id=?"; commissionBinds.push(Number(filters.team_id)); }
    if (filters.marketer_id) { commissionExtra += " AND ce.marketer_id=?"; commissionBinds.push(Number(filters.marketer_id)); }
  }
  const filterLabel = `From ${range.from} to ${range.to}` +
    (filters.branch_id ? `; branch ${filters.branch_id}` : "") +
    (filters.team_id ? `; team ${filters.team_id}` : "") +
    (filters.marketer_id ? `; marketer ${filters.marketer_id}` : "");
  const reportTestFilter = filters.include_test ? "" : " AND COALESCE(c.is_internal_test,0)=0 AND COALESCE(c.is_archived,0)=0";
  const paymentTestFilter = filters.include_test ? "" : " AND COALESCE(p.is_internal_test,0)=0 AND COALESCE(p.is_archived,0)=0";

  if (type === "sales") {
    const { results } = await env.DB.prepare(`
      SELECT c.client_reference, c.full_name, c.status, c.sale_type,
             b.name AS branch_name, m.full_name AS marketer_name,
             c.agreed_purchase_price, c.created_at
      FROM clients c
      LEFT JOIN branches b ON b.id=c.assigned_branch_id
      LEFT JOIN users m ON m.id=c.original_marketer_id
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.status NOT IN ('Cancelled','Inactive') AND ${clientScope.clause}${branchFilter}${clientExtraFilter}${reportTestFilter}
        AND date(c.created_at) BETWEEN date(?) AND date(?)
      ORDER BY c.created_at DESC
    `).bind(...clientBinds, ...clientExtraBinds, range.from, range.to).all();
    const total = results.reduce((sum, row) => sum + toKobo(row.agreed_purchase_price || 0), 0);
    return {
      title: "Sales Report",
      columns: ["Client Ref", "Client", "Status", "Sale Type", "Branch", "Marketer", "Contract Value", "Created"],
      rows: results.map(row => [row.client_reference, row.full_name, row.status, row.sale_type, row.branch_name || "-", row.marketer_name || "-", formatNGN(toKobo(row.agreed_purchase_price || 0)), String(row.created_at).slice(0, 10)]),
      summaryLines: [`Contracts: ${results.length}`, `Contract sales value: ${formatNGN(total)}`],
      filtersLabel: filterLabel
    };
  }

  if (type === "collections") {
    const { results } = await env.DB.prepare(`
      SELECT p.transaction_ref, c.client_reference, c.full_name, b.name AS branch_name,
             p.amount_kobo, p.method, p.verified_at
      FROM payments p JOIN clients c ON c.id=p.client_id
      LEFT JOIN branches b ON b.id=c.assigned_branch_id
      WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN'${paymentTestFilter}
        AND ${clientScope.clause}${branchFilter}${clientExtraFilter}
        AND date(p.verified_at) BETWEEN date(?) AND date(?)
      ORDER BY p.verified_at DESC
    `).bind(...clientBinds, ...clientExtraBinds, range.from, range.to).all();
    const total = results.reduce((sum, row) => sum + Number(row.amount_kobo || 0), 0);
    return {
      title: "Collections Report",
      columns: ["Payment Ref", "Client Ref", "Client", "Branch", "Amount", "Method", "Verified"],
      rows: results.map(row => [row.transaction_ref, row.client_reference, row.full_name, row.branch_name || "-", formatNGN(row.amount_kobo), row.method, String(row.verified_at).slice(0, 10)]),
      summaryLines: [`Verified payments: ${results.length}`, `Verified collections: ${formatNGN(total)}`],
      filtersLabel: filterLabel
    };
  }

  if (type === "outstanding") {
    const { results } = await env.DB.prepare(`
      SELECT c.client_reference, c.full_name, b.name AS branch_name,
             c.agreed_purchase_price,
             COALESCE((SELECT SUM(p.amount_kobo) FROM payments p
               WHERE p.client_id=c.id AND p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
                 AND COALESCE(p.is_internal_test,0)=0 AND COALESCE(p.is_archived,0)=0),0) AS verified_kobo
      FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.agreed_purchase_price IS NOT NULL AND c.agreed_purchase_price > 0
        AND ${clientScope.clause}${branchFilter}${clientExtraFilter}${reportTestFilter}
      ORDER BY c.agreed_purchase_price DESC
    `).bind(...clientBinds, ...clientExtraBinds).all();
    const rows = results.map(row => {
      const contract = toKobo(row.agreed_purchase_price || 0);
      const verified = Number(row.verified_kobo || 0);
      return { row, contract, verified, outstanding: Math.max(0, contract - verified) };
    });
    return {
      title: "Outstanding Balances Report",
      columns: ["Client Ref", "Client", "Branch", "Contract Value", "Verified", "Outstanding"],
      rows: rows.map(({ row, contract, verified, outstanding }) => [row.client_reference, row.full_name, row.branch_name || "-", formatNGN(contract), formatNGN(verified), formatNGN(outstanding)]),
      summaryLines: [
        `Clients: ${rows.length}`,
        `Contract value: ${formatNGN(rows.reduce((s, r) => s + r.contract, 0))}`,
        `Outstanding: ${formatNGN(rows.reduce((s, r) => s + r.outstanding, 0))}`
      ],
      filtersLabel: filterLabel
    };
  }

  if (type === "commission" || type === "commission_liability") {
    const liabilityOnly = type === "commission_liability";
    const { results } = await env.DB.prepare(`
      SELECT ce.commission_ref, ce.recipient_role, u.full_name AS recipient_name,
             c.client_reference, c.full_name AS client_name, cp.name AS plan_name,
             ce.basis, ce.commission_kobo, ce.qualifying_amount_kobo, ce.paid_kobo,
             ce.adjusted_kobo, ce.status, ce.created_at,
             MAX(0, ce.commission_kobo + ce.adjusted_kobo - ce.paid_kobo) AS outstanding_kobo
      FROM commission_entries ce
      JOIN users u ON u.id=ce.recipient_user_id
      JOIN clients c ON c.id=ce.client_id
      JOIN commission_plans cp ON cp.id=ce.plan_id
      WHERE ${commissionScope.clause}${commissionExtra}
        AND date(ce.created_at) BETWEEN date(?) AND date(?)
        ${liabilityOnly ? "AND ce.status IN ('Approved','Partially Paid','Paid','Reversed')" : ""}
        ${filters.include_test ? "" : "AND COALESCE(c.is_internal_test,0)=0 AND COALESCE(c.is_archived,0)=0"}
      ORDER BY ce.created_at DESC
    `).bind(...commissionBinds, range.from, range.to).all();
    const total = results.reduce((sum, row) => sum + Number(row.commission_kobo || 0), 0);
    const outstanding = results.reduce((sum, row) => sum + Number(row.outstanding_kobo || 0), 0);
    return {
      title: liabilityOnly ? "Commission Liability Report" : "Commission Report",
      columns: ["Commission Ref", "Recipient", "Role", "Client", "Plan", "Basis", "Earned", "Paid", "Outstanding", "Status", "Created"],
      rows: results.map(row => [row.commission_ref, row.recipient_name, row.recipient_role, row.client_name, row.plan_name, row.basis, formatNGN(row.commission_kobo), formatNGN(row.paid_kobo), formatNGN(row.outstanding_kobo), row.status, String(row.created_at).slice(0, 10)]),
      summaryLines: [`Commission entries: ${results.length}`, `Commission earned: ${formatNGN(total)}`, `Commission outstanding: ${formatNGN(outstanding)}`],
      filtersLabel: filterLabel
    };
  }

  if (type === "branch_performance" || type === "marketer_performance") {
    const reportUrl = new URL("http://local/api/reports");
    reportUrl.searchParams.set("from", range.from);
    reportUrl.searchParams.set("to", range.to);
    if (filters.branch_id) reportUrl.searchParams.set("branch_id", filters.branch_id);
    if (filters.property_category_id) reportUrl.searchParams.set("property_category_id", filters.property_category_id);
    const analytics = await buildAnalytics(env, actor, scope, reportUrl);
    if (type === "branch_performance") {
      const rows = analytics.branch_comparison || [];
      return {
        title: "Branch Performance Report",
        columns: ["Branch", "Properties", "Clients", "Contract Value", "Verified", "Outstanding", "Leads", "Conversions"],
        rows: rows.map(row => [row.branch_name, row.properties, row.clients, formatNGN(row.contract_value_kobo), formatNGN(row.verified_kobo), formatNGN(row.outstanding_kobo), row.leads, row.conversions]),
        summaryLines: [`Branches: ${rows.length}`],
        filtersLabel: filterLabel
      };
    }
    const rows = analytics.marketer_rankings || [];
    return {
      title: "Marketer Performance Report",
      columns: ["Marketer", "Branch", "Clients", "Leads", "Converted", "Contract Value", "Verified", "Outstanding"],
      rows: rows.map(row => [row.full_name, row.branch_name || "-", row.clients_count, row.leads_count, row.converted_count, formatNGN(row.contract_value_kobo), formatNGN(row.verified_kobo), formatNGN(row.outstanding_kobo)]),
      summaryLines: [`Marketers: ${rows.length}`, `Verified collections: ${formatNGN(rows.reduce((s, r) => s + r.verified_kobo, 0))}`],
      filtersLabel: filterLabel
    };
  }

  if (type === "refunds") {
    const { results } = await env.DB.prepare(`
      SELECT fa.adjustment_type, p.transaction_ref, c.client_reference, c.full_name,
             b.name AS branch_name, fa.amount_kobo, fa.reason, fa.created_at
      FROM financial_adjustments fa
      JOIN payments p ON p.id=fa.payment_id
      JOIN clients c ON c.id=p.client_id
      LEFT JOIN branches b ON b.id=c.assigned_branch_id
      WHERE ${clientScope.clause}${branchFilter} AND p.is_demo=0
        AND date(fa.created_at) BETWEEN date(?) AND date(?)
      ORDER BY fa.created_at DESC
    `).bind(...clientBinds, range.from, range.to).all();
    return {
      title: "Refund and Reversal Report",
      columns: ["Type", "Payment Ref", "Client", "Branch", "Amount", "Reason", "Date"],
      rows: results.map(row => [row.adjustment_type, row.transaction_ref, row.full_name, row.branch_name || "-", formatNGN(Math.abs(Number(row.amount_kobo || 0))), row.reason, String(row.created_at).slice(0, 10)]),
      summaryLines: [`Adjustments: ${results.length}`, `Total adjusted: ${formatNGN(results.reduce((s, r) => s + Math.abs(Number(r.amount_kobo || 0)), 0))}`],
      filtersLabel: filterLabel
    };
  }

  throw new Error("Unsupported report type");
}

async function queryActivities(env, scope, url, defaultLimit = 20) {
  const activityScope = activityScopeSql(scope, "al");
  const clauses = [activityScope.clause];
  const binds = [...activityScope.binds];
  const type = url.searchParams.get("type");
  const actorId = url.searchParams.get("actor_id");
  const from = dateOnly(url.searchParams.get("from"));
  const to = dateOnly(url.searchParams.get("to"));
  if (type) { clauses.push("al.action LIKE ?"); binds.push(`${type}%`); }
  if (actorId) { clauses.push("al.actor_user_id = ?"); binds.push(actorId); }
  if (from) { clauses.push("date(al.created_at) >= date(?)"); binds.push(from); }
  if (to) { clauses.push("date(al.created_at) <= date(?)"); binds.push(to); }
  const whereSql = "WHERE " + clauses.join(" AND ");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || String(defaultLimit), 10)));
  const offset = (page - 1) * limit;
  const { results } = await env.DB.prepare(`
    SELECT al.id, al.action, al.target_type, al.target_id, al.metadata, al.created_at,
           al.actor_user_id, al.branch_id, u.full_name AS actor_name,
           r.name AS actor_role, b.name AS branch_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id=al.actor_user_id
    LEFT JOIN roles r ON r.id=u.role_id
    LEFT JOIN branches b ON b.id=al.branch_id
    ${whereSql}
    ORDER BY al.id DESC LIMIT ? OFFSET ?
  `).bind(...binds, limit, offset).all();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM audit_logs al ${whereSql}`).bind(...binds).first();
  return {
    activities: results.map(row => {
      let metadata = null;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { metadata = null; }
      return { ...row, metadata };
    }),
    pagination: { page, limit, total: count ? count.c : 0 }
  };
}

async function buildAnalytics(env, actor, scope, url) {
  const range = defaultDateRange(url);
  const includeTest = url.searchParams.get("include_test") === "1";
  const clientScope = clientScopeSql(scope, "c");
  const financeScope = scope.role === "Finance Officer";
  // Finance receives financial analytics only; lead/staff operational data is
  // intentionally outside its authorised reporting scope.
  const leadScope = financeScope ? { clause: "1=0", binds: [] } : leadScopeSql(scope, "l");
  const canCompanyReport = ["Managing Director", "Finance Officer"].includes(scope.role);
  const requestedBranch = url.searchParams.get("branch_id");
  const branchId = canCompanyReport && requestedBranch ? Number(requestedBranch) : null;

  const clientBinds = [...clientScope.binds];
  const leadBinds = [...leadScope.binds];
  let clientBranch = "";
  let leadBranch = "";
  if (canCompanyReport && branchId) {
    clientBranch = " AND c.assigned_branch_id=?";
    clientBinds.push(branchId);
    leadBranch = " AND l.branch_id=?";
    leadBinds.push(branchId);
  }
  const requestedCategory = url.searchParams.get("property_category_id");
  const categoryBinds = requestedCategory ? [Number(requestedCategory)] : [];
  let categoryFilter = "";
  if (requestedCategory) {
    categoryFilter = " AND c.interested_property_id IN (SELECT id FROM properties WHERE category_id=?)";
    clientBinds.push(Number(requestedCategory));
  }

  const clientWhere = `c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%' AND ${clientScope.clause}${clientBranch}${categoryFilter}${includeTest ? "" : " AND COALESCE(c.is_internal_test,0)=0 AND COALESCE(c.is_archived,0)=0"}`;
  const leadWhere = `l.is_demo=0 AND ${leadScope.clause}${leadBranch}`;
  const paymentWhere = `p.status='verified' AND p.is_demo=0 AND p.currency='NGN' AND ${clientScope.clause}${clientBranch}${categoryFilter}${includeTest ? "" : " AND COALESCE(p.is_internal_test,0)=0 AND COALESCE(p.is_archived,0)=0"}`;

  const clientAgg = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN c.status IN ('Active Buyer','Completed') THEN 1 ELSE 0 END) AS active_clients,
           SUM(CASE WHEN c.status='Prospect' THEN 1 ELSE 0 END) AS prospects,
           COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value
    FROM clients c WHERE ${clientWhere}
  `).bind(...clientBinds).first();

  const paymentAgg = await env.DB.prepare(`
    SELECT COALESCE(SUM(p.amount_kobo),0) AS verified_kobo, COUNT(*) AS verified_count
    FROM payments p JOIN clients c ON c.id=p.client_id
    WHERE ${paymentWhere}
  `).bind(...clientBinds).first();

  const leadAgg = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN l.status='Converted' THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN l.status IN (${LEAD_OPEN_STATUSES.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS open_leads
    FROM leads l WHERE ${leadWhere}
  `).bind(...LEAD_OPEN_STATUSES, ...leadBinds).first();

  const dueFollowUps = await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM leads l
    WHERE ${leadWhere} AND l.next_follow_up_date IS NOT NULL
      AND date(l.next_follow_up_date) <= date('now')
      AND l.status NOT IN ('Converted','Lost')
  `).bind(...leadBinds).first();

  let propertyWhere = "1=1";
  let propertyBinds = [];
  if (canCompanyReport) {
    if (branchId) {
      propertyWhere = "p.branch_id=?";
      propertyBinds = [branchId];
    }
  } else if (scope.role === "Branch Manager") {
    propertyWhere = "p.branch_id=?";
    propertyBinds = [scope.branchId];
  } else {
    propertyWhere = `p.id IN (
      SELECT c.interested_property_id FROM clients c
      WHERE c.interested_property_id IS NOT NULL AND c.is_deleted=0
        AND c.client_reference NOT LIKE 'DEMO-%' AND ${clientScope.clause}${clientBranch}
    )`;
    propertyBinds = [...clientBinds];
  }

  const propertyAgg = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN p.is_published=1 THEN 1 ELSE 0 END) AS published,
           SUM(CASE WHEN p.status='Available' THEN 1 ELSE 0 END) AS available,
           SUM(CASE WHEN p.status='Reserved' THEN 1 ELSE 0 END) AS reserved,
           SUM(CASE WHEN p.status='Sold' THEN 1 ELSE 0 END) AS sold,
           SUM(CASE WHEN p.status='Unavailable' THEN 1 ELSE 0 END) AS unavailable
    FROM properties p WHERE ${propertyWhere}
  `).bind(...propertyBinds).first();

  let staffWhere = financeScope ? "1=0" : "u.is_active=1 AND r.name<>'Client'";
  let staffBinds = [];
  if (!financeScope && scope.role === "Branch Manager") {
    staffWhere += " AND u.branch_id=?";
    staffBinds = [scope.branchId];
  } else if (!financeScope && scope.role === "Team Lead") {
    staffWhere += ` AND u.id IN (${placeholders(scope.memberIds)})`;
    staffBinds = [...scope.memberIds];
  } else if (!financeScope && scope.role === "Marketer") {
    staffWhere += " AND u.id=?";
    staffBinds = [scope.actorId];
  }
  const staffAgg = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN r.name='Marketer' THEN 1 ELSE 0 END) AS marketers,
           SUM(CASE WHEN r.name='Team Lead' THEN 1 ELSE 0 END) AS team_leads
    FROM users u JOIN roles r ON r.id=u.role_id WHERE ${staffWhere}
  `).bind(...staffBinds).first();

  const periodClient = await env.DB.prepare(`
    SELECT COUNT(*) AS new_clients, COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value
    FROM clients c
    WHERE ${clientWhere} AND date(c.created_at) BETWEEN date(?) AND date(?)
  `).bind(...clientBinds, range.from, range.to).first();

  const periodPayment = await env.DB.prepare(`
    SELECT COALESCE(SUM(p.amount_kobo),0) AS verified_kobo, COUNT(*) AS verified_count
    FROM payments p JOIN clients c ON c.id=p.client_id
    WHERE ${paymentWhere} AND date(p.verified_at) BETWEEN date(?) AND date(?)
  `).bind(...clientBinds, range.from, range.to).first();

  const periodLead = await env.DB.prepare(`
    SELECT COUNT(*) AS generated,
           SUM(CASE WHEN l.status='Converted' THEN 1 ELSE 0 END) AS converted
    FROM leads l
    WHERE ${leadWhere} AND date(l.created_at) BETWEEN date(?) AND date(?)
  `).bind(...leadBinds, range.from, range.to).first();

  const periodConversions = await env.DB.prepare(`
    SELECT COUNT(*) AS converted
    FROM leads l
    WHERE ${leadWhere} AND l.converted_at IS NOT NULL
      AND date(l.converted_at) BETWEEN date(?) AND date(?)
  `).bind(...leadBinds, range.from, range.to).first();

  // Trend buckets
  const paymentGroup = periodSql("p.verified_at", range.granularity);
  const contractGroup = periodSql("c.created_at", range.granularity);
  const leadGroup = periodSql("l.created_at", range.granularity);
  const conversionGroup = periodSql("l.converted_at", range.granularity);

  const { results: paymentTrend } = await env.DB.prepare(`
    SELECT ${paymentGroup} AS period, COALESCE(SUM(p.amount_kobo),0) AS verified_kobo
    FROM payments p JOIN clients c ON c.id=p.client_id
    WHERE ${paymentWhere} AND date(p.verified_at) BETWEEN date(?) AND date(?)
    GROUP BY period ORDER BY period
  `).bind(...clientBinds, range.from, range.to).all();

  const { results: contractTrend } = await env.DB.prepare(`
    SELECT ${contractGroup} AS period, COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value
    FROM clients c
    WHERE ${clientWhere} AND date(c.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period ORDER BY period
  `).bind(...clientBinds, range.from, range.to).all();

  const { results: leadTrend } = await env.DB.prepare(`
    SELECT ${leadGroup} AS period, COUNT(*) AS leads
    FROM leads l
    WHERE ${leadWhere} AND date(l.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period ORDER BY period
  `).bind(...leadBinds, range.from, range.to).all();

  const { results: conversionTrend } = await env.DB.prepare(`
    SELECT ${conversionGroup} AS period, COUNT(*) AS conversions
    FROM leads l
    WHERE ${leadWhere} AND l.converted_at IS NOT NULL
      AND date(l.converted_at) BETWEEN date(?) AND date(?)
    GROUP BY period ORDER BY period
  `).bind(...leadBinds, range.from, range.to).all();

  const trendMap = new Map();
  for (const key of buildPeriodKeys(range.from, range.to, range.granularity)) {
    trendMap.set(key, { period: key, verified_kobo: 0, contract_value: 0, leads: 0, conversions: 0 });
  }
  const ensureTrend = (key) => {
    if (!trendMap.has(key)) {
      trendMap.set(key, { period: key, verified_kobo: 0, contract_value: 0, leads: 0, conversions: 0 });
    }
    return trendMap.get(key);
  };
  for (const row of paymentTrend) ensureTrend(row.period).verified_kobo = Number(row.verified_kobo);
  for (const row of contractTrend) ensureTrend(row.period).contract_value = Number(row.contract_value);
  for (const row of leadTrend) ensureTrend(row.period).leads = Number(row.leads);
  for (const row of conversionTrend) ensureTrend(row.period).conversions = Number(row.conversions);
  const trends = [...trendMap.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));

  const { results: pipelineRows } = await env.DB.prepare(`
    SELECT l.status, COUNT(*) AS count FROM leads l
    WHERE ${leadWhere} GROUP BY l.status
  `).bind(...leadBinds).all();
  const leadPipeline = {};
  for (const status of LEAD_STATUSES) leadPipeline[status] = 0;
  for (const row of pipelineRows) leadPipeline[row.status] = Number(row.count);

  // Branch comparison (company-wide / branch users only)
  let branchComparison = [];
  if (["Managing Director", "Branch Manager", "Finance Officer"].includes(scope.role)) {
    let branchSql = "SELECT id, name FROM branches";
    const branchBindsList = [];
    if (scope.role === "Branch Manager") {
      branchSql += " WHERE id=?";
      branchBindsList.push(scope.branchId);
    } else if (branchId) {
      branchSql += " WHERE id=?";
      branchBindsList.push(branchId);
    }
    branchSql += " ORDER BY name";
    const { results: branchRows } = await env.DB.prepare(branchSql).bind(...branchBindsList).all();

    const { results: clientByBranch } = await env.DB.prepare(`
      SELECT c.assigned_branch_id AS branch_id, COUNT(*) AS clients,
             COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value,
             SUM(CASE WHEN c.status IN ('Active Buyer','Completed') THEN 1 ELSE 0 END) AS active_clients
      FROM clients c
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%' ${categoryFilter}
      GROUP BY c.assigned_branch_id
    `).bind(...categoryBinds).all();
    const { results: paymentByBranch } = await env.DB.prepare(`
      SELECT c.assigned_branch_id AS branch_id, COALESCE(SUM(p.amount_kobo),0) AS verified_kobo
      FROM payments p JOIN clients c ON c.id=p.client_id
      WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN' ${categoryFilter}
      GROUP BY c.assigned_branch_id
    `).bind(...categoryBinds).all();
    const { results: leadByBranch } = await env.DB.prepare(`
      SELECT l.branch_id, COUNT(*) AS leads,
             SUM(CASE WHEN l.status='Converted' THEN 1 ELSE 0 END) AS conversions
      FROM leads l WHERE l.is_demo=0 GROUP BY l.branch_id
    `).all();
    const propertyCategoryFilter = requestedCategory ? " WHERE p.category_id=?" : "";
    const { results: propertyByBranch } = await env.DB.prepare(`
      SELECT p.branch_id, COUNT(*) AS properties,
             SUM(CASE WHEN p.is_published=1 THEN 1 ELSE 0 END) AS published
      FROM properties p${propertyCategoryFilter} GROUP BY p.branch_id
    `).bind(...categoryBinds).all();
    const clientMap = new Map(clientByBranch.map(r => [r.branch_id, r]));
    const paymentMap = new Map(paymentByBranch.map(r => [r.branch_id, r]));
    const leadMap = financeScope ? new Map() : new Map(leadByBranch.map(r => [r.branch_id, r]));
    const propertyMap = new Map(propertyByBranch.map(r => [r.branch_id, r]));

    branchComparison = branchRows.map(branch => {
      const client = clientMap.get(branch.id) || {};
      const payment = paymentMap.get(branch.id) || {};
      const lead = leadMap.get(branch.id) || {};
      const property = propertyMap.get(branch.id) || {};
      const contractKobo = toKobo(client.contract_value || 0);
      const verifiedKobo = Number(payment.verified_kobo || 0);
      return {
        branch_id: branch.id,
        branch_name: branch.name,
        properties: Number(property.properties || 0),
        published_properties: Number(property.published || 0),
        clients: Number(client.clients || 0),
        active_clients: Number(client.active_clients || 0),
        contract_value_kobo: contractKobo,
        verified_kobo: verifiedKobo,
        outstanding_kobo: Math.max(0, contractKobo - verifiedKobo),
        leads: Number(lead.leads || 0),
        conversions: Number(lead.conversions || 0),
        conversion_rate: Number(lead.leads || 0) > 0 ? Math.round((Number(lead.conversions || 0) / Number(lead.leads)) * 1000) / 10 : 0
      };
    });
  }

  // Marketer rankings
  let marketerWhere = "r.name='Marketer' AND u.is_active=1";
  let marketerBinds = [];
  if (scope.role === "Branch Manager") {
    marketerWhere += " AND u.branch_id=?";
    marketerBinds = [scope.branchId];
  } else if (scope.role === "Team Lead") {
    marketerWhere += ` AND u.id IN (${placeholders(scope.memberIds)})`;
    marketerBinds = [...scope.memberIds];
  } else if (scope.role === "Marketer") {
    marketerWhere += " AND u.id=?";
    marketerBinds = [scope.actorId];
  } else if (branchId) {
    marketerWhere += " AND u.branch_id=?";
    marketerBinds = [branchId];
  }
  const { results: marketerRankings } = await env.DB.prepare(`
    SELECT u.id, u.full_name, b.name AS branch_name,
      (SELECT COUNT(*) FROM clients c WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.assigned_branch_id=u.branch_id AND (c.original_marketer_id=u.id OR c.created_by=u.id)${categoryFilter}) AS clients_count,
      (SELECT COALESCE(SUM(c.agreed_purchase_price),0) FROM clients c WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.assigned_branch_id=u.branch_id AND (c.original_marketer_id=u.id OR c.created_by=u.id)${categoryFilter}) AS contract_value,
      (SELECT COALESCE(SUM(p.amount_kobo),0) FROM payments p JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN' AND c.assigned_branch_id=u.branch_id
          AND (c.original_marketer_id=u.id OR c.created_by=u.id)${categoryFilter}) AS verified_kobo,
      (SELECT COUNT(*) FROM leads l WHERE l.is_demo=0 AND l.branch_id=u.branch_id AND l.assigned_marketer_id=u.id) AS leads_count,
      (SELECT COUNT(*) FROM leads l WHERE l.is_demo=0 AND l.branch_id=u.branch_id AND l.assigned_marketer_id=u.id AND l.status='Converted') AS converted_count
    FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id
    WHERE ${marketerWhere}
    ORDER BY verified_kobo DESC, contract_value DESC, u.full_name
  `).bind(...categoryBinds, ...categoryBinds, ...categoryBinds, ...marketerBinds).all();

  const marketerRankingRows = marketerRankings.map(row => {
    const contractKobo = toKobo(row.contract_value || 0);
    const verifiedKobo = Number(row.verified_kobo || 0);
    return {
      user_id: row.id,
      full_name: row.full_name,
      branch_name: row.branch_name,
      clients_count: Number(row.clients_count || 0),
      contract_value_kobo: contractKobo,
      verified_kobo: verifiedKobo,
      outstanding_kobo: Math.max(0, contractKobo - verifiedKobo),
      leads_count: financeScope ? 0 : Number(row.leads_count || 0),
      converted_count: financeScope ? 0 : Number(row.converted_count || 0),
      conversion_rate: financeScope ? 0 : (Number(row.leads_count || 0) > 0 ? Math.round((Number(row.converted_count || 0) / Number(row.leads_count)) * 1000) / 10 : 0)
    };
  });

  // Team rankings
  let teamWhere = "t.is_active=1";
  let teamBinds = [];
  if (scope.role === "Branch Manager") {
    teamWhere += " AND t.branch_id=?";
    teamBinds = [scope.branchId];
  } else if (["Team Lead", "Marketer"].includes(scope.role)) {
    teamWhere += scope.teamIds.length ? ` AND t.id IN (${placeholders(scope.teamIds)})` : " AND 1=0";
    teamBinds = [...scope.teamIds];
  } else if (branchId) {
    teamWhere += " AND t.branch_id=?";
    teamBinds = [branchId];
  }
  const { results: teamRows } = await env.DB.prepare(`
    SELECT t.id, t.name, t.branch_id, t.team_lead_user_id, b.name AS branch_name, u.full_name AS team_lead_name
    FROM teams t LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN users u ON u.id=t.team_lead_user_id
    WHERE ${teamWhere} ORDER BY t.name
  `).bind(...teamBinds).all();

  const teamRankings = [];
  for (const team of teamRows) {
    const memberCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM team_members WHERE team_id=?").bind(team.id).first();
    const teamClient = await env.DB.prepare(`
      SELECT COUNT(*) AS clients, COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value
      FROM clients c
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND (c.team_lead_id=? OR c.original_marketer_id IN (SELECT user_id FROM team_members WHERE team_id=?))${categoryFilter}
    `).bind(team.team_lead_user_id || -1, team.id, ...categoryBinds).first();
    const teamPayment = await env.DB.prepare(`
      SELECT COALESCE(SUM(p.amount_kobo),0) AS verified_kobo
      FROM payments p JOIN clients c ON c.id=p.client_id
      WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
        AND (c.team_lead_id=? OR c.original_marketer_id IN (SELECT user_id FROM team_members WHERE team_id=?))${categoryFilter}
    `).bind(team.team_lead_user_id || -1, team.id, ...categoryBinds).first();
    const teamLead = financeScope ? null : await env.DB.prepare(`
      SELECT COUNT(*) AS leads, SUM(CASE WHEN status='Converted' THEN 1 ELSE 0 END) AS conversions
      FROM leads WHERE is_demo=0
        AND (team_lead_id=? OR assigned_marketer_id IN (SELECT user_id FROM team_members WHERE team_id=?))
    `).bind(team.team_lead_user_id || -1, team.id).first();
    const contractKobo = toKobo(teamClient ? teamClient.contract_value : 0);
    const verifiedKobo = Number(teamPayment ? teamPayment.verified_kobo : 0);
    const leadCount = financeScope ? 0 : Number(teamLead ? teamLead.leads : 0);
    const conversionCount = financeScope ? 0 : Number(teamLead ? teamLead.conversions : 0);
    teamRankings.push({
      team_id: team.id,
      team_name: team.name,
      branch_id: team.branch_id,
      branch_name: team.branch_name,
      team_lead_name: team.team_lead_name,
      member_count: Number(memberCount ? memberCount.c : 0),
      clients_count: Number(teamClient ? teamClient.clients : 0),
      contract_value_kobo: contractKobo,
      verified_kobo: verifiedKobo,
      outstanding_kobo: Math.max(0, contractKobo - verifiedKobo),
      leads_count: leadCount,
      converted_count: conversionCount,
      conversion_rate: leadCount > 0 ? Math.round((conversionCount / leadCount) * 1000) / 10 : 0
    });
  }
  teamRankings.sort((a, b) => b.verified_kobo - a.verified_kobo || b.contract_value_kobo - a.contract_value_kobo);

  let commissionSummary = { total_count: 0, earned_kobo: 0, gross_earned_kobo: 0, draft_kobo: 0,
    pending_approval_kobo: 0, approved_kobo: 0, paid_kobo: 0, outstanding_kobo: 0, adjusted_kobo: 0 };
  if (canAccessCommissions(actor)) {
    commissionSummary = await getCommissionSummary(env, scope);
  } else if (canViewOwnCommission(actor)) {
    const own = await getCommissionSummary(env, scope);
    commissionSummary = {
      total_count: own.total_count,
      earned_kobo: own.gross_earned_kobo,
      expected_kobo: own.earned_kobo,
      paid_kobo: own.paid_kobo,
      outstanding_kobo: own.outstanding_kobo
    };
  }

  const { results: categoryClientRows } = await env.DB.prepare(`
    SELECT COALESCE(pc.name,'Uncategorised') AS category_name,
           COUNT(*) AS clients,
           COALESCE(SUM(c.agreed_purchase_price),0) AS contract_value
    FROM clients c
    LEFT JOIN properties p ON p.id=c.interested_property_id
    LEFT JOIN property_categories pc ON pc.id=p.category_id
    WHERE ${clientWhere} AND date(c.created_at) BETWEEN date(?) AND date(?)
    GROUP BY category_name ORDER BY contract_value DESC
  `).bind(...clientBinds, range.from, range.to).all();

  const { results: categoryPaymentRows } = await env.DB.prepare(`
    SELECT COALESCE(pc.name,'Uncategorised') AS category_name,
           COALESCE(SUM(p.amount_kobo),0) AS verified_kobo
    FROM payments p
    JOIN clients c ON c.id=p.client_id
    LEFT JOIN properties prop ON prop.id=c.interested_property_id
    LEFT JOIN property_categories pc ON pc.id=prop.category_id
    WHERE ${paymentWhere} AND date(p.verified_at) BETWEEN date(?) AND date(?)
    GROUP BY category_name
  `).bind(...clientBinds, range.from, range.to).all();

  const categoryMap = new Map();
  for (const row of categoryClientRows) {
    categoryMap.set(row.category_name, {
      category_name: row.category_name,
      clients: Number(row.clients || 0),
      contract_value_kobo: toKobo(row.contract_value || 0),
      verified_kobo: 0
    });
  }
  for (const row of categoryPaymentRows) {
    const item = categoryMap.get(row.category_name) || {
      category_name: row.category_name, clients: 0, contract_value_kobo: 0, verified_kobo: 0
    };
    item.verified_kobo = Number(row.verified_kobo || 0);
    categoryMap.set(row.category_name, item);
  }
  const propertyCategorySales = [...categoryMap.values()]
    .sort((a, b) => b.contract_value_kobo - a.contract_value_kobo);

  const { results: refundRows } = await env.DB.prepare(`
    SELECT fa.adjustment_type, COUNT(*) AS count, COALESCE(SUM(fa.amount_kobo),0) AS amount_kobo
    FROM financial_adjustments fa
    JOIN payments p ON p.id=fa.payment_id
    JOIN clients c ON c.id=p.client_id
    WHERE ${clientScope.clause}${clientBranch}${categoryFilter} AND p.is_demo=0
      AND date(fa.created_at) BETWEEN date(?) AND date(?)
    GROUP BY fa.adjustment_type
  `).bind(...clientBinds, range.from, range.to).all();
  const refundSummary = refundRows.map(row => ({
    adjustment_type: row.adjustment_type,
    count: Number(row.count || 0),
    amount_kobo: Math.abs(Number(row.amount_kobo || 0))
  }));

  const contractKobo = toKobo(clientAgg ? clientAgg.contract_value : 0);
  const verifiedKobo = Number(paymentAgg ? paymentAgg.verified_kobo : 0);
  const leadsGenerated = Number(periodLead ? periodLead.generated : 0);
  const conversions = Number(periodConversions ? periodConversions.converted : 0);

  return {
    range,
    scope: {
      role: scope.role,
      branch_id: scope.branchId,
      team_ids: scope.teamIds,
      member_ids: scope.memberIds
    },
    summary: {
      properties: {
        total: Number(propertyAgg ? propertyAgg.total : 0),
        published: Number(propertyAgg ? propertyAgg.published : 0),
        available: Number(propertyAgg ? propertyAgg.available : 0),
        reserved: Number(propertyAgg ? propertyAgg.reserved : 0),
        sold: Number(propertyAgg ? propertyAgg.sold : 0),
        unavailable: Number(propertyAgg ? propertyAgg.unavailable : 0)
      },
      clients: {
        total: Number(clientAgg ? clientAgg.total : 0),
        active: Number(clientAgg ? clientAgg.active_clients : 0),
        prospects: Number(clientAgg ? clientAgg.prospects : 0)
      },
      staff: {
        total: Number(staffAgg ? staffAgg.total : 0),
        marketers: Number(staffAgg ? staffAgg.marketers : 0),
        team_leads: Number(staffAgg ? staffAgg.team_leads : 0)
      },
      leads: {
        total: Number(leadAgg ? leadAgg.total : 0),
        open: Number(leadAgg ? leadAgg.open_leads : 0),
        converted: Number(leadAgg ? leadAgg.converted : 0),
        conversion_rate: Number(leadAgg && leadAgg.total) > 0
          ? Math.round((Number(leadAgg.converted || 0) / Number(leadAgg.total)) * 1000) / 10 : 0,
        follow_ups_due: Number(dueFollowUps ? dueFollowUps.c : 0)
      },
      financials: {
        contract_sales_value_kobo: contractKobo,
        verified_payments_kobo: verifiedKobo,
        outstanding_balances_kobo: Math.max(0, contractKobo - verifiedKobo)
      },
      commissions: commissionSummary
    },
    period: {
      new_clients: Number(periodClient ? periodClient.new_clients : 0),
      contract_value_kobo: toKobo(periodClient ? periodClient.contract_value : 0),
      verified_kobo: Number(periodPayment ? periodPayment.verified_kobo : 0),
      verified_count: Number(periodPayment ? periodPayment.verified_count : 0),
      leads_generated: leadsGenerated,
      conversions,
      conversion_rate: leadsGenerated > 0 ? Math.round((conversions / leadsGenerated) * 1000) / 10 : 0
    },
    trends,
    branch_comparison: branchComparison,
    marketer_rankings: marketerRankingRows,
    team_rankings: teamRankings,
    lead_pipeline: leadPipeline,
    property_category_sales: propertyCategorySales,
    refund_summary: refundSummary
  };
}
function formatNGN(kobo) {
  return "₦" + (fromKobo(kobo)).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Permanent / dedicated payment accounts are displayed as
// "Client Name / Bliss Legacy Limited" on every client-facing screen.
const VIRTUAL_ACCOUNT_COMPANY_NAME = "Bliss Legacy Limited";
function clientVirtualAccountName(client) {
  const name = String((client && client.full_name) || "").trim() || "Bliss Client";
  return `${name} / ${VIRTUAL_ACCOUNT_COMPANY_NAME}`;
}

// Demo data is only accepted outside production unless explicitly enabled.
function demoEnabled(env) {
  return env.ENVIRONMENT !== "production" || env.DEMO_MODE_ENABLED === "true";
}

function validPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC) and our ISO
// timestamps include "T" and "Z". Normalise both before comparing.
function parseDbDate(value) {
  if (!value) return new Date(NaN);
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
    return new Date(str.replace(" ", "T") + "Z");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(str + "T00:00:00Z");
  }
  return new Date(str);
}

function validateScheduleInput({ totalKobo, depositKobo, installmentKobo, frequencyDays, nextDue, status }) {
  if (!Number.isInteger(totalKobo) || totalKobo <= 0) return { error: "Total agreed price must be a positive amount" };
  if (!Number.isInteger(depositKobo) || depositKobo < 0) return { error: "Deposit amount is invalid" };
  if (depositKobo > totalKobo) return { error: "Deposit cannot exceed the total agreed price" };
  if (!Number.isInteger(installmentKobo) || installmentKobo <= 0) return { error: "Installment amount must be a positive amount" };
  if (!Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > 365) return { error: "Frequency must be between 1 and 365 days" };
  if (!nextDue || !/^\d{4}-\d{2}-\d{2}/.test(String(nextDue)) || isNaN(new Date(nextDue).getTime())) {
    return { error: "A valid next due date (YYYY-MM-DD) is required" };
  }
  if (status && !["active", "completed", "cancelled"].includes(status)) return { error: "Invalid schedule status" };
  return { ok: true };
}

function normalizePlanType(value, fallback = "outright") {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    "outright": "outright", "full": "outright", "full_payment": "outright",
    "part": "part_payment", "part_payment": "part_payment", "partpay": "part_payment",
    "daily": "daily", "weekly": "weekly", "bi_monthly": "bi_monthly",
    "bimonthly": "bi_monthly", "bi_weekly": "bi_monthly", "fortnightly": "bi_monthly",
    "monthly": "monthly"
  };
  return aliases[raw] || fallback;
}

function isEasyBuyPlan(planType) {
  return EASY_BUY_PLAN_TYPES.includes(normalizePlanType(planType));
}

function addDays(dateText, days) {
  const date = new Date(String(dateText).slice(0, 10) + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function addMonths(dateText, months) {
  const date = new Date(String(dateText).slice(0, 10) + "T00:00:00Z");
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function diffDays(fromDate, toDate) {
  const from = new Date(String(fromDate).slice(0, 10) + "T00:00:00Z");
  const to = new Date(String(toDate).slice(0, 10) + "T00:00:00Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  return Math.floor((to - from) / 86400000);
}

function planIntervalDays(planType, frequencyDays) {
  const type = normalizePlanType(planType);
  if (type === "daily") return 1;
  if (type === "weekly") return 7;
  if (type === "bi_monthly") return 15;
  if (type === "monthly") return 30;
  return Math.max(1, Number(frequencyDays || 30));
}

function derivePlanInstallmentCount(planType, durationMonths) {
  const type = normalizePlanType(planType);
  const duration = Number(durationMonths || 0);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (type === "daily") return Math.round(duration * 30);
  if (type === "weekly") return Math.round((duration * 30) / 7);
  if (type === "bi_monthly") return Math.round(duration * 2);
  if (type === "monthly") return Math.round(duration);
  if (type === "part_payment") return Math.round(duration);
  return 0;
}

function buildPlanScheduleItems({ totalKobo, depositKobo, installmentKobo, planType, startDate, frequencyDays, numberOfInstallments }) {
  const type = normalizePlanType(planType);
  const start = dateOnly(startDate) || todayOnly();
  const total = Math.max(0, Number(totalKobo || 0));
  const deposit = Math.min(total, Math.max(0, Number(depositKobo || 0)));
  const items = [];
  if (total <= 0) return items;
  if (type === "outright") {
    items.push({ due_date: start, amount_kobo: total });
    return items;
  }
  if (deposit > 0) items.push({ due_date: start, amount_kobo: deposit });
  let remaining = total - deposit;
  if (remaining <= 0) return items;
  const requestedCount = Number(numberOfInstallments || 0);
  const interval = planIntervalDays(type, frequencyDays);
  const useCalendarMonths = type === "monthly";
  const requestedInstalment = Number(installmentKobo || 0);
  const count = requestedCount > 0
    ? Math.min(1000, Math.max(1, Math.floor(requestedCount)))
    : Math.max(1, Math.min(1000, Math.ceil(remaining / Math.max(1, requestedInstalment))));
  const baseAmount = Math.floor(remaining / count);
  let offset = deposit > 0 ? 1 : 0;
  for (let index = 0; index < count && remaining > 0; index++) {
    const amount = index === count - 1 ? remaining : Math.max(1, Math.min(remaining, baseAmount));
    const due = useCalendarMonths
      ? addMonths(start, offset + index)
      : addDays(start, interval * (offset + index));
    items.push({ due_date: due, amount_kobo: amount });
    remaining -= amount;
  }
  return items;
}

function computeScheduleDefaulting(schedule, items, paidKobo, today = todayOnly()) {
  const graceDays = Math.max(0, Number(schedule.grace_days || 0));
  const threshold = addDays(today, -graceDays);
  const dueItems = (items || []).filter(item => dateOnly(item.due_date) && String(item.due_date).slice(0, 10) <= today);
  const overdueItems = (items || []).filter(item => String(item.due_date).slice(0, 10) < threshold);
  const expectedToDateKobo = dueItems.reduce((sum, item) => sum + Number(item.amount_kobo || 0), 0);
  const overdueExpectedKobo = overdueItems.reduce((sum, item) => sum + Number(item.amount_kobo || 0), 0);
  const paid = Math.max(0, Number(paidKobo || 0));
  const amountBehindKobo = Math.max(0, overdueExpectedKobo - paid);
  const earliestOverdue = overdueItems
    .map(item => String(item.due_date).slice(0, 10))
    .sort()[0] || null;
  const daysOverdue = amountBehindKobo > 0 && earliestOverdue ? Math.max(0, diffDays(earliestOverdue, today)) : 0;
  const nextDue = (items || [])
    .map(item => String(item.due_date).slice(0, 10))
    .filter(date => date >= today)
    .sort()[0] || null;
  return {
    plan_type: normalizePlanType(schedule.plan_type),
    is_easy_buy: isEasyBuyPlan(schedule.plan_type),
    grace_days: graceDays,
    expected_to_date_kobo: expectedToDateKobo,
    paid_to_date_kobo: paid,
    amount_behind_kobo: amountBehindKobo,
    amount_behind_ngn: fromKobo(amountBehindKobo),
    days_overdue: daysOverdue,
    status: amountBehindKobo > 0 ? "defaulting" : "performing",
    next_due_date: nextDue,
    next_installment_kobo: nextDue
      ? Number((items || []).find(item => String(item.due_date).slice(0, 10) === nextDue)?.amount_kobo || 0)
      : 0
  };
}

async function replaceScheduleItems(env, scheduleId, items) {
  await env.DB.prepare("DELETE FROM payment_schedule_items WHERE schedule_id=?").bind(scheduleId).run();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    await env.DB.prepare(`
      INSERT INTO payment_schedule_items (schedule_id, sequence_no, due_date, amount_kobo, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'expected', datetime('now'), datetime('now'))
    `).bind(scheduleId, index + 1, item.due_date, item.amount_kobo).run();
  }
}

async function ensureScheduleItems(env, schedule) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM payment_schedule_items WHERE schedule_id=?").bind(schedule.id).first();
  if (Number(count ? count.c : 0) > 0) return;
  const items = buildPlanScheduleItems({
    totalKobo: Number(schedule.total_kobo || toKobo(schedule.total_amount)),
    depositKobo: Number(schedule.deposit_kobo || toKobo(schedule.deposit_amount)),
    installmentKobo: Number(schedule.installment_kobo || toKobo(schedule.installment_amount)),
    planType: schedule.plan_type,
    startDate: schedule.start_date || schedule.created_at,
    frequencyDays: schedule.frequency_days,
    numberOfInstallments: schedule.number_of_installments
  });
  if (items.length) await replaceScheduleItems(env, schedule.id, items);
}

function propertyPlanSnapshot(plan) {
  return {
    property_payment_plan_id: plan.id,
    plan_type: normalizePlanType(plan.plan_type),
    total_price_kobo: Number(plan.total_price_kobo || 0),
    deposit_kobo: Number(plan.deposit_kobo || 0),
    installment_kobo: Number(plan.installment_kobo || 0),
    duration_months: plan.duration_months === null || plan.duration_months === undefined ? null : Number(plan.duration_months),
    number_of_installments: plan.number_of_installments === null || plan.number_of_installments === undefined ? null : Number(plan.number_of_installments),
    first_payment_rule: plan.first_payment_rule || null,
    balance_difference_kobo: Number(plan.balance_difference_kobo || 0),
    locked_at: new Date().toISOString()
  };
}

async function createScheduleFromPropertyPlan(env, client, plan, actorId, startDateArg) {
  const planType = normalizePlanType(plan.plan_type);
  const totalKobo = Number(plan.total_price_kobo || 0);
  const depositKobo = Math.min(totalKobo, Math.max(0, Number(plan.deposit_kobo || 0)));
  let installmentKobo = Number(plan.installment_kobo || 0);
  const number = plan.number_of_installments ? Number(plan.number_of_installments) : null;
  if (planType === "outright") installmentKobo = totalKobo;
  if (!Number.isInteger(installmentKobo) || installmentKobo <= 0) {
    if (number && totalKobo > depositKobo) installmentKobo = Math.ceil((totalKobo - depositKobo) / number);
    else return { error: "The selected plan needs a positive instalment amount or number of instalments" };
  }
  let frequencyDays = planIntervalDays(planType);
  if (planType === "part_payment") {
    frequencyDays = number && plan.duration_months
      ? Math.max(1, Math.round((Number(plan.duration_months) * 30) / number))
      : 30;
  }
  const start = dateOnly(startDateArg) || todayOnly();
  const items = buildPlanScheduleItems({
    totalKobo, depositKobo, installmentKobo, planType, startDate: start,
    frequencyDays, numberOfInstallments: number
  });
  if (!items.length) return { error: "Unable to generate the payment schedule" };
  const nextDue = items[0].due_date;
  const snapshot = propertyPlanSnapshot(plan);
  const res = await env.DB.prepare(`
    INSERT INTO payment_schedules
      (client_id, property_id, total_amount, total_kobo, deposit_amount, deposit_kobo,
       installment_amount, installment_kobo, frequency_days, next_due_date, status, notes,
       created_by, created_at, updated_at, plan_type, start_date, grace_days,
       number_of_installments, is_easy_buy, schedule_version, property_payment_plan_id, locked_plan_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'),
      ?, ?, 0, ?, ?, 1, ?, ?)
  `).bind(
    client.id, client.interested_property_id || plan.property_id || null,
    fromKobo(totalKobo), totalKobo,
    fromKobo(depositKobo), depositKobo,
    fromKobo(installmentKobo), installmentKobo,
    frequencyDays, nextDue,
    `Locked from property plan at onboarding (${planType}).`,
    actorId, planType, start, number,
    isEasyBuyPlan(planType) ? 1 : 0, plan.id, JSON.stringify(snapshot)
  ).run();
  const scheduleId = res.meta.last_row_id;
  await replaceScheduleItems(env, scheduleId, items);
  await env.DB.prepare(`
    INSERT INTO payment_schedule_history (schedule_id, action, previous_json, new_json, reason, changed_by, created_at)
    VALUES (?, 'create', NULL, ?, 'Created from property payment plan at onboarding', ?, datetime('now'))
  `).bind(scheduleId, JSON.stringify({ snapshot, items }), actorId).run();
  await audit(env, actorId, "installment.create_from_property_plan", "installment", String(scheduleId), {
    client_id: client.id, property_payment_plan_id: plan.id, plan_type: planType
  }, client.assigned_branch_id);
  return { id: scheduleId, items, snapshot };
}

// ---------------------------------------------------------------------------
// Minimal dependency-free PDF writer (used for stored R2 receipts)
// ---------------------------------------------------------------------------
function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pdfText(value) {
  const safe = String(value === undefined || value === null ? "" : value)
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  return `(${safe})`;
}

function assemblePdf(objectBodies) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (bytes) => { parts.push(bytes); length += bytes.length; };

  push(latin1("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  objectBodies.forEach((body, index) => {
    offsets[index] = length;
    push(latin1(`${index + 1} 0 obj\n`));
    push(body);
    push(latin1("\nendobj\n"));
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objectBodies.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(latin1(xref));
  push(latin1(`trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatBytes(parts);
}

function buildReceiptPdf({ receiptRef, clientName, clientRef, propertyTitle, propertyRef, paymentRef, method, paymentDate, amountKobo, remainingKobo, status, demo, logoBytes }) {
  const green = "0.000 0.710 0.133";
  const ink = "0.100 0.100 0.100";
  const muted = "0.420 0.450 0.420";
  const commands = [];

  commands.push(`q ${green} rg 0 742 595 100 re f Q`);
  if (demo) {
    commands.push(`q 0.960 0.900 0.900 rg 0 716 595 26 re f Q`);
    commands.push(`BT /F2 10 Tf 0.800 0.100 0.100 rg 48 724 Td ${pdfText("DEMO RECEIPT - NOT A VALID FINANCIAL DOCUMENT")} Tj ET`);
    commands.push(`BT /F2 68 Tf 0.950 0.880 0.880 rg 120 360 Td ${pdfText("DEMO")} Tj ET`);
  }
  commands.push(`q 1 1 1 rg 34 746 140 92 re f Q`);
  if (logoBytes) commands.push(`q 126 0 0 84 40 750 cm /Im0 Do Q`);
  commands.push(`BT /F2 19 Tf 1 1 1 rg 360 808 Td ${pdfText("OFFICIAL RECEIPT")} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 360 792 Td ${pdfText("Bliss Legacy Limited")} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 360 778 Td ${pdfText("Real Estate & Property Investment")} Tj ET`);

  commands.push(`BT /F2 16 Tf ${ink} rg 48 682 Td ${pdfText("Payment Receipt")} Tj ET`);
  commands.push(`BT /F1 10 Tf ${muted} rg 48 664 Td ${pdfText("Receipt No: " + receiptRef)} Tj ET`);
  commands.push(`BT /F1 10 Tf ${muted} rg 360 664 Td ${pdfText("Date: " + paymentDate)} Tj ET`);

  const row = (label, value, y, opts = {}) => {
    commands.push(`BT /F2 10 Tf ${muted} rg 48 ${y} Td ${pdfText(label)} Tj ET`);
    commands.push(`BT ${opts.bold ? "/F2 12" : "/F1 11"} Tf ${opts.color || ink} rg 200 ${y} Td ${pdfText(value)} Tj ET`);
  };

  let y = 624;
  row("Received From", clientName, y); y -= 26;
  row("Client Reference", clientRef, y); y -= 26;
  row("Property", propertyTitle, y); y -= 26;
  row("Property Reference", propertyRef, y); y -= 26;
  row("Payment Reference", paymentRef, y); y -= 26;
  row("Payment Method", method, y); y -= 26;
  row("Payment Date", paymentDate, y); y -= 26;
  row("Verification Status", status, y, { bold: true, color: "0.000 0.560 0.110" });

  commands.push(`q 0.900 0.950 0.900 rg 48 470 499 78 re f Q`);
  commands.push(`q ${green} rg 48 470 4 78 re f Q`);
  commands.push(`BT /F2 10 Tf ${muted} rg 64 532 Td ${pdfText("AMOUNT PAID")} Tj ET`);
  commands.push(`BT /F2 24 Tf ${green} rg 64 496 Td ${pdfText("NGN " + (amountKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} Tj ET`);

  commands.push(`BT /F2 10 Tf ${muted} rg 48 438 Td ${pdfText("REMAINING BALANCE AFTER PAYMENT")} Tj ET`);
  commands.push(`BT /F2 14 Tf ${ink} rg 48 418 Td ${pdfText("NGN " + (remainingKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} Tj ET`);

  commands.push(`q 0.850 0.870 0.850 RG 0.6 w 48 150 m 547 150 l S Q`);
  commands.push(`BT /F2 9 Tf ${ink} rg 48 128 Td ${pdfText("Bliss Legacy Limited")} Tj ET`);
  commands.push(`BT /F1 8 Tf ${muted} rg 48 112 Td ${pdfText("This receipt is computer-generated from verified D1 transaction records and stored in Cloudflare R2.")} Tj ET`);
  commands.push(`BT /F1 8 Tf ${muted} rg 48 98 Td ${pdfText("Only verified transactions are receipted. Reversals and refunds are separate immutable adjustments.")} Tj ET`);
  if (demo) {
    commands.push(`BT /F2 9 Tf 0.800 0.100 0.100 rg 48 82 Td ${pdfText("DEMO DOCUMENT - SAMPLE DATA ONLY. NOT VALID FOR ACCOUNTING OR LEGAL PURPOSES.")} Tj ET`);
  }

  const content = latin1(commands.join("\n"));
  const objects = [];
  objects.push(latin1("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(latin1("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  const imageResource = logoBytes ? " /XObject << /Im0 7 0 R >>" : "";
  objects.push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResource} >> /Contents 4 0 R >>`));

  const contentHeader = latin1(`<< /Length ${content.length} >>\nstream\n`);
  objects.push(concatBytes([contentHeader, content, latin1("\nendstream")]));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));

  if (logoBytes) {
    const imageHeader = latin1(`<< /Type /XObject /Subtype /Image /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`);
    objects.push(concatBytes([imageHeader, logoBytes, latin1("\nendstream")]));
  }

  return assemblePdf(objects);
}

function buildCommissionReceiptPdf({ receiptRef, paymentRef, recipientName, planName, clientName, amountKobo, paidAt, method, logoBytes }) {
  const green = "0.000 0.710 0.133";
  const ink = "0.100 0.100 0.100";
  const muted = "0.420 0.450 0.420";
  const commands = [];
  commands.push(`q ${green} rg 0 742 595 100 re f Q`);
  commands.push(`q 1 1 1 rg 34 746 140 92 re f Q`);
  if (logoBytes) commands.push(`q 126 0 0 84 40 750 cm /Im0 Do Q`);
  commands.push(`BT /F2 19 Tf 1 1 1 rg 360 808 Td ${pdfText("COMMISSION RECEIPT")} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 360 792 Td ${pdfText("Bliss Legacy Limited")} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 360 778 Td ${pdfText("Commission Payment Record")} Tj ET`);
  const row = (label, value, y, bold) => {
    commands.push(`BT /F2 10 Tf ${muted} rg 48 ${y} Td ${pdfText(label)} Tj ET`);
    commands.push(`BT ${bold ? "/F2 12" : "/F1 11"} Tf ${ink} rg 200 ${y} Td ${pdfText(value)} Tj ET`);
  };
  let y = 666;
  row("Receipt No", receiptRef, y); y -= 28;
  row("Payment Ref", paymentRef, y); y -= 28;
  row("Recipient", recipientName, y); y -= 28;
  row("Commission Plan", planName, y); y -= 28;
  row("Client", clientName, y); y -= 28;
  row("Payment Method", method || "Bank Transfer", y); y -= 28;
  row("Paid At", paidAt, y); y -= 28;
  commands.push(`q 0.900 0.950 0.900 rg 48 470 499 70 re f Q`);
  commands.push(`q ${green} rg 48 470 4 70 re f Q`);
  commands.push(`BT /F2 10 Tf ${muted} rg 64 518 Td ${pdfText("COMMISSION AMOUNT PAID")} Tj ET`);
  commands.push(`BT /F2 24 Tf ${green} rg 64 486 Td ${pdfText("NGN " + (amountKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} Tj ET`);
  commands.push(`q 0.850 0.870 0.850 RG 0.6 w 48 150 m 547 150 l S Q`);
  commands.push(`BT /F2 9 Tf ${ink} rg 48 128 Td ${pdfText("Bliss Legacy Limited")} Tj ET`);
  commands.push(`BT /F1 8 Tf ${muted} rg 48 112 Td ${pdfText("This commission payment record is generated from approved D1 commission data.")} Tj ET`);
  commands.push(`BT /F1 8 Tf ${muted} rg 48 98 Td ${pdfText("Commission payments are separate from client payment receipts.")} Tj ET`);
  const content = latin1(commands.join("\n"));
  const objects = [];
  objects.push(latin1("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(latin1("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  const imageResource = logoBytes ? " /XObject << /Im0 7 0 R >>" : "";
  objects.push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResource} >> /Contents 4 0 R >>`));
  objects.push(concatBytes([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1("\nendstream")]));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
  if (logoBytes) {
    objects.push(concatBytes([latin1(`<< /Type /XObject /Subtype /Image /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`), logoBytes, latin1("\nendstream")]));
  }
  return assemblePdf(objects);
}

function buildFinancialReportPdf({ title, reportRef, generatedAt, generatedBy, filters, summaryLines, columns, rows, logoBytes }) {
  const green = "0.000 0.710 0.133";
  const ink = "0.100 0.100 0.100";
  const muted = "0.420 0.450 0.420";
  const commands = [];
  commands.push(`q ${green} rg 0 742 595 100 re f Q`);
  commands.push(`q 1 1 1 rg 34 746 140 92 re f Q`);
  if (logoBytes) commands.push(`q 126 0 0 84 40 750 cm /Im0 Do Q`);
  commands.push(`BT /F2 18 Tf 1 1 1 rg 350 808 Td ${pdfText(title)} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 350 792 Td ${pdfText("Bliss Legacy Limited")} Tj ET`);
  commands.push(`BT /F1 9 Tf 1 1 1 rg 350 778 Td ${pdfText("Financial Report")} Tj ET`);
  let y = 706;
  const line = (text, size, font, color) => {
    commands.push(`BT /${font || "F1"} ${size || 9} Tf ${color || ink} rg 48 ${y} Td ${pdfText(text)} Tj ET`);
    y -= Math.max(11, (size || 9) + 3);
  };
  line(`Report Ref: ${reportRef}`, 9, "F2");
  line(`Generated: ${generatedAt}`, 8, "F1", muted);
  line(`Generated By: ${generatedBy}`, 8, "F1", muted);
  line(`Filters: ${filters || "None"}`, 8, "F1", muted);
  y -= 6;
  for (const text of summaryLines || []) line(text, 9, "F2", green);
  y -= 6;
  line((columns || []).join(" | "), 7, "F2", muted);
  const limited = (rows || []).slice(0, 24);
  for (const row of limited) {
    line(row.join(" | "), 7, "F1", ink);
    if (y < 64) break;
  }
  if ((rows || []).length > limited.length) {
    line(`Showing ${limited.length} of ${rows.length} rows. Download CSV for the complete dataset.`, 8, "F2", muted);
  }
  const content = latin1(commands.join("\n"));
  const objects = [];
  objects.push(latin1("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(latin1("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  const imageResource = logoBytes ? " /XObject << /Im0 7 0 R >>" : "";
  objects.push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${imageResource} >> /Contents 4 0 R >>`));
  objects.push(concatBytes([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1("\nendstream")]));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
  if (logoBytes) {
    objects.push(concatBytes([latin1(`<< /Type /XObject /Subtype /Image /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`), logoBytes, latin1("\nendstream")]));
  }
  return assemblePdf(objects);
}

async function getReceiptLogoBytes(env) {
  try {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
    const res = await env.ASSETS.fetch(new URL("/assets/images/bliss-legacy-logo.jpg", "https://bliss.local"));
    if (!res || !res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function receiptSummary(row) {
  return {
    receipt_ref: row.receipt_ref,
    client_name: row.full_name || row.client_name || "",
    client_reference: row.client_reference,
    property_title: row.property_title || "Residential Property",
    property_reference: row.property_reference || "N/A",
    payment_ref: row.transaction_ref,
    method: row.method || "Bank Transfer",
    payment_date: (row.verified_at || row.created_at || "").slice(0, 10),
    amount_kobo: Number(row.amount_kobo || toKobo(row.amount)),
    remaining_kobo: Number(row.remaining_balance_kobo || 0),
    status: row.payment_status || row.status || "verified",
    is_demo: Boolean(row.is_demo || row.payment_is_demo)
  };
}

// Generate (and persist to R2) the official PDF for a receipt row. Receipt
// files are only produced for payments that have actually been verified;
// reversal/refund history remains downloadable.
async function ensureReceiptPdf(env, row) {
  const summary = receiptSummary(row);
  const receiptStatus = String(summary.status || "").toLowerCase();
  if (!["verified", "reversed", "refunded"].includes(receiptStatus)) return null;
  const key = row.r2_key || `receipts/${summary.client_reference}/${summary.receipt_ref}.pdf`;
  if (!key.startsWith("receipts/")) return null;
  if (!env.FILES) return null;
  try {
    const existing = await env.FILES.get(key);
    if (existing) return key;
  } catch {
    // fall through and regenerate
  }
  const logoBytes = await getReceiptLogoBytes(env);
  const pdf = buildReceiptPdf({
    receiptRef: summary.receipt_ref,
    clientName: summary.client_name,
    clientRef: summary.client_reference,
    propertyTitle: summary.property_title,
    propertyRef: summary.property_reference,
    paymentRef: summary.payment_ref,
    method: summary.method,
    paymentDate: summary.payment_date,
    amountKobo: summary.amount_kobo,
    remainingKobo: summary.remaining_kobo,
    status: summary.status === "verified" ? "Verified" : summary.status,
    demo: summary.is_demo,
    logoBytes
  });
  await env.FILES.put(key, pdf, {
    httpMetadata: { contentType: "application/pdf" }
  });
  if (row.id) {
    await env.DB.prepare("UPDATE receipts SET r2_key=? WHERE id=?").bind(key, row.id).run();
  }
  return key;
}

// Client resolver for Client role actors
async function getClientForActor(env, actor) {
  if (!actor || actor.role_name !== "Client") return null;
  // 1. Look up by clients.user_id (authoritative link)
  let client = await env.DB.prepare(
    "SELECT c.*, b.name AS branch_name, m.full_name AS original_marketer_name FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id LEFT JOIN users m ON m.id=c.original_marketer_id WHERE c.user_id=? AND c.is_deleted=0"
  ).bind(actor.id).first();

  // 2. Fallback: match by email_address and auto-link the user. Never hijack a
  //    client record that is already linked to a different login.
  if (!client && actor.email) {
    const candidate = await env.DB.prepare(
      "SELECT c.*, b.name AS branch_name, m.full_name AS original_marketer_name FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id LEFT JOIN users m ON m.id=c.original_marketer_id WHERE LOWER(c.email_address)=? AND c.is_deleted=0"
    ).bind(actor.email.toLowerCase()).first();
    if (candidate && (candidate.user_id === null || candidate.user_id === actor.id)) {
      if (!candidate.user_id) {
        await env.DB.prepare("UPDATE clients SET user_id=? WHERE id=?").bind(actor.id, candidate.id).run();
        candidate.user_id = actor.id;
      }
      client = candidate;
    }
    // A client record owned by someone else is intentionally NOT returned.
  }

  return client;
}

async function upsertClientPropertyAllocation(env, clientId, propertyId, agreedPrice, status) {
  if (!clientId || !propertyId) return;
  await env.DB.prepare(`
    INSERT INTO client_properties (client_id, property_id, agreed_purchase_price, status, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_id, property_id) DO UPDATE SET
      agreed_purchase_price=excluded.agreed_purchase_price,
      status=excluded.status,
      updated_at=datetime('now')
  `).bind(clientId, propertyId, Number(agreedPrice || 0), status || "Active").run();
}

async function lockClientPurchasePlan(env, clientId, propertyId, plan, status) {
  const snapshot = propertyPlanSnapshot(plan);
  await env.DB.prepare(`
    UPDATE clients SET property_payment_plan_id=?, payment_plan_type=?, payment_plan_total_kobo=?,
      payment_plan_deposit_kobo=?, payment_plan_installment_kobo=?, payment_plan_duration_months=?,
      payment_plan_number_of_installments=?, payment_plan_locked_at=?, payment_plan_locked_json=?,
      agreed_purchase_price=?, updated_at=datetime('now')
    WHERE id=?
  `).bind(
    plan.id, snapshot.plan_type, snapshot.total_price_kobo, snapshot.deposit_kobo,
    snapshot.installment_kobo, snapshot.duration_months, snapshot.number_of_installments,
    snapshot.locked_at, JSON.stringify(snapshot), fromKobo(snapshot.total_price_kobo), clientId
  ).run();
  await env.DB.prepare(`
    UPDATE client_properties SET property_payment_plan_id=?, plan_type=?, plan_total_kobo=?,
      plan_deposit_kobo=?, plan_installment_kobo=?, plan_duration_months=?, plan_number_of_installments=?,
      plan_locked_at=?, plan_locked_json=?, agreed_purchase_price=?, status=?, updated_at=datetime('now')
    WHERE client_id=? AND property_id=?
  `).bind(
    plan.id, snapshot.plan_type, snapshot.total_price_kobo, snapshot.deposit_kobo,
    snapshot.installment_kobo, snapshot.duration_months, snapshot.number_of_installments,
    snapshot.locked_at, JSON.stringify(snapshot), fromKobo(snapshot.total_price_kobo),
    status || "Active", clientId, propertyId
  ).run();
  return snapshot;
}

async function resolvePropertyPlanForPurchase(env, propertyId, planId) {
  if (!propertyId) return { plan: null, plans: [] };
  const property = await env.DB.prepare("SELECT id, title, branch_id, is_published FROM properties WHERE id=?").bind(propertyId).first();
  if (!property) return { error: "Property not found" };
  const { results: plans } = await env.DB.prepare(
    "SELECT * FROM property_payment_plans WHERE property_id=? AND is_enabled=1 ORDER BY plan_type"
  ).bind(propertyId).all();
  if (planId) {
    const plan = plans.find(row => Number(row.id) === Number(planId));
    if (!plan) return { error: "Selected payment plan is not offered for this property" };
    return { property, plan, plans };
  }
  if (plans.length) return { error: "Select one of the payment plans offered for this property", plans };
  return { property, plan: null, plans };
}

async function buildClientPropertyPortfolio(env, client) {
  const { results: allocations } = await env.DB.prepare(`
    SELECT cp.id AS allocation_id, cp.property_id, cp.agreed_purchase_price, cp.status AS allocation_status,
           p.reference, p.title, p.description, p.city, p.state, p.address,
           p.status AS property_status, p.branch_id, b.name AS branch_name, pc.name AS category_name
    FROM client_properties cp
    JOIN properties p ON p.id=cp.property_id
    LEFT JOIN branches b ON b.id=p.branch_id
    LEFT JOIN property_categories pc ON pc.id=p.category_id
    WHERE cp.client_id=?
    ORDER BY cp.id
  `).bind(client.id).all();

  const { results: paymentTotals } = await env.DB.prepare(`
    SELECT property_id, COALESCE(SUM(amount_kobo),0) AS verified_kobo,
           COUNT(*) AS verified_count, MAX(verified_at) AS last_verified
    FROM payments
    WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
    GROUP BY property_id
  `).bind(client.id).all();
  const paymentMap = new Map(paymentTotals.map(row => [row.property_id, row]));

  const { results: schedules } = await env.DB.prepare(`
    SELECT property_id, installment_amount, installment_kobo, next_due_date, status
    FROM payment_schedules
    WHERE client_id=? AND status='active'
    ORDER BY next_due_date ASC
  `).bind(client.id).all();
  const scheduleMap = new Map();
  for (const schedule of schedules) {
    if (!scheduleMap.has(schedule.property_id)) scheduleMap.set(schedule.property_id, schedule);
  }

  // The clients row remains authoritative for the primary contract price so
  // direct contract updates (and legacy records) never drift from the ledger.
  let propertyRows = allocations.map(row => {
    if (client.interested_property_id !== null && client.interested_property_id !== undefined
        && Number(row.property_id) === Number(client.interested_property_id)
        && client.agreed_purchase_price !== null && client.agreed_purchase_price !== undefined) {
      return { ...row, agreed_purchase_price: client.agreed_purchase_price };
    }
    return row;
  });
  if (!propertyRows.length && client.interested_property_id) {
    const property = await env.DB.prepare(`
      SELECT p.id AS property_id, p.reference, p.title, p.description, p.city, p.state, p.address,
             p.status AS property_status, p.branch_id, b.name AS branch_name, pc.name AS category_name
      FROM properties p
      LEFT JOIN branches b ON b.id=p.branch_id
      LEFT JOIN property_categories pc ON pc.id=p.category_id
      WHERE p.id=?
    `).bind(client.interested_property_id).first();
    if (property) {
      propertyRows = [{
        ...property,
        agreed_purchase_price: client.agreed_purchase_price || 0,
        allocation_status: client.status || "Active",
        allocation_id: null
      }];
    }
  }

  const knownPropertyIds = new Set(propertyRows.map(row => row.property_id));
  for (const payment of paymentTotals) {
    if (!payment.property_id || knownPropertyIds.has(payment.property_id)) continue;
    const property = await env.DB.prepare(`
      SELECT p.id AS property_id, p.reference, p.title, p.description, p.city, p.state, p.address,
             p.status AS property_status, p.branch_id, b.name AS branch_name, pc.name AS category_name
      FROM properties p
      LEFT JOIN branches b ON b.id=p.branch_id
      LEFT JOIN property_categories pc ON pc.id=p.category_id
      WHERE p.id=?
    `).bind(payment.property_id).first();
    if (property) {
      propertyRows.push({
        ...property, agreed_purchase_price: 0, allocation_status: client.status || "Active",
        allocation_id: null
      });
      knownPropertyIds.add(payment.property_id);
    }
  }

  const properties = [];
  for (const row of propertyRows) {
    const payment = paymentMap.get(row.property_id) || {};
    const schedule = scheduleMap.get(row.property_id) || null;
    const contractKobo = toKobo(row.agreed_purchase_price || 0);
    const verifiedKobo = Number(payment.verified_kobo || 0);
    const outstandingKobo = Math.max(0, contractKobo - verifiedKobo);
    const progress = contractKobo > 0
      ? Math.min(100, Math.round((verifiedKobo / contractKobo) * 1000) / 10)
      : 0;
    const { results: images } = await env.DB.prepare(
      "SELECT r2_key FROM property_images WHERE property_id=? ORDER BY is_main DESC, sort_order LIMIT 3"
    ).bind(row.property_id).all();
    properties.push({
      id: row.allocation_id,
      property_id: row.property_id,
      reference: row.reference,
      title: row.title,
      description: row.description,
      location: `${row.city || ""}, ${row.state || ""}`.trim().replace(/^,|,$/g, ""),
      address: row.address,
      category_name: row.category_name,
      branch_name: row.branch_name,
      property_status: row.property_status,
      status: row.allocation_status || client.status,
      agreed_purchase_price: Number(row.agreed_purchase_price || 0),
      agreed_purchase_price_kobo: contractKobo,
      verified_kobo: verifiedKobo,
      verified_ngn: fromKobo(verifiedKobo),
      outstanding_kobo: outstandingKobo,
      outstanding_ngn: fromKobo(outstandingKobo),
      progress,
      verified_payments_count: Number(payment.verified_count || 0),
      last_payment_at: payment.last_verified || null,
      next_due_date: schedule ? schedule.next_due_date : null,
      next_installment_kobo: schedule ? Number(schedule.installment_kobo || toKobo(schedule.installment_amount)) : 0,
      images: images.map(image => `/api/files/${encodeURIComponent(image.r2_key)}`)
    });
  }

  const contractKobo = properties.length
    ? properties.reduce((sum, item) => sum + item.agreed_purchase_price_kobo, 0)
    : toKobo(client.agreed_purchase_price || 0);
  const verifiedKobo = paymentTotals.reduce((sum, row) => sum + Number(row.verified_kobo || 0), 0);
  const outstandingKobo = Math.max(0, contractKobo - verifiedKobo);
  return {
    properties,
    property: properties[0] || null,
    financials: {
      agreed_price_ngn: fromKobo(contractKobo),
      agreed_price_kobo: contractKobo,
      total_verified_ngn: fromKobo(verifiedKobo),
      total_verified_kobo: verifiedKobo,
      outstanding_balance_ngn: fromKobo(outstandingKobo),
      outstanding_balance_kobo: outstandingKobo,
      payment_percentage: contractKobo > 0 ? Math.min(100, Math.round((verifiedKobo / contractKobo) * 1000) / 10) : 0,
      verified_payments_count: paymentTotals.reduce((sum, row) => sum + Number(row.verified_count || 0), 0)
    }
  };
}

// In-app Notification creation helper
async function clientStaffRecipients(env, client) {
  const recipients = new Set();
  if (!client) return recipients;
  for (const id of [client.original_marketer_id, client.team_lead_id, client.referred_by_staff_id]) {
    if (id) recipients.add(Number(id));
  }
  if (client.assigned_branch_id) {
    const { results } = await env.DB.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.is_active=1 AND r.name='Branch Manager' AND u.branch_id=?
    `).bind(client.assigned_branch_id).all();
    for (const row of results) recipients.add(Number(row.id));
  }
  return recipients;
}

async function notifyClientCreated(env, client, actorId) {
  const recipients = await clientStaffRecipients(env, client);
  for (const userId of recipients) {
    if (actorId && Number(userId) === Number(actorId)) continue;
    await createNotification(env, {
      userId,
      type: "client.created",
      title: "New Client",
      message: `${client.full_name} (${client.client_reference}) was added${client.referred_by_staff_id ? " through a staff referral" : ""}.`,
      metadata: { client_id: client.id, client_reference: client.client_reference, branch_id: client.assigned_branch_id }
    });
  }
}

async function notifyPaymentVerified(env, payment, actorId) {
  const client = await env.DB.prepare(`
    SELECT id, client_reference, full_name, assigned_branch_id, original_marketer_id, team_lead_id, referred_by_staff_id
    FROM clients WHERE id=?
  `).bind(payment.client_id).first();
  const recipients = await clientStaffRecipients(env, client);
  const { results: finance } = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.is_active=1 AND r.name='Finance Officer'
  `).all();
  for (const row of finance) recipients.add(Number(row.id));
  for (const userId of recipients) {
    if (actorId && Number(userId) === Number(actorId)) continue;
    await createNotification(env, {
      userId,
      type: "payment.verified",
      title: "Payment Verified",
      message: `${formatNGN(payment.amount_kobo || toKobo(payment.amount))} was verified for ${client ? client.full_name : "a client"} (${client ? client.client_reference : payment.transaction_ref}).`,
      metadata: { payment_id: payment.id, transaction_ref: payment.transaction_ref, client_id: payment.client_id }
    });
  }
}

async function createNotification(env, { userId, clientId, type, title, message, metadata, dedupeKey }) {
  try {
    if (dedupeKey) {
      const inserted = await env.DB.prepare(
        "INSERT OR IGNORE INTO notification_dedupe (dedupe_key, created_at) VALUES (?, datetime('now'))"
      ).bind(dedupeKey).run();
      if (!inserted.meta || Number(inserted.meta.changes) === 0) return null;
    }

    const res = await env.DB.prepare(
      "INSERT INTO notifications (user_id, client_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      userId || null,
      clientId || null,
      type,
      title,
      message,
      metadata ? JSON.stringify(metadata) : null
    ).run();
    const notificationId = res.meta.last_row_id;

    if (dedupeKey) {
      await env.DB.prepare("UPDATE notification_dedupe SET notification_id=? WHERE dedupe_key=?")
        .bind(notificationId, dedupeKey).run();
    }

    await env.DB.prepare(
      "INSERT INTO notification_deliveries (notification_id, channel, provider, status, detail) VALUES (?, 'in_app', 'bliss_portal', 'sent', 'Delivered in-app')"
    ).bind(notificationId).run().catch(() => {});

    // Trigger Cloudflare Queues background processing if TASKS binding exists
    if (env.TASKS && typeof env.TASKS.send === "function") {
      await env.TASKS.send({
        type: "notification.created",
        notification_id: notificationId,
        event_type: type,
        client_id: clientId,
        user_id: userId,
        title,
        message,
        metadata
      }).catch(() => {});
    }
    return notificationId;
  } catch (err) {
    return null;
  }
}

async function processNotificationQueue(env, message) {
  const body = message.body || message;
  if (body.type === "sms.send" && body.sms_message_id) {
    await processSmsMessage(env, Number(body.sms_message_id));
    return;
  }
  const notificationId = body.notification_id || null;
  if (!notificationId) return;

  const channels = [
    { name: "email", provider: env.EMAIL_PROVIDER || "" },
    { name: "whatsapp", provider: env.WHATSAPP_PROVIDER || "" }
  ];

  for (const channel of channels) {
    let status = "skipped";
    let detail = "No provider configured";
    if (channel.provider) {
      // Integration point: provider adapters are intentionally not implemented
      // until official credentials and documentation are supplied.
      status = "pending_provider";
      detail = `Provider '${channel.provider}' configured; adapter awaiting official credentials`;
    }
    await env.DB.prepare(
      "INSERT INTO notification_deliveries (notification_id, channel, provider, status, detail) VALUES (?, ?, ?, ?, ?)"
    ).bind(notificationId, channel.name, channel.provider || "none", status, detail).run().catch(() => {});
  }
}

async function getSmsSettings(env) {
  const { results } = await env.DB.prepare("SELECT setting_key, setting_value FROM sms_settings").all();
  const values = {};
  for (const row of results) values[row.setting_key] = row.setting_value;
  return {
    enabled: String(values.sms_enabled || "0") === "1",
    provider: String(env.SMS_PROVIDER || values.sms_provider || "termii").toLowerCase(),
    senderId: String(env.SMS_SENDER_ID || values.sms_sender_id || "BlissLegacy"),
    lowCreditThreshold: Number(values.sms_low_credit_threshold || 1000),
    remindersEnabled: String(values.sms_reminders_enabled || "0") === "1",
    defaultingRemindersEnabled: String(values.sms_defaulting_reminders_enabled || "0") === "1",
    reminderDays: Math.max(0, Number(values.sms_reminder_days || 3)),
    defaultingFrequencyDays: Math.max(1, Number(values.sms_defaulting_frequency_days || 3)),
    statementDay: Math.min(28, Math.max(1, Number(values.sms_statement_day || 1))),
    creditBalance: values.sms_credit_balance === "" ? null : Number(values.sms_credit_balance),
    creditCurrency: values.sms_credit_currency || "NGN",
    creditCheckedAt: values.sms_credit_checked_at || null,
    lowBalanceAlertedAt: values.sms_low_balance_alerted_at || null,
    raw: values
  };
}

async function setSmsSetting(env, key, value, actorId) {
  await env.DB.prepare(`
    INSERT INTO sms_settings (setting_key, setting_value, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,
      updated_by=excluded.updated_by, updated_at=datetime('now')
  `).bind(key, value === undefined || value === null ? null : String(value), actorId || null).run();
}

function renderSmsTemplate(template, variables) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(variables || {})) {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), value === undefined || value === null ? "" : String(value));
  }
  return output.slice(0, 1000);
}

async function getSmsTemplate(env, templateKey) {
  return env.DB.prepare("SELECT * FROM sms_templates WHERE template_key=? AND is_active=1").bind(templateKey).first();
}

async function sendSmsThroughProvider(env, settings, phone, body) {
  const provider = settings.provider;
  if (provider === "mock") {
    if (String(env.ENVIRONMENT || "").toLowerCase() === "production") {
      throw Object.assign(new Error("Mock SMS adapter is disabled in production"), { permanent: true });
    }
    return { provider: "mock", providerMessageId: "mock-" + crypto.randomUUID(), costKobo: 0, status: "sent" };
  }
  if (provider === "termii") {
    const apiKey = env.TERMII_API_KEY;
    if (!apiKey) throw Object.assign(new Error("TERMII_API_KEY is not configured"), { permanent: true });
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: phone,
        from: settings.senderId,
        sms: body,
        type: "plain",
        channel: "dnd",
        api_key: apiKey
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || String(data.code || "").toLowerCase() === "error") {
      throw new Error(data.message || `Termii SMS failed (${response.status})`);
    }
    return {
      provider: "termii",
      providerMessageId: data.message_id || data.messageId || null,
      costKobo: data.cost ? toKobo(data.cost) : null,
      status: "sent"
    };
  }
  if (provider === "africastalking") {
    const apiKey = env.AFRICASTALKING_API_KEY;
    const username = env.AFRICASTALKING_USERNAME;
    if (!apiKey || !username) throw Object.assign(new Error("Africa's Talking credentials are not configured"), { permanent: true });
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("to", phone);
    form.set("message", body);
    if (settings.senderId) form.set("from", settings.senderId);
    const response = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: form.toString()
    });
    const data = await response.json().catch(() => ({}));
    const recipient = data.SMSMessageData && data.SMSMessageData.Recipients && data.SMSMessageData.Recipients[0];
    if (!response.ok || !recipient || String(recipient.status || "").toLowerCase().includes("fail")) {
      throw new Error((recipient && recipient.status) || `Africa's Talking SMS failed (${response.status})`);
    }
    const cost = String(recipient.cost || "").replace(/[^0-9.]/g, "");
    return {
      provider: "africastalking",
      providerMessageId: recipient.messageId || null,
      costKobo: cost ? toKobo(cost) : null,
      status: "sent"
    };
  }
  throw Object.assign(new Error(`Unknown SMS provider '${provider}'`), { permanent: true });
}

async function fetchSmsProviderBalance(env, settings) {
  if (settings.provider === "termii" && env.TERMII_API_KEY) {
    const response = await fetch(`https://api.ng.termii.com/api/get-balance?api_key=${encodeURIComponent(env.TERMII_API_KEY)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Balance request failed (${response.status})`);
    const balance = Number(data.balance);
    return Number.isFinite(balance) ? balance : null;
  }
  if (settings.provider === "mock") return null;
  return null;
}

async function processSmsMessage(env, messageId) {
  const message = await env.DB.prepare("SELECT * FROM sms_messages WHERE id=?").bind(messageId).first();
  if (!message) return { skipped: true, reason: "not_found" };
  if (["sent", "delivered", "opted_out", "skipped", "failed"].includes(message.status)) return { skipped: true, reason: "already_final" };
  const settings = await getSmsSettings(env);
  if (!settings.enabled) {
    await env.DB.prepare("UPDATE sms_messages SET status='skipped', error='SMS disabled globally', updated_at=datetime('now') WHERE id=?")
      .bind(message.id).run();
    return { skipped: true, reason: "disabled" };
  }
  if (message.client_id) {
    const optout = await env.DB.prepare("SELECT opted_out FROM sms_optouts WHERE client_id=?").bind(message.client_id).first();
    if (optout && Number(optout.opted_out) === 1) {
      await env.DB.prepare("UPDATE sms_messages SET status='opted_out', updated_at=datetime('now') WHERE id=?").bind(message.id).run();
      return { skipped: true, reason: "opted_out" };
    }
  }
  try {
    const result = await sendSmsThroughProvider(env, settings, message.phone_e164, message.body);
    await env.DB.prepare(`
      UPDATE sms_messages SET status=?, provider=?, provider_message_id=?, provider_cost_kobo=?,
        attempts=attempts+1, sent_at=datetime('now'), error=NULL, updated_at=datetime('now')
      WHERE id=?
    `).bind(result.status || "sent", result.provider, result.providerMessageId, result.costKobo, message.id).run();
    if (result.provider === "mock") {
      await env.DB.prepare("UPDATE sms_messages SET status='delivered', delivered_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
        .bind(message.id).run();
    }
    return { ok: true, status: result.status || "sent" };
  } catch (error) {
    const attempts = Number(message.attempts || 0) + 1;
    const permanent = error.permanent || attempts >= 5;
    await env.DB.prepare(`
      UPDATE sms_messages SET status=?, attempts=?, error=?, failed_at=?, next_attempt_at=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      permanent ? "failed" : "queued", attempts, String(error.message || "SMS send failed").slice(0, 500),
      permanent ? new Date().toISOString() : null,
      permanent ? null : new Date(Date.now() + Math.min(900, 30 * Math.pow(2, attempts)) * 1000).toISOString(),
      message.id
    ).run();
    if (!permanent) throw error;
    return { ok: false, failed: true, error: error.message };
  }
}

async function enqueueSms(env, options) {
  const settings = await getSmsSettings(env);
  if (!settings.enabled) return { skipped: true, reason: "disabled" };
  const phone = normalizeNigerianPhone(options.phone);
  if (!phone) return { skipped: true, reason: "invalid_phone" };
  if (options.clientId) {
    const optout = await env.DB.prepare("SELECT opted_out FROM sms_optouts WHERE client_id=?").bind(options.clientId).first();
    if (optout && Number(optout.opted_out) === 1) {
      if (options.idempotencyKey) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO sms_messages (client_id, payment_id, schedule_id, template_key, phone_e164, body,
            status, provider, idempotency_key, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'opted_out', ?, ?, ?)
        `).bind(options.clientId, options.paymentId || null, options.scheduleId || null, options.templateKey || null,
          phone, options.body || "", settings.provider, options.idempotencyKey, options.createdBy || null).run();
      }
      return { skipped: true, reason: "opted_out" };
    }
  }
  const res = await env.DB.prepare(`
    INSERT OR IGNORE INTO sms_messages (client_id, payment_id, schedule_id, template_key, phone_e164, body,
      status, provider, idempotency_key, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `).bind(
    options.clientId || null, options.paymentId || null, options.scheduleId || null,
    options.templateKey || null, phone, options.body || "", settings.provider,
    options.idempotencyKey || null, options.createdBy || null
  ).run();
  if (!res.meta || Number(res.meta.changes) === 0) return { skipped: true, reason: "duplicate" };
  const messageId = res.meta.last_row_id;
  if (env.TASKS && typeof env.TASKS.send === "function") {
    await env.TASKS.send({ type: "sms.send", sms_message_id: messageId }).catch(() => {});
  } else {
    await processSmsMessage(env, messageId).catch(() => {});
  }
  return { ok: true, id: messageId };
}

async function sendPaymentReceivedSms(env, paymentId) {
  const row = await env.DB.prepare(`
    SELECT p.id, p.client_id, p.amount_kobo, p.amount, p.transaction_ref, p.verified_at, p.is_demo, p.currency, p.payment_mode,
           c.full_name, c.phone_number, c.client_reference, c.agreed_purchase_price,
           COALESCE(prop.title, 'your property') AS property_title
    FROM payments p JOIN clients c ON c.id=p.client_id
    LEFT JOIN properties prop ON prop.id=p.property_id
    WHERE p.id=?
  `).bind(paymentId).first();
  if (!row || Number(row.is_demo) === 1 || String(row.currency || "NGN").toUpperCase() !== "NGN") return { skipped: true };
  const wallet = await getClientStaticWallet(env, row.client_id, row.payment_mode || getPaymentMode(env));
  const total = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount_kobo),0) AS paid FROM payments
    WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
  `).bind(row.client_id).first();
  const paidKobo = Number(total ? total.paid : 0);
  const balanceKobo = Math.max(0, toKobo(row.agreed_purchase_price || 0) - paidKobo);
  const template = await getSmsTemplate(env, "payment_received");
  let body = renderSmsTemplate(template ? template.body : "Payment received: NGN {amount}. New balance: NGN {balance}. Ref: {reference}. Bliss Legacy.", {
    name: row.full_name,
    amount: fromKobo(Number(row.amount_kobo || toKobo(row.amount))).toLocaleString("en-NG"),
    balance: fromKobo(balanceKobo).toLocaleString("en-NG"),
    property: row.property_title,
    date: String(row.verified_at || new Date().toISOString()).slice(0, 10),
    reference: row.transaction_ref
  });
  if (wallet && wallet.status === "active" && wallet.account_number) {
    body = `${body} Account: ${wallet.account_number}.`.slice(0, 1000);
  }
  return enqueueSms(env, {
    clientId: row.client_id,
    paymentId: row.id,
    templateKey: "payment_received",
    phone: row.phone_number,
    body,
    idempotencyKey: `payment:${row.id}:payment_received`,
    createdBy: null
  });
}

async function sendAccountCreatedSms(env, clientId, actorId) {
  const client = await env.DB.prepare("SELECT id, full_name, phone_number, client_reference, assigned_branch_id FROM clients WHERE id=?")
    .bind(clientId).first();
  if (!client) return { skipped: true };
  const wallet = await getClientStaticWallet(env, client.id, getPaymentMode(env));
  const template = await getSmsTemplate(env, "account_created");
  let body = renderSmsTemplate(template ? template.body : "Welcome {name}. Your Bliss Legacy client reference is {reference}.", {
    name: client.full_name, reference: client.client_reference
  });
  if (wallet && wallet.status === "active" && wallet.account_number) {
    body = `${body} Your permanent ALATPay account is ${wallet.account_number} (${wallet.bank_name || "Wema Bank"}).`.slice(0, 1000);
  }
  return enqueueSms(env, {
    clientId: client.id,
    templateKey: "account_created",
    phone: client.phone_number,
    body,
    idempotencyKey: `client:${client.id}:account_created`,
    createdBy: actorId || null
  });
}

function emailProviderName(env) {
  return String(env.EMAIL_PROVIDER || "resend").toLowerCase();
}

function emailProviderReady(env) {
  const provider = emailProviderName(env);
  if (provider === "mock") return String(env.ENVIRONMENT || "").toLowerCase() !== "production";
  if (provider === "resend") return Boolean(env.RESEND_API_KEY && (env.EMAIL_FROM || env.RESEND_FROM));
  return false;
}

async function sendEmailThroughProvider(env, to, subject, text) {
  const provider = emailProviderName(env);
  const recipient = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw Object.assign(new Error("Invalid email recipient"), { status: 400 });
  if (provider === "mock") {
    if (String(env.ENVIRONMENT || "").toLowerCase() === "production") {
      throw Object.assign(new Error("Mock email adapter is disabled in production"), { permanent: true });
    }
    return { provider: "mock", providerMessageId: "mock-email-" + crypto.randomUUID() };
  }
  if (provider === "resend") {
    if (!env.RESEND_API_KEY || !(env.EMAIL_FROM || env.RESEND_FROM)) {
      throw Object.assign(new Error("RESEND_API_KEY and EMAIL_FROM are not configured"), { permanent: true });
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || env.RESEND_FROM,
        to: [recipient],
        subject: String(subject || "Bliss Legacy verification").slice(0, 180),
        text: String(text || "").slice(0, 4000)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Email provider failed (${response.status})`);
    return { provider: "resend", providerMessageId: data.id || null };
  }
  throw Object.assign(new Error(`Unknown email provider '${provider}'`), { permanent: true });
}

function generateOtpCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
}

async function hashOtpCode(code, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function maskDestination(channel, destination) {
  const value = String(destination || "");
  if (channel === "email") {
    const [name, domain] = value.split("@");
    if (!domain) return value;
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return value.length > 6 ? `${value.slice(0, 4)}***${value.slice(-3)}` : value;
}

async function createClientVerificationOtp(env, client, requestedChannel, actorId) {
  let channel = String(requestedChannel || "").toLowerCase();
  if (!["email", "sms"].includes(channel)) {
    if (emailProviderReady(env) && client.email_address) channel = "email";
    else channel = "sms";
  }
  const destination = channel === "email"
    ? String(client.email_address || "").trim().toLowerCase()
    : normalizeNigerianPhone(client.phone_number);
  if (!destination) {
    throw Object.assign(new Error(channel === "email" ? "This client has no valid email address" : "This client has no valid Nigerian phone number"), { status: 400 });
  }
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM client_verification_otps
    WHERE client_id=? AND created_at >= datetime('now','-15 minutes')
  `).bind(client.id).first();
  if (Number(recent ? recent.c : 0) >= 5) {
    throw Object.assign(new Error("Too many verification codes requested. Try again in 15 minutes."), { status: 429 });
  }
  await env.DB.prepare(`
    UPDATE client_verification_otps SET consumed_at=datetime('now')
    WHERE client_id=? AND consumed_at IS NULL
  `).bind(client.id).run();
  const code = generateOtpCode();
  const salt = crypto.randomUUID();
  const codeHash = await hashOtpCode(code, salt);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const res = await env.DB.prepare(`
    INSERT INTO client_verification_otps
      (client_id, channel, destination, code_salt, code_hash, expires_at, delivery_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
  `).bind(client.id, channel, destination, salt, codeHash, expiresAt, actorId || null).run();
  const otpId = res.meta.last_row_id;
  let deliveryStatus = "queued";
  let providerMessageId = null;
  let error = null;
  try {
    if (channel === "email") {
      const result = await sendEmailThroughProvider(
        env, destination, "Your Bliss Legacy verification code",
        `Hello ${client.full_name || "Client"},\n\nYour Bliss Legacy verification code is ${code}.\nIt expires in 10 minutes. Do not share this code.\n\nBliss Legacy Limited`
      );
      deliveryStatus = "sent";
      providerMessageId = result.providerMessageId || null;
    } else {
      const template = await getSmsTemplate(env, "client_verification_otp");
      const body = renderSmsTemplate(template ? template.body : "Your Bliss Legacy verification code is {code}. It expires in 10 minutes.", { code });
      const queued = await enqueueSms(env, {
        clientId: client.id,
        templateKey: "client_verification_otp",
        phone: destination,
        body,
        idempotencyKey: `otp:${otpId}:client_verification_otp`,
        createdBy: actorId || null
      });
      if (queued.skipped) {
        deliveryStatus = "failed";
        error = queued.reason === "disabled" ? "SMS is disabled globally" : (queued.reason || "SMS delivery is not available");
      } else {
        deliveryStatus = "sent";
        providerMessageId = queued.id ? String(queued.id) : null;
      }
    }
  } catch (sendError) {
    deliveryStatus = "failed";
    error = String(sendError.message || "Delivery failed").slice(0, 500);
  }
  await env.DB.prepare(`
    UPDATE client_verification_otps SET delivery_status=?, provider_message_id=?, error=?, last_sent_at=datetime('now')
    WHERE id=?
  `).bind(deliveryStatus, providerMessageId, error, otpId).run();
  if (deliveryStatus === "failed") {
    throw Object.assign(new Error(error || "Unable to send the verification code"), { status: 503, otp_id: otpId });
  }
  await env.DB.prepare(`
    UPDATE clients SET verification_status='unverified', verification_channel=?, verification_sent_at=datetime('now')
    WHERE id=?
  `).bind(channel, client.id).run();
  await audit(env, actorId || null, "client.verification.sent", "client", String(client.id), {
    channel, destination_masked: maskDestination(channel, destination), otp_id: otpId
  }, client.assigned_branch_id);
  return {
    ok: true,
    otp_id: otpId,
    channel,
    destination: maskDestination(channel, destination),
    expires_at: expiresAt,
    delivery_status: deliveryStatus
  };
}

async function verifyClientVerificationOtp(env, clientId, code, actorId) {
  const cleaned = String(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(cleaned)) throw Object.assign(new Error("Enter the 6-digit verification code"), { status: 400 });
  const otp = await env.DB.prepare(`
    SELECT * FROM client_verification_otps
    WHERE client_id=? AND consumed_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).bind(clientId).first();
  if (!otp) throw Object.assign(new Error("No active verification code. Request a new one."), { status: 404 });
  if (parseDbDate(otp.expires_at) < new Date()) {
    throw Object.assign(new Error("The verification code has expired. Request a new one."), { status: 410 });
  }
  if (Number(otp.attempts || 0) >= Number(otp.max_attempts || 5)) {
    throw Object.assign(new Error("Too many incorrect attempts. Request a new code."), { status: 429 });
  }
  const candidate = await hashOtpCode(cleaned, otp.code_salt);
  if (!secureCompare(candidate, otp.code_hash)) {
    await env.DB.prepare("UPDATE client_verification_otps SET attempts=attempts+1 WHERE id=?").bind(otp.id).run();
    throw Object.assign(new Error("Incorrect verification code"), { status: 400 });
  }
  await env.DB.prepare("UPDATE client_verification_otps SET consumed_at=datetime('now') WHERE id=?").bind(otp.id).run();
  await env.DB.prepare(`
    UPDATE clients SET verification_status='verified', verification_channel=?, verified_at=datetime('now'), updated_at=datetime('now')
    WHERE id=?
  `).bind(otp.channel, clientId).run();
  await audit(env, actorId || null, "client.verification.verified", "client", String(clientId), {
    channel: otp.channel, otp_id: otp.id
  }, null);
  return { ok: true, verification_status: "verified", channel: otp.channel };
}

async function getClientVerificationState(env, clientId) {
  const client = await env.DB.prepare(`
    SELECT id, client_reference, full_name, email_address, phone_number, verification_status,
           verification_channel, verification_sent_at, verified_at
    FROM clients WHERE id=?
  `).bind(clientId).first();
  if (!client) return null;
  const smsSettings = await getSmsSettings(env);
  const smsReady = smsSettings.enabled && (
    smsSettings.provider === "mock"
      || (smsSettings.provider === "termii" && Boolean(env.TERMII_API_KEY))
      || (smsSettings.provider === "africastalking" && Boolean(env.AFRICASTALKING_API_KEY && env.AFRICASTALKING_USERNAME))
  );
  const otp = await env.DB.prepare(`
    SELECT channel, destination, expires_at, delivery_status, created_at
    FROM client_verification_otps
    WHERE client_id=? AND consumed_at IS NULL AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).bind(clientId).first();
  return {
    verification_status: client.verification_status || "unverified",
    verification_channel: client.verification_channel || null,
    verification_sent_at: client.verification_sent_at || null,
    verified_at: client.verified_at || null,
    has_email: Boolean(client.email_address),
    has_phone: Boolean(normalizeNigerianPhone(client.phone_number)),
    email_ready: emailProviderReady(env),
    sms_ready: smsReady,
    active_otp: otp ? {
      channel: otp.channel,
      destination: maskDestination(otp.channel, otp.destination),
      expires_at: otp.expires_at,
      delivery_status: otp.delivery_status,
      created_at: otp.created_at
    } : null
  };
}

async function autoSendClientVerification(env, client, actorId) {
  try {
    return await createClientVerificationOtp(env, client, null, actorId);
  } catch (error) {
    return { ok: false, error: error.message || "Unable to send verification code" };
  }
}


async function checkSmsLowBalance(env, settingsOverride) {
  const settings = settingsOverride || await getSmsSettings(env);
  if (settings.creditBalance === null || !Number.isFinite(Number(settings.creditBalance))) return { skipped: true };
  if (Number(settings.creditBalance) > Number(settings.lowCreditThreshold)) return { ok: true, low: false };
  const lastAlert = settings.lowBalanceAlertedAt ? new Date(settings.lowBalanceAlertedAt).getTime() : 0;
  if (Date.now() - lastAlert < 24 * 3600 * 1000) return { ok: true, low: true, alerted: false };
  const { results: recipients } = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.is_active=1 AND r.name IN ('Managing Director','Head Accountant','Super Admin')
  `).all();
  for (const recipient of recipients) {
    await createNotification(env, {
      userId: recipient.id,
      type: "sms.low_credit",
      title: "SMS credit is low",
      message: `Remaining SMS credit is ${settings.creditCurrency} ${Number(settings.creditBalance).toLocaleString()}, below the threshold of ${settings.creditCurrency} ${Number(settings.lowCreditThreshold).toLocaleString()}. Please top up the provider account.`,
      metadata: { balance: settings.creditBalance, threshold: settings.lowCreditThreshold }
    });
  }
  await setSmsSetting(env, "sms_low_balance_alerted_at", new Date().toISOString(), null);
  return { ok: true, low: true, alerted: true };
}

async function dispatchSmsSchedules(env) {
  const settings = await getSmsSettings(env);
  if (!settings.enabled) return;
  const today = todayOnly();
  const { results: schedules } = await env.DB.prepare(`
    SELECT s.*, c.full_name, c.phone_number, c.client_reference, c.agreed_purchase_price,
           COALESCE(prop.title, 'your property') AS property_title
    FROM payment_schedules s
    JOIN clients c ON c.id=s.client_id
    LEFT JOIN properties prop ON prop.id=s.property_id
    WHERE s.status='active' AND c.is_deleted=0
  `).all();
  for (const schedule of schedules) {
    const { results: items } = await env.DB.prepare(
      "SELECT * FROM payment_schedule_items WHERE schedule_id=? ORDER BY sequence_no"
    ).bind(schedule.id).all();
    if (!items.length) continue;
    const paidRow = await env.DB.prepare(`
      SELECT COALESCE(SUM(amount_kobo),0) AS paid FROM payments
      WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
    `).bind(schedule.client_id).first();
    const paidKobo = Number(paidRow ? paidRow.paid : 0);
    const totalKobo = Number(schedule.total_kobo || toKobo(schedule.total_amount));
    const balanceKobo = Math.max(0, totalKobo - paidKobo);
    if (balanceKobo <= 0) continue;
    const state = computeScheduleDefaulting(schedule, items, paidKobo, today);
    if (settings.remindersEnabled && state.next_due_date && state.next_installment_kobo > 0) {
      const daysUntil = diffDays(today, state.next_due_date);
      if (daysUntil >= 0 && daysUntil <= settings.reminderDays) {
        const template = await getSmsTemplate(env, "payment_reminder");
        const body = renderSmsTemplate(template ? template.body : "Reminder: NGN {amount} is due on {due_date}. Bliss Legacy.", {
          amount: fromKobo(state.next_installment_kobo).toLocaleString("en-NG"),
          due_date: state.next_due_date,
          property: schedule.property_title,
          reference: schedule.client_reference
        });
        await enqueueSms(env, {
          clientId: schedule.client_id, scheduleId: schedule.id, templateKey: "payment_reminder",
          phone: schedule.phone_number, body, idempotencyKey: `reminder:${schedule.id}:${state.next_due_date}`
        });
      }
    }
    if (settings.defaultingRemindersEnabled && state.status === "defaulting" && state.amount_behind_kobo > 0) {
      const last = await env.DB.prepare(`
        SELECT sent_at, created_at FROM sms_messages WHERE schedule_id=? AND template_key='defaulting_reminder'
        ORDER BY id DESC LIMIT 1
      `).bind(schedule.id).first();
      const lastAt = last ? parseDbDate(last.sent_at || last.created_at).getTime() : 0;
      if (Date.now() - lastAt >= settings.defaultingFrequencyDays * 86400000) {
        const template = await getSmsTemplate(env, "defaulting_reminder");
        const body = renderSmsTemplate(template ? template.body : "{days} day(s) overdue: NGN {amount} behind on {property}.", {
          days: state.days_overdue,
          amount: fromKobo(state.amount_behind_kobo).toLocaleString("en-NG"),
          property: schedule.property_title,
          reference: schedule.client_reference
        });
        await enqueueSms(env, {
          clientId: schedule.client_id, scheduleId: schedule.id, templateKey: "defaulting_reminder",
          phone: schedule.phone_number, body, idempotencyKey: `defaulting:${schedule.id}:${today}`
        });
      }
    }
    if (Number(today.slice(8, 10)) === settings.statementDay) {
      const template = await getSmsTemplate(env, "monthly_statement");
      const body = renderSmsTemplate(template ? template.body : "Paid NGN {paid} of NGN {total}; outstanding NGN {balance}. Next due {next_due}.", {
        paid: fromKobo(paidKobo).toLocaleString("en-NG"),
        total: fromKobo(totalKobo).toLocaleString("en-NG"),
        balance: fromKobo(balanceKobo).toLocaleString("en-NG"),
        next_due: state.next_due_date || "none",
        property: schedule.property_title,
        reference: schedule.client_reference
      });
      await enqueueSms(env, {
        clientId: schedule.client_id, scheduleId: schedule.id, templateKey: "monthly_statement",
        phone: schedule.phone_number, body, idempotencyKey: `statement:${schedule.id}:${today.slice(0, 7)}`
      });
    }
  }
}


async function dispatchPaymentReminders(env) {
  const { results: schedules } = await env.DB.prepare(`
    SELECT s.id, s.client_id, s.next_due_date, s.installment_kobo, s.installment_amount, s.status,
           c.full_name, c.client_reference
    FROM payment_schedules s
    JOIN clients c ON c.id=s.client_id
    WHERE s.status='active' AND c.is_deleted=0
  `).all();

  const today = new Date();
  for (const schedule of schedules) {
    const paidRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount_kobo),0) AS total FROM payments WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'"
    ).bind(schedule.client_id).first();
    const totalRow = await env.DB.prepare("SELECT total_kobo FROM payment_schedules WHERE id=?").bind(schedule.id).first();
    const remaining = Math.max(0, Number(totalRow ? totalRow.total_kobo : 0) - Number(paidRow ? paidRow.total : 0));
    if (remaining <= 0) continue;

    const due = parseDbDate(schedule.next_due_date);
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const amount = Number(schedule.installment_kobo || toKobo(schedule.installment_amount));

    if (diffDays < 0) {
      await createNotification(env, {
        clientId: schedule.client_id,
        type: "installment.overdue",
        title: "Installment Overdue",
        message: `Your installment of ${formatNGN(amount)} was due on ${schedule.next_due_date}. Please contact our finance team to regularise your account. No penalty has been applied.`,
        metadata: { schedule_id: schedule.id, due_date: schedule.next_due_date },
        dedupeKey: `overdue:${schedule.id}:${schedule.next_due_date}`
      });
    } else if (diffDays <= 7) {
      await createNotification(env, {
        clientId: schedule.client_id,
        type: "installment.upcoming",
        title: "Upcoming Installment",
        message: `Your next installment of ${formatNGN(amount)} is due on ${schedule.next_due_date}. Quote your client reference ${schedule.client_reference} when paying.`,
        metadata: { schedule_id: schedule.id, due_date: schedule.next_due_date },
        dedupeKey: `upcoming:${schedule.id}:${schedule.next_due_date}`
      });
    }
  }
}

// Durable Object: one instance per chat room/conversation. Messages are
// persisted in D1 and broadcast only to WebSocket clients attached to this room.
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const userId = Number(request.headers.get("X-Bliss-User-Id"));
    const roomId = Number(request.headers.get("X-Bliss-Room-Id"));
    const userName = String(request.headers.get("X-Bliss-User-Name") || "Staff");
    if (!userId || !roomId) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId, roomId, userName });
    this.state.acceptWebSocket(server);

    const { results } = await this.env.DB.prepare(`
      SELECT m.id, m.room_id, m.sender_id, m.message, m.created_at, u.full_name AS sender_name
      FROM chat_messages m JOIN users u ON u.id=m.sender_id
      WHERE m.room_id=? ORDER BY m.id DESC LIMIT 50
    `).bind(roomId).all();
    try {
      server.send(JSON.stringify({ type: "history", messages: results.reverse() }));
    } catch (error) {}

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    const attachment = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
    if (!attachment || !attachment.userId || !attachment.roomId) return;
    let payload;
    try {
      payload = JSON.parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage));
    } catch (error) {
      return;
    }
    const text = String(payload && payload.message || "").trim().slice(0, 2000);
    if (!text) return;

    const inserted = await this.env.DB.prepare(
      "INSERT INTO chat_messages (room_id, sender_id, message) VALUES (?, ?, ?)"
    ).bind(attachment.roomId, attachment.userId, text).run();
    const row = await this.env.DB.prepare(`
      SELECT m.id, m.room_id, m.sender_id, m.message, m.created_at, u.full_name AS sender_name
      FROM chat_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?
    `).bind(inserted.meta.last_row_id).first();
    const outbound = JSON.stringify({ type: "message", message: row });
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(outbound); } catch (error) {}
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch (error) {}
  }

  async webSocketError(ws) {
    try { ws.close(); } catch (error) {}
  }
}

async function handleFetch(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- Health check ----
    if (path === "/api/health") return json({ ok: true });

    // ---- Setup initial MD (one-time) ----
    if (path === "/api/setup" && request.method === "POST") {
      const setupSecret = request.headers.get("X-Setup-Secret");
      if (!env.SETUP_SECRET || !secureCompare(setupSecret, env.SETUP_SECRET)) return json({ error: "Forbidden" }, 403);
      const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
      if (count && count.c > 0) return json({ error: "Already initialized" }, 409);
      const body = await request.json();
      const { email, password, full_name } = body || {};
      if (!email || !password || !full_name) return json({ error: "Missing fields" }, 400);
      const mdRole = await env.DB.prepare("SELECT id FROM roles WHERE name='Managing Director'").first();
      const hash = await hashPassword(password);
      const referralCode = await allocateReferralCode(env);
      const res = await env.DB.prepare("INSERT INTO users (email, password_hash, full_name, role_id, branch_id, referral_code) VALUES (?, ?, ?, ?, NULL, ?)").bind(email.toLowerCase(), hash, full_name, mdRole.id, referralCode).run();
      await audit(env, res.meta.last_row_id, "setup.initialize", "user", String(res.meta.last_row_id), { email });
      return json({ ok: true, user_id: res.meta.last_row_id });
    }

    // =========================================================================
    // PUBLIC ENQUIRIES
    // =========================================================================
    if (path === "/api/public/enquiries" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const fullName = String(body?.full_name || "").trim();
      const phone = String(body?.phone_number || "").trim();
      const email = String(body?.email_address || "").trim().toLowerCase();
      const message = String(body?.message || "").trim();
      const source = String(body?.source || "Website enquiry").trim().slice(0, 80);
      const acquisitionMode = String(body?.acquisition_mode || "").trim().slice(0, 80);
      const branchName = String(body?.branch_name || "").trim();
      const propertyReference = String(body?.property_reference || "").trim();
      if (!fullName || fullName.length > 160) return json({ error: "A valid full name is required" }, 400);
      if (!/^[+0-9()\s-]{7,25}$/.test(phone)) return json({ error: "A valid phone number is required" }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email address is required" }, 400);
      if (!message || message.length > 3000) return json({ error: "A message of up to 3,000 characters is required" }, 400);

      const enquiryIp = clientIp(request);
      if (await recentAuditCount(env, "enquiry.attempt", `ip:${enquiryIp}`, 60) >= 10) {
        return json({ error: "Too many enquiries. Please try again later." }, 429);
      }
      await audit(env, null, "enquiry.attempt", "enquiry", `ip:${enquiryIp}`, { source });

      let property = null;
      if (propertyReference) {
        property = await env.DB.prepare("SELECT id, title, reference, branch_id FROM properties WHERE reference=? AND is_published=1 LIMIT 1")
          .bind(propertyReference).first();
      } else if (body?.property_id) {
        property = await env.DB.prepare("SELECT id, title, reference, branch_id FROM properties WHERE id=? AND is_published=1 LIMIT 1")
          .bind(Number(body.property_id)).first();
      }

      let branch = null;
      if (property && property.branch_id) {
        branch = await env.DB.prepare("SELECT id, name FROM branches WHERE id=?").bind(property.branch_id).first();
      }
      if (!branch && branchName) {
        branch = await env.DB.prepare("SELECT id, name FROM branches WHERE name=?").bind(branchName).first();
      }
      if (!branch) {
        branch = await env.DB.prepare("SELECT id, name FROM branches ORDER BY CASE WHEN name='Head Office' THEN 0 ELSE 1 END, id LIMIT 1").first();
      }
      if (!branch) return json({ error: "Enquiries are temporarily unavailable" }, 503);

      const system = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE r.name='Managing Director' AND u.is_active=1 ORDER BY u.id LIMIT 1
      `).first();
      if (!system) return json({ error: "Enquiries are temporarily unavailable" }, 503);

      const notes = [
        message,
        acquisitionMode ? `Preferred acquisition mode: ${acquisitionMode}` : "",
        property ? `Property: ${property.title} (${property.reference})` : (propertyReference ? `Property reference supplied: ${propertyReference}` : ""),
        branchName ? `Preferred branch: ${branchName}` : "",
        `Source: ${source}`
      ].filter(Boolean).join("\n").slice(0, 4000);
      const reference = "LEAD-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
      const res = await env.DB.prepare(`
        INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source, status, property_id,
          assigned_marketer_id, team_lead_id, branch_id, estimated_value_kobo, notes, created_by)
        VALUES (?, ?, ?, ?, ?, 'New Lead', ?, NULL, NULL, ?, 0, ?, ?)
      `).bind(
        reference, fullName, phone, email || null, source, property ? property.id : null,
        branch.id, notes, system.id
      ).run();
      await audit(env, system.id, "lead.public_enquiry", "lead", String(res.meta.last_row_id), {
        reference, source, branch_id: branch.id, property_id: property ? property.id : null
      }, branch.id);
      return json({ ok: true, reference });
    }

    // =========================================================================
    // PUBLIC TERMS & CONDITIONS
    // =========================================================================
    if (path === "/api/terms" && request.method === "GET") {
      const terms = await env.DB.prepare(`
        SELECT id, version_no, title, body_text, document_r2_key, document_filename, created_at
        FROM terms_versions WHERE is_active=1 ORDER BY version_no DESC LIMIT 1
      `).first();
      if (!terms) return json({ terms: null });
      return json({
        terms: {
          id: terms.id,
          version_no: terms.version_no,
          title: terms.title,
          body_text: terms.body_text,
          document_url: terms.document_r2_key ? `/api/terms/document/${terms.id}` : null,
          document_filename: terms.document_filename || null,
          published_at: terms.created_at
        }
      }, 200, { "Cache-Control": "public, max-age=60" });
    }

    const publicTermsDocumentMatch = path.match(/^\/api\/terms\/document\/(\d+)$/);
    if (publicTermsDocumentMatch && request.method === "GET") {
      const terms = await env.DB.prepare(
        "SELECT id, document_r2_key, document_filename, document_content_type FROM terms_versions WHERE id=?"
      ).bind(publicTermsDocumentMatch[1]).first();
      if (!terms || !terms.document_r2_key) return new Response("Not found", { status: 404 });
      const object = await env.FILES.get(terms.document_r2_key);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
      headers.set("Content-Type", terms.document_content_type || "application/pdf");
      headers.set("Content-Disposition", `inline; filename="${sanitizeFilename(terms.document_filename, "terms-and-conditions")}"`);
      headers.set("Cache-Control", "public, max-age=300");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(object.body, { headers });
    }

    // =========================================================================
    // PUBLIC STAFF REFERRAL LOOKUP
    // =========================================================================
    const publicReferralMatch = path.match(/^\/api\/referral\/([^/]+)$/);
    if (publicReferralMatch && request.method === "GET") {
      const code = decodeURIComponent(publicReferralMatch[1] || "").trim().toUpperCase();
      if (!code) return json({ error: "Referral code is required" }, 400);
      const staff = await resolveReferralStaff(env, code);
      if (!staff) return json({ error: "Referral code not found" }, 404);
      const branch = staff.branch_id
        ? await env.DB.prepare("SELECT id, name FROM branches WHERE id=?").bind(staff.branch_id).first()
        : null;
      return json({
        ok: true,
        referral_code: staff.referral_code,
        staff_name: staff.full_name,
        branch_id: branch ? branch.id : null,
        branch_name: branch ? branch.name : null
      });
    }

    // =========================================================================
    // PUBLIC CLIENT SIGN-UP
    // =========================================================================
    if (path === "/api/signup" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const {
        full_name, email, phone_number, password, interested_property_id, property_plan_id, plan_start_date,
        alternate_phone, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship,
        next_of_kin_address, referral_code, residential_address, state, city, branch_id,
        identity_type, identity_number, bvn, terms_accepted
      } = body || {};
      if (!full_name || !email || !phone_number || !password) {
        return json({ error: "Full name, email, phone number and password are required" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
        return json({ error: "A valid email address is required" }, 400);
      }
      if (!/^[+0-9()\s-]{7,25}$/.test(String(phone_number).trim())) {
        return json({ error: "A valid phone number is required" }, 400);
      }
      const signupPhone = normalizeNigerianPhone(phone_number);
      if (!signupPhone) return json({ error: "A valid Nigerian phone number is required" }, 400);
      if (alternate_phone && !/^[+0-9()\s-]{7,25}$/.test(String(alternate_phone).trim())) {
        return json({ error: "Alternate phone number is invalid" }, 400);
      }
      if (next_of_kin_phone && !/^[+0-9()\s-]{7,25}$/.test(String(next_of_kin_phone).trim())) {
        return json({ error: "Next of kin phone number is invalid" }, 400);
      }
      if (alternate_phone && normalizeNigerianPhone(alternate_phone) === signupPhone) {
        return json({ error: "Alternate phone number must be different from the primary phone number" }, 400);
      }
      if (!residential_address || !String(residential_address).trim()) {
        return json({ error: "Residential address is required" }, 400);
      }
      if (branch_id === undefined || branch_id === null || branch_id === "") {
        return json({ error: "Select the branch you are onboarding with" }, 400);
      }

      const requestedIdentityType = identity_type ? normalizeIdentityType(identity_type) : null;
      const identityProvided = Boolean(identity_type || identity_number);
      if (identityProvided) {
        if (!requestedIdentityType) return json({ error: "Select a valid identity type" }, 400);
        const identityError = validateIdentityNumber(requestedIdentityType, identity_number);
        if (identityError) return json({ error: identityError }, 400);
      }
      const signupIdentityHash = identityProvided ? await hashIdentityNumber(identity_number) : null;
      if (signupIdentityHash) {
        const existingIdentity = await env.DB.prepare(
          "SELECT id FROM clients WHERE identity_number_hash=? AND identity_type=? AND is_deleted=0 LIMIT 1"
        ).bind(signupIdentityHash, requestedIdentityType).first();
        if (existingIdentity) return json({ error: "This identity number is already linked to another client account" }, 409);
      }
      const bvnDigits = bvn ? cleanBvn(bvn) : null;
      if (bvn && !bvnDigits) return json({ error: "BVN must be 10 or 11 digits" }, 400);

      let requestedBranchId = null;
      if (branch_id !== undefined && branch_id !== null && branch_id !== "") {
        requestedBranchId = Number(branch_id);
        if (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0) {
          return json({ error: "Select a valid branch" }, 400);
        }
      }
      if (!validPassword(password)) {
        return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedPhone = signupPhone;
      const signupIp = clientIp(request);
      if (await recentAuditCount(env, "signup.attempt", `ip:${signupIp}`, 60) >= 5) {
        return json({ error: "Too many registration attempts. Please try again later." }, 429);
      }
      if (await recentAuditCount(env, "signup.attempt", `email:${normalizedEmail}`, 1440) >= 3) {
        return json({ error: "Too many registration attempts for this email. Please try again later." }, 429);
      }
      await audit(env, null, "signup.attempt", "signup", `ip:${signupIp}`, { email: normalizedEmail });
      await audit(env, null, "signup.attempt", "signup", `email:${normalizedEmail}`, { ip: signupIp });
      const activeTerms = await env.DB.prepare(`
        SELECT id, version_no, title FROM terms_versions WHERE is_active=1 ORDER BY version_no DESC LIMIT 1
      `).first();
      if (!activeTerms) return json({ error: "Terms and conditions are not configured yet" }, 503);
      if (!isTruthy(terms_accepted)) {
        return json({ error: "You must read and accept the Terms and Conditions before creating an account" }, 400);
      }
      const existingUser = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(normalizedEmail).first();
      if (existingUser) return json({ error: "An account with this email already exists" }, 409);
      const existingClient = await env.DB.prepare(
        "SELECT id FROM clients WHERE (LOWER(email_address)=? OR phone_number=?) AND is_deleted=0 LIMIT 1"
      ).bind(normalizedEmail, signupPhone).first();
      if (existingClient) return json({ error: "A client record with this email or phone already exists" }, 409);

      const system = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE r.name='Managing Director' AND u.is_active=1 ORDER BY u.id LIMIT 1
      `).first();
      if (!system) return json({ error: "Client registration is not available until the portal is initialized" }, 503);

      // The client must choose a branch during onboarding. A staff referral is
      // still recorded for attribution, but it never overrides the chosen branch.
      const referrer = referral_code ? await resolveReferralStaff(env, referral_code) : null;
      if (referral_code && !referrer) return json({ error: "Invalid referral code" }, 400);
      const attribution = await buildReferralAttribution(env, referrer, system.id);
      const requestedBranch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(requestedBranchId).first();
      if (!requestedBranch) return json({ error: "The selected branch was not found" }, 400);
      const resolvedBranch = requestedBranch.id;

      let propertyId = interested_property_id ? Number(interested_property_id) : null;
      let signupPlan = null;
      if (propertyId) {
        const property = await env.DB.prepare("SELECT id FROM properties WHERE id=? AND is_published=1 AND is_internal_test=0 AND is_archived=0").bind(propertyId).first();
        if (!property) return json({ error: "Selected property is not available" }, 400);
        const planResult = await resolvePropertyPlanForPurchase(env, propertyId, property_plan_id ? Number(property_plan_id) : null);
        if (planResult.error) return json({ error: planResult.error, plans: planResult.plans || [] }, 400);
        signupPlan = planResult.plan;
      } else if (property_plan_id) {
        return json({ error: "A property is required before selecting a payment plan" }, 400);
      }

      const clientRole = await env.DB.prepare("SELECT id FROM roles WHERE name='Client'").first();
      if (!clientRole) return json({ error: "Client role is not configured" }, 503);
      const hash = await hashPassword(password);
      const userRes = await env.DB.prepare(`
        INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(normalizedEmail, hash, String(full_name).trim(), clientRole.id, resolvedBranch).run();
      const userId = userRes.meta.last_row_id;
      const clientRef = "BLC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const nextOfKinLegacy = [next_of_kin_name, next_of_kin_relationship ? `(${next_of_kin_relationship})` : ""]
        .filter(Boolean).join(" ").trim() || null;
      const resolvedIdentityType = identityProvided ? requestedIdentityType : null;
      const identityMasked = identityProvided ? maskIdentityNumber(identity_number) : null;
      const identityLast4 = identityProvided ? cleanIdentityNumber(identity_number).slice(-4) : null;
      const identityHash = signupIdentityHash;
      const bvnLast4 = bvnDigits ? bvnDigits.slice(-4) : null;
      const kycSubmittedAt = identityProvided ? new Date().toISOString() : null;
      const clientRes = await env.DB.prepare(`
        INSERT INTO clients (client_reference, full_name, phone_number, alternate_phone, email_address,
          residential_address, state, city, next_of_kin, next_of_kin_name, next_of_kin_phone,
          next_of_kin_relationship, next_of_kin_address, notes, status,
          sale_type, assigned_branch_id, created_by, original_marketer_id, team_lead_id,
          agreed_purchase_price, interested_property_id, referral_code_used, referred_by_staff_id, user_id,
          identity_type, identity_number_masked, identity_number_last4, identity_number_hash, bvn_last4,
          kyc_status, kyc_submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Prospect', 'New Sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).bind(
        clientRef, String(full_name).trim(), normalizedPhone, alternate_phone || null, normalizedEmail,
        residential_address || null, state || null, city || null,
        nextOfKinLegacy, next_of_kin_name || null, next_of_kin_phone || null,
        next_of_kin_relationship || null, next_of_kin_address || null,
        "Self-registered through the public client portal.", resolvedBranch,
        referrer ? referrer.id : system.id, attribution.originalMarketerId, attribution.teamLeadId,
        signupPlan ? fromKobo(Number(signupPlan.total_price_kobo || 0)) : null, propertyId,
        attribution.referralCodeUsed, attribution.referredByStaffId, userId,
        resolvedIdentityType, identityMasked, identityLast4, identityHash, bvnLast4,
        kycSubmittedAt
      ).run();
      const clientId = clientRes.meta.last_row_id;
      await env.DB.prepare(`
        INSERT INTO terms_acceptances (terms_version_id, user_id, client_id, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        activeTerms.id, userId, clientId, clientIp(request),
        String(request.headers.get("User-Agent") || "").slice(0, 500)
      ).run();
      if (propertyId) await upsertClientPropertyAllocation(env, clientId, propertyId, signupPlan ? fromKobo(Number(signupPlan.total_price_kobo || 0)) : 0, "Prospect");
      if (signupPlan) {
        await lockClientPurchasePlan(env, clientId, propertyId, signupPlan, "Prospect");
        const schedule = await createScheduleFromPropertyPlan(env, {
          id: clientId, interested_property_id: propertyId, assigned_branch_id: resolvedBranch
        }, signupPlan, system.id, plan_start_date || todayOnly());
        if (schedule.error) return json({ error: schedule.error }, 400);
      }
      await env.DB.prepare(`
        INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(clientId, attribution.relationshipManagerId, resolvedBranch, attribution.teamLeadId, system.id).run();
      await env.DB.prepare(`
        INSERT INTO client_status_history (client_id, old_status, new_status, changed_by)
        VALUES (?, NULL, 'Prospect', ?)
      `).bind(clientId, userId).run();
      await audit(env, userId, "client.self_register", "client", String(clientId), {
        client_reference: clientRef, email: normalizedEmail, branch_id: resolvedBranch,
        branch_selected_by_client: Boolean(requestedBranch),
        referral_code: attribution.referralCodeUsed, referred_by_staff_id: attribution.referredByStaffId,
        identity_type: resolvedIdentityType, identity_last4: identityLast4,
        bvn_last4: bvnLast4, kyc_status: "pending",
        terms_version_id: activeTerms.id, terms_version_no: activeTerms.version_no
      }, resolvedBranch);
      await createNotification(env, {
        userId,
        type: "client.welcome",
        title: "Welcome to Bliss Legacy",
        message: `Your client portal account is ready. Your client reference is ${clientRef}.`,
        metadata: { client_id: clientId, client_reference: clientRef }
      });
      await notifyClientCreated(env, {
        id: clientId,
        full_name: String(full_name).trim(),
        client_reference: clientRef,
        assigned_branch_id: resolvedBranch,
        original_marketer_id: attribution.originalMarketerId,
        team_lead_id: attribution.teamLeadId,
        referred_by_staff_id: attribution.referredByStaffId
      }, userId);
      await sendAccountCreatedSms(env, clientId, userId);
      const verification = await autoSendClientVerification(env, {
        id: clientId,
        full_name: String(full_name).trim(),
        phone_number: normalizedPhone,
        email_address: normalizedEmail,
        assigned_branch_id: resolvedBranch
      }, userId);

      // Every client gets a dedicated (permanent) ALATPay wallet. The provider
      // requires the client's BVN plus an OTP sent to the BVN phone, so we start
      // provisioning here when a BVN was supplied and the client can finish the
      // OTP step from the virtual-account page.
      let virtualAccount = null;
      if (bvnDigits) {
        try {
          const walletSettings = await getAlatpaySettings(env);
          if (walletSettings.ready) {
            virtualAccount = await initiateAlatpayStaticWallet(env, {
              id: clientId,
              full_name: String(full_name).trim(),
              phone_number: normalizedPhone,
              email_address: normalizedEmail,
              assigned_branch_id: resolvedBranch
            }, bvnDigits, userId);
          } else {
            virtualAccount = {
              ok: false,
              status: "pending_provider",
              message: "Your dedicated account is queued and will be activated when our banking partner is configured."
            };
          }
        } catch (error) {
          virtualAccount = {
            ok: false,
            status: "pending_provider",
            message: "Your dedicated account could not be created automatically. Open My Virtual Account to retry."
          };
        }
      } else {
        virtualAccount = {
          ok: false,
          status: "bvn_required",
          message: "Add your BVN in My Virtual Account to activate your dedicated bank account."
        };
      }

      const session = await createSession(env, userId);
      const cookie = `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(session.expires).toUTCString()}`;
      return json({
        ok: true,
        client_id: clientId,
        client_reference: clientRef,
        kyc_status: "pending",
        verification,
        virtual_account: virtualAccount,
        terms: { accepted: true, version_id: activeTerms.id, version_no: activeTerms.version_no, title: activeTerms.title },
        user: { id: userId, email: normalizedEmail, full_name: String(full_name).trim(), role: "Client" }
      }, 200, { "Set-Cookie": cookie });
    }

    // =========================================================================
    // UNIFIED AUTHENTICATION (Staff & Clients)
    // =========================================================================
    if (path === "/api/login" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { email, password } = body || {};
      if (!email || !password) return json({ error: "Identifier and password required" }, 400);

      const ident = email.trim().toLowerCase();

      // Basic brute-force throttling backed by the immutable audit log.
      const recentFailures = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE action='login.failure' AND target_id=? AND created_at >= datetime('now','-15 minutes')"
      ).bind(ident).first();
      if (recentFailures && recentFailures.c >= 10) {
        await audit(env, null, "login.throttled", "user", ident, { reason: "too_many_failures" });
        return json({ error: "Too many failed attempts. Please try again later." }, 429);
      }

      // Look up user by email directly OR by client reference / phone
      let user = await env.DB.prepare(
        "SELECT u.id, u.email, u.password_hash, u.is_active, u.is_test, u.test_expires_at, u.access_valid_until, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=?"
      ).bind(ident).first();

      if (!user) {
        // Try resolving client reference or phone number
        const clientMatch = await env.DB.prepare(
          "SELECT user_id, email_address FROM clients WHERE (LOWER(client_reference)=? OR phone_number=?) AND is_deleted=0"
        ).bind(ident, ident).first();
        if (clientMatch) {
          if (clientMatch.user_id) {
            user = await env.DB.prepare(
              "SELECT u.id, u.email, u.password_hash, u.is_active, u.is_test, u.test_expires_at, u.access_valid_until, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?"
            ).bind(clientMatch.user_id).first();
          } else if (clientMatch.email_address) {
            user = await env.DB.prepare(
              "SELECT u.id, u.email, u.password_hash, u.is_active, u.is_test, u.test_expires_at, u.access_valid_until, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=?"
            ).bind(clientMatch.email_address.toLowerCase()).first();
          }
        }
      }

      if (!user) {
        await audit(env, null, "login.failure", "user", ident, { reason: "not_found" });
        return json({ error: "Invalid credentials" }, 401);
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        await audit(env, user.id, "login.failure", "user", ident, { reason: "bad_password" });
        return json({ error: "Invalid credentials" }, 401);
      }

      if (testAccountExpired(user, env)) {
        await env.DB.prepare("UPDATE users SET is_active=0, deactivated_at=datetime('now') WHERE id=?").bind(user.id).run();
        await audit(env, user.id, "test_account.expired", "user", String(user.id), { test_expires_at: user.test_expires_at });
        return json({ error: "This test account has expired after 14 days. Contact the administrator." }, 403);
      }
      const lapsedMonthly = user.role_name === "Marketer" && monthlyAccessLapsed(user, env) &&
        await monthlyReactivationEnabled(env, "Marketer");
      if (lapsedMonthly) {
        await env.DB.prepare("UPDATE users SET access_lapsed_at=COALESCE(access_lapsed_at, datetime('now')) WHERE id=?")
          .bind(user.id).run();
        await audit(env, user.id, "marketer.access_lapsed", "user", String(user.id), { access_valid_until: user.access_valid_until });
        return json({ error: "Your monthly access has lapsed. Contact your branch manager or the MD for reactivation." }, 403);
      }
      if (!user.is_active) {
        await audit(env, null, "login.failure", "user", ident, { reason: "inactive" });
        return json({ error: "Invalid credentials" }, 401);
      }

      // Rotate away any pre-existing browser session to prevent fixation.
      const priorSession = parseCookies(request)[SESSION_COOKIE];
      if (priorSession) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(priorSession).run();
      const sess = await createSession(env, user.id);
      await env.DB.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").bind(user.id).run();
      await audit(env, user.id, "login.success", "user", String(user.id), { role: user.role_name });

      // If client, fetch client metadata
      let clientRef = null;
      let clientId = null;
      if (user.role_name === "Client") {
        const c = await getClientForActor(env, { id: user.id, role_name: "Client", email: user.email });
        if (c) {
          clientRef = c.client_reference;
          clientId = c.id;
        }
      }

      const cookie = `${SESSION_COOKIE}=${sess.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(sess.expires).toUTCString()}`;
      return json(
        {
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role_name,
            client_reference: clientRef,
            client_id: clientId
          }
        },
        200,
        { "Set-Cookie": cookie }
      );
    }

    if (path === "/api/logout" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const user = await getSessionUser(env, request);
      const cookies = parseCookies(request);
      const sid = cookies[SESSION_COOKIE];
      if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
      if (user) await audit(env, user.id, "logout", "user", String(user.id), null);
      const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }

    if (path === "/api/me" && request.method === "GET") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Unauthenticated" }, 401);

      let clientDetails = null;
      if (user.role_name === "Client") {
        const c = await getClientForActor(env, user);
        if (c) {
          clientDetails = {
            id: c.id,
            client_reference: c.client_reference,
            full_name: c.full_name,
            phone_number: c.phone_number,
            email_address: c.email_address,
            status: c.status
          };
        }
      }

      let staffDetails = null;
      if (user.role_name !== "Client") {
        staffDetails = await env.DB.prepare(`
          SELECT b.name AS branch_name, sp.phone_number, sp.job_title, sp.date_joined,
                 u.last_login_at, u.created_at,
                 (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id
                   WHERE tm.user_id=u.id AND t.is_active=1) AS team_names
          FROM users u
          LEFT JOIN branches b ON b.id=u.branch_id
          LEFT JOIN staff_profiles sp ON sp.user_id=u.id
          WHERE u.id=?
        `).bind(user.id).first();
      }

      return json({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role_name,
        actual_role: user.actual_role_name || user.role_name,
        role_id: user.role_id,
        branch_id: user.branch_id,
        branch_name: staffDetails ? staffDetails.branch_name : null,
        phone_number: staffDetails ? staffDetails.phone_number : null,
        job_title: staffDetails ? staffDetails.job_title : null,
        date_joined: staffDetails ? staffDetails.date_joined : null,
        last_login_at: staffDetails ? staffDetails.last_login_at : null,
        team_names: staffDetails ? staffDetails.team_names : null,
        referral_code: user.role_name !== "Client" ? user.referral_code : null,
        commission_access: Number(user.commission_access || 0) === 1,
        can_access_commissions: canAccessCommissions(user),
        property_plans_access: Number(user.property_plans_access || 0) === 1,
        sms_access: Number(user.sms_access || 0) === 1,
        care_scope: user.care_scope || null,
        payment_mode: getPaymentMode(env),
        referral_link: user.role_name !== "Client" && user.referral_code
          ? `${new URL(request.url).origin}/signup?ref=${encodeURIComponent(user.referral_code)}`
          : null,
        client: clientDetails
      });
    }

    // =========================================================================
    // SUPER ADMIN — permission-guarded system administration
    // =========================================================================
    async function adminActor(permission) {
      const actor = await getSessionUser(env, request);
      if (!actor) return { error: json({ error: "Unauthenticated" }, 401) };
      if (!["Managing Director", "Super Admin"].includes(actor.actual_role_name || actor.role_name)) {
        return { error: json({ error: "Forbidden" }, 403) };
      }
      if (!(await roleHasPermission(env, actor.role_id, permission))) {
        return { error: json({ error: `Missing permission: ${permission}` }, 403) };
      }
      return { actor };
    }

    if (path === "/api/admin/clients" && request.method === "GET") {
      const auth = await adminActor("admin.system");
      if (auth.error) return auth.error;
      const q = String(url.searchParams.get("q") || "").trim();
      const branchId = url.searchParams.get("branch_id");
      const kycStatus = String(url.searchParams.get("kyc_status") || "").trim();
      const status = String(url.searchParams.get("status") || "").trim();
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
      const offset = (page - 1) * limit;
      const clauses = ["c.is_deleted=0"];
      const binds = [];
      if (q) {
        clauses.push("(c.full_name LIKE ? OR c.client_reference LIKE ? OR c.phone_number LIKE ? OR c.email_address LIKE ?)");
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (branchId) { clauses.push("c.assigned_branch_id=?"); binds.push(Number(branchId)); }
      if (kycStatus) { clauses.push("c.kyc_status=?"); binds.push(kycStatus); }
      if (status) { clauses.push("c.status=?"); binds.push(status); }
      const whereSql = "WHERE " + clauses.join(" AND ");
      const { results: clients } = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.phone_number, c.alternate_phone, c.email_address,
               c.residential_address, c.state, c.city, c.status, c.verification_status, c.verification_channel,
               c.next_of_kin_name, c.next_of_kin_phone, c.next_of_kin_relationship, c.next_of_kin_address,
               c.assigned_branch_id, c.kyc_status, c.identity_type, c.identity_number_masked, c.identity_number_last4, c.bvn_last4,
               c.payment_plan_type, c.payment_plan_duration_months, c.payment_plan_total_kobo,
               c.referral_code_used, c.referred_by_staff_id, c.original_marketer_id,
               c.created_at, c.updated_at,
               b.name AS branch_name, ref.full_name AS referred_by_name, ref.referral_code AS referred_by_code,
               m.full_name AS marketer_name, prop.title AS property_title, prop.reference AS property_reference,
               (SELECT t.version_no FROM terms_acceptances ta
                 JOIN terms_versions t ON t.id=ta.terms_version_id
                 WHERE ta.client_id=c.id ORDER BY ta.id DESC LIMIT 1) AS terms_version_no,
               (SELECT ta.accepted_at FROM terms_acceptances ta
                 WHERE ta.client_id=c.id ORDER BY ta.id DESC LIMIT 1) AS terms_accepted_at
        FROM clients c
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN users ref ON ref.id=c.referred_by_staff_id
        LEFT JOIN users m ON m.id=c.original_marketer_id
        LEFT JOIN properties prop ON prop.id=c.interested_property_id
        ${whereSql}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM clients c ${whereSql}`).bind(...binds).first();
      return json({
        clients,
        pagination: { page, limit, total: Number(count ? count.c : 0) }
      });
    }

    if (path === "/api/admin/app-settings" && (request.method === "GET" || request.method === "PUT")) {
      const auth = await adminActor("settings.manage");
      if (auth.error) return auth.error;
      if (request.method === "GET") {
        const config = await getSiteConfig(env);
        return json({
          settings: {
            branch_manager_listing_approval: String(await getAppSetting(env, "branch_manager_listing_approval", "1")) === "1",
            hide_demo_properties: String(await getAppSetting(env, "hide_demo_properties", "1")) === "1",
            hide_all_test_data: String(await getAppSetting(env, "hide_all_test_data", "0")) === "1",
            site_config: config
          }
        });
      }
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json().catch(() => ({}));
      if (body.branch_manager_listing_approval !== undefined) {
        await setAppSetting(env, "branch_manager_listing_approval", isTruthy(body.branch_manager_listing_approval) ? "1" : "0", auth.actor.id);
      }
      if (body.hide_demo_properties !== undefined) {
        await setAppSetting(env, "hide_demo_properties", isTruthy(body.hide_demo_properties) ? "1" : "0", auth.actor.id);
      }
      if (body.hide_all_test_data !== undefined) {
        await setAppSetting(env, "hide_all_test_data", isTruthy(body.hide_all_test_data) ? "1" : "0", auth.actor.id);
      }
      if (body.site_config !== undefined) {
        if (typeof body.site_config !== "object" || Array.isArray(body.site_config)) return json({ error: "site_config must be an object" }, 400);
        await setAppSetting(env, "site_config", JSON.stringify(body.site_config), auth.actor.id);
      }
      await audit(env, auth.actor.id, "settings.update", "app_settings", null, {
        branch_manager_listing_approval: body.branch_manager_listing_approval,
        hide_demo_properties: body.hide_demo_properties,
        hide_all_test_data: body.hide_all_test_data,
        site_config_updated: body.site_config !== undefined
      }, null);
      return json({ ok: true });
    }

    if (path === "/api/admin/archive-test-data" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const auth = await adminActor("settings.manage");
      if (auth.error) return auth.error;
      const properties = await env.DB.prepare("UPDATE properties SET is_archived=1, is_published=0, workflow_status='archived', archived_at=datetime('now'), updated_at=datetime('now') WHERE is_internal_test=1 AND is_archived=0").run();
      const clients = await env.DB.prepare("UPDATE clients SET is_archived=1, updated_at=datetime('now') WHERE is_internal_test=1 AND is_archived=0").run();
      const payments = await env.DB.prepare("UPDATE payments SET is_archived=1 WHERE is_internal_test=1 AND is_archived=0").run();
      await setAppSetting(env, "hide_all_test_data", "1", auth.actor.id);
      const summary = {
        properties: Number(properties.meta ? properties.meta.changes : 0),
        clients: Number(clients.meta ? clients.meta.changes : 0),
        payments: Number(payments.meta ? payments.meta.changes : 0)
      };
      await audit(env, auth.actor.id, "test_data.archive", "app_settings", null, summary, null);
      return json({ ok: true, archived: summary });
    }

    if (path === "/api/admin/terms" && request.method === "GET") {
      const auth = await adminActor("settings.manage");
      if (auth.error) return auth.error;
      const active = await env.DB.prepare(`
        SELECT t.*, u.full_name AS created_by_name
        FROM terms_versions t LEFT JOIN users u ON u.id=t.created_by
        WHERE t.is_active=1 ORDER BY t.version_no DESC LIMIT 1
      `).first();
      const { results: versions } = await env.DB.prepare(`
        SELECT t.id, t.version_no, t.title, t.body_text, t.document_filename, t.document_content_type,
               t.is_active, t.created_at, u.full_name AS created_by_name,
               (SELECT COUNT(*) FROM terms_acceptances a WHERE a.terms_version_id=t.id) AS acceptance_count
        FROM terms_versions t LEFT JOIN users u ON u.id=t.created_by
        ORDER BY t.version_no DESC
      `).all();
      return json({ active: active || null, versions });
    }

    if (path === "/api/admin/terms" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const auth = await adminActor("settings.manage");
      if (auth.error) return auth.error;
      const actor = auth.actor;
      const contentType = String(request.headers.get("Content-Type") || "");
      let title = "";
      let bodyText = "";
      let file = null;
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        title = String(form.get("title") || "").trim();
        bodyText = String(form.get("body_text") || "").trim();
        file = form.get("file");
      } else {
        const body = await request.json().catch(() => ({}));
        title = String(body.title || "").trim();
        bodyText = String(body.body_text || "").trim();
      }
      const active = await env.DB.prepare("SELECT * FROM terms_versions WHERE is_active=1 ORDER BY version_no DESC LIMIT 1").first();
      if (!title) title = active ? active.title : "Terms and Conditions";
      if (!bodyText && active) bodyText = active.body_text;
      if (!bodyText && (!file || typeof file === "string")) {
        return json({ error: "Provide the Terms and Conditions text or upload a document" }, 400);
      }
      if (!bodyText) return json({ error: "Terms text is required when publishing the first version" }, 400);
      if (bodyText.length > 60000) return json({ error: "Terms text is too long (60,000 characters max)" }, 400);

      let documentKey = active ? active.document_r2_key || null : null;
      let documentFilename = active ? active.document_filename || null : null;
      let documentContentType = active ? active.document_content_type || null : null;
      if (file && typeof file !== "string") {
        if (file.type !== "application/pdf") return json({ error: "Terms documents must be uploaded as PDF" }, 400);
        if (file.size > 10 * 1024 * 1024) return json({ error: "Terms document is too large (10MB max)" }, 400);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (detectFileType(bytes) !== "application/pdf") {
          return json({ error: "File contents do not match a PDF document" }, 400);
        }
        documentFilename = sanitizeFilename(file.name, "terms-and-conditions.pdf");
        documentKey = `terms/${crypto.randomUUID()}-${documentFilename}`;
        documentContentType = "application/pdf";
        await env.FILES.put(documentKey, bytes, { httpMetadata: { contentType: "application/pdf" } });
      }

      const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(version_no),0) AS max_no FROM terms_versions").first();
      const nextVersion = Number(maxRow ? maxRow.max_no : 0) + 1;
      await env.DB.prepare("UPDATE terms_versions SET is_active=0 WHERE is_active=1").run();
      const res = await env.DB.prepare(`
        INSERT INTO terms_versions
          (version_no, title, body_text, document_r2_key, document_filename, document_content_type,
           is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).bind(nextVersion, title, bodyText || null, documentKey, documentFilename, documentContentType, actor.id).run();
      await audit(env, actor.id, "terms.publish", "terms_version", String(res.meta.last_row_id), {
        version_no: nextVersion, title, has_document: Boolean(documentKey)
      }, null);
      return json({
        ok: true, id: res.meta.last_row_id, version_no: nextVersion, title,
        document_url: documentKey ? `/api/terms/document/${res.meta.last_row_id}` : null
      });
    }

    const adminTermsActivateMatch = path.match(/^\/api\/admin\/terms\/(\d+)\/activate$/);
    if (adminTermsActivateMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const auth = await adminActor("settings.manage");
      if (auth.error) return auth.error;
      const version = await env.DB.prepare("SELECT * FROM terms_versions WHERE id=?").bind(adminTermsActivateMatch[1]).first();
      if (!version) return json({ error: "Terms version not found" }, 404);
      await env.DB.prepare("UPDATE terms_versions SET is_active=0 WHERE is_active=1").run();
      await env.DB.prepare("UPDATE terms_versions SET is_active=1 WHERE id=?").bind(version.id).run();
      await audit(env, auth.actor.id, "terms.activate", "terms_version", String(version.id), { version_no: version.version_no }, null);
      return json({ ok: true, active_version_id: version.id, version_no: version.version_no });
    }

    if (path === "/api/admin/overview" && request.method === "GET") {
      const auth = await adminActor("admin.system");
      if (auth.error) return auth.error;
      const roles = await env.DB.prepare("SELECT id, name FROM roles ORDER BY id").all();
      const staff = await env.DB.prepare("SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name<>'Client' AND u.is_active=1").first();
      const clients = await env.DB.prepare("SELECT COUNT(*) AS c FROM clients WHERE is_deleted=0").first();
      const audit = await env.DB.prepare("SELECT COUNT(*) AS c FROM audit_logs").first();
      return json({
        roles: roles.results,
        staff_count: staff ? staff.c : 0,
        client_count: clients ? clients.c : 0,
        audit_count: audit ? audit.c : 0,
        actual_role: auth.actor.actual_role_name || auth.actor.role_name
      });
    }

    if (path === "/api/admin/roles" && request.method === "GET") {
      const auth = await adminActor("admin.roles");
      if (auth.error) return auth.error;
      const { results: roles } = await env.DB.prepare("SELECT id, name FROM roles ORDER BY id").all();
      const { results: permissions } = await env.DB.prepare("SELECT id, name FROM permissions ORDER BY name").all();
      const { results: mappings } = await env.DB.prepare(`
        SELECT rp.role_id, p.name AS permission_name FROM role_permissions rp
        JOIN permissions p ON p.id=rp.permission_id
      `).all();
      const byRole = {};
      for (const row of mappings) {
        if (!byRole[row.role_id]) byRole[row.role_id] = [];
        byRole[row.role_id].push(row.permission_name);
      }
      return json({
        roles: roles.map(role => ({ ...role, permissions: byRole[role.id] || [] })),
        permissions: permissions.map(p => p.name)
      });
    }

    const adminRolePermissionsMatch = path.match(/^\/api\/admin\/roles\/(\d+)\/permissions$/);
    if (adminRolePermissionsMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const auth = await adminActor("admin.permissions");
      if (auth.error) return auth.error;
      if ((auth.actor.actual_role_name || auth.actor.role_name) !== "Super Admin") {
        return json({ error: "Only a Super Admin can change role permissions" }, 403);
      }
      const roleId = Number(adminRolePermissionsMatch[1]);
      const role = await env.DB.prepare("SELECT id, name FROM roles WHERE id=?").bind(roleId).first();
      if (!role) return json({ error: "Role not found" }, 404);
      if (role.name === "Super Admin") return json({ error: "The Super Admin role permissions are protected" }, 409);
      const body = await request.json().catch(() => ({}));
      const names = Array.isArray(body.permission_names) ? [...new Set(body.permission_names.map(String))] : null;
      if (!names) return json({ error: "permission_names must be an array" }, 400);
      const placeholdersSql = names.length ? names.map(() => "?").join(",") : null;
      let permissions = [];
      if (names.length) {
        const rows = await env.DB.prepare(`SELECT id, name FROM permissions WHERE name IN (${placeholdersSql})`).bind(...names).all();
        permissions = rows.results;
        if (permissions.length !== names.length) return json({ error: "One or more permissions are invalid" }, 400);
      }
      await env.DB.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(roleId).run();
      for (const permission of permissions) {
        await env.DB.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)").bind(roleId, permission.id).run();
      }
      await audit(env, auth.actor.id, "admin.role.permissions", "role", String(roleId), { role: role.name, permissions: names }, auth.actor.branch_id);
      return json({ ok: true, role_id: roleId, permissions: names });
    }

    if (path === "/api/admin/commission-failures" && request.method === "GET") {
      const auth = await adminActor("admin.system");
      if (auth.error) return auth.error;
      const { results } = await env.DB.prepare(`
        SELECT f.id, f.payment_id, f.client_id, f.attempts, f.last_error, f.next_retry_at,
               f.created_at, p.transaction_ref, p.amount_kobo, p.verified_at, p.commission_state,
               c.full_name AS client_name, c.client_reference, b.name AS branch_name
        FROM commission_generation_failures f
        JOIN payments p ON p.id=f.payment_id
        JOIN clients c ON c.id=f.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        WHERE f.resolved_at IS NULL
        ORDER BY f.id DESC LIMIT 200
      `).all();
      return json({ failures: results, total: results.length });
    }

    if (path === "/api/admin/commission-backfill" && request.method === "GET") {
      const auth = await adminActor("admin.system");
      if (auth.error) return auth.error;
      const { results } = await env.DB.prepare(`
        SELECT p.id AS payment_id, p.transaction_ref, p.amount_kobo, p.verified_at, p.payment_mode,
               p.commission_state, c.id AS client_id, c.full_name AS client_name,
               c.client_reference, b.name AS branch_name
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
          AND NOT EXISTS (SELECT 1 FROM commission_entries ce WHERE ce.payment_id=p.id)
        ORDER BY p.verified_at DESC, p.id DESC
        LIMIT 500
      `).all();
      return json({
        dry_run: true,
        missing_count: results.length,
        payments: results,
        note: "No commission entries were created. Awaiting owner approval before backfill."
      });
    }


    if (path === "/api/admin/audit" && request.method === "GET") {
      const auth = await adminActor("admin.audit");
      if (auth.error) return auth.error;
      const action = url.searchParams.get("action");
      const actorId = url.searchParams.get("actor_id");
      const dateFrom = url.searchParams.get("from");
      const dateTo = url.searchParams.get("to");
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10)));
      const clauses = ["1=1"];
      const binds = [];
      if (action) { clauses.push("al.action LIKE ?"); binds.push(`%${action}%`); }
      if (actorId) { clauses.push("al.actor_user_id=?"); binds.push(Number(actorId)); }
      if (dateFrom) { clauses.push("date(al.created_at) >= date(?)"); binds.push(dateFrom); }
      if (dateTo) { clauses.push("date(al.created_at) <= date(?)"); binds.push(dateTo); }
      const { results } = await env.DB.prepare(`
        SELECT al.id, al.action, al.target_type, al.target_id, al.metadata, al.created_at, al.branch_id,
               u.full_name AS actor_name, b.name AS branch_name
        FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
        LEFT JOIN branches b ON b.id=al.branch_id
        WHERE ${clauses.join(" AND ")} ORDER BY al.id DESC LIMIT ?
      `).bind(...binds, limit).all();
      return json({ audit: results });
    }

    // Staff in-app notifications
    if (path === "/api/staff/notifications" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const unreadOnly = url.searchParams.get("unread") === "1";
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
      const clauses = ["n.user_id=?"];
      const binds = [actor.id];
      if (unreadOnly) clauses.push("n.is_read=0");
      const { results } = await env.DB.prepare(`
        SELECT n.id, n.type, n.title, n.message, n.is_read, n.metadata, n.created_at
        FROM notifications n WHERE ${clauses.join(" AND ")}
        ORDER BY n.created_at DESC LIMIT ?
      `).bind(...binds, limit).all();
      const unread = await env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0").bind(actor.id).first();
      return json({
        notifications: results.map(row => ({
          ...row,
          is_read: Boolean(row.is_read),
          metadata: row.metadata ? (() => { try { return JSON.parse(row.metadata); } catch { return null; } })() : null
        })),
        unread_count: unread ? Number(unread.c) : 0
      });
    }

    const staffNotificationReadMatch = path.match(/^\/api\/staff\/notifications\/(\d+)\/read$/);
    if (staffNotificationReadMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const result = await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?")
        .bind(staffNotificationReadMatch[1], actor.id).run();
      if (!result.meta || Number(result.meta.changes) === 0) return json({ error: "Notification not found" }, 404);
      return json({ ok: true });
    }

    if (path === "/api/staff/notifications/read-all" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0").bind(actor.id).run();
      return json({ ok: true });
    }

    // Staff chat rooms and WebSocket handoff to the ChatRoom Durable Object.
    async function chatRoomAccess(actor, roomId) {
      const room = await env.DB.prepare("SELECT * FROM chat_rooms WHERE id=?").bind(roomId).first();
      if (!room) return { error: json({ error: "Room not found" }, 404) };
      const actualRole = actor.actual_role_name || actor.role_name;
      if (["Managing Director", "Super Admin"].includes(actualRole)) return { room };
      if (room.kind === "branch" && Number(room.branch_id) === Number(actor.branch_id)) return { room };
      if (room.kind === "direct") {
        const member = await env.DB.prepare("SELECT 1 AS ok FROM chat_room_members WHERE room_id=? AND user_id=?")
          .bind(room.id, actor.id).first();
        if (member) return { room };
      }
      return { error: json({ error: "Forbidden" }, 403) };
    }

    if (path === "/api/chat/rooms" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const actualRole = actor.actual_role_name || actor.role_name;
      const companyWide = ["Managing Director", "Super Admin"].includes(actualRole);
      const branchClause = companyWide ? "1=1" : "r.kind='branch' AND r.branch_id=?";
      const branchBinds = companyWide ? [] : [actor.branch_id];
      const { results: rooms } = await env.DB.prepare(`
        SELECT r.*, b.name AS branch_name,
          (SELECT m.message FROM chat_messages m WHERE m.room_id=r.id ORDER BY m.id DESC LIMIT 1) AS last_message,
          (SELECT m.created_at FROM chat_messages m WHERE m.room_id=r.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
          (SELECT u.full_name FROM chat_room_members cm JOIN users u ON u.id=cm.user_id
             WHERE cm.room_id=r.id AND cm.user_id<>? LIMIT 1) AS direct_name
        FROM chat_rooms r LEFT JOIN branches b ON b.id=r.branch_id
        WHERE (${branchClause}) OR (
          r.kind='direct' AND EXISTS (SELECT 1 FROM chat_room_members cm2 WHERE cm2.room_id=r.id AND cm2.user_id=?)
        )
        ORDER BY r.kind, r.name
      `).bind(actor.id, ...branchBinds, actor.id).all();
      return json({
        rooms: rooms.map(room => ({
          ...room,
          display_name: room.kind === "direct" ? (room.direct_name || room.name) : room.name
        }))
      });
    }

    if (path === "/api/chat/rooms" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const body = await request.json().catch(() => ({}));
      const targetId = Number(body.user_id || 0);
      if (!targetId) return json({ error: "A staff member is required" }, 400);
      if (Number(targetId) === Number(actor.id)) return json({ error: "You cannot start a chat with yourself" }, 400);
      const target = await env.DB.prepare(`
        SELECT u.id, u.branch_id, u.full_name, r.name AS role_name
        FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND u.is_active=1 AND r.name<>'Client'
      `).bind(targetId).first();
      if (!target) return json({ error: "Staff member not found" }, 404);
      const actualRole = actor.actual_role_name || actor.role_name;
      if (!["Managing Director", "Super Admin"].includes(actualRole) &&
          Number(target.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch chat is restricted" }, 403);
      }
      const existing = await env.DB.prepare(`
        SELECT r.id FROM chat_rooms r
        JOIN chat_room_members a ON a.room_id=r.id AND a.user_id=?
        JOIN chat_room_members b ON b.room_id=r.id AND b.user_id=?
        WHERE r.kind='direct' LIMIT 1
      `).bind(actor.id, targetId).first();
      if (existing) return json({ ok: true, room_id: existing.id, existing: true });
      const res = await env.DB.prepare(
        "INSERT INTO chat_rooms (name, kind, branch_id, created_by) VALUES (?, 'direct', ?, ?)"
      ).bind(`Direct: ${actor.full_name} / ${target.full_name}`, actor.branch_id || target.branch_id, actor.id).run();
      const roomId = res.meta.last_row_id;
      await env.DB.prepare("INSERT INTO chat_room_members (room_id, user_id) VALUES (?,?)").bind(roomId, actor.id).run();
      await env.DB.prepare("INSERT INTO chat_room_members (room_id, user_id) VALUES (?,?)").bind(roomId, targetId).run();
      await audit(env, actor.id, "chat.room.create", "chat_room", String(roomId), { target_user_id: targetId }, actor.branch_id);
      return json({ ok: true, room_id: roomId });
    }

    const chatMessagesMatch = path.match(/^\/api\/chat\/rooms\/(\d+)\/messages$/);
    if (chatMessagesMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const access = await chatRoomAccess(actor, chatMessagesMatch[1]);
      if (access.error) return access.error;
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.room_id, m.sender_id, m.message, m.created_at, u.full_name AS sender_name
        FROM chat_messages m JOIN users u ON u.id=m.sender_id
        WHERE m.room_id=? ORDER BY m.id DESC LIMIT 100
      `).bind(access.room.id).all();
      return json({ messages: results.reverse() });
    }

    const chatSocketMatch = path.match(/^\/api\/chat\/rooms\/(\d+)\/socket$/);
    if (chatSocketMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const access = await chatRoomAccess(actor, chatSocketMatch[1]);
      if (access.error) return access.error;
      if (!env.CHAT_ROOM) return json({ error: "Chat is not configured" }, 503);
      const headers = new Headers(request.headers);
      headers.set("X-Bliss-User-Id", String(actor.id));
      headers.set("X-Bliss-Room-Id", String(access.room.id));
      headers.set("X-Bliss-User-Name", actor.full_name || "Staff");
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("room:" + access.room.id));
      return stub.fetch(new Request(request.url, { method: "GET", headers }));
    }

    // Password Reset Request
    if (path === "/api/password-reset-request" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { email } = body || {};
      if (!email) return json({ error: "Email required" }, 400);
      const resetIp = clientIp(request);
      if (await recentAuditCount(env, "password.reset_request", `ip:${resetIp}`, 15) >= 5) {
        return json({ error: "Too many reset requests. Please try again later." }, 429);
      }
      await audit(env, null, "password.reset_request", "password_reset", `ip:${resetIp}`, { email: String(email).toLowerCase().trim() });
      const user = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(email.toLowerCase().trim()).first();
      if (user) {
        const token = crypto.randomUUID();
        const expires = new Date(Date.now() + 3600000).toISOString();
        await env.DB.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)")
          .bind(token, user.id, expires)
          .run();
        await audit(env, user.id, "password.reset_requested", "user", String(user.id), null);
      }
      return json({ ok: true, message: "If the email is registered, reset instructions have been generated." });
    }

    // Password Reset Finalize
    if (path === "/api/password-reset" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { token, password } = body || {};
      if (!token || !password) return json({ error: "Token and password required" }, 400);
      if (!validPassword(password)) return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      const reset = await env.DB.prepare("SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token=? AND used=0").bind(token).first();
      if (!reset) return json({ error: "Invalid or expired token" }, 400);
      if (parseDbDate(reset.expires_at) < new Date()) return json({ error: "Token expired" }, 400);
      const hash = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, reset.user_id).run();
      await env.DB.prepare("UPDATE password_reset_tokens SET used=1 WHERE token=?").bind(token).run();
      await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(reset.user_id).run();
      await audit(env, reset.user_id, "password.reset_completed", "user", String(reset.user_id), null);
      return json({ ok: true });
    }

    // Change Password (Authenticated)
    if (path === "/api/change-password" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const body = await request.json();
      const { current_password, new_password } = body || {};
      if (!current_password || !new_password) return json({ error: "Current and new password required" }, 400);
      if (!validPassword(new_password)) return json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      if (current_password === new_password) return json({ error: "New password must be different from the current password" }, 400);
      const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(actor.id).first();
      const ok = await verifyPassword(current_password, user.password_hash);
      if (!ok) return json({ error: "Current password incorrect" }, 401);
      const hash = await hashPassword(new_password);
      await env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, actor.id).run();
      // Invalidate every other session, keeping the current one active.
      const sid = parseCookies(request)[SESSION_COOKIE];
      await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(actor.id, sid).run();
      await audit(env, actor.id, "password.change", "user", String(actor.id), null);
      return json({ ok: true });
    }

    // =========================================================================
    // STAFF USERS & ORG MANAGEMENT
    // =========================================================================
    if (path === "/api/users" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      let role = url.searchParams.get("role");
      const branch = url.searchParams.get("branch");
      let where = ["u.is_active=1"];
      const binds = [];
      if (role) { where.push("r.name = ?"); binds.push(role); }
      if (branch) { where.push("u.branch_id = ?"); binds.push(branch); }
      if (actor.role_name === "Branch Manager") { where.push("u.branch_id = ?"); binds.push(actor.branch_id); }
      if (["Team Lead", "Marketer"].includes(actor.role_name)) {
        where.push("u.branch_id = ?");
        binds.push(actor.branch_id);
        if (!role) where.push("r.name IN ('Marketer','Team Lead')");
      }
      const sql = `SELECT u.id, u.email, u.full_name, r.name AS role_name, u.branch_id, b.name AS branch_name FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id WHERE ${where.join(" AND ")} ORDER BY u.id`;
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return json({ users: results });
    }

    if (path === "/api/users" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { email, password, full_name, role_name, branch_name, branch_id, team_id, care_scope } = body || {};
      if (!email || !password || !full_name || !role_name) return json({ error: "Missing fields" }, 400);
      const allowedForBM = ["Team Lead", "Marketer", "Finance Officer", "Client"];
      if (actor.role_name === "Branch Manager" && !allowedForBM.includes(role_name)) return json({ error: "Forbidden role" }, 403);
      if (role_name === "Managing Director") return json({ error: "Cannot create MD" }, 403);
      if (role_name === "Customer Care" && !["Managing Director", "Super Admin"].includes(actor.actual_role_name || actor.role_name)) {
        return json({ error: "Only the MD or Super Admin can create customer care accounts" }, 403);
      }
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(role_name).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      const resolvedCareScope = role_name === "Customer Care"
        ? (CARE_SCOPES.includes(String(care_scope || "").toLowerCase()) ? String(care_scope).toLowerCase() : "branch")
        : null;
      let branchId = branch_id || null;
      if (!branchId && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        if (branch) branchId = branch.id;
      }
      if (resolvedCareScope === "national") branchId = null;
      if (!branchId && resolvedCareScope !== "national") return json({ error: "Branch is required" }, 400);
      const branch = branchId ? await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branchId).first() : null;
      if (branchId && !branch) return json({ error: "Unknown branch" }, 400);
      if (actor.role_name === "Branch Manager" && Number(branchId) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(email.toLowerCase()).first();
      if (existing) return json({ error: "Email already used" }, 409);
      const hash = await hashPassword(password);
      const referralCode = await allocateReferralCode(env);
      const res = await env.DB.prepare("INSERT INTO users (email, password_hash, full_name, role_id, branch_id, referral_code, care_scope) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(email.toLowerCase(), hash, full_name, role.id, branchId, referralCode, resolvedCareScope).run();
      const newId = res.meta.last_row_id;
      if (role_name === "Marketer" && team_id) {
        const team = await env.DB.prepare("SELECT id, branch_id FROM teams WHERE id=?").bind(team_id).first();
        if (team && Number(team.branch_id) === Number(branchId)) {
          await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(team_id, newId).run();
        }
      }
      await audit(env, actor.id, "user.create", "user", String(newId), { email, role: role_name, branch_id: branchId }, branchId);
      return json({ ok: true, id: newId });
    }

    if (path === "/api/branches" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name FROM branches ORDER BY id").all();
      return json({ branches: results });
    }

    // Phase 2/6 team management (branch-scoped)
    if (path === "/api/teams" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (["Client", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const requestedBranch = url.searchParams.get("branch_id") || url.searchParams.get("branch");
      const clauses = [];
      const binds = [];
      if (actor.role_name === "Managing Director" && requestedBranch) {
        clauses.push("t.branch_id=?");
        binds.push(requestedBranch);
      } else if (actor.role_name !== "Managing Director") {
        clauses.push("t.branch_id=?");
        binds.push(actor.branch_id);
      }
      if (url.searchParams.get("include_inactive") !== "1") clauses.push("t.is_active=1");
      const whereSql = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
      const { results } = await env.DB.prepare(`
        SELECT t.id, t.name, t.branch_id, t.team_lead_user_id, t.is_active,
               b.name AS branch_name, u.full_name AS team_lead_name,
               (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id) AS member_count
        FROM teams t
        LEFT JOIN branches b ON b.id=t.branch_id
        LEFT JOIN users u ON u.id=t.team_lead_user_id
        ${whereSql} ORDER BY t.name
      `).bind(...binds).all();
      return json({ teams: results });
    }

    if (path === "/api/teams" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { name, branch_name, branch_id, team_lead_user_id, member_ids, is_active } = body || {};
      if (!name) return json({ error: "Team name is required" }, 400);
      let branchId = branch_id || null;
      if (!branchId && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        if (!branch) return json({ error: "Unknown branch" }, 400);
        branchId = branch.id;
      }
      if (!branchId) return json({ error: "Branch is required" }, 400);
      if (actor.role_name === "Branch Manager" && Number(branchId) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (team_lead_user_id) {
        const lead = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(team_lead_user_id).first();
        if (!lead || Number(lead.branch_id) !== Number(branchId) || !["Team Lead", "Branch Manager"].includes(lead.role_name)) {
          return json({ error: "Team lead must be an active Team Lead or Branch Manager in this branch" }, 400);
        }
      }
      const activeFlag = is_active !== undefined && !isTruthy(is_active) ? 0 : 1;
      const res = await env.DB.prepare("INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, ?)")
        .bind(name, branchId, team_lead_user_id || null, activeFlag).run();
      const teamId = res.meta.last_row_id;
      if (Array.isArray(member_ids) && member_ids.length) {
        const memberIds = member_ids.map(Number).filter(Number.isFinite);
        const { results: members } = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id IN (${placeholders(memberIds)}) AND u.is_active=1
        `).bind(...memberIds).all();
        if (members.length !== memberIds.length || members.some(m => Number(m.branch_id) !== Number(branchId) || m.role_name === "Client")) {
          await env.DB.prepare("DELETE FROM teams WHERE id=?").bind(teamId).run();
          return json({ error: "All team members must be active staff in this branch" }, 400);
        }
        for (const memberId of memberIds) {
          await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(teamId, memberId).run();
        }
      }
      await audit(env, actor.id, "team.create", "team", String(teamId), { name, branch_id: branchId }, branchId);
      return json({ ok: true, team_id: teamId });
    }

    // =========================================================================
    // PROPERTIES (Public & Staff)
    // =========================================================================
    if (path === "/api/site-config" && request.method === "GET") {
      const config = await getSiteConfig(env);
      const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
      return json({
        config: {
          companyName: config.company_name || "Bliss Legacy Limited",
          tagline: config.tagline || "Your Future Begins With the Right Property.",
          phone: config.phone || "",
          whatsappNumber: config.whatsapp_number || "",
          email: config.email || "",
          address: config.address || "",
          social: {
            facebook: config.facebook || "",
            instagram: config.instagram || "",
            twitter: config.twitter || "",
            linkedin: config.linkedin || ""
          },
          branches: Array.isArray(config.branches) ? config.branches : [],
          showDemoProperties: !hideDemo
        }
      }, 200, { "Cache-Control": "public, max-age=60" });
    }

    if (path === "/api/property-categories" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name FROM property_categories ORDER BY name").all();
      return json({ categories: results });
    }

    if (path === "/api/property-categories" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Managing Director") return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "Category name is required" }, 400);
      try {
        const res = await env.DB.prepare("INSERT INTO property_categories (name) VALUES (?)").bind(name).run();
        await audit(env, actor.id, "category.create", "property_category", String(res.meta.last_row_id), { name });
        return json({ ok: true, id: res.meta.last_row_id });
      } catch {
        return json({ error: "Category already exists" }, 409);
      }
    }

    if (path === "/api/properties" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      const actualRole = actor ? (actor.actual_role_name || actor.role_name) : null;
      const q = url.searchParams.get("q") || "";
      const category = url.searchParams.get("category") || "";
      const location = url.searchParams.get("location") || "";
      const status = url.searchParams.get("status") || "";
      const branch = url.searchParams.get("branch") || "";
      const featured = url.searchParams.get("featured");
      const published = url.searchParams.get("is_published");
      const workflowStatus = url.searchParams.get("workflow_status") || "";
      const pendingApproval = url.searchParams.get("pending_approval") === "1";
      const includeArchived = url.searchParams.get("include_archived") === "1" && isPropertyManager(actor);
      const parsedPage = parseInt(url.searchParams.get("page") || "1", 10);
      const parsedLimit = parseInt(url.searchParams.get("limit") || "20", 10);
      const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
      const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 20;
      const offset = (page - 1) * limit;

      const where = [];
      const binds = [];
      const isClient = actor && actor.role_name === "Client";
      const isPublicViewer = !actor || isClient;
      if (isPublicViewer) {
        where.push("p.is_published=1", "p.is_archived=0");
        where.push(`(p.is_internal_test=0${isClient ? ` OR EXISTS (SELECT 1 FROM client_properties cp JOIN clients c ON c.id=cp.client_id WHERE cp.property_id=p.id AND c.user_id=?)` : ""})`);
        if (isClient) binds.push(actor.id);
        const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
        if (hideDemo) where.push("p.is_demo=0");
      } else if (!includeArchived) {
        where.push("p.is_archived=0");
      }
      if (published === "1") where.push("p.is_published=1");
      if (published === "0") where.push("p.is_published=0");
      if (workflowStatus) { where.push("p.workflow_status=?"); binds.push(workflowStatus); }
      if (pendingApproval) where.push("p.workflow_status='pending_approval'");
      if (q) { where.push("(p.title LIKE ? OR p.city LIKE ? OR p.state LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (category) { where.push("pc.name=?"); binds.push(category); }
      if (location) { where.push("(p.city=? OR p.state=?)"); binds.push(location, location); }
      if (status) { where.push("p.status=?"); binds.push(status); }
      if (branch) { where.push("b.name=?"); binds.push(branch); }
      if (featured === "1") { where.push("p.is_featured=1"); }
      if (actor && actualRole === "Branch Manager") { where.push("p.branch_id=?"); binds.push(actor.branch_id); }

      const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
      const sql = `SELECT p.*, pc.name AS category_name, b.name AS branch_name,
        (SELECT COUNT(*) FROM property_payment_plans pp WHERE pp.property_id=p.id AND pp.is_enabled=1) AS enabled_plan_count
        FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id ${whereSql} ORDER BY p.id DESC LIMIT ? OFFSET ?`;
      const countSql = `SELECT COUNT(*) AS c FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id ${whereSql}`;
      const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
      const cnt = await env.DB.prepare(countSql).bind(...binds).first();
      return json({ properties: results, page, limit, total: cnt ? cnt.c : 0 });
    }

    const propMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propMatch && request.method === "GET") {
      const id = propMatch[1];
      const actor = await getSessionUser(env, request);
      const actualRole = actor ? (actor.actual_role_name || actor.role_name) : null;
      const prop = await env.DB.prepare("SELECT p.*, pc.name AS category_name, b.name AS branch_name FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id WHERE p.id=?").bind(id).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if (!actor) {
        const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
        if (!prop.is_published || prop.is_archived || prop.is_internal_test || (hideDemo && prop.is_demo)) return json({ error: "Not found" }, 404);
      } else if (actor.role_name === "Client") {
        const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
        let internalAccess = false;
        if (prop.is_internal_test) {
          const client = await getClientForActor(env, actor);
          if (client) {
            const access = await env.DB.prepare(`
              SELECT 1 AS ok FROM client_properties WHERE client_id=? AND property_id=?
              UNION SELECT 1 WHERE ?=(SELECT interested_property_id FROM clients WHERE id=?)
              LIMIT 1
            `).bind(client.id, prop.id, prop.id, client.id).first();
            internalAccess = Boolean(access);
          }
        }
        if (!prop.is_published || prop.is_archived || (prop.is_internal_test && !internalAccess) || (hideDemo && prop.is_demo)) {
          return json({ error: "Not found" }, 404);
        }
      } else if (prop.is_archived && !isPropertyManager(actor)) {
        return json({ error: "Not found" }, 404);
      }
      const { results: images } = await env.DB.prepare("SELECT id, r2_key, is_main, sort_order FROM property_images WHERE property_id=? ORDER BY is_main DESC, sort_order").bind(id).all();
      // Internal property documents are never exposed to anonymous or client callers.
      let documents = [];
      const canSeeDocuments = actor && actor.role_name !== "Client"
        && !(actualRole === "Branch Manager" && Number(prop.branch_id) !== Number(actor.branch_id));
      if (canSeeDocuments) {
        const result = await env.DB.prepare("SELECT id, r2_key, filename FROM property_documents WHERE property_id=?").bind(id).all();
        documents = result.results;
      }
      const canManagePlans = canManagePropertyPlans(actor) && canManagePropertyRecord(actor, prop);
      const planWhere = canManagePlans ? "" : " AND is_enabled=1";
      const { results: paymentPlans } = await env.DB.prepare(`
        SELECT * FROM property_payment_plans WHERE property_id=?${planWhere}
        ORDER BY CASE plan_type WHEN 'outright' THEN 1 WHEN 'part_payment' THEN 2 WHEN 'daily' THEN 3
          WHEN 'weekly' THEN 4 WHEN 'bi_monthly' THEN 5 WHEN 'monthly' THEN 6 ELSE 7 END
      `).bind(id).all();
      return json({ property: prop, images, documents, payment_plans: paymentPlans });
    }

    const propertyPlansMatch = path.match(/^\/api\/properties\/(\d+)\/payment-plans$/);
    if (propertyPlansMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      const propertyId = propertyPlansMatch[1];
      const property = await env.DB.prepare("SELECT id, branch_id, is_published, is_archived, is_internal_test, is_demo FROM properties WHERE id=?").bind(propertyId).first();
      if (!property) return json({ error: "Property not found" }, 404);
      if (!actor) {
        const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
        if (!property.is_published || property.is_archived || property.is_internal_test || (hideDemo && property.is_demo)) return json({ error: "Not found" }, 404);
      } else if (actor.role_name === "Client") {
        const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
        let internalAccess = false;
        if (property.is_internal_test) {
          const client = await getClientForActor(env, actor);
          if (client) {
            const access = await env.DB.prepare(`
              SELECT 1 AS ok FROM client_properties WHERE client_id=? AND property_id=?
              UNION SELECT 1 WHERE ?=(SELECT interested_property_id FROM clients WHERE id=?)
              LIMIT 1
            `).bind(client.id, property.id, property.id, client.id).first();
            internalAccess = Boolean(access);
          }
        }
        if (!property.is_published || property.is_archived || (property.is_internal_test && !internalAccess) || (hideDemo && property.is_demo)) {
          return json({ error: "Not found" }, 404);
        }
      } else if (property.is_archived && !isPropertyManager(actor)) {
        return json({ error: "Not found" }, 404);
      }
      const canManagePlans = canManagePropertyPlans(actor) && canManagePropertyRecord(actor, property);
      const includeDisabled = canManagePlans && url.searchParams.get("all") === "1";
      const { results } = await env.DB.prepare(`
        SELECT * FROM property_payment_plans WHERE property_id=?${includeDisabled ? "" : " AND is_enabled=1"}
        ORDER BY CASE plan_type WHEN 'outright' THEN 1 WHEN 'part_payment' THEN 2 WHEN 'daily' THEN 3
          WHEN 'weekly' THEN 4 WHEN 'bi_monthly' THEN 5 WHEN 'monthly' THEN 6 ELSE 7 END
      `).bind(propertyId).all();
      return json({
        property_id: Number(propertyId),
        plans: results.map(plan => ({ ...plan, plan_type: normalizePlanType(plan.plan_type), is_easy_buy: isEasyBuyPlan(plan.plan_type) }))
      });
    }

    if (propertyPlansMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManagePropertyPlans(actor)) return json({ error: "Property plan management access is required" }, 403);
      const propertyId = propertyPlansMatch[1];
      const property = await env.DB.prepare("SELECT id, branch_id, is_published, is_archived FROM properties WHERE id=?").bind(propertyId).first();
      if (!property) return json({ error: "Property not found" }, 404);
      if (!canManagePropertyRecord(actor, property)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (property.is_archived) return json({ error: "Archived properties cannot change plans" }, 409);
      const body = await request.json();
      if (!Array.isArray(body.plans)) return json({ error: "A plans array is required" }, 400);

      const { results: existingPlans } = await env.DB.prepare(
        "SELECT plan_type, is_enabled FROM property_payment_plans WHERE property_id=?"
      ).bind(propertyId).all();
      const finalEnabled = new Set(existingPlans.filter(plan => Number(plan.is_enabled) === 1).map(plan => normalizePlanType(plan.plan_type)));
      for (const raw of body.plans) {
        const planType = normalizePlanType(raw.plan_type, null);
        const enabled = raw.is_enabled === undefined ? true : isTruthy(raw.is_enabled);
        if (!planType) continue;
        if (enabled) finalEnabled.add(planType); else finalEnabled.delete(planType);
      }
      if (Number(property.is_published) === 1 && finalEnabled.size === 0) {
        return json({ error: "A published property must keep at least one enabled payment plan" }, 409);
      }

      const seen = new Set();
      for (const raw of body.plans) {
        const planType = normalizePlanType(raw.plan_type, null);
        if (!planType || !PAYMENT_PLAN_TYPES.includes(planType)) return json({ error: "Invalid payment plan type" }, 400);
        if (seen.has(planType)) return json({ error: `Duplicate plan type: ${planType}` }, 400);
        seen.add(planType);
        const totalKobo = raw.total_price_kobo !== undefined ? Number(raw.total_price_kobo) : toKobo(raw.total_price);
        let depositKobo = raw.deposit_kobo !== undefined ? Number(raw.deposit_kobo) : toKobo(raw.deposit || 0);
        let installmentKobo = raw.installment_kobo !== undefined ? Number(raw.installment_kobo) : toKobo(raw.installment || 0);
        const planEnabled = raw.is_enabled === undefined ? true : isTruthy(raw.is_enabled);
        const durationMonths = raw.duration_months === undefined || raw.duration_months === null || raw.duration_months === ""
          ? null : Number(raw.duration_months);
        let number = raw.number_of_installments === undefined || raw.number_of_installments === null || raw.number_of_installments === ""
          ? null : Number(raw.number_of_installments);
        if (planType !== "outright" && number === null && durationMonths) {
          const derived = derivePlanInstallmentCount(planType, durationMonths);
          if (derived > 0) number = derived;
        }
        const firstPaymentRule = raw.first_payment_rule ? String(raw.first_payment_rule).trim().slice(0, 500) : null;
        if (!Number.isInteger(totalKobo) || totalKobo <= 0) return json({ error: "Plan total price must be positive" }, 400);
        if (!Number.isInteger(depositKobo) || depositKobo < 0 || depositKobo > totalKobo) return json({ error: "Plan deposit is invalid" }, 400);
        if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 0 || durationMonths > 120)) {
          return json({ error: "Plan duration must be between 0 and 120 months" }, 400);
        }
        if (number !== null && (!Number.isInteger(number) || number < 1 || number > 1000)) {
          return json({ error: "Plan number of instalments must be between 1 and 1000" }, 400);
        }
        if (planType === "outright") {
          depositKobo = 0;
          installmentKobo = totalKobo;
        } else {
          if (planEnabled && number === null) {
            return json({ error: "Enabled plans need a number of instalments or a duration" }, 400);
          }
          if (!Number.isFinite(installmentKobo) || installmentKobo <= 0) {
            return json({ error: "Non-outright plans need a positive instalment amount" }, 400);
          }
        }
        let balanceDifferenceKobo = 0;
        if (planType !== "outright" && number) {
          const expectedKobo = depositKobo + (installmentKobo * number);
          balanceDifferenceKobo = totalKobo - expectedKobo;
          if (planEnabled && balanceDifferenceKobo !== 0) {
            return json({
              error: `Plan numbers must add up: deposit + instalment × ${number} must equal the total. Off by ${formatNGN(Math.abs(balanceDifferenceKobo))}.`
            }, 400);
          }
        }
        await env.DB.prepare(`
          INSERT INTO property_payment_plans
            (property_id, plan_type, total_price_kobo, deposit_kobo, installment_kobo,
             duration_months, number_of_installments, is_enabled, notes, first_payment_rule,
             balance_difference_kobo, created_by, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(property_id, plan_type) DO UPDATE SET
            total_price_kobo=excluded.total_price_kobo, deposit_kobo=excluded.deposit_kobo,
            installment_kobo=excluded.installment_kobo, duration_months=excluded.duration_months,
            number_of_installments=excluded.number_of_installments, is_enabled=excluded.is_enabled,
            notes=excluded.notes, first_payment_rule=excluded.first_payment_rule,
            balance_difference_kobo=excluded.balance_difference_kobo,
            updated_by=excluded.updated_by, updated_at=datetime('now')
        `).bind(
          propertyId, planType, totalKobo, depositKobo, installmentKobo,
          durationMonths, number, planEnabled ? 1 : 0,
          raw.notes || null, firstPaymentRule, balanceDifferenceKobo, actor.id, actor.id
        ).run();
      }
      await audit(env, actor.id, "property.payment_plans.update", "property", String(propertyId), {
        plans: body.plans.map(plan => normalizePlanType(plan.plan_type)),
        enabled_plan_types: [...finalEnabled]
      }, property.branch_id);
      const { results } = await env.DB.prepare(
        "SELECT * FROM property_payment_plans WHERE property_id=? ORDER BY plan_type"
      ).bind(propertyId).all();
      return json({ ok: true, plans: results });
    }

    // ---- Create property (Phase 3) ----
    if (path === "/api/properties" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const actualRole = actor.actual_role_name || actor.role_name;
      const body = await request.json();
      const {
        title, description, category_name, property_type, sale_price, promotional_price,
        state, city, address, branch_name, branch_id, land_size, bedrooms, bathrooms, toilets,
        parking_spaces, features, is_featured, is_published, available_units, total_units,
        is_demo, is_internal_test
      } = body || {};
      const price = Number(sale_price);
      if (!title || !Number.isFinite(price) || price <= 0) return json({ error: "Title and a positive sale price are required" }, 400);
      if (isTruthy(is_demo) || isTruthy(is_internal_test)) {
        if (!["Super Admin", "Managing Director"].includes(actualRole)) {
          return json({ error: "Only the MD or Super Admin can mark a property as demo or internal test" }, 403);
        }
      }
      if (isTruthy(is_published)) {
        return json({ error: "Create the property as a draft, add at least one payment plan, then publish it" }, 400);
      }
      const availableUnits = available_units === undefined || available_units === null || available_units === "" ? null : Number(available_units);
      const totalUnits = total_units === undefined || total_units === null || total_units === "" ? null : Number(total_units);
      if (availableUnits !== null && (!Number.isInteger(availableUnits) || availableUnits < 0)) return json({ error: "Available units must be a non-negative whole number" }, 400);
      if (totalUnits !== null && (!Number.isInteger(totalUnits) || totalUnits < 0)) return json({ error: "Total units must be a non-negative whole number" }, 400);

      let categoryId = null;
      if (category_name) {
        const category = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(category_name).first();
        categoryId = category ? category.id : null;
      }
      let branchId = branch_id ? Number(branch_id) : null;
      if (!branchId && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        branchId = branch ? branch.id : null;
      }
      if (actualRole === "Branch Manager") {
        if (branchId !== null && branchId !== Number(actor.branch_id)) return json({ error: "Cross-branch forbidden" }, 403);
        branchId = actor.branch_id;
      }
      if (!branchId) return json({ error: "A branch is required" }, 400);
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branchId).first();
      if (!branch) return json({ error: "Branch not found" }, 400);

      const ref = "BLP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const res = await env.DB.prepare(`INSERT INTO properties (reference,title,description,category_id,property_type,sale_price,promotional_price,state,city,address,branch_id,land_size,bedrooms,bathrooms,toilets,parking_spaces,features,status,is_featured,is_published,workflow_status,is_demo,is_internal_test,available_units,total_units,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ref, title, description || null, categoryId, property_type || null, price, promotional_price || null,
          state || null, city || null, address || null, branchId, land_size || null, bedrooms || null,
          bathrooms || null, toilets || null, parking_spaces || null, features ? JSON.stringify(features) : null,
          "Available", isTruthy(is_featured) ? 1 : 0, 0, "draft", isTruthy(is_demo) ? 1 : 0,
          isTruthy(is_internal_test) ? 1 : 0, availableUnits, totalUnits, actor.id, actor.id).run();
      const newId = res.meta.last_row_id;
      await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
        .bind(newId, null, "draft", actor.id).run();
      await audit(env, actor.id, "property.create", "property", String(newId), {
        title, sale_price: price, branch_id: branchId, workflow_status: "draft",
        is_demo: isTruthy(is_demo), is_internal_test: isTruthy(is_internal_test)
      }, branchId);
      return json({ ok: true, id: newId, reference: ref, workflow_status: "draft" });
    }

    // ---- Update property (Phase 3) ----
    const propUpdateMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propUpdateMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const actualRole = actor.actual_role_name || actor.role_name;
      const id = propUpdateMatch[1];
      const existing = await env.DB.prepare("SELECT * FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, existing)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (existing.is_archived) return json({ error: "Archived properties cannot be edited" }, 409);
      const body = await request.json();
      if (body.sale_price !== undefined) {
        const price = Number(body.sale_price);
        if (!Number.isFinite(price) || price <= 0) return json({ error: "Sale price must be positive" }, 400);
      }
      if ((body.is_demo !== undefined || body.is_internal_test !== undefined) && !["Super Admin", "Managing Director"].includes(actualRole)) {
        return json({ error: "Only the MD or Super Admin can change demo or internal-test flags" }, 403);
      }
      const fields = ["title", "description", "property_type", "sale_price", "promotional_price", "state",
        "city", "address", "land_size", "bedrooms", "bathrooms", "toilets", "parking_spaces",
        "is_featured", "available_units", "total_units"];
      const sets = [];
      const vals = [];
      for (const field of fields) {
        if (body[field] === undefined) continue;
        sets.push(`${field}=?`);
        vals.push(field === "is_featured" ? (isTruthy(body[field]) ? 1 : 0) : body[field]);
      }
      if (body.is_demo !== undefined) { sets.push("is_demo=?"); vals.push(isTruthy(body.is_demo) ? 1 : 0); }
      if (body.is_internal_test !== undefined) { sets.push("is_internal_test=?"); vals.push(isTruthy(body.is_internal_test) ? 1 : 0); }
      if (body.category_name !== undefined) {
        const category = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(body.category_name).first();
        sets.push("category_id=?");
        vals.push(category ? category.id : null);
      }
      if (body.features !== undefined) {
        sets.push("features=?");
        vals.push(JSON.stringify(body.features));
      }
      let nextBranchId = existing.branch_id;
      if (body.branch_id !== undefined || body.branch_name !== undefined) {
        const branch = body.branch_id
          ? await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(Number(body.branch_id)).first()
          : await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(body.branch_name).first();
        if (actualRole === "Branch Manager" && (!branch || branch.id !== actor.branch_id)) {
          return json({ error: "Cross-branch forbidden" }, 403);
        }
        if (!branch) return json({ error: "Branch not found" }, 400);
        nextBranchId = branch.id;
        sets.push("branch_id=?");
        vals.push(branch.id);
      }

      let workflow = existing.workflow_status || (existing.is_published ? "published" : "draft");
      if (body.is_published !== undefined || body.workflow_status !== undefined) {
        const wantsPublished = body.is_published !== undefined ? isTruthy(body.is_published) : body.workflow_status === "published";
        if (wantsPublished) {
          const enabledPlans = await propertyEnabledPlanCount(env, existing.id);
          if (!enabledPlans) return json({ error: "Add and enable at least one payment plan before publishing" }, 409);
          const approvalRequired = String(await getAppSetting(env, "branch_manager_listing_approval", "1")) !== "0";
          if (actualRole === "Branch Manager" && approvalRequired) {
            workflow = "pending_approval";
            sets.push("is_published=?", "workflow_status=?", "submitted_at=datetime('now')");
            vals.push(0, workflow);
          } else {
            workflow = "published";
            sets.push("is_published=?", "workflow_status=?", "approved_by=?", "approved_at=datetime('now')");
            vals.push(1, workflow, actor.id);
          }
        } else {
          workflow = body.workflow_status === "draft" ? "draft" : "unpublished";
          sets.push("is_published=?", "workflow_status=?");
          vals.push(0, workflow);
        }
      }
      if (!sets.length) return json({ error: "No fields" }, 400);
      sets.push("updated_by=?");
      vals.push(actor.id);
      sets.push("updated_at=datetime('now')");
      vals.push(id);
      await env.DB.prepare(`UPDATE properties SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      if (body.is_internal_test !== undefined && isTruthy(body.is_internal_test)) {
        await env.DB.prepare("UPDATE clients SET is_internal_test=1 WHERE interested_property_id=?").bind(id).run();
        await env.DB.prepare("UPDATE payments SET is_internal_test=1 WHERE property_id=?").bind(id).run();
      }
      await audit(env, actor.id, "property.update", "property", id, {
        before: { sale_price: existing.sale_price, workflow_status: existing.workflow_status, branch_id: existing.branch_id },
        after: { sale_price: body.sale_price !== undefined ? Number(body.sale_price) : existing.sale_price, workflow_status: workflow, branch_id: nextBranchId },
        changed_fields: Object.keys(body || {})
      }, existing.branch_id);
      return json({ ok: true, workflow_status: workflow });
    }

    // ---- Property workflow actions (publish approval, archive, convert demo) ----
    const propWorkflowMatch = path.match(/^\/api\/properties\/(\d+)\/(approve|unpublish|archive|convert-to-real)$/);
    if (propWorkflowMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const actualRole = actor.actual_role_name || actor.role_name;
      const property = await env.DB.prepare("SELECT * FROM properties WHERE id=?").bind(propWorkflowMatch[1]).first();
      if (!property) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, property)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      const action = propWorkflowMatch[2];
      if (action === "approve") {
        if (!["Super Admin", "Managing Director"].includes(actualRole)) return json({ error: "Only the MD or Super Admin can approve a listing" }, 403);
        const enabledPlans = await propertyEnabledPlanCount(env, property.id);
        if (!enabledPlans) return json({ error: "Add and enable at least one payment plan before approving" }, 409);
        await env.DB.prepare(`
          UPDATE properties SET is_published=1, workflow_status='published', approved_by=?, approved_at=datetime('now'),
            updated_by=?, updated_at=datetime('now') WHERE id=?
        `).bind(actor.id, actor.id, property.id).run();
        await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
          .bind(property.id, property.workflow_status, "published", actor.id).run();
        await audit(env, actor.id, "property.approve", "property", String(property.id), { previous: property.workflow_status }, property.branch_id);
        if (property.created_by && Number(property.created_by) !== Number(actor.id)) {
          await createNotification(env, {
            userId: property.created_by,
            type: "property.approved",
            title: "Property listing approved",
            message: `${property.title} (${property.reference}) is now published.`,
            metadata: { property_id: property.id }
          }).catch(() => {});
        }
        return json({ ok: true, workflow_status: "published" });
      }
      if (action === "unpublish") {
        await env.DB.prepare(`
          UPDATE properties SET is_published=0, workflow_status='unpublished', updated_by=?, updated_at=datetime('now') WHERE id=?
        `).bind(actor.id, property.id).run();
        await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
          .bind(property.id, property.workflow_status, "unpublished", actor.id).run();
        await audit(env, actor.id, "property.unpublish", "property", String(property.id), null, property.branch_id);
        return json({ ok: true, workflow_status: "unpublished" });
      }
      if (action === "archive") {
        await env.DB.prepare(`
          UPDATE properties SET is_published=0, is_archived=1, workflow_status='archived',
            archived_at=datetime('now'), updated_by=?, updated_at=datetime('now') WHERE id=?
        `).bind(actor.id, property.id).run();
        await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
          .bind(property.id, property.workflow_status, "archived", actor.id).run();
        await audit(env, actor.id, "property.archive", "property", String(property.id), null, property.branch_id);
        return json({ ok: true, workflow_status: "archived" });
      }
      if (action === "convert-to-real") {
        if (!["Super Admin", "Managing Director", "Branch Manager"].includes(actualRole)) return json({ error: "Forbidden" }, 403);
        await env.DB.prepare(`
          UPDATE properties SET is_demo=0, is_internal_test=0, is_archived=0, is_published=0,
            workflow_status='draft', archived_at=NULL, updated_by=?, updated_at=datetime('now') WHERE id=?
        `).bind(actor.id, property.id).run();
        await audit(env, actor.id, "property.convert_to_real", "property", String(property.id), {
          previous_demo: Boolean(property.is_demo), previous_test: Boolean(property.is_internal_test)
        }, property.branch_id);
        return json({ ok: true, workflow_status: "draft" });
      }
    }

    // ---- Property status change (Phase 3) ----
    const statusMatch = path.match(/^\/api\/properties\/(\d+)\/status$/);
    if (statusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const id = statusMatch[1];
      const body = await request.json();
      const newStatus = body.status;
      if (!["Available", "Reserved", "Sold", "Unavailable"].includes(newStatus)) {
        return json({ error: "Invalid status" }, 400);
      }
      const existing = await env.DB.prepare("SELECT status, branch_id, workflow_status, is_archived FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, existing)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (existing.is_archived) return json({ error: "Archived properties cannot change status" }, 409);
      await env.DB.prepare("UPDATE properties SET status=?, workflow_status=CASE WHEN ?='Sold' THEN 'sold_out' ELSE workflow_status END, updated_by=?, updated_at=datetime('now') WHERE id=?")
        .bind(newStatus, newStatus, actor.id, id).run();
      await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
        .bind(id, existing.status, newStatus, actor.id).run();
      await audit(env, actor.id, "property.status", "property", id, { from: existing.status, to: newStatus }, existing.branch_id);
      return json({ ok: true });
    }

    // ---- Property status history (Phase 3) ----
    const propHistoryMatch = path.match(/^\/api\/properties\/(\d+)\/status-history$/);
    if (propHistoryMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthorized" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const id = propHistoryMatch[1];
      const prop = await env.DB.prepare("SELECT branch_id, is_published FROM properties WHERE id=?").bind(id).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && prop.branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (["Team Lead", "Marketer"].includes(actor.role_name) && !prop.is_published) {
        return json({ error: "Not found" }, 404);
      }
      const { results } = await env.DB.prepare(`
        SELECT h.old_status, h.new_status, h.changed_at, u.full_name AS changed_by
        FROM property_status_history h LEFT JOIN users u ON u.id=h.changed_by
        WHERE h.property_id=? ORDER BY h.changed_at DESC
      `).bind(id).all();
      return json({ history: results });
    }

    // ---- Property image upload (Phase 3) ----
    const imageUploadMatch = path.match(/^\/api\/properties\/(\d+)\/images$/);
    if (imageUploadMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const id = imageUploadMatch[1];
      const existing = await env.DB.prepare("SELECT branch_id, is_archived FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, existing)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (existing.is_archived) return json({ error: "Archived properties cannot be changed" }, 409);
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type)) return json({ error: "Invalid file type" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "File too large (5MB max)" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (detectFileType(bytes) !== file.type) return json({ error: "File contents do not match the declared image type" }, 400);
      const key = `properties/${id}/${crypto.randomUUID()}-${sanitizeFilename(file.name, "image")}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
      const isMain = formData.get("is_main") === "1" ? 1 : 0;
      if (isMain) await env.DB.prepare("UPDATE property_images SET is_main=0 WHERE property_id=?").bind(id).run();
      const res = await env.DB.prepare("INSERT INTO property_images (property_id, r2_key, is_main) VALUES (?,?,?)")
        .bind(id, key, isMain).run();
      await audit(env, actor.id, "property.image.upload", "property", id, { key }, existing.branch_id);
      return json({ ok: true, image_id: res.meta.last_row_id, key });
    }

    // ---- Delete property image (Phase 3) ----
    const imageDeleteMatch = path.match(/^\/api\/properties\/(\d+)\/images\/(\d+)$/);
    if (imageDeleteMatch && request.method === "DELETE") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const propId = imageDeleteMatch[1];
      const imgId = imageDeleteMatch[2];
      const image = await env.DB.prepare("SELECT r2_key, property_id FROM property_images WHERE id=?").bind(imgId).first();
      if (!image || String(image.property_id) !== propId) return json({ error: "Not found" }, 404);
      const prop = await env.DB.prepare("SELECT branch_id, is_archived FROM properties WHERE id=?").bind(propId).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, prop)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (prop.is_archived) return json({ error: "Archived properties cannot be changed" }, 409);
      if (env.FILES.delete) await env.FILES.delete(image.r2_key);
      await env.DB.prepare("DELETE FROM property_images WHERE id=?").bind(imgId).run();
      await audit(env, actor.id, "property.image.delete", "property", propId, { key: image.r2_key }, prop.branch_id);
      return json({ ok: true });
    }

    // Staff-only internal property document download. Documents are never
    // served through the anonymous /api/files route.
    const docDownloadMatch = path.match(/^\/api\/properties\/(\d+)\/documents\/(\d+)\/download$/);
    if (docDownloadMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const propertyId = docDownloadMatch[1];
      const documentId = docDownloadMatch[2];
      const doc = await env.DB.prepare(`
        SELECT d.*, p.branch_id, p.is_published FROM property_documents d
        JOIN properties p ON p.id=d.property_id
        WHERE d.id=? AND d.property_id=?
      `).bind(documentId, propertyId).first();
      if (!doc) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(doc.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Forbidden" }, 403);
      }
      if (["Team Lead", "Marketer"].includes(actor.role_name) && !doc.is_published) {
        return json({ error: "Not found" }, 404);
      }
      if (!doc.r2_key.startsWith("property-documents/")) return json({ error: "Not found" }, 404);
      const obj = await env.FILES.get(doc.r2_key);
      if (!obj) return json({ error: "Not found" }, 404);
      const headers = new Headers();
      if (typeof obj.writeHttpMetadata === "function") obj.writeHttpMetadata(headers);
      headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(doc.filename, "property-document")}"`);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(obj.body, { headers });
    }

    const docDeleteMatch = path.match(/^\/api\/properties\/(\d+)\/documents\/(\d+)$/);
    if (docDeleteMatch && request.method === "DELETE") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const propertyId = docDeleteMatch[1];
      const documentId = docDeleteMatch[2];
      const doc = await env.DB.prepare(`
        SELECT d.*, p.branch_id, p.is_archived FROM property_documents d
        JOIN properties p ON p.id=d.property_id
        WHERE d.id=? AND d.property_id=?
      `).bind(documentId, propertyId).first();
      if (!doc) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, doc)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (doc.is_archived) return json({ error: "Archived properties cannot be changed" }, 409);
      if (env.FILES.delete) await env.FILES.delete(doc.r2_key);
      await env.DB.prepare("DELETE FROM property_documents WHERE id=?").bind(doc.id).run();
      await audit(env, actor.id, "property.document.delete", "property", propertyId, { key: doc.r2_key }, doc.branch_id);
      return json({ ok: true });
    }

    // ---- Property document upload (private R2) ----
    const docUploadMatch = path.match(/^\/api\/properties\/(\d+)\/documents$/);
    if (docUploadMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isPropertyManager(actor)) return json({ error: "Forbidden" }, 403);
      const propertyId = docUploadMatch[1];
      const property = await env.DB.prepare("SELECT branch_id, is_archived FROM properties WHERE id=?").bind(propertyId).first();
      if (!property) return json({ error: "Not found" }, 404);
      if (!canManagePropertyRecord(actor, property)) return json({ error: "Cross-branch or unauthorised property" }, 403);
      if (property.is_archived) return json({ error: "Archived properties cannot be changed" }, 409);
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);
      const allowed = ["application/pdf", "image/jpeg", "image/png"];
      if (!allowed.includes(file.type)) return json({ error: "Only PDF, JPEG and PNG documents are accepted" }, 400);
      if (file.size > 10 * 1024 * 1024) return json({ error: "File too large (10MB max)" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (detectFileType(bytes) !== file.type) return json({ error: "File contents do not match the declared document type" }, 400);
      const filename = sanitizeFilename(file.name, "property-document");
      const key = `property-documents/${propertyId}/${crypto.randomUUID()}-${filename}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
      const res = await env.DB.prepare("INSERT INTO property_documents (property_id, r2_key, filename) VALUES (?,?,?)")
        .bind(propertyId, key, filename).run();
      await audit(env, actor.id, "property.document.upload", "property", propertyId, { key, filename }, property.branch_id);
      return json({ ok: true, document_id: res.meta.last_row_id, filename, key });
    }

    // Serve public property images from R2. Receipts, reports and property
    // documents are never exposed through this anonymous route.
    const fileMatch = path.match(/^\/api\/files\/(.+)$/);
    if (fileMatch && request.method === "GET") {
      let key;
      try {
        key = decodeURIComponent(fileMatch[1]);
      } catch {
        return new Response("Not found", { status: 404 });
      }
      if (!key.startsWith("properties/")) return new Response("Not found", { status: 404 });
      const registered = await env.DB.prepare(`
        SELECT pi.id, p.id AS property_id, p.is_published, p.branch_id, p.is_internal_test, p.is_archived, p.is_demo
        FROM property_images pi
        JOIN properties p ON p.id=pi.property_id
        WHERE pi.r2_key=? LIMIT 1
      `).bind(key).first();
      if (!registered) return new Response("Not found", { status: 404 });
      const hideDemo = String(await getAppSetting(env, "hide_demo_properties", "1")) !== "0";
      const protectedImage = registered.is_internal_test || registered.is_archived || (hideDemo && registered.is_demo);
      if (protectedImage) {
        const actor = await getSessionUser(env, request);
        if (!actor) return new Response("Not found", { status: 404 });
        if (actor.role_name === "Client") {
          const client = await getClientForActor(env, actor);
          const access = client ? await env.DB.prepare(`
            SELECT 1 AS ok FROM client_properties WHERE client_id=? AND property_id=?
            UNION SELECT 1 WHERE ?=(SELECT interested_property_id FROM clients WHERE id=?)
            LIMIT 1
          `).bind(client.id, registered.property_id, registered.property_id, client.id).first() : null;
          if (!access) return new Response("Not found", { status: 404 });
        } else if (actor.role_name === "Branch Manager" && Number(registered.branch_id) !== Number(actor.branch_id)) {
          return new Response("Not found", { status: 404 });
        } else if (!STAFF_ROLES.includes(actor.role_name) && !["Customer Care", "Head Accountant", "Account Officer", "Telemarketer"].includes(actor.actual_role_name || actor.role_name)) {
          return new Response("Not found", { status: 404 });
        }
      }
      if (!registered.is_published) {
        const actor = await getSessionUser(env, request);
        if (!actor || actor.role_name === "Client") return new Response("Not found", { status: 404 });
        if (actor.role_name === "Branch Manager" && Number(registered.branch_id) !== Number(actor.branch_id)) {
          return new Response("Not found", { status: 404 });
        }
        if (["Team Lead", "Marketer"].includes(actor.role_name)) return new Response("Not found", { status: 404 });
      }
      const obj = await env.FILES.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      if (typeof obj.writeHttpMetadata === "function") obj.writeHttpMetadata(headers);
      headers.set("Cache-Control", registered.is_published ? "public, max-age=3600" : "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(obj.body, { headers });
    }

    // =========================================================================
    // CLIENT MANAGEMENT (Staff-scoped)
    // =========================================================================
    function clientScope(actor) {
      const role = actor.role_name;
      if (role === "Managing Director" || role === "Finance Officer") return { clause: "", binds: [] };
      if (role === "Branch Manager") return { clause: "c.assigned_branch_id = ?", binds: [actor.branch_id] };
      if (role === "Team Lead") return { clause: "(c.team_lead_id = ? OR c.original_marketer_id = ? OR c.created_by = ? OR c.referred_by_staff_id = ?)", binds: [actor.id, actor.id, actor.id, actor.id] };
      if (role === "Marketer") {
        return {
          clause: `(
            (EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1)
             AND EXISTS (SELECT 1 FROM client_assignments ca2 WHERE ca2.client_id=c.id AND ca2.is_primary=1 AND ca2.relationship_manager_id=?))
            OR
            (NOT EXISTS (SELECT 1 FROM client_assignments ca3 WHERE ca3.client_id=c.id AND ca3.is_primary=1)
             AND (c.original_marketer_id=? OR c.created_by=?))
            OR c.referred_by_staff_id=?
          )`,
          binds: [actor.id, actor.id, actor.id, actor.id]
        };
      }
      return { clause: "c.id = -1", binds: [] };
    }

    function canManageClient(actor, client) {
      const role = actor.role_name;
      if (role === "Managing Director") return true;
      if (role === "Branch Manager") return client.assigned_branch_id === actor.branch_id;
      if (role === "Team Lead") {
        return client.team_lead_id === actor.id || client.original_marketer_id === actor.id ||
          client.created_by === actor.id || Number(client.referred_by_staff_id) === Number(actor.id);
      }
      if (role === "Marketer") {
        if (Number(client.referred_by_staff_id) === Number(actor.id)) return true;
        if (client.current_relationship_manager_id !== undefined && client.current_relationship_manager_id !== null) {
          return Number(client.current_relationship_manager_id) === Number(actor.id);
        }
        return client.original_marketer_id === actor.id || client.created_by === actor.id;
      }
      return false;
    }

    if (path === "/api/clients" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const scope = clientScope(actor);
      const q = url.searchParams.get("q") || "";
      const status = url.searchParams.get("status");
      const branchId = url.searchParams.get("branch_id") || url.searchParams.get("branch");
      const marketerId = url.searchParams.get("marketer_id") || url.searchParams.get("marketer");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
      const offset = (page - 1) * limit;

      const clauses = ["c.is_deleted = 0"];
      const binds = [];
      if (scope.clause) { clauses.push(scope.clause); binds.push(...scope.binds); }
      if (q) { clauses.push("(c.full_name LIKE ? OR c.client_reference LIKE ? OR c.phone_number LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (status) { clauses.push("c.status = ?"); binds.push(status); }
      if (branchId) { clauses.push("c.assigned_branch_id = ?"); binds.push(branchId); }
      if (marketerId) { clauses.push("c.original_marketer_id = ?"); binds.push(marketerId); }

      const whereSql = "WHERE " + clauses.join(" AND ");
      const sql = `SELECT c.*, u.full_name AS created_by_name, m.full_name AS original_marketer_name, b.name AS branch_name FROM clients c LEFT JOIN users u ON u.id=c.created_by LEFT JOIN users m ON m.id=c.original_marketer_id LEFT JOIN branches b ON b.id=c.assigned_branch_id ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
      const countSql = `SELECT COUNT(*) AS c FROM clients c ${whereSql}`;
      const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
      const cnt = await env.DB.prepare(countSql).bind(...binds).first();
      return json({ clients: results, page, limit, total: cnt ? cnt.c : 0 });
    }

    if (path === "/api/clients" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const body = await request.json();
      const {
        full_name, phone_number, alternate_phone, email_address, residential_address, state, city,
        next_of_kin, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship,
        next_of_kin_address, notes, preferred_channel, status, assigned_branch_id,
        agreed_purchase_price, interested_property_id, sale_type, referral_code, property_plan_id,
        plan_start_date, static_wallet_bvn, identity_type, identity_number
      } = body || {};
      if (!full_name || !phone_number) return json({ error: "Full name and phone number required" }, 400);
      const normalizedPhone = normalizeNigerianPhone(phone_number);
      if (!normalizedPhone) return json({ error: "A valid Nigerian phone number is required" }, 400);
      if (alternate_phone && !/^[+0-9()\s-]{7,25}$/.test(String(alternate_phone).trim())) {
        return json({ error: "Alternate phone number is invalid" }, 400);
      }
      if (next_of_kin_phone && !/^[+0-9()\s-]{7,25}$/.test(String(next_of_kin_phone).trim())) {
        return json({ error: "Next of kin phone number is invalid" }, 400);
      }
      const identityProvided = Boolean(identity_type || identity_number);
      const resolvedIdentityType = identityProvided ? normalizeIdentityType(identity_type) : null;
      if (identityProvided) {
        if (!resolvedIdentityType) return json({ error: "Select a valid identity type" }, 400);
        const identityError = validateIdentityNumber(resolvedIdentityType, identity_number);
        if (identityError) return json({ error: identityError }, 400);
      }
      const staticWalletBvnDigits = static_wallet_bvn ? cleanBvn(static_wallet_bvn) : null;
      if (static_wallet_bvn && !staticWalletBvnDigits) return json({ error: "BVN must be 10 or 11 digits" }, 400);
      const staffIdentityHash = identityProvided ? await hashIdentityNumber(identity_number) : null;
      if (staffIdentityHash) {
        const existingIdentity = await env.DB.prepare(
          "SELECT id FROM clients WHERE identity_number_hash=? AND identity_type=? AND is_deleted=0 LIMIT 1"
        ).bind(staffIdentityHash, resolvedIdentityType).first();
        if (existingIdentity) return json({ error: "This identity number is already linked to another client account" }, 409);
      }
      const validStatuses = ["Prospect", "Interested", "Negotiation", "Reserved", "Active Buyer", "Completed", "Cancelled", "Inactive"];
      if (status && !validStatuses.includes(status)) return json({ error: "Invalid client status" }, 400);
      const resolvedSaleType = sale_type || "New Sale";
      if (!SALE_TYPES.includes(resolvedSaleType)) return json({ error: "Invalid sale type" }, 400);

      let resolvedBranchId;
      if (["Managing Director", "Branch Manager"].includes(actor.role_name)) {
        resolvedBranchId = assigned_branch_id || actor.branch_id;
        if (actor.role_name === "Branch Manager" && Number(resolvedBranchId) !== actor.branch_id) {
          return json({ error: "Cross-branch forbidden" }, 403);
        }
      } else {
        if (assigned_branch_id && Number(assigned_branch_id) !== actor.branch_id) {
          return json({ error: "Cross-branch forbidden" }, 403);
        }
        resolvedBranchId = actor.branch_id;
      }
      if (!resolvedBranchId) return json({ error: "A branch is required" }, 400);
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(resolvedBranchId).first();
      if (!branch) return json({ error: "Branch not found" }, 400);

      let purchasePlan = null;
      if (interested_property_id) {
        const planResult = await resolvePropertyPlanForPurchase(env, Number(interested_property_id), property_plan_id ? Number(property_plan_id) : null);
        if (planResult.error) return json({ error: planResult.error, plans: planResult.plans || [] }, 400);
        purchasePlan = planResult.plan;
      } else if (property_plan_id) {
        return json({ error: "A property is required before selecting a payment plan" }, 400);
      }

      let normalizedAgreedPrice = null;
      if (purchasePlan) {
        normalizedAgreedPrice = fromKobo(Number(purchasePlan.total_price_kobo || 0));
      } else if (agreed_purchase_price !== undefined && agreed_purchase_price !== null && agreed_purchase_price !== "") {
        if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) {
          return json({ error: "Only a Managing Director or Branch Manager can establish a contract price" }, 403);
        }
        const price = Number(agreed_purchase_price);
        if (!Number.isFinite(price) || price < 0) return json({ error: "Agreed purchase price is invalid" }, 400);
        normalizedAgreedPrice = price;
      }

      const dup = await env.DB.prepare("SELECT id FROM clients WHERE phone_number = ? AND assigned_branch_id = ? AND is_deleted = 0 LIMIT 1")
        .bind(normalizedPhone, resolvedBranchId).first();
      if (dup) return json({ error: "A client with this phone number already exists in this branch" }, 409);

      const referrer = referral_code ? await resolveReferralStaff(env, referral_code) : actor;
      if (referral_code && !referrer) return json({ error: "Invalid referral code" }, 400);
      const nextOfKinLegacy = [next_of_kin_name, next_of_kin_relationship ? `(${next_of_kin_relationship})` : ""]
        .filter(Boolean).join(" ").trim() || next_of_kin || null;
      const ref = "BLC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const teamLeadId = actor.role_name === "Team Lead" ? actor.id : null;
      const agreedPrice = normalizedAgreedPrice;
      const identityMasked = identityProvided ? maskIdentityNumber(identity_number) : null;
      const identityLast4 = identityProvided ? cleanIdentityNumber(identity_number).slice(-4) : null;
      const identityHash = staffIdentityHash;
      const bvnLast4 = staticWalletBvnDigits ? staticWalletBvnDigits.slice(-4) : null;
      const kycSubmittedAt = identityProvided ? new Date().toISOString() : null;

      const res = await env.DB.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, alternate_phone, email_address, residential_address, state, city, next_of_kin, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship, next_of_kin_address, notes, preferred_channel, status, assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id, sale_type, referral_code_used, referred_by_staff_id, identity_type, identity_number_masked, identity_number_last4, identity_number_hash, bvn_last4, kyc_status, kyc_submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ref, full_name, normalizedPhone, alternate_phone || null, email_address || null, residential_address || null, state || null, city || null, nextOfKinLegacy, next_of_kin_name || null, next_of_kin_phone || null, next_of_kin_relationship || null, next_of_kin_address || null, notes || null, preferred_channel || null, status || "Prospect", resolvedBranchId, actor.id, actor.id, teamLeadId, agreedPrice, interested_property_id || null, resolvedSaleType, referrer ? referrer.referral_code : null, referrer ? referrer.id : null, resolvedIdentityType, identityMasked, identityLast4, identityHash, bvnLast4, "pending", kycSubmittedAt).run();
      const newId = res.meta.last_row_id;
      if (interested_property_id) {
        await upsertClientPropertyAllocation(env, newId, Number(interested_property_id), agreedPrice || 0, status || "Prospect");
      }
      let createdScheduleId = null;
      if (purchasePlan) {
        await lockClientPurchasePlan(env, newId, Number(interested_property_id), purchasePlan, status || "Prospect");
        const schedule = await createScheduleFromPropertyPlan(env, {
          id: newId, interested_property_id: Number(interested_property_id), assigned_branch_id: resolvedBranchId
        }, purchasePlan, actor.id, plan_start_date || todayOnly());
        if (schedule.error) return json({ error: schedule.error }, 400);
        createdScheduleId = schedule.id;
      }

      await env.DB.prepare("INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by) VALUES (?, ?, ?, ?, ?)")
        .bind(newId, actor.id, resolvedBranchId, teamLeadId, actor.id).run();
      await env.DB.prepare("INSERT INTO client_status_history (client_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)")
        .bind(newId, null, status || "Prospect", actor.id).run();
      await audit(env, actor.id, "client.create", "client", String(newId), {
        full_name, phone_number, branch_id: resolvedBranchId,
        referral_code: referrer ? referrer.referral_code : null,
        referred_by_staff_id: referrer ? referrer.id : null,
        identity_type: resolvedIdentityType, identity_last4: identityLast4,
        bvn_last4: bvnLast4, kyc_status: "pending"
      }, resolvedBranchId);
      await notifyClientCreated(env, {
        id: newId,
        full_name,
        client_reference: ref,
        assigned_branch_id: resolvedBranchId,
        original_marketer_id: actor.id,
        team_lead_id: teamLeadId,
        referred_by_staff_id: referrer ? referrer.id : actor.id
      }, actor.id);
      await sendAccountCreatedSms(env, newId, actor.id);
      const verification = await autoSendClientVerification(env, {
        id: newId,
        full_name,
        phone_number: normalizedPhone,
        email_address: email_address || null,
        assigned_branch_id: resolvedBranchId
      }, actor.id);
      let staticWallet = null;
      if (staticWalletBvnDigits) {
        try {
          staticWallet = await initiateAlatpayStaticWallet(env, {
            id: newId, full_name, phone_number: normalizedPhone, email_address: email_address || null,
            assigned_branch_id: resolvedBranchId
          }, staticWalletBvnDigits, actor.id);
        } catch (walletError) {
          staticWallet = { ok: false, error: walletError.message || "Unable to initiate static wallet" };
        }
      }
      if (env.TASKS && typeof env.TASKS.send === "function") {
        await env.TASKS.send({ type: "client.registered", client_id: newId }).catch(() => {});
      }

      return json({ ok: true, id: newId, client_reference: ref, kyc_status: "pending", schedule_id: createdScheduleId, verification, static_wallet: staticWallet });
    }

    // ---- Client details (Phase 4) ----
    // ---- Client OTP verification (staff-assisted onboarding) ----
    const clientVerificationMatch = path.match(/^\/api\/clients\/(\d+)\/verification(?:\/(send|verify))?$/);
    if (clientVerificationMatch) {
      if (clientVerificationMatch[2] && request.method === "POST" && !csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const client = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.phone_number, c.email_address,
               c.assigned_branch_id, c.team_lead_id, c.created_by, c.original_marketer_id,
               c.referred_by_staff_id, c.verification_status, c.verification_channel,
               c.verification_sent_at, c.verified_at,
               (SELECT ca.relationship_manager_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id
        FROM clients c WHERE c.id=? AND c.is_deleted=0
      `).bind(clientVerificationMatch[1]).first();
      if (!client || !canManageClient(actor, client)) return json({ error: "Client not found" }, 404);
      if (request.method === "GET") {
        const state = await getClientVerificationState(env, client.id);
        return json({ ok: true, client_id: client.id, ...state });
      }
      if (request.method === "POST" && clientVerificationMatch[2] === "send") {
        const body = await request.json().catch(() => ({}));
        try {
          const result = await createClientVerificationOtp(env, client, body.channel, actor.id);
          return json({ ok: true, client_id: client.id, ...result });
        } catch (error) {
          return json({ error: error.message || "Unable to send verification code" }, error.status || 500);
        }
      }
      if (request.method === "POST" && clientVerificationMatch[2] === "verify") {
        const body = await request.json().catch(() => ({}));
        try {
          const result = await verifyClientVerificationOtp(env, client.id, body.code, actor.id);
          await createNotification(env, {
            clientId: client.id,
            type: "client.verified",
            title: "Account Verified",
            message: "Your client account has been verified. Thank you.",
            metadata: { client_id: client.id, channel: result.channel }
          });
          return json({ ok: true, client_id: client.id, ...result });
        } catch (error) {
          return json({ error: error.message || "Unable to verify code" }, error.status || 400);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }


    if (path === "/api/phone-cleanup" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const scope = await resolvePhase6Scope(env, actor);
      const clientScope = clientScopeSql(scope, "c");
      const { results } = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.phone_number, c.assigned_branch_id,
               b.name AS branch_name, c.original_marketer_id, m.full_name AS marketer_name
        FROM clients c
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN users m ON m.id=c.original_marketer_id
        WHERE c.is_deleted=0 AND ${clientScope.clause}
        ORDER BY b.name, m.full_name, c.full_name
      `).bind(...clientScope.binds).all();
      const rows = [];
      for (const client of results) {
        const stored = client.phone_number ? String(client.phone_number).trim() : "";
        const proposed = normalizeNigerianPhone(stored);
        if (proposed && stored === proposed) continue;
        let reason = "invalid_number";
        if (!stored) reason = "missing_phone";
        else if (proposed) reason = "normalise_to_+234";
        rows.push({
          client_id: client.id,
          client_reference: client.client_reference,
          client_name: client.full_name,
          branch_id: client.assigned_branch_id,
          branch_name: client.branch_name || "Unassigned",
          marketer_id: client.original_marketer_id,
          marketer_name: client.marketer_name || "Unassigned",
          stored_value: stored || null,
          proposed_value: proposed,
          reason
        });
      }
      const byBranch = {};
      for (const row of rows) {
        const branch = row.branch_name || "Unassigned";
        byBranch[branch] = byBranch[branch] || { branch_name: branch, count: 0, marketers: {} };
        byBranch[branch].count++;
        const marketer = row.marketer_name || "Unassigned";
        byBranch[branch].marketers[marketer] = byBranch[branch].marketers[marketer] || { marketer_name: marketer, count: 0, clients: [] };
        byBranch[branch].marketers[marketer].count++;
        byBranch[branch].marketers[marketer].clients.push(row);
      }
      const grouped = Object.values(byBranch).map(branch => ({
        ...branch,
        marketers: Object.values(branch.marketers)
      }));
      return json({ total: rows.length, clients: rows, grouped });
    }


    const clientDetailMatch = path.match(/^\/api\/clients\/(\d+)$/);
    if (clientDetailMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const id = clientDetailMatch[1];
      const client = await env.DB.prepare(`
        SELECT c.*, u.full_name AS created_by_name, m.full_name AS original_marketer_name,
               ref.full_name AS referred_by_name, ref.referral_code AS referred_by_code,
               b.name AS branch_name,
               (SELECT ca.relationship_manager_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id,
               (SELECT ca.team_lead_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_team_lead_id
        FROM clients c
        LEFT JOIN users u ON u.id=c.created_by
        LEFT JOIN users m ON m.id=c.original_marketer_id
        LEFT JOIN users ref ON ref.id=c.referred_by_staff_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        WHERE c.id=? AND c.is_deleted=0
      `).bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (actor.role_name !== "Finance Officer" && !canManageClient(actor, client)) {
        return json({ error: "Forbidden" }, 403);
      }
      const { results: assignments } = await env.DB.prepare(`
        SELECT ca.*, u.full_name AS manager_name
        FROM client_assignments ca LEFT JOIN users u ON u.id=ca.relationship_manager_id
        WHERE ca.client_id=? ORDER BY ca.assigned_at DESC
      `).bind(id).all();
      const { results: assignmentHistory } = await env.DB.prepare(`
        SELECT h.*, u.full_name AS authorized_by_name,
               nm.full_name AS new_manager_name, pm.full_name AS previous_manager_name,
               nt.full_name AS new_team_lead_name
        FROM client_assignment_history h
        LEFT JOIN users u ON u.id=h.authorized_by
        LEFT JOIN users nm ON nm.id=h.new_manager_id
        LEFT JOIN users pm ON pm.id=h.previous_manager_id
        LEFT JOIN users nt ON nt.id=h.new_team_lead_id
        WHERE h.client_id=? ORDER BY h.changed_at DESC
      `).bind(id).all();
      const { results: statusHistory } = await env.DB.prepare(`
        SELECT csh.*, u.full_name AS changed_by_name
        FROM client_status_history csh LEFT JOIN users u ON u.id=csh.changed_by
        WHERE csh.client_id=? ORDER BY csh.changed_at DESC
      `).bind(id).all();
      const { results: notes } = await env.DB.prepare(`
        SELECT cn.*, u.full_name AS created_by_name
        FROM client_notes cn LEFT JOIN users u ON u.id=cn.created_by
        WHERE cn.client_id=? ORDER BY cn.created_at DESC
      `).bind(id).all();
      const portfolio = await buildClientPropertyPortfolio(env, client);
      const paymentPlanRow = await env.DB.prepare(`
        SELECT * FROM payment_schedules WHERE client_id=? ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, id DESC LIMIT 1
      `).bind(client.id).first();
      let paymentPlan = null;
      if (paymentPlanRow) {
        await ensureScheduleItems(env, paymentPlanRow);
        const { results: planItems } = await env.DB.prepare(
          "SELECT * FROM payment_schedule_items WHERE schedule_id=? ORDER BY sequence_no"
        ).bind(paymentPlanRow.id).all();
        const paidRow = await env.DB.prepare(`
          SELECT COALESCE(SUM(amount_kobo),0) AS paid_kobo FROM payments
          WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
        `).bind(client.id).first();
        paymentPlan = {
          ...paymentPlanRow,
          plan_type: normalizePlanType(paymentPlanRow.plan_type),
          is_easy_buy: isEasyBuyPlan(paymentPlanRow.plan_type),
          total_agreed_price: fromKobo(Number(paymentPlanRow.total_kobo || toKobo(paymentPlanRow.total_amount))),
          deposit_amount: fromKobo(Number(paymentPlanRow.deposit_kobo || toKobo(paymentPlanRow.deposit_amount))),
          installment_amount: fromKobo(Number(paymentPlanRow.installment_kobo || toKobo(paymentPlanRow.installment_amount))),
          expected_items: planItems,
          ...computeScheduleDefaulting(paymentPlanRow, planItems, Number(paidRow ? paidRow.paid_kobo : 0))
        };
      }
      return json({
        client,
        properties: portfolio.properties,
        financials: portfolio.financials,
        payment_plan: paymentPlan,
        assignments,
        assignment_history: assignmentHistory,
        history: assignmentHistory,
        status_history: statusHistory,
        notes
      });
    }

    // ---- Update client (Phase 4) ----
    if (clientDetailMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const id = clientDetailMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (!canManageClient(actor, client)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      if (actor.role_name === "Marketer" && Object.keys(body || {}).some(key => key !== "phone_number")) {
        return json({ error: "Marketers may only correct a client phone number" }, 403);
      }
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name) &&
          (body.agreed_purchase_price !== undefined || body.interested_property_id !== undefined)) {
        return json({ error: "Only a Managing Director or Branch Manager can change contract price or property ownership" }, 403);
      }
      if (body.agreed_purchase_price !== undefined && body.agreed_purchase_price !== null && body.agreed_purchase_price !== "") {
        const price = Number(body.agreed_purchase_price);
        if (!Number.isFinite(price) || price < 0) return json({ error: "Agreed purchase price is invalid" }, 400);
      }
      if (body.sale_type !== undefined && !SALE_TYPES.includes(body.sale_type)) {
        return json({ error: "Invalid sale type" }, 400);
      }
      for (const field of ["alternate_phone", "next_of_kin_phone"]) {
        if (body[field] && !/^[+0-9()\s-]{7,25}$/.test(String(body[field]).trim())) {
          return json({ error: `${field.replace(/_/g, " ")} is invalid` }, 400);
        }
      }
      if (body.phone_number !== undefined) {
        const normalized = normalizeNigerianPhone(body.phone_number);
        if (!normalized) return json({ error: "A valid Nigerian phone number is required" }, 400);
        body.phone_number = normalized;
      }
      const fields = ["full_name", "phone_number", "alternate_phone", "email_address", "residential_address",
        "state", "city", "next_of_kin", "next_of_kin_name", "next_of_kin_phone",
        "next_of_kin_relationship", "next_of_kin_address", "notes", "preferred_channel",
        "agreed_purchase_price", "interested_property_id", "sale_type"];
      const sets = [];
      const vals = [];
      const before = {};
      const after = {};
      for (const field of fields) {
        if (body[field] === undefined) continue;
        let value = body[field];
        if (typeof value === "string") value = value.trim();
        if (field === "email_address" && value) {
          const duplicate = await env.DB.prepare("SELECT id FROM clients WHERE LOWER(email_address)=? AND id<>? AND is_deleted=0")
            .bind(value.toLowerCase(), id).first();
          if (duplicate) return json({ error: "Email address is already in use" }, 409);
          value = value.toLowerCase();
        }
        before[field] = client[field];
        after[field] = value === "" ? null : value;
        sets.push(`${field}=?`);
        vals.push(value === "" ? null : value);
      }
      if (!sets.length) return json({ error: "No fields" }, 400);
      sets.push("updated_at=datetime('now')");
      vals.push(id);
      await env.DB.prepare(`UPDATE clients SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      const allocationPropertyId = after.interested_property_id !== undefined
        ? after.interested_property_id
        : client.interested_property_id;
      if (allocationPropertyId) {
        await upsertClientPropertyAllocation(
          env, Number(id), Number(allocationPropertyId),
          after.agreed_purchase_price !== undefined ? after.agreed_purchase_price : client.agreed_purchase_price,
          client.status
        );
      }
      await audit(env, actor.id, "client.update", "client", id, { before, after }, client.assigned_branch_id);
      return json({ ok: true });
    }

    // ---- Client identity / KYC review (staff) ----
    const clientKycMatch = path.match(/^\/api\/clients\/(\d+)\/kyc$/);
    if (clientKycMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const client = await env.DB.prepare(`
        SELECT c.id, c.full_name, c.client_reference, c.assigned_branch_id, c.kyc_status,
               (SELECT ca.relationship_manager_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id
        FROM clients c WHERE c.id=? AND c.is_deleted=0
      `).bind(clientKycMatch[1]).first();
      if (!client) return json({ error: "Client not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(client.assigned_branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json().catch(() => ({}));
      const status = String(body.status || "").trim().toLowerCase();
      if (!["verified", "rejected", "pending"].includes(status)) {
        return json({ error: "KYC status must be verified, rejected or pending" }, 400);
      }
      const notes = body.notes === undefined || body.notes === null ? null : String(body.notes).trim().slice(0, 1000);
      if (status === "rejected" && !notes) {
        return json({ error: "Add a reason before rejecting identity verification" }, 400);
      }
      await env.DB.prepare(`
        UPDATE clients SET kyc_status=?, kyc_reviewed_by=?, kyc_reviewed_at=datetime('now'),
          kyc_notes=?, updated_at=datetime('now') WHERE id=?
      `).bind(status, status === "pending" ? null : actor.id, notes, client.id).run();
      await audit(env, actor.id, "client.kyc.review", "client", String(client.id), {
        status, previous_status: client.kyc_status, notes
      }, client.assigned_branch_id);
      const label = status === "verified" ? "verified" : (status === "rejected" ? "not approved" : "returned to review");
      await createNotification(env, {
        clientId: client.id,
        type: "client.kyc",
        title: "Identity verification update",
        message: `Your identity verification was ${label}.${notes ? ` Note: ${notes}` : ""}`,
        metadata: { kyc_status: status }
      }).catch(() => {});
      return json({ ok: true, kyc_status: status, notes });
    }

    // ---- Client status change (Phase 4) ----
    const clientStatusMatch = path.match(/^\/api\/clients\/(\d+)\/status$/);
    if (clientStatusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const id = clientStatusMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (!canManageClient(actor, client)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const newStatus = body.status;
      const validStatuses = ["Prospect", "Interested", "Negotiation", "Reserved", "Active Buyer", "Completed", "Cancelled", "Inactive"];
      if (!validStatuses.includes(newStatus)) return json({ error: "Invalid status" }, 400);
      await env.DB.prepare("UPDATE clients SET status=?, updated_at=datetime('now') WHERE id=?").bind(newStatus, id).run();
      await env.DB.prepare("INSERT INTO client_status_history (client_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)")
        .bind(id, client.status, newStatus, actor.id).run();
      await audit(env, actor.id, "client.status", "client", id, { from: client.status, to: newStatus }, client.assigned_branch_id);
      return json({ ok: true });
    }

    // ---- Client assignment (Phase 4) ----
    const clientAssignMatch = path.match(/^\/api\/clients\/(\d+)\/assign$/);
    if (clientAssignMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = clientAssignMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (!canManageClient(actor, client)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { relationship_manager_id, branch_id, team_lead_id, reason } = body || {};
      if (!relationship_manager_id || !branch_id) return json({ error: "Relationship manager and branch are required" }, 400);
      if (actor.role_name === "Branch Manager" && Number(branch_id) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const manager = await env.DB.prepare("SELECT id, branch_id FROM users WHERE id=? AND is_active=1").bind(relationship_manager_id).first();
      if (!manager) return json({ error: "Relationship manager not found or inactive" }, 404);
      if (manager.branch_id !== null && Number(manager.branch_id) !== Number(branch_id)) {
        return json({ error: "Relationship manager does not belong to this branch" }, 400);
      }
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branch_id).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      const current = await env.DB.prepare("SELECT * FROM client_assignments WHERE client_id=? AND is_primary=1 ORDER BY assigned_at DESC LIMIT 1").bind(id).first();
      await env.DB.prepare("UPDATE client_assignments SET is_primary=0 WHERE client_id=?").bind(id).run();
      await env.DB.prepare("INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary) VALUES (?, ?, ?, ?, ?, 1)")
        .bind(id, relationship_manager_id, branch_id, team_lead_id || null, actor.id).run();
      await env.DB.prepare("UPDATE clients SET assigned_branch_id=?, team_lead_id=?, updated_at=datetime('now') WHERE id=?")
        .bind(branch_id, team_lead_id || null, id).run();
      await env.DB.prepare(`INSERT INTO client_assignment_history (client_id, previous_manager_id, new_manager_id, previous_branch_id, new_branch_id, previous_team_lead_id, new_team_lead_id, authorized_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, current ? current.relationship_manager_id : null, relationship_manager_id,
          current ? current.branch_id : client.assigned_branch_id, branch_id,
          current ? current.team_lead_id : client.team_lead_id, team_lead_id || null, actor.id, reason || null).run();
      await audit(env, actor.id, "client.assign", "client", id, { new_manager: relationship_manager_id, new_branch: branch_id }, branch_id);
      return json({ ok: true });
    }

    // ---- Client reassignment (Phase 4, MD only) ----
    const clientReassignMatch = path.match(/^\/api\/clients\/(\d+)\/reassign$/);
    if (clientReassignMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name !== "Managing Director") return json({ error: "Forbidden" }, 403);
      const id = clientReassignMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      const body = await request.json();
      const { relationship_manager_id, branch_id, team_lead_id, reason } = body || {};
      if (!relationship_manager_id || !branch_id) return json({ error: "Relationship manager and branch are required" }, 400);
      const manager = await env.DB.prepare("SELECT id, branch_id FROM users WHERE id=? AND is_active=1").bind(relationship_manager_id).first();
      if (!manager) return json({ error: "Relationship manager not found or inactive" }, 404);
      if (manager.branch_id !== null && Number(manager.branch_id) !== Number(branch_id)) {
        return json({ error: "Relationship manager does not belong to this branch" }, 400);
      }
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branch_id).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      const current = await env.DB.prepare("SELECT * FROM client_assignments WHERE client_id=? AND is_primary=1 ORDER BY assigned_at DESC LIMIT 1").bind(id).first();
      await env.DB.prepare("UPDATE client_assignments SET is_primary=0 WHERE client_id=?").bind(id).run();
      await env.DB.prepare("INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary) VALUES (?, ?, ?, ?, ?, 1)")
        .bind(id, relationship_manager_id, branch_id, team_lead_id || null, actor.id).run();
      await env.DB.prepare("UPDATE clients SET assigned_branch_id=?, team_lead_id=?, updated_at=datetime('now') WHERE id=?")
        .bind(branch_id, team_lead_id || null, id).run();
      await env.DB.prepare(`INSERT INTO client_assignment_history (client_id, previous_manager_id, new_manager_id, previous_branch_id, new_branch_id, previous_team_lead_id, new_team_lead_id, authorized_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, current ? current.relationship_manager_id : null, relationship_manager_id,
          current ? current.branch_id : client.assigned_branch_id, branch_id,
          current ? current.team_lead_id : client.team_lead_id, team_lead_id || null, actor.id, reason || null).run();
      await audit(env, actor.id, "client.reassign", "client", id, { new_manager: relationship_manager_id, new_branch: branch_id }, branch_id);
      return json({ ok: true });
    }

    // ---- Client status history (Phase 4) ----
    const clientStatusHistoryMatch = path.match(/^\/api\/clients\/(\d+)\/status-history$/);
    if (clientStatusHistoryMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const id = clientStatusHistoryMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (actor.role_name !== "Finance Officer" && !canManageClient(actor, client)) {
        return json({ error: "Forbidden" }, 403);
      }
      const { results } = await env.DB.prepare(`
        SELECT csh.*, u.full_name AS changed_by_name FROM client_status_history csh
        LEFT JOIN users u ON u.id=csh.changed_by WHERE csh.client_id=? ORDER BY csh.changed_at DESC
      `).bind(id).all();
      return json({ history: results });
    }

    // ---- Client assignment history (Phase 4) ----
    const clientAssignmentHistoryMatch = path.match(/^\/api\/clients\/(\d+)\/assignment-history$/);
    if (clientAssignmentHistoryMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const id = clientAssignmentHistoryMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (actor.role_name !== "Finance Officer" && !canManageClient(actor, client)) {
        return json({ error: "Forbidden" }, 403);
      }
      const { results } = await env.DB.prepare(`
        SELECT h.*, u.full_name AS authorized_by_name,
               nm.full_name AS new_manager_name, pm.full_name AS previous_manager_name,
               nt.full_name AS new_team_lead_name
        FROM client_assignment_history h
        LEFT JOIN users u ON u.id=h.authorized_by
        LEFT JOIN users nm ON nm.id=h.new_manager_id
        LEFT JOIN users pm ON pm.id=h.previous_manager_id
        LEFT JOIN users nt ON nt.id=h.new_team_lead_id
        WHERE h.client_id=? ORDER BY h.changed_at DESC
      `).bind(id).all();
      return json({ history: results });
    }

    // ---- Client notes (Phase 4) ----
    const clientNotesMatch = path.match(/^\/api\/clients\/(\d+)\/notes$/);
    if (clientNotesMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const id = clientNotesMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (!canManageClient(actor, client)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const note = String(body.note || "").trim();
      if (!note) return json({ error: "Note is required" }, 400);
      if (note.length > 2000) return json({ error: "Note is too long" }, 400);
      const res = await env.DB.prepare("INSERT INTO client_notes (client_id, note, created_by) VALUES (?, ?, ?)")
        .bind(id, note, actor.id).run();
      await audit(env, actor.id, "client.note.create", "client", id, { note_id: res.meta.last_row_id }, client.assigned_branch_id);
      return json({ ok: true, id: res.meta.last_row_id });
    }

    // =========================================================================
    // CLIENT PORTAL (Client-Scoped Endpoints)
    // =========================================================================

    // 2. Client Dashboard
    // ---- Client self-service OTP verification ----
    if ((path === "/api/client/verification" || path === "/api/client/verification/send" || path === "/api/client/verification/verify")) {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Client record not found" }, 404);
      if (path === "/api/client/verification" && request.method === "GET") {
        const state = await getClientVerificationState(env, client.id);
        return json({ ok: true, client_id: client.id, ...state });
      }
      if (path === "/api/client/verification/send" && request.method === "POST") {
        if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
        const body = await request.json().catch(() => ({}));
        try {
          const result = await createClientVerificationOtp(env, client, body.channel, actor.id);
          return json({ ok: true, client_id: client.id, ...result });
        } catch (error) {
          return json({ error: error.message || "Unable to send verification code" }, error.status || 500);
        }
      }
      if (path === "/api/client/verification/verify" && request.method === "POST") {
        if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
        const body = await request.json().catch(() => ({}));
        try {
          const result = await verifyClientVerificationOtp(env, client.id, body.code, actor.id);
          await createNotification(env, {
            clientId: client.id,
            type: "client.verified",
            title: "Account Verified",
            message: "Your client account has been verified. Thank you.",
            metadata: { client_id: client.id, channel: result.channel }
          });
          return json({ ok: true, client_id: client.id, ...result });
        } catch (error) {
          return json({ error: error.message || "Unable to verify code" }, error.status || 400);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (path === "/api/client/dashboard" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name !== "Client") return json({ error: "Forbidden: Client only" }, 403);

      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Client record not found" }, 404);

      const portfolio = await buildClientPropertyPortfolio(env, client);
      const property = portfolio.property;

      // Latest payment
      const latestPayment = await env.DB.prepare(
        "SELECT id, transaction_ref, amount, amount_kobo, method, status, verified_at, created_at FROM payments WHERE client_id=? AND is_demo=0 ORDER BY created_at DESC LIMIT 1"
      ).bind(client.id).first();

      // Next payment / installment info (only an authorised active plan is shown)
      const schedule = await env.DB.prepare(
        "SELECT s.*, p.title AS property_title FROM payment_schedules s LEFT JOIN properties p ON p.id=s.property_id WHERE s.client_id=? AND s.status='active' ORDER BY s.next_due_date ASC LIMIT 1"
      ).bind(client.id).first();

      let nextPayment = null;
      if (schedule) {
        const isOverdue = parseDbDate(schedule.next_due_date) < new Date();
        nextPayment = {
          has_schedule: true,
          schedule_id: schedule.id,
          installment_amount: fromKobo(Number(schedule.installment_kobo || toKobo(schedule.installment_amount))),
          installment_amount_kobo: Number(schedule.installment_kobo || toKobo(schedule.installment_amount)),
          total_amount_kobo: Number(schedule.total_kobo || toKobo(schedule.total_amount)),
          next_due_date: schedule.next_due_date,
          frequency_days: schedule.frequency_days,
          is_overdue: isOverdue,
          status: isOverdue ? "Overdue" : "Scheduled",
          payment_reference: client.client_reference,
          payment_instruction: "Please quote your Client Reference (" + client.client_reference + ") during payment transfer."
        };
      } else {
        nextPayment = {
          has_schedule: false,
          message: WEMA_NO_SCHEDULE_MESSAGE
        };
      }

      // Recent notifications
      const { results: notifs } = await env.DB.prepare(
        "SELECT id, type, title, message, is_read, created_at FROM notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 5"
      ).bind(client.id).all();

      return json({
        client: {
          id: client.id,
          client_reference: client.client_reference,
          full_name: client.full_name,
          phone_number: client.phone_number,
          alternate_phone: client.alternate_phone,
          email_address: client.email_address,
          residential_address: client.residential_address,
          state: client.state,
          city: client.city,
          next_of_kin: client.next_of_kin,
          next_of_kin_name: client.next_of_kin_name,
          next_of_kin_phone: client.next_of_kin_phone,
          next_of_kin_relationship: client.next_of_kin_relationship,
          next_of_kin_address: client.next_of_kin_address,
          status: client.status,
          branch_name: client.branch_name
        },
        property,
        properties: portfolio.properties,
        financials: portfolio.financials,
        latest_payment: latestPayment || null,
        next_payment: nextPayment,
        recent_notifications: notifs || []
      });
    }

    // 3. Client Profile (View & Permitted Updates)
    if (path === "/api/client/profile" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);
      return json({
        profile: {
          id: client.id,
          client_reference: client.client_reference,
          full_name: client.full_name,
          phone_number: client.phone_number,
          alternate_phone: client.alternate_phone,
          email_address: client.email_address,
          residential_address: client.residential_address,
          state: client.state,
          city: client.city,
          next_of_kin: client.next_of_kin,
          next_of_kin_name: client.next_of_kin_name,
          next_of_kin_phone: client.next_of_kin_phone,
          next_of_kin_relationship: client.next_of_kin_relationship,
          next_of_kin_address: client.next_of_kin_address,
          identity_type: client.identity_type,
          identity_number_masked: client.identity_number_masked,
          identity_last4: client.identity_number_last4,
          bvn_last4: client.bvn_last4,
          kyc_status: client.kyc_status || "pending",
          kyc_submitted_at: client.kyc_submitted_at,
          kyc_reviewed_at: client.kyc_reviewed_at,
          kyc_notes: client.kyc_notes,
          status: client.status,
          branch_name: client.branch_name
        }
      });
    }

    if (path === "/api/client/profile" && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const body = await request.json();
      const permittedFields = ["full_name", "phone_number", "alternate_phone", "email_address",
        "residential_address", "state", "city", "next_of_kin", "next_of_kin_name",
        "next_of_kin_phone", "next_of_kin_relationship", "next_of_kin_address"];
      const sets = [];
      const vals = [];
      const before = {};
      const after = {};

      for (const field of permittedFields) {
        if (body[field] === undefined) continue;
        let value = body[field];
        if (typeof value === "string") value = value.trim();

        if (field === "full_name" && !value) return json({ error: "Full name cannot be empty" }, 400);
        if (field === "phone_number") {
          if (!value || !/^[+0-9()\s-]{7,25}$/.test(value)) return json({ error: "Invalid phone number" }, 400);
        }
        if (["alternate_phone", "next_of_kin_phone"].includes(field) && value && !/^[+0-9()\s-]{7,25}$/.test(value)) {
          return json({ error: `Invalid ${field.replace(/_/g, " ")}` }, 400);
        }
        if (field === "email_address") {
          if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return json({ error: "Invalid email address" }, 400);
          value = value.toLowerCase();
          const otherUser = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=? AND id<>?").bind(value, actor.id).first();
          const otherClient = await env.DB.prepare("SELECT id FROM clients WHERE LOWER(email_address)=? AND id<>? AND is_deleted=0").bind(value, client.id).first();
          if (otherUser || otherClient) return json({ error: "Email address is already in use" }, 409);
        }

        before[field] = client[field];
        after[field] = value === "" ? null : value;
        sets.push(`${field} = ?`);
        vals.push(value === "" ? null : value);
      }

      // Identity details are captured as a hash plus a masked display value.
      // Changing them always returns the account to the KYC review queue.
      if (body.identity_type !== undefined || body.identity_number !== undefined) {
        const nextType = normalizeIdentityType(body.identity_type !== undefined ? body.identity_type : client.identity_type);
        if (!nextType) return json({ error: "Select a valid identity type" }, 400);
        const identityError = validateIdentityNumber(nextType, body.identity_number);
        if (identityError) return json({ error: identityError }, 400);
        const cleanedIdentity = cleanIdentityNumber(body.identity_number);
        const maskedIdentity = maskIdentityNumber(cleanedIdentity);
        const identityHash = await hashIdentityNumber(cleanedIdentity);
        const duplicateIdentity = await env.DB.prepare(
          "SELECT id FROM clients WHERE identity_number_hash=? AND identity_type=? AND id<>? AND is_deleted=0 LIMIT 1"
        ).bind(identityHash, nextType, client.id).first();
        if (duplicateIdentity) return json({ error: "This identity number is already linked to another client account" }, 409);
        before.identity_type = client.identity_type;
        before.identity_number_masked = client.identity_number_masked;
        after.identity_type = nextType;
        after.identity_number_masked = maskedIdentity;
        sets.push(
          "identity_type = ?", "identity_number_masked = ?", "identity_number_last4 = ?",
          "identity_number_hash = ?", "kyc_status = 'pending'", "kyc_submitted_at = datetime('now')",
          "kyc_reviewed_by = NULL", "kyc_reviewed_at = NULL", "kyc_notes = NULL"
        );
        vals.push(nextType, maskedIdentity, cleanedIdentity.slice(-4), identityHash);
      }

      if (!sets.length) return json({ error: "No editable fields provided" }, 400);
      sets.push("updated_at = datetime('now')");
      vals.push(client.id);

      await env.DB.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      await audit(env, actor.id, "client.profile.update", "client", String(client.id), { before, after }, client.assigned_branch_id);

      // If full_name or email changed, synchronize the login user record as well
      if (after.full_name !== undefined || after.email_address !== undefined) {
        const uSets = [];
        const uVals = [];
        if (after.full_name) { uSets.push("full_name = ?"); uVals.push(after.full_name); }
        if (after.email_address) { uSets.push("email = ?"); uVals.push(after.email_address); }
        if (uSets.length) {
          uVals.push(actor.id);
          await env.DB.prepare(`UPDATE users SET ${uSets.join(", ")}, updated_at=datetime('now') WHERE id = ?`).bind(...uVals).run();
        }
      }

      return json({ ok: true, message: "Profile updated successfully." });
    }

    // 4. Client My Property Page
    if (path === "/api/client/property" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      if (!client.interested_property_id) {
        return json({ property: null, message: "You have no property assigned or reserved at this time." });
      }

      const prop = await env.DB.prepare(
        "SELECT p.*, pc.name AS category_name, b.name AS branch_name FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id WHERE p.id=?"
      ).bind(client.interested_property_id).first();
      if (!prop) return json({ property: null, message: "Property details not found." });

      const { results: images } = await env.DB.prepare(
        "SELECT r2_key, is_main FROM property_images WHERE property_id=? ORDER BY is_main DESC"
      ).bind(prop.id).all();

      return json({
        property: {
          id: prop.id,
          title: prop.title,
          reference: prop.reference,
          purchase_reference: client.client_reference,
          location: `${prop.city || ""}, ${prop.state || ""}`.trim().replace(/^,|,$/g, ""),
          address: prop.address,
          description: prop.description,
          agreed_purchase_price: client.agreed_purchase_price || 0,
          agreed_purchase_price_kobo: toKobo(client.agreed_purchase_price || 0),
          purchase_date: client.created_at,
          status: client.status,
          property_status: prop.status,
          features: prop.features ? JSON.parse(prop.features) : [],
          bedrooms: prop.bedrooms,
          bathrooms: prop.bathrooms,
          land_size: prop.land_size,
          branch_name: prop.branch_name,
          category_name: prop.category_name,
          images: images.map(i => `/api/files/${encodeURIComponent(i.r2_key)}`)
        }
      });
    }

    // 5. Client Payment History
    if (path === "/api/client/payments" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const status = url.searchParams.get("status");
      const dateFrom = url.searchParams.get("date_from");
      const dateTo = url.searchParams.get("date_to");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
      const offset = (page - 1) * limit;

      let where = ["p.client_id = ?", "p.is_demo = 0"];
      const binds = [client.id];
      if (status) { where.push("p.status = ?"); binds.push(status); }
      if (dateFrom) { where.push("date(COALESCE(p.verified_at, p.created_at)) >= date(?)"); binds.push(dateFrom); }
      if (dateTo) { where.push("date(COALESCE(p.verified_at, p.created_at)) <= date(?)"); binds.push(dateTo); }

      const whereSql = "WHERE " + where.join(" AND ");
      const sql = `SELECT p.*, r.id AS receipt_id, r.receipt_ref, prop.reference AS property_reference FROM payments p LEFT JOIN receipts r ON r.payment_id=p.id LEFT JOIN properties prop ON prop.id=p.property_id ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
      const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM payments p ${whereSql}`).bind(...binds).first();

      // Total verified calculation in kobo
      const verifiedRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_kobo), 0) AS total_kobo FROM payments WHERE client_id = ? AND status = 'verified' AND is_demo = 0 AND currency = 'NGN'"
      ).bind(client.id).first();
      const totalVerifiedKobo = verifiedRow ? Number(verifiedRow.total_kobo) : 0;

      return json({
        payments: results.map(p => ({
          id: p.id,
          transaction_ref: p.transaction_ref,
          amount: p.amount,
          amount_kobo: p.amount_kobo || toKobo(p.amount),
          currency: p.currency,
          method: p.method,
          status: p.status, // 'verified', 'pending', 'failed', 'reversed', 'refunded'
          purchase_reference: p.property_reference || client.client_reference,
          created_at: p.created_at,
          verified_at: p.verified_at,
          receipt_available: Boolean(p.receipt_id),
          receipt_ref: p.receipt_ref || null
        })),
        total_verified_ngn: fromKobo(totalVerifiedKobo),
        total_verified_kobo: totalVerifiedKobo,
        pagination: { page, limit, total: countRow ? countRow.c : 0 }
      });
    }

    // 6. Client Installments & Schedules
    if (path === "/api/client/installments" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const { results: schedules } = await env.DB.prepare(
        "SELECT s.*, p.title AS property_title FROM payment_schedules s LEFT JOIN properties p ON p.id=s.property_id WHERE s.client_id=? ORDER BY s.next_due_date ASC"
      ).bind(client.id).all();

      const verifiedRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_kobo), 0) AS total_kobo FROM payments WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'"
      ).bind(client.id).first();
      const totalPaidKobo = verifiedRow ? Number(verifiedRow.total_kobo) : 0;

      return json({
        has_installments: schedules.length > 0,
        schedules: schedules.map(s => {
          const totalKobo = Number(s.total_kobo || toKobo(s.total_amount));
          const remainingKobo = Math.max(0, totalKobo - totalPaidKobo);
          const isCancelled = s.status === "cancelled";
          const isOverdue = !isCancelled && parseDbDate(s.next_due_date) < new Date() && remainingKobo > 0;
          const status = isCancelled ? "Cancelled" : (remainingKobo === 0 ? "Completed" : (isOverdue ? "Overdue" : "Active"));
          return {
            id: s.id,
            property_title: s.property_title,
            total_agreed_price: fromKobo(totalKobo),
            total_agreed_kobo: totalKobo,
            deposit_amount: fromKobo(Number(s.deposit_kobo || toKobo(s.deposit_amount))),
            deposit_amount_kobo: Number(s.deposit_kobo || toKobo(s.deposit_amount)),
            installment_amount: fromKobo(Number(s.installment_kobo || toKobo(s.installment_amount))),
            installment_amount_kobo: Number(s.installment_kobo || toKobo(s.installment_amount)),
            frequency_days: s.frequency_days,
            next_due_date: s.next_due_date,
            total_paid_ngn: fromKobo(totalPaidKobo),
            total_paid_kobo: totalPaidKobo,
            remaining_balance_ngn: fromKobo(remainingKobo),
            remaining_balance_kobo: remainingKobo,
            payment_percentage: totalKobo > 0 ? Math.min(100, Math.round((totalPaidKobo / totalKobo) * 1000) / 10) : 0,
            status,
            is_overdue: isOverdue
          };
        })
      });
    }

    // 8 & 9. ALATPay Virtual Account (Client View)
    if (path === "/api/client/virtual-account/static-wallet/initiate" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);
      const body = await request.json().catch(() => ({}));
      const bvnDigits = cleanBvn(body.bvn);
      if (!bvnDigits) return json({ error: "Enter a valid 11-digit BVN" }, 400);
      try {
        const result = await initiateAlatpayStaticWallet(env, client, bvnDigits, actor.id);
        await env.DB.prepare("UPDATE clients SET bvn_last4=?, updated_at=datetime('now') WHERE id=?")
          .bind(bvnDigits.slice(-4), client.id).run();
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ error: error.message || "Unable to create your dedicated account" }, error.status || 502);
      }
    }

    if (path === "/api/client/virtual-account/static-wallet/validate" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);
      const body = await request.json().catch(() => ({}));
      try {
        const result = await validateAlatpayStaticWallet(env, client, body.otp, actor.id);
        await createNotification(env, {
          clientId: client.id,
          type: "payment.virtual_account",
          title: "Dedicated account active",
          message: `Your permanent ALATPay account ${result.account_number || ""} is now active.`.trim(),
          metadata: { account_number: result.account_number || null }
        }).catch(() => {});
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ error: error.message || "Unable to validate your dedicated account" }, error.status || 502);
      }
    }

    if (path === "/api/client/virtual-account" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const settings = await getAlatpaySettings(env);
      const outstandingKobo = await outstandingForClient(env, client);
      const staticWallet = await getClientStaticWallet(env, client.id, settings.mode);
      if (staticWallet && staticWallet.status === "active" && staticWallet.account_number) {
        return json({
          is_active: true,
          is_static: true,
          payment_mode: settings.mode,
          provider: settings.providerName,
          provider_status: settings.status,
          status: settings.status,
          bank_name: staticWallet.bank_name || "Wema Bank",
          account_name: clientVirtualAccountName(client),
          account_number: staticWallet.account_number,
          account_status: "active",
          wallet_reference: staticWallet.wallet_reference,
          amount_kobo: 0,
          amount_ngn: 0,
          outstanding_kobo: outstandingKobo,
          outstanding_ngn: fromKobo(outstandingKobo),
          client_reference: client.client_reference,
          notice: "This is your permanent ALATPay account number. It can be used for any amount and any number of payments."
        });
      }
      let va = await env.DB.prepare(
        "SELECT * FROM virtual_accounts WHERE client_id=? AND provider IN ('alatpay','wema_alat') ORDER BY id DESC LIMIT 1"
      ).bind(client.id).first();
      if (va && va.account_status === "active" && va.expires_at && parseDbDate(va.expires_at) < new Date()) {
        await env.DB.prepare("UPDATE virtual_accounts SET account_status='expired', updated_at=datetime('now') WHERE id=?")
          .bind(va.id).run();
        va = { ...va, account_status: "expired" };
      }

      if (va && va.account_number && va.account_status === "active") {
        return json({
          is_active: true,
          provider: settings.providerName,
          provider_status: settings.status,
          status: settings.status,
          bank_name: va.bank_name || "Wema Bank",
          account_name: clientVirtualAccountName(client),
          account_number: va.account_number,
          account_status: va.account_status,
          amount_kobo: Number(va.amount_kobo || 0),
          amount_ngn: fromKobo(Number(va.amount_kobo || 0)),
          order_id: va.order_id,
          transaction_id: va.transaction_id,
          expires_at: va.expires_at,
          outstanding_kobo: outstandingKobo,
          outstanding_ngn: fromKobo(outstandingKobo),
          client_reference: client.client_reference
        });
      }

      return json({
        is_active: false,
        can_generate: settings.ready,
        can_activate_static: settings.ready,
        payment_mode: settings.mode,
        static_wallet: staticWallet ? {
          status: staticWallet.status,
          account_number: staticWallet.account_number,
          account_name: clientVirtualAccountName(client),
          bank_name: staticWallet.bank_name,
          wallet_reference: staticWallet.wallet_reference
        } : null,
        static_wallet_status: staticWallet ? staticWallet.status : "not_created",
        bvn_last4: client.bvn_last4 || null,
        outstanding_kobo: outstandingKobo,
        outstanding_ngn: fromKobo(outstandingKobo),
        provider: settings.providerName,
        provider_status: settings.status,
        status: settings.status,
        notice: settings.ready
          ? "Activate your permanent dedicated ALATPay account to receive any amount at any time."
          : "Your dedicated account will be activated once ALATPay is fully configured. Please contact the finance team.",
        message: settings.ready
          ? "Activate your permanent dedicated ALATPay account to receive any amount at any time."
          : "Your dedicated account will be activated once ALATPay is fully configured. Please contact the finance team.",
        client_reference: client.client_reference
      });
    }

    if (path === "/api/client/virtual-account" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);
      const body = await request.json().catch(() => ({}));
      const outstanding = await outstandingForClient(env, client);
      const amountKobo = body && body.amount !== undefined && body.amount !== null && body.amount !== ""
        ? toKobo(body.amount)
        : outstanding;
      if (!Number.isInteger(amountKobo) || amountKobo < 10000) {
        return json({ error: "An amount of at least ₦100 is required" }, 400);
      }
      if (amountKobo > outstanding && outstanding > 0) {
        return json({ error: "Amount cannot exceed the outstanding balance" }, 400);
      }
      try {
        const account = await createAlatpayVirtualAccount(env, client, amountKobo, actor.id);
        await createNotification(env, {
          clientId: client.id,
          type: "payment.virtual_account",
          title: "Payment Account Created",
          message: `A dedicated ALATPay account was created for ${formatNGN(amountKobo)}.`,
          metadata: { order_id: account.order_id, account_number: account.account_number }
        });
        return json({ ok: true, ...account, client_reference: client.client_reference });
      } catch (error) {
        return json({ error: error.message || "Unable to create a virtual account" }, error.status || 502);
      }
    }

    // Staff-assisted virtual-account generation
    // ALATPay static wallets: permanent account numbers per client.
    const staticWalletMatch = path.match(/^\/api\/finance\/clients\/(\d+)\/static-wallet(?:\/(initiate|validate))?$/);
    if (staticWalletMatch) {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const client = await env.DB.prepare("SELECT id, full_name, email_address, phone_number, assigned_branch_id FROM clients WHERE id=? AND is_deleted=0")
        .bind(staticWalletMatch[1]).first();
      if (!client) return json({ error: "Client not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(client.assigned_branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (request.method === "GET") {
        const wallet = await getClientStaticWallet(env, client.id);
        if (wallet) wallet.account_name = clientVirtualAccountName(client);
        return json({ wallet: wallet || null, payment_mode: getPaymentMode(env) });
      }
      if (request.method === "POST" && staticWalletMatch[2] === "initiate") {
        if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
        const body = await request.json().catch(() => ({}));
        try {
          const result = await initiateAlatpayStaticWallet(env, client, body.bvn, actor.id);
          return json(result);
        } catch (error) {
          return json({ error: error.message || "Unable to initiate static wallet" }, error.status || 502);
        }
      }
      if (request.method === "POST" && staticWalletMatch[2] === "validate") {
        if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
        const body = await request.json().catch(() => ({}));
        try {
          const result = await validateAlatpayStaticWallet(env, client, body.otp, actor.id);
          return json(result);
        } catch (error) {
          return json({ error: error.message || "Unable to validate static wallet" }, error.status || 502);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (path === "/api/finance/static-wallets/backfill" && request.method === "POST") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json().catch(() => ({}));
      const { results: clients } = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.assigned_branch_id, b.name AS branch_name
        FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN client_static_wallets w ON w.client_id=c.id AND w.payment_mode=?
        WHERE c.is_deleted=0 AND w.id IS NULL
        ORDER BY c.id
      `).bind(getPaymentMode(env)).all();
      if (body.dry_run !== false) {
        return json({ dry_run: true, missing_count: clients.length, clients, note: "Static wallet creation requires a per-client BVN and OTP validation. No BVN is stored by this app." });
      }
      if (!Array.isArray(body.wallets)) {
        return json({ error: "Provide wallets: [{client_id, bvn}] for non-dry-run backfill" }, 400);
      }
      const results = [];
      for (const item of body.wallets) {
        const target = clients.find(client => Number(client.id) === Number(item.client_id));
        if (!target) { results.push({ client_id: item.client_id, status: "skipped", reason: "not_missing" }); continue; }
        try {
          const fullClient = await env.DB.prepare("SELECT * FROM clients WHERE id=?").bind(target.id).first();
          const result = await initiateAlatpayStaticWallet(env, fullClient, item.bvn, actor.id);
          results.push({ client_id: target.id, status: result.status || "otp_pending", wallet_reference: result.wallet_reference || null });
        } catch (error) {
          results.push({ client_id: target.id, status: "failed", error: error.message });
        }
      }
      return json({ dry_run: false, processed: results.length, results });
    }


    const staffVirtualAccountMatch = path.match(/^\/api\/finance\/clients\/(\d+)\/virtual-account$/);
    if (staffVirtualAccountMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const client = await env.DB.prepare("SELECT * FROM clients WHERE id=? AND is_deleted=0")
        .bind(staffVirtualAccountMatch[1]).first();
      if (!client) return json({ error: "Client not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(client.assigned_branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json().catch(() => ({}));
      const outstanding = await outstandingForClient(env, client);
      const amountKobo = body && body.amount !== undefined && body.amount !== null && body.amount !== ""
        ? toKobo(body.amount)
        : outstanding;
      if (!Number.isInteger(amountKobo) || amountKobo < 10000) {
        return json({ error: "An amount of at least ₦100 is required" }, 400);
      }
      if (amountKobo > outstanding && outstanding > 0) {
        return json({ error: "Amount cannot exceed the outstanding balance" }, 400);
      }
      try {
        const account = await createAlatpayVirtualAccount(env, client, amountKobo, actor.id);
        await createNotification(env, {
          clientId: client.id,
          type: "payment.virtual_account",
          title: "Payment Account Created",
          message: `Your finance team created a dedicated ALATPay account for ${formatNGN(amountKobo)}.`,
          metadata: { order_id: account.order_id, account_number: account.account_number }
        });
        return json({ ok: true, ...account, client_reference: client.client_reference });
      } catch (error) {
        return json({ error: error.message || "Unable to create a virtual account" }, error.status || 502);
      }
    }

    // 10. Client Receipts
    if (path === "/api/client/receipts" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const sql = `
        SELECT r.*, p.transaction_ref, p.method, p.verified_at, p.status AS payment_status, p.property_id, prop.title AS property_title, prop.reference AS property_reference
        FROM receipts r
        JOIN payments p ON p.id=r.payment_id
        LEFT JOIN properties prop ON prop.id=p.property_id
        WHERE r.client_id=? AND r.is_demo=0 AND p.is_demo=0 AND p.verified_at IS NOT NULL
        ORDER BY r.created_at DESC
      `;
      const { results } = await env.DB.prepare(sql).bind(client.id).all();

      return json({
        receipts: results.map(r => ({
          id: r.id,
          receipt_number: r.receipt_ref,
          payment_id: r.payment_id,
          transaction_ref: r.transaction_ref,
          client_name: client.full_name,
          client_reference: client.client_reference,
          property_title: r.property_title || "Residential Property",
          property_reference: r.property_reference || "N/A",
          amount: Number(r.amount_kobo || toKobo(r.amount)) / 100,
          amount_kobo: Number(r.amount_kobo || toKobo(r.amount)),
          payment_date: r.verified_at || r.created_at,
          remaining_balance_kobo: Number(r.remaining_balance_kobo || 0),
          remaining_balance_ngn: fromKobo(r.remaining_balance_kobo || 0),
          verification_status: r.payment_status === "verified" ? "Verified" : (r.payment_status || "Verified"),
          is_verified: r.payment_status === "verified",
          is_demo: false,
          download_url: `/api/client/receipts/${r.id}/download`
        }))
      });
    }

    // 10b. Download official receipt PDF (client-scoped)
    const clientReceiptMatch = path.match(/^\/api\/client\/receipts\/(\d+)\/download$/);
    if (clientReceiptMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const row = await env.DB.prepare(`
        SELECT r.*, p.transaction_ref, p.method, p.verified_at, p.status AS payment_status,
               p.amount AS payment_amount, c.full_name, c.client_reference,
               prop.title AS property_title, prop.reference AS property_reference
        FROM receipts r
        JOIN payments p ON p.id=r.payment_id
        JOIN clients c ON c.id=r.client_id
        LEFT JOIN properties prop ON prop.id=p.property_id
        WHERE r.id=? AND r.client_id=? AND r.is_demo=0 AND p.is_demo=0 AND p.verified_at IS NOT NULL
      `).bind(clientReceiptMatch[1], client.id).first();
      if (!row) return json({ error: "Receipt not found" }, 404);

      const key = await ensureReceiptPdf(env, row);
      const object = key ? await env.FILES.get(key) : null;
      const pdf = object ? await object.arrayBuffer() : null;
      if (!pdf) return json({ error: "Receipt PDF unavailable" }, 503);
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(row.receipt_ref, "receipt")}.pdf"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    // 10c. Staff receipt download (demo receipts are clearly marked inside the PDF)
    const staffReceiptMatch = path.match(/^\/api\/finance\/receipts\/(\d+)\/download$/);
    if (staffReceiptMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const row = await env.DB.prepare(`
        SELECT r.*, p.transaction_ref, p.method, p.verified_at, p.status AS payment_status,
               p.amount AS payment_amount, p.is_demo AS payment_is_demo,
               c.full_name, c.client_reference, c.assigned_branch_id,
               prop.title AS property_title, prop.reference AS property_reference
        FROM receipts r
        JOIN payments p ON p.id=r.payment_id
        JOIN clients c ON c.id=r.client_id
        LEFT JOIN properties prop ON prop.id=p.property_id
        WHERE r.id=? AND p.verified_at IS NOT NULL
      `).bind(staffReceiptMatch[1]).first();
      if (!row) return json({ error: "Receipt not found" }, 404);
      if (actor.role_name === "Branch Manager" && row.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if ((row.is_demo || row.payment_is_demo) && !demoEnabled(env)) {
        return json({ error: "Demo receipts are disabled" }, 403);
      }

      const key = await ensureReceiptPdf(env, row);
      const object = key ? await env.FILES.get(key) : null;
      const pdf = object ? await object.arrayBuffer() : null;
      if (!pdf) return json({ error: "Receipt PDF unavailable" }, 503);
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(row.receipt_ref, "receipt")}.pdf"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    // 11. Client In-App Notifications
    if (path === "/api/client/notifications" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      const { results: notifs } = await env.DB.prepare(
        "SELECT * FROM notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 30"
      ).bind(client.id).all();
      const unreadCount = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM notifications WHERE client_id=? AND is_read=0"
      ).bind(client.id).first();

      return json({
        notifications: notifs,
        unread_count: unreadCount ? unreadCount.c : 0
      });
    }

    const notifReadMatch = path.match(/^\/api\/client\/notifications\/(\d+)\/read$/);
    if (notifReadMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const notifId = notifReadMatch[1];
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND client_id=?").bind(notifId, client.id).run();
      return json({ ok: true });
    }

    if (path === "/api/client/notifications/read-all" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE client_id=?").bind(client.id).run();
      return json({ ok: true });
    }

    // =========================================================================
    // =========================================================================
    // HIERARCHICAL REVENUE DRILL-DOWN
    // =========================================================================
    function revenueDateRange() {
      const today = todayOnly();
      let from = dateOnly(url.searchParams.get("from")) || today;
      let to = dateOnly(url.searchParams.get("to")) || today;
      if (from > to) { const swap = from; from = to; to = swap; }
      return { from, to };
    }

    async function revenueContext(actor) {
      const actualRole = actor.actual_role_name || actor.role_name;
      const companyWide = ["Super Admin", "Managing Director", "Head Accountant", "Finance Officer"].includes(actualRole);
      const range = revenueDateRange();
      let branchId = url.searchParams.get("branch_id") ? Number(url.searchParams.get("branch_id")) : null;
      let teamLeadId = url.searchParams.get("team_lead_id") ? Number(url.searchParams.get("team_lead_id")) : null;
      let staffId = url.searchParams.get("staff_id") ? Number(url.searchParams.get("staff_id")) : null;

      if (["Project Manager", "Branch Manager"].includes(actualRole)) {
        if (branchId && branchId !== Number(actor.branch_id)) return { error: json({ error: "Branch is outside your scope" }, 403) };
        branchId = Number(actor.branch_id);
      } else if (actualRole === "Team Lead") {
        if (teamLeadId && teamLeadId !== Number(actor.id)) return { error: json({ error: "Team is outside your scope" }, 403) };
        if (branchId && branchId !== Number(actor.branch_id)) return { error: json({ error: "Branch is outside your scope" }, 403) };
        teamLeadId = Number(actor.id);
        branchId = Number(actor.branch_id);
      } else if (!companyWide) {
        if (staffId && staffId !== Number(actor.id)) return { error: json({ error: "Staff scope is outside your permission" }, 403) };
        staffId = Number(actor.id);
        branchId = actor.branch_id;
        teamLeadId = null;
      }

      if (staffId && ["Project Manager", "Branch Manager"].includes(actualRole)) {
        const staff = await env.DB.prepare("SELECT id, branch_id, manager_id FROM users WHERE id=?").bind(staffId).first();
        if (!staff || Number(staff.branch_id) !== Number(actor.branch_id)) {
          return { error: json({ error: "Staff is outside your branch" }, 403) };
        }
      }
      if (staffId && actualRole === "Team Lead") {
        const staff = await env.DB.prepare("SELECT id, manager_id FROM users WHERE id=?").bind(staffId).first();
        if (!staff) return { error: json({ error: "Staff not found" }, 404) };
        const teamMember = await env.DB.prepare(`
          SELECT 1 AS ok FROM users u
          WHERE u.id=? AND (u.manager_id=? OR u.id IN (
            SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id=tm.team_id
            WHERE t.team_lead_user_id=? AND t.is_active=1
          ))
        `).bind(staffId, actor.id, actor.id).first();
        if (!teamMember) return { error: json({ error: "Staff is outside your team" }, 403) };
      }

      const scope = revenueScopeSql(actor, "p");
      const clauses = [
        scope.clause,
        "p.status='verified'",
        "p.is_demo=0",
        "p.currency='NGN'",
        "date(p.verified_at) BETWEEN date(?) AND date(?)"
      ];
      const binds = [...scope.binds, range.from, range.to];
      if (url.searchParams.get("include_test") !== "1") {
        clauses.push("COALESCE(p.is_internal_test,0)=0", "COALESCE(p.is_archived,0)=0");
      }
      if (companyWide && branchId) {
        clauses.push("COALESCE(p.revenue_branch_id, c.assigned_branch_id)=?");
        binds.push(branchId);
      }
      if (teamLeadId) { clauses.push("p.revenue_team_lead_id=?"); binds.push(teamLeadId); }
      if (staffId) { clauses.push("p.revenue_staff_id=?"); binds.push(staffId); }

      let level = companyWide ? "company" : (["Project Manager", "Branch Manager"].includes(actualRole) ? "branch" : (actualRole === "Team Lead" ? "team_lead" : "staff"));
      if (branchId && level === "company") level = "branch";
      if (teamLeadId) level = "team_lead";
      if (staffId) level = "staff";

      const breadcrumb = [];
      if (companyWide) breadcrumb.push({ type: "company", label: "National", params: {} });
      if (branchId) {
        const branch = await env.DB.prepare("SELECT name FROM branches WHERE id=?").bind(branchId).first();
        breadcrumb.push({ type: "branch", label: branch ? branch.name : "Branch", params: { branch_id: branchId } });
      }
      if (teamLeadId) {
        const tl = await env.DB.prepare("SELECT full_name FROM users WHERE id=?").bind(teamLeadId).first();
        breadcrumb.push({ type: "team_lead", label: tl ? tl.full_name : "Team Lead", params: { branch_id: branchId, team_lead_id: teamLeadId } });
      }
      if (staffId) {
        const staff = await env.DB.prepare("SELECT full_name FROM users WHERE id=?").bind(staffId).first();
        breadcrumb.push({ type: "staff", label: staff ? staff.full_name : "Staff", params: { branch_id: branchId, team_lead_id: teamLeadId, staff_id: staffId } });
      }
      if (!breadcrumb.length) breadcrumb.push({ type: "company", label: "National", params: {} });

      return {
        actor, actualRole, companyWide, from: range.from, to: range.to,
        branchId, teamLeadId, staffId, level,
        whereSql: clauses.join(" AND "), binds, breadcrumb
      };
    }

    async function revenueChildRows(ctx, totalKobo) {
      const rows = [];
      if (ctx.level === "company") {
        const result = await env.DB.prepare(`
          SELECT COALESCE(p.revenue_branch_id, c.assigned_branch_id) AS id,
                 COALESCE(b.name, 'Unassigned') AS name,
                 COALESCE(SUM(p.amount_kobo),0) AS total_kobo,
                 COUNT(*) AS payment_count
          FROM payments p JOIN clients c ON c.id=p.client_id
          LEFT JOIN branches b ON b.id=COALESCE(p.revenue_branch_id, c.assigned_branch_id)
          WHERE ${ctx.whereSql}
          GROUP BY COALESCE(p.revenue_branch_id, c.assigned_branch_id)
          ORDER BY total_kobo DESC
        `).bind(...ctx.binds).all();
        for (const row of result.results) {
          rows.push({
            type: "branch", id: row.id, name: row.name,
            total_kobo: Number(row.total_kobo || 0), total_ngn: fromKobo(Number(row.total_kobo || 0)),
            payment_count: Number(row.payment_count || 0),
            params: { branch_id: row.id }
          });
        }
      } else if (ctx.level === "branch") {
        const tl = await env.DB.prepare(`
          SELECT p.revenue_team_lead_id AS id, u.full_name AS name,
                 COALESCE(SUM(p.amount_kobo),0) AS total_kobo, COUNT(*) AS payment_count
          FROM payments p JOIN clients c ON c.id=p.client_id
          LEFT JOIN users u ON u.id=p.revenue_team_lead_id
          WHERE ${ctx.whereSql} AND p.revenue_team_lead_id IS NOT NULL
          GROUP BY p.revenue_team_lead_id ORDER BY total_kobo DESC
        `).bind(...ctx.binds).all();
        for (const row of tl.results) {
          rows.push({
            type: "team_lead", id: row.id, name: row.name || "Team Lead",
            total_kobo: Number(row.total_kobo || 0), total_ngn: fromKobo(Number(row.total_kobo || 0)),
            payment_count: Number(row.payment_count || 0),
            params: { branch_id: ctx.branchId, team_lead_id: row.id }
          });
        }
        const direct = await env.DB.prepare(`
          SELECT p.revenue_staff_id AS id, u.full_name AS name,
                 COALESCE(SUM(p.amount_kobo),0) AS total_kobo, COUNT(*) AS payment_count
          FROM payments p JOIN clients c ON c.id=p.client_id
          LEFT JOIN users u ON u.id=p.revenue_staff_id
          WHERE ${ctx.whereSql} AND p.revenue_team_lead_id IS NULL AND p.revenue_staff_id IS NOT NULL
          GROUP BY p.revenue_staff_id ORDER BY total_kobo DESC
        `).bind(...ctx.binds).all();
        for (const row of direct.results) {
          rows.push({
            type: "staff", id: row.id, name: row.name || "Staff",
            total_kobo: Number(row.total_kobo || 0), total_ngn: fromKobo(Number(row.total_kobo || 0)),
            payment_count: Number(row.payment_count || 0),
            params: { branch_id: ctx.branchId, staff_id: row.id }
          });
        }
      } else if (ctx.level === "team_lead") {
        const staff = await env.DB.prepare(`
          SELECT p.revenue_staff_id AS id, u.full_name AS name,
                 COALESCE(SUM(p.amount_kobo),0) AS total_kobo, COUNT(*) AS payment_count
          FROM payments p JOIN clients c ON c.id=p.client_id
          LEFT JOIN users u ON u.id=p.revenue_staff_id
          WHERE ${ctx.whereSql} AND p.revenue_staff_id IS NOT NULL
          GROUP BY p.revenue_staff_id ORDER BY total_kobo DESC
        `).bind(...ctx.binds).all();
        for (const row of staff.results) {
          rows.push({
            type: "staff", id: row.id, name: row.name || "Staff",
            total_kobo: Number(row.total_kobo || 0), total_ngn: fromKobo(Number(row.total_kobo || 0)),
            payment_count: Number(row.payment_count || 0),
            params: { branch_id: ctx.branchId, team_lead_id: ctx.teamLeadId, staff_id: row.id }
          });
        }
      }
      const childrenTotal = rows.reduce((sum, row) => sum + row.total_kobo, 0);
      const difference = Number(totalKobo) - childrenTotal;
      if (difference > 0) {
        rows.push({
          type: "unassigned", id: null, name: "Unassigned",
          total_kobo: difference, total_ngn: fromKobo(difference), payment_count: 0,
          params: { branch_id: ctx.branchId, team_lead_id: ctx.teamLeadId, staff_id: ctx.staffId }
        });
      }
      return rows;
    }

    if ((path === "/api/revenue/overview" || path === "/api/revenue/breakdown") && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const ctx = await revenueContext(actor);
      if (ctx.error) return ctx.error;
      const totalRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo),0) AS total_kobo, COUNT(*) AS payment_count
        FROM payments p JOIN clients c ON c.id=p.client_id
        WHERE ${ctx.whereSql}
      `).bind(...ctx.binds).first();
      const totalKobo = Number(totalRow ? totalRow.total_kobo : 0);
      const children = ctx.level === "staff" ? [] : await revenueChildRows(ctx, totalKobo);
      const childrenTotal = children.reduce((sum, row) => sum + row.total_kobo, 0);
      return json({
        from: ctx.from,
        to: ctx.to,
        level: ctx.level,
        actual_role: ctx.actualRole,
        breadcrumb: ctx.breadcrumb,
        total_kobo: totalKobo,
        total_ngn: fromKobo(totalKobo),
        payment_count: Number(totalRow ? totalRow.payment_count : 0),
        children,
        children_total_kobo: childrenTotal,
        children_total_ngn: fromKobo(childrenTotal),
        reconciles: ctx.level === "staff" ? true : childrenTotal === totalKobo
      });
    }

    if (path === "/api/revenue/payments" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const ctx = await revenueContext(actor);
      if (ctx.error) return ctx.error;
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10)));
      const offset = (page - 1) * limit;
      const { results } = await env.DB.prepare(`
        SELECT p.id, p.transaction_ref, p.amount_kobo, p.method, p.verified_at,
               c.client_reference, c.full_name AS client_name,
               s.full_name AS staff_name, tl.full_name AS team_lead_name,
               b.name AS branch_name, p.revenue_staff_id, p.revenue_team_lead_id, p.revenue_branch_id
        FROM payments p JOIN clients c ON c.id=p.client_id
        LEFT JOIN users s ON s.id=p.revenue_staff_id
        LEFT JOIN users tl ON tl.id=p.revenue_team_lead_id
        LEFT JOIN branches b ON b.id=p.revenue_branch_id
        WHERE ${ctx.whereSql}
        ORDER BY p.verified_at DESC, p.id DESC LIMIT ? OFFSET ?
      `).bind(...ctx.binds, limit, offset).all();
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM payments p JOIN clients c ON c.id=p.client_id WHERE ${ctx.whereSql}
      `).bind(...ctx.binds).first();
      return json({
        from: ctx.from, to: ctx.to, level: ctx.level, breadcrumb: ctx.breadcrumb,
        payments: results.map(row => ({ ...row, amount_ngn: fromKobo(row.amount_kobo) })),
        pagination: { page, limit, total: count ? Number(count.c) : 0 }
      });
    }

    // 12. FINANCE DASHBOARD & FINANCIAL MANAGEMENT (Staff)
    // =========================================================================

    // Finance KPI Overview
    if (path === "/api/finance/overview" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const isDemo = url.searchParams.get("demo") === "1" ? 1 : 0;
      if (isDemo && !demoEnabled(env)) return json({ error: "Demo mode is disabled in this environment" }, 403);
      const includeTest = url.searchParams.get("include_test") === "1";
      const testFilter = includeTest ? "" : " AND COALESCE(p.is_internal_test,0)=0 AND COALESCE(p.is_archived,0)=0";
      const clientTestFilter = includeTest ? "" : " AND COALESCE(c.is_internal_test,0)=0 AND COALESCE(c.is_archived,0)=0";
      let branchFilter = "";
      const branchBinds = [];
      if (actor.role_name === "Branch Manager") {
        branchFilter = "AND c.assigned_branch_id = ?";
        branchBinds.push(actor.branch_id);
      }

      // Total verified collections
      const totalVerifiedRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS total_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN'${testFilter} ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();
      const totalVerifiedKobo = totalVerifiedRow ? Number(totalVerifiedRow.total_kobo) : 0;

      // Today's collections
      const today = new Date().toISOString().slice(0, 10);
      const todayRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS today_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN'${testFilter} AND date(p.verified_at)=? ${branchFilter}
      `).bind(isDemo, today, ...branchBinds).first();

      // Monthly collections (current month)
      const curMonth = today.slice(0, 7);
      const monthRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS month_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN'${testFilter} AND strftime('%Y-%m', p.verified_at)=? ${branchFilter}
      `).bind(isDemo, curMonth, ...branchBinds).first();

      // Pending payments
      const pendingRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS pending_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='pending' AND p.is_demo=? AND p.currency='NGN'${testFilter} ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Failed payments
      const failedRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS failed_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='failed' AND p.is_demo=? AND p.currency='NGN'${testFilter} ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Refunds & reversals
      const refundsRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS refunds_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status IN ('reversed', 'refunded') AND p.is_demo=? AND p.currency='NGN'${testFilter} ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Outstanding client balances. Demo and live contract totals are kept in
      // separate ledgers so demo data can never distort live reporting.
      const demoClientFilter = isDemo
        ? "AND c.client_reference LIKE 'DEMO-%'"
        : "AND c.client_reference NOT LIKE 'DEMO-%'";
      const agreedSumRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(agreed_purchase_price), 0) AS agreed_total
        FROM clients c
        WHERE c.is_deleted=0 ${demoClientFilter}${clientTestFilter} ${branchFilter}
      `).bind(...branchBinds).first();
      const totalAgreedKobo = toKobo(agreedSumRow ? agreedSumRow.agreed_total : 0);
      const outstandingBalancesKobo = Math.max(0, totalAgreedKobo - totalVerifiedKobo);

      // ALAT by Wema Bank integration status
      const wemaConfig = await env.DB.prepare(
        "SELECT status, environment, updated_at FROM provider_configs WHERE provider_key='wema_alat'"
      ).first();

      // Recent 10 transactions
      const recentTx = await env.DB.prepare(`
        SELECT p.*, c.full_name AS client_name, c.client_reference, b.name AS branch_name
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        WHERE p.is_demo=? ${branchFilter}
        ORDER BY p.created_at DESC
        LIMIT 10
      `).bind(isDemo, ...branchBinds).all();

      return json({
        is_demo: Boolean(isDemo),
        demo_mode_enabled: demoEnabled(env),
        summary: {
          total_verified_ngn: fromKobo(totalVerifiedKobo),
          total_verified_kobo: totalVerifiedKobo,
          verified_count: totalVerifiedRow ? totalVerifiedRow.count : 0,
          today_verified_ngn: fromKobo(todayRow ? todayRow.today_kobo : 0),
          today_verified_kobo: todayRow ? todayRow.today_kobo : 0,
          month_verified_ngn: fromKobo(monthRow ? monthRow.month_kobo : 0),
          month_verified_kobo: monthRow ? monthRow.month_kobo : 0,
          pending_count: pendingRow ? pendingRow.count : 0,
          pending_ngn: fromKobo(pendingRow ? pendingRow.pending_kobo : 0),
          failed_count: failedRow ? failedRow.count : 0,
          failed_ngn: fromKobo(failedRow ? failedRow.failed_kobo : 0),
          refunds_count: refundsRow ? refundsRow.count : 0,
          refunds_ngn: fromKobo(refundsRow ? refundsRow.refunds_kobo : 0),
          outstanding_client_balances_ngn: fromKobo(outstandingBalancesKobo),
          outstanding_client_balances_kobo: outstandingBalancesKobo
        },
        wema_integration: {
          provider: "ALAT by Wema Bank",
          status: wemaConfig ? wemaConfig.status : "Not configured",
          environment: wemaConfig ? wemaConfig.environment : "sandbox",
          updated_at: wemaConfig ? wemaConfig.updated_at : null
        },
        recent_transactions: recentTx.results
      });
    }

    // List & Filter Transactions
    if (path === "/api/finance/transactions" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const q = url.searchParams.get("q") || "";
      const status = url.searchParams.get("status");
      const branchId = url.searchParams.get("branch_id");
      const clientId = url.searchParams.get("client_id");
      const propertyId = url.searchParams.get("property_id");
      const marketerId = url.searchParams.get("marketer_id");
      const dateFrom = url.searchParams.get("date_from");
      const dateTo = url.searchParams.get("date_to");
      const isDemo = url.searchParams.get("demo") === "1" ? 1 : 0;
      if (isDemo && !demoEnabled(env)) return json({ error: "Demo mode is disabled in this environment" }, 403);
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
      const offset = (page - 1) * limit;

      let where = ["p.is_demo = ?"];
      const binds = [isDemo];
      if (url.searchParams.get("include_test") !== "1") {
        where.push("COALESCE(p.is_internal_test,0)=0", "COALESCE(p.is_archived,0)=0");
      }

      // Role scoping
      if (actor.role_name === "Branch Manager") {
        where.push("c.assigned_branch_id = ?");
        binds.push(actor.branch_id);
      } else if (actor.role_name === "Team Lead") {
        where.push("(c.team_lead_id = ? OR c.original_marketer_id = ?)");
        binds.push(actor.id, actor.id);
      } else if (actor.role_name === "Marketer") {
        where.push("(c.original_marketer_id = ? OR c.created_by = ?)");
        binds.push(actor.id, actor.id);
      }

      if (q) {
        where.push("(p.transaction_ref LIKE ? OR c.full_name LIKE ? OR c.client_reference LIKE ?)");
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (status) { where.push("p.status = ?"); binds.push(status); }
      if (branchId) { where.push("c.assigned_branch_id = ?"); binds.push(branchId); }
      if (clientId) { where.push("p.client_id = ?"); binds.push(clientId); }
      if (propertyId) { where.push("p.property_id = ?"); binds.push(propertyId); }
      if (marketerId) { where.push("c.original_marketer_id = ?"); binds.push(marketerId); }
      if (dateFrom) { where.push("date(COALESCE(p.verified_at, p.created_at)) >= date(?)"); binds.push(dateFrom); }
      if (dateTo) { where.push("date(COALESCE(p.verified_at, p.created_at)) <= date(?)"); binds.push(dateTo); }

      const whereSql = "WHERE " + where.join(" AND ");
      const sql = `
        SELECT p.*, c.full_name AS client_name, c.client_reference,
               b.name AS branch_name, m.full_name AS marketer_name,
               prop.title AS property_title, prop.reference AS property_reference,
               r.id AS receipt_id, r.receipt_ref
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN users m ON m.id=c.original_marketer_id
        LEFT JOIN properties prop ON prop.id=p.property_id
        LEFT JOIN receipts r ON r.payment_id=p.id
        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM payments p JOIN clients c ON c.id=p.client_id ${whereSql}`).bind(...binds).first();

      return json({
        transactions: results,
        pagination: { page, limit, total: countRow ? countRow.c : 0 }
      });
    }

    // Record Manual Payment
    if (path === "/api/finance/payments" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const body = await request.json();
      const { client_id, property_id, amount, method, transaction_ref, is_demo, currency } = body || {};
      if (!client_id || !amount || !method) {
        return json({ error: "Client ID, amount, and payment method are required" }, 400);
      }
      const requestedCurrency = String(currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      if (requestedCurrency !== SUPPORTED_CURRENCY) {
        return json({ error: "Only NGN payments are supported" }, 400);
      }
      const amountKobo = toKobo(amount);
      if (!Number.isFinite(amountKobo) || amountKobo <= 0) return json({ error: "Amount must be a positive NGN value" }, 400);
      const demoFlag = isTruthy(is_demo) ? 1 : 0;
      if (demoFlag && !demoEnabled(env)) return json({ error: "Demo payments are disabled in this environment" }, 403);

      const client = await env.DB.prepare("SELECT id, full_name, client_reference, assigned_branch_id, agreed_purchase_price FROM clients WHERE id=? AND is_deleted=0").bind(client_id).first();
      if (!client) return json({ error: "Client not found" }, 404);
      if (actor.role_name === "Branch Manager" && client.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (isDemoClientReference(client.client_reference) && !demoFlag) {
        return json({ error: "Demo clients can only receive demo payments" }, 400);
      }

      const txRef = String(transaction_ref || ("TX-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase())).trim();
      if (!txRef) return json({ error: "Transaction reference is required" }, 400);
      const dup = await env.DB.prepare("SELECT id FROM payments WHERE transaction_ref=?").bind(txRef).first();
      if (dup) return json({ error: "Duplicate transaction reference" }, 409);

      const kobo = amountKobo;

      let res;
      try {
        const providerKey = body.provider ? String(body.provider) : await getDefaultPaymentProvider(env);
        res = await env.DB.prepare(`
          INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference, payment_mode, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now'))
        `).bind(client_id, property_id || null, txRef, fromKobo(kobo), SUPPORTED_CURRENCY, method, kobo, demoFlag, providerKey, txRef, getPaymentMode(env)).run();
      } catch (err) {
        if (String(err && err.message || "").toUpperCase().includes("UNIQUE")) {
          return json({ error: "Duplicate transaction reference" }, 409);
        }
        throw err;
      }
      const newId = res.meta.last_row_id;

      await audit(env, actor.id, "payment.record", "payment", String(newId), { client_id, amount: fromKobo(kobo), currency: SUPPORTED_CURRENCY, method, txRef, is_demo: demoFlag }, client.assigned_branch_id);

      // Notify client in-app of pending payment
      await createNotification(env, {
        clientId: client.id,
        type: "payment.pending",
        title: "Payment Received (Pending Verification)",
        message: `Your payment of ${formatNGN(kobo)} via ${method} (Ref: ${txRef}) has been recorded and is currently awaiting verification.`,
        metadata: { payment_id: newId, transaction_ref: txRef }
      });

      return json({ ok: true, id: newId, transaction_ref: txRef });
    }

    // Verify Payment (Idempotent)
    const verifyMatch = path.match(/^\/api\/finance\/payments\/(\d+)\/verify$/);
    if (verifyMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden: Only Managing Director or Finance Officer can verify payments" }, 403);
      }

      const paymentId = verifyMatch[1];
      const payment = await env.DB.prepare(
        "SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price, c.assigned_branch_id AS client_branch_id, prop.title AS property_title, prop.reference AS property_reference FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN properties prop ON prop.id=p.property_id WHERE p.id=?"
      ).bind(paymentId).first();
      if (!payment) return json({ error: "Payment not found" }, 404);
      if (payment.is_demo && !demoEnabled(env)) {
        return json({ error: "Demo payments cannot be verified in this environment" }, 403);
      }
      if (String(payment.currency || SUPPORTED_CURRENCY).toUpperCase() !== SUPPORTED_CURRENCY) {
        return json({ error: "Only NGN payments can be verified" }, 409);
      }

      // Idempotency: do not re-process already verified payment
      if (payment.status === "verified") {
        const existing = await env.DB.prepare("SELECT receipt_ref FROM receipts WHERE payment_id=?").bind(payment.id).first();
        return json({ ok: true, already_verified: true, payment_id: payment.id, receipt_ref: existing ? existing.receipt_ref : null });
      }
      if (payment.status !== "pending") {
        return json({ error: `Only pending payments can be verified (current status: ${payment.status})` }, 409);
      }

      const now = new Date().toISOString();
      const upd = await env.DB.prepare("UPDATE payments SET status='verified', verified_at=?, verified_by=? WHERE id=? AND status='pending'")
        .bind(now, actor.id, paymentId).run();
      if (upd.meta && Number(upd.meta.changes) === 0) {
        return json({ ok: true, already_verified: true, payment_id: payment.id });
      }
      await stampPaymentAttribution(env, payment.id, payment.client_id);

      // Compute remaining balance after payment in kobo (demo and live ledgers are isolated)
      const agreedKobo = toKobo(payment.agreed_purchase_price || 0);
      const totalVerifiedRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_kobo), 0) AS total_kobo FROM payments WHERE client_id=? AND status='verified' AND is_demo=? AND currency=?"
      ).bind(payment.client_id, payment.is_demo, SUPPORTED_CURRENCY).first();
      const totalVerifiedKobo = totalVerifiedRow ? Number(totalVerifiedRow.total_kobo) : 0;
      const remainingKobo = Math.max(0, agreedKobo - totalVerifiedKobo);

      // Generate Receipt (one per payment, enforced by the UNIQUE(payment_id) index)
      let receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      if (!receipt) {
        const receiptRef = newReceiptRef(payment.is_demo);
        await env.DB.prepare(`
          INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo, remaining_balance_kobo, is_demo, created_at)
          VALUES (?, ?, ?, ?, 'NGN', ?, ?, ?, datetime('now'))
        `).bind(payment.id, payment.client_id, receiptRef, fromKobo(payment.amount_kobo || toKobo(payment.amount)), payment.amount_kobo || toKobo(payment.amount), remainingKobo, payment.is_demo).run();
        receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      }
      const receiptRef = receipt.receipt_ref;

      // Persist the downloadable PDF in Cloudflare R2
      await ensureReceiptPdf(env, {
        ...payment,
        ...receipt,
        payment_status: "verified",
        payment_date: now
      }).catch(() => {});

      await audit(env, actor.id, "payment.verify", "payment", String(paymentId), {
        transaction_ref: payment.transaction_ref,
        amount: fromKobo(payment.amount_kobo || toKobo(payment.amount)),
        receipt_ref: receiptRef
      }, payment.client_branch_id);

      // Send in-app notification to client
      await createNotification(env, {
        clientId: payment.client_id,
        type: "payment.verified",
        title: "Payment Successfully Verified",
        message: `Your payment of ${formatNGN(payment.amount_kobo || toKobo(payment.amount))} has been verified. Official Receipt #${receiptRef} is now available in your Receipts tab.`,
        metadata: { payment_id: payment.id, receipt_ref: receiptRef, transaction_ref: payment.transaction_ref }
      });
      await notifyPaymentVerified(env, payment, actor.id);
      await sendPaymentReceivedSms(env, payment.id);
      await autoGenerateCommissionForPayment(env, payment);

      return json({ ok: true, receipt_ref: receiptRef, remaining_balance_kobo: remainingKobo });
    }

    // Payment Financial Adjustment (Reversal / Refund)
    const adjustMatch = path.match(/^\/api\/finance\/payments\/(\d+)\/adjust$/);
    if (adjustMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden: Only Managing Director or Finance Officer can adjust payments" }, 403);
      }

      const paymentId = adjustMatch[1];
      const body = await request.json();
      const { adjustment_type, reason } = body || {};
      if (!adjustment_type || !reason) {
        return json({ error: "Adjustment type ('reversal' or 'refund') and reason are required" }, 400);
      }
      if (!["reversal", "refund"].includes(adjustment_type)) {
        return json({ error: "Adjustment type must be 'reversal' or 'refund'" }, 400);
      }

      const payment = await env.DB.prepare("SELECT p.*, c.assigned_branch_id AS client_branch_id FROM payments p JOIN clients c ON c.id=p.client_id WHERE p.id=?").bind(paymentId).first();
      if (!payment) return json({ error: "Payment not found" }, 404);
      if (payment.is_demo && !demoEnabled(env)) return json({ error: "Demo payments are disabled in this environment" }, 403);
      if (payment.status !== "verified") {
        return json({ error: `Only verified payments can be adjusted (current status: ${payment.status})` }, 409);
      }

      const kobo = payment.amount_kobo || toKobo(payment.amount);
      const newStatus = adjustment_type === "refund" ? "refunded" : "reversed";

      const upd = await env.DB.prepare("UPDATE payments SET status=? WHERE id=? AND status='verified'").bind(newStatus, paymentId).run();
      if (upd.meta && Number(upd.meta.changes) === 0) {
        return json({ error: "Payment status changed concurrently; refresh and retry" }, 409);
      }
      await env.DB.prepare(`
        INSERT INTO financial_adjustments (payment_id, adjustment_type, amount_kobo, reason, authorized_by, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(paymentId, adjustment_type, kobo, reason, actor.id).run();

      await audit(env, actor.id, "payment.adjustment", "payment", String(paymentId), { adjustment_type, reason, amount_kobo: kobo }, payment.client_branch_id);
      await applyPaymentCommissionAdjustments(env, payment, adjustment_type, actor.id, reason);

      // Notify client
      await createNotification(env, {
        clientId: payment.client_id,
        type: adjustment_type === "refund" ? "payment.refunded" : "payment.reversed",
        title: `Payment ${adjustment_type === "refund" ? "Refunded" : "Reversed"}`,
        message: `Your payment of ${formatNGN(kobo)} (Ref: ${payment.transaction_ref}) has been marked as ${newStatus}. Reason: ${reason}.`,
        metadata: { payment_id: payment.id, adjustment_type }
      });

      return json({ ok: true, status: newStatus });
    }

    // Mark a pending payment as failed (bank rejection / abandoned transfer)
    const failMatch = path.match(/^\/api\/finance\/payments\/(\d+)\/fail$/);
    if (failMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden: Only Managing Director or Finance Officer can fail payments" }, 403);
      }
      const paymentId = failMatch[1];
      const body = await request.json().catch(() => ({}));
      const reason = (body && body.reason ? String(body.reason).trim() : "") || "Marked failed by finance review";
      const payment = await env.DB.prepare("SELECT p.*, c.assigned_branch_id AS client_branch_id FROM payments p JOIN clients c ON c.id=p.client_id WHERE p.id=?").bind(paymentId).first();
      if (!payment) return json({ error: "Payment not found" }, 404);
      if (payment.is_demo && !demoEnabled(env)) return json({ error: "Demo payments are disabled in this environment" }, 403);
      if (payment.status !== "pending") return json({ error: `Only pending payments can be marked failed (current status: ${payment.status})` }, 409);

      await env.DB.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").bind(paymentId).run();
      await audit(env, actor.id, "payment.failed", "payment", String(paymentId), {
        transaction_ref: payment.transaction_ref,
        amount_kobo: payment.amount_kobo || toKobo(payment.amount),
        reason
      }, payment.client_branch_id);
      await createNotification(env, {
        clientId: payment.client_id,
        type: "payment.failed",
        title: "Payment Could Not Be Verified",
        message: `Your payment of ${formatNGN(payment.amount_kobo || toKobo(payment.amount))} (Ref: ${payment.transaction_ref}) could not be verified. Reason: ${reason}. Please contact our finance team.`,
        metadata: { payment_id: payment.id, transaction_ref: payment.transaction_ref }
      });
      return json({ ok: true, status: "failed" });
    }

    // Multi-provider registry. Provider secrets are read from Worker secrets /
    // environment variables; this endpoint only manages non-secret settings.
    if (path === "/api/finance/providers" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const { results } = await env.DB.prepare(`
        SELECT provider_key, provider_name, status, environment, is_default, webhook_path, adapter_key,
               updated_at, CASE WHEN webhook_secret IS NULL OR webhook_secret='' THEN 0 ELSE 1 END AS has_db_secret
        FROM provider_configs ORDER BY is_default DESC, provider_key
      `).all();
      const alatSettings = await getAlatpaySettings(env);
      const providers = results.map(row => ({
        ...row,
        env_secret_configured: row.provider_key === "alatpay"
          ? Boolean(alatSettings.secret && alatSettings.businessId)
          : (row.provider_key === "paystack" ? Boolean(env.PAYSTACK_SECRET_KEY) : row.has_db_secret === 1),
        webhook_secret_configured: row.provider_key === "alatpay"
          ? Boolean(alatSettings.webhookSecret)
          : row.has_db_secret === 1,
        payment_mode: row.provider_key === "alatpay" ? alatSettings.mode : null,
        adapter_registered: Boolean(getPaymentProviderAdapter(row.adapter_key || row.provider_key))
      }));
      return json({
        providers,
        default_provider: await getDefaultPaymentProvider(env),
        adapters: Object.keys(PAYMENT_PROVIDER_ADAPTERS),
        payment_mode: getPaymentMode(env),
        alatpay_webhook_path: alatpayWebhookPath(env),
        alatpay_webhook_ready: Boolean(alatSettings.webhookSecret && alatSettings.secret && alatSettings.businessId)
      });
    }

    if (path === "/api/finance/providers" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const body = await request.json();
      const providerKey = String(body.provider_key || "").trim().toLowerCase();
      const adapter = getPaymentProviderAdapter(body.adapter_key || providerKey);
      if (!providerKey || !adapter) return json({ error: "Unknown provider adapter" }, 400);
      const existing = await env.DB.prepare("SELECT * FROM provider_configs WHERE provider_key=?").bind(providerKey).first();
      if (!existing) return json({ error: "Provider is not registered" }, 404);
      const validStatuses = ["Not configured", "Awaiting onboarding", "Awaiting credentials", "Configured", "Active"];
      if (body.status !== undefined && !validStatuses.includes(body.status)) {
        return json({ error: "Invalid provider status" }, 400);
      }
      if (body.environment !== undefined && !["sandbox", "production"].includes(body.environment)) {
        return json({ error: "Invalid environment" }, 400);
      }
      await env.DB.prepare(`
        UPDATE provider_configs SET
          status=COALESCE(?, status), environment=COALESCE(?, environment),
          webhook_path=COALESCE(?, webhook_path), adapter_key=COALESCE(?, adapter_key),
          updated_by=?, updated_at=datetime('now')
        WHERE provider_key=?
      `).bind(
        body.status || null, body.environment || null,
        body.webhook_path || adapter.webhookPath || null,
        body.adapter_key || providerKey, actor.id, providerKey
      ).run();
      if (isTruthy(body.is_default)) {
        await env.DB.prepare("UPDATE provider_configs SET is_default=0").run();
        await env.DB.prepare("UPDATE provider_configs SET is_default=1 WHERE provider_key=?").bind(providerKey).run();
      }
      await audit(env, actor.id, "provider_config.update", "provider_config", providerKey, {
        status: body.status || null, environment: body.environment || null, is_default: isTruthy(body.is_default)
      });
      return json({ ok: true, provider_key: providerKey, default_provider: await getDefaultPaymentProvider(env) });
    }

    // 8. ALAT by Wema Bank Integration Configuration
    if (path === "/api/finance/provider-config" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const conf = await env.DB.prepare("SELECT provider_key, provider_name, status, environment, config_json, updated_by, updated_at, webhook_secret FROM provider_configs WHERE provider_key='wema_alat'").first();
      const safe = conf ? {
        provider_key: conf.provider_key,
        provider_name: conf.provider_name,
        status: conf.status,
        environment: conf.environment,
        // Provider metadata may contain onboarding identifiers; Branch Managers
        // get a read-only operational view without it.
        config_json: actor.role_name === "Branch Manager" ? null : conf.config_json,
        updated_by: conf.updated_by,
        updated_at: conf.updated_at,
        has_webhook_secret: Boolean(conf.webhook_secret)
      } : null;

      let virtualAccounts = [];
      if (actor.role_name === "Branch Manager") {
        const { results } = await env.DB.prepare(`
          SELECT v.*, c.full_name AS client_name, c.client_reference, b.name AS branch_name
          FROM virtual_accounts v JOIN clients c ON c.id=v.client_id LEFT JOIN branches b ON b.id=c.assigned_branch_id
          WHERE c.assigned_branch_id=?
        `).bind(actor.branch_id).all();
        virtualAccounts = results;
      } else {
        const { results } = await env.DB.prepare(`
          SELECT v.*, c.full_name AS client_name, c.client_reference, b.name AS branch_name
          FROM virtual_accounts v JOIN clients c ON c.id=v.client_id LEFT JOIN branches b ON b.id=c.assigned_branch_id
          ORDER BY v.id DESC
        `).all();
        virtualAccounts = results;
      }

      let webhookEvents;
      if (actor.role_name === "Branch Manager") {
        const scoped = await env.DB.prepare(`
          SELECT we.id, we.event_id, we.event_type, we.transaction_ref, we.result, we.created_at, we.processed_at
          FROM webhook_events we
          WHERE we.transaction_ref IN (
            SELECT p.transaction_ref FROM payments p
            JOIN clients c ON c.id=p.client_id
            WHERE c.assigned_branch_id=?
          )
          ORDER BY we.id DESC LIMIT 20
        `).bind(actor.branch_id).all();
        webhookEvents = scoped.results;
      } else {
        const all = await env.DB.prepare(
          "SELECT id, event_id, event_type, transaction_ref, result, created_at, processed_at FROM webhook_events ORDER BY id DESC LIMIT 20"
        ).all();
        webhookEvents = all.results;
      }

      return json({
        config: safe || {
          provider_key: "wema_alat",
          provider_name: "ALAT by Wema Bank",
          status: "Not configured",
          environment: "sandbox",
          has_webhook_secret: false
        },
        virtual_accounts: virtualAccounts,
        webhook_events: webhookEvents,
        webhook_url: "/api/webhooks/wema-alat",
        integration_interfaces: {
          virtual_accounts: { status: safe && safe.status === "Active" ? "Active" : "Awaiting provider", mode: "provider-issued only" },
          payment_verification: { status: safe && ["Configured", "Active"].includes(safe.status) ? "Ready" : "Awaiting credentials" },
          webhook_processing: { status: safe && ["Configured", "Active"].includes(safe.status) ? "Ready" : "Awaiting credentials" },
          reconciliation: { status: safe && ["Configured", "Active"].includes(safe.status) ? "Ready" : "Awaiting credentials" }
        }
      });
    }

    if (path === "/api/finance/provider-config" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const body = await request.json();
      const { status, environment, webhook_secret, config_json } = body || {};
      const validStatuses = ["Not configured", "Awaiting onboarding", "Awaiting credentials", "Configured", "Active"];
      if (status && !validStatuses.includes(status)) {
        return json({ error: "Invalid provider status" }, 400);
      }
      if (environment && !["sandbox", "production"].includes(environment)) {
        return json({ error: "Invalid environment" }, 400);
      }
      const current = await env.DB.prepare(
        "SELECT status, webhook_secret FROM provider_configs WHERE provider_key='wema_alat'"
      ).first();
      const nextStatus = status || (current ? current.status : "Not configured");
      const nextSecret = webhook_secret || (current ? current.webhook_secret : null);
      if (["Configured", "Active"].includes(nextStatus) && !nextSecret) {
        return json({ error: "A webhook secret is required before the provider can be marked Configured or Active" }, 400);
      }

      await env.DB.prepare(`
        UPDATE provider_configs
        SET status = COALESCE(?, status),
            environment = COALESCE(?, environment),
            webhook_secret = COALESCE(?, webhook_secret),
            config_json = COALESCE(?, config_json),
            updated_by = ?,
            updated_at = datetime('now')
        WHERE provider_key = 'wema_alat'
      `).bind(status || null, environment || null, webhook_secret || null, config_json ? JSON.stringify(config_json) : null, actor.id).run();

      await audit(env, actor.id, "provider_config.update", "provider_config", "wema_alat", { status, environment, secret_rotated: Boolean(webhook_secret) });
      return json({ ok: true, message: "ALAT by Wema Bank configuration updated." });
    }

    // ALATPay webhook: trust is established by re-querying ALATPay with the
    // server-side secret before any payment is verified.
    // ALATPay webhook: documented x-signature validation (HMAC-SHA256, base64)
    // and transaction-status re-query before any credit.
    const alatpayWebhookMatch = path.match(/^\/api\/webhooks\/alatpay(?:\/(test|live))?$/);
    if (alatpayWebhookMatch && request.method === "POST") {
      const currentMode = getPaymentMode(env);
      const routeMode = alatpayWebhookMatch[1] || currentMode;
      if (routeMode !== currentMode) {
        await audit(env, null, "webhook.rejected", "alatpay", null, { reason: "mode_mismatch", route_mode: routeMode, current_mode: currentMode });
        return json({ error: "Webhook mode does not match this deployment" }, 404);
      }
      const settings = await getAlatpaySettings(env, routeMode);
      if (!settings.webhookSecret) {
        await audit(env, null, "webhook.rejected", "alatpay", null, { reason: "webhook_secret_missing", mode: routeMode });
        return json({ error: `ALATPay ${routeMode} webhook secret is not configured` }, 503);
      }
      const rawText = await request.text();
      let body;
      try { body = rawText ? JSON.parse(rawText) : null; } catch { body = null; }
      if (!body) return json({ error: "Invalid JSON payload" }, 400);
      const supplied = request.headers.get("x-signature") || "";
      const expected = await hmacBase64(settings.webhookSecret, rawText, "SHA-256");
      if (!secureCompare(supplied, expected)) {
        await audit(env, null, "webhook.rejected", "alatpay", null, { reason: "bad_signature", mode: routeMode });
        return json({ error: "Invalid webhook signature" }, 401);
      }

      const envelope = body.Value || body;
      const data = envelope.Data || body.Data || body.data || body;
      const transactionId = data.Id || data.id || data.TransactionId || data.transactionId || body.transactionId;
      const statusText = String(data.Status || data.status || data.TransactionStatus || "").trim().toLowerCase();
      const payloadAmountKobo = data.Amount !== undefined ? toKobo(data.Amount)
        : (data.amount !== undefined ? toKobo(data.amount) : null);
      const currency = String(data.Currency || data.currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      const orderId = data.OrderId || data.orderId || data.OrderReference || data.order_reference || null;
      const accountNumber = data.NgnVirtualBankAccountNumber || data.ngnVirtualBankAccountNumber ||
        data.VirtualBankAccountNumber || data.virtualBankAccountNumber || null;
      if (!transactionId) return json({ error: "Missing ALATPay transaction ID" }, 400);
      if (!Number.isInteger(payloadAmountKobo) || payloadAmountKobo <= 0) return json({ error: "Invalid ALATPay amount" }, 400);
      if (currency !== SUPPORTED_CURRENCY) return json({ error: "Unsupported ALATPay currency" }, 409);

      const eventId = `alatpay:${routeMode}:${transactionId}:${statusText}:${payloadAmountKobo}`;
      const seen = await env.DB.prepare("SELECT id, result FROM webhook_events WHERE provider='alatpay' AND event_id=?")
        .bind(eventId).first();
      if (seen && !["pending", "verification_failed"].includes(seen.result)) {
        return json({ ok: true, already_processed: true, result: seen.result });
      }
      const recordEvent = async (result, reference, paymentId, extra = {}) => {
        await env.DB.prepare(`
          INSERT INTO webhook_events (provider, event_id, event_type, transaction_ref, payload, result, processed_at, payment_mode)
          VALUES ('alatpay', ?, ?, ?, ?, ?, datetime('now'), ?)
          ON CONFLICT(event_id) DO UPDATE SET result=excluded.result, processed_at=excluded.processed_at,
            payload=excluded.payload, payment_mode=excluded.payment_mode
        `).bind(eventId, statusText || null, reference || orderId || transactionId,
          JSON.stringify({ transaction_id: transactionId, order_id: orderId, amount: data.Amount ?? data.amount, status: statusText, ...extra }).slice(0, 4000),
          result, routeMode).run().catch(() => {});
        await audit(env, null, "webhook.received", "payment", paymentId ? String(paymentId) : (reference || transactionId), {
          provider: "alatpay", mode: routeMode, event_id: eventId, result
        });
      };

      let remote;
      try {
        remote = await alatpayRequest(env, `/alatpaytransaction/api/v1/transactions/${encodeURIComponent(transactionId)}`, { mode: routeMode });
      } catch (error) {
        await recordEvent("verification_failed", orderId || transactionId, null);
        return json({ error: "Unable to verify ALATPay transaction status" }, error.status || 503);
      }
      const remoteData = remote.data || remote;
      const remoteStatus = String(remoteData.Status || remoteData.status || "").trim().toLowerCase();
      const remoteAmountKobo = remoteData.Amount !== undefined ? toKobo(remoteData.Amount)
        : (remoteData.amount !== undefined ? toKobo(remoteData.amount) : null);
      const remoteCurrency = String(remoteData.Currency || remoteData.currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      const remoteOrderId = remoteData.OrderId || remoteData.orderId || orderId;
      const remoteAccount = remoteData.NgnVirtualBankAccountNumber || remoteData.ngnVirtualBankAccountNumber || accountNumber;
      const remoteTransactionId = remoteData.Id || remoteData.id || transactionId;
      if (!Number.isInteger(remoteAmountKobo) || remoteAmountKobo <= 0) {
        await recordEvent("rejected", remoteOrderId || transactionId, null, { reason: "invalid_remote_amount" });
        return json({ error: "ALATPay returned an invalid amount" }, 409);
      }
      if (remoteAmountKobo !== payloadAmountKobo) {
        await recordEvent("amount_mismatch", remoteOrderId || transactionId, null, { remote_amount: remoteAmountKobo, payload_amount: payloadAmountKobo });
        return json({ error: "ALATPay webhook amount does not match provider status" }, 409);
      }
      if (remoteCurrency !== SUPPORTED_CURRENCY) {
        await recordEvent("currency_mismatch", remoteOrderId || transactionId, null);
        return json({ error: "Unsupported ALATPay currency" }, 409);
      }
      if (remoteOrderId && orderId && String(remoteOrderId) !== String(orderId)) {
        await recordEvent("reference_mismatch", orderId, null, { remote_order_id: remoteOrderId });
        return json({ error: "ALATPay reference does not match the webhook" }, 409);
      }

      const reference = orderId || remoteOrderId || transactionId;
      let payment = await env.DB.prepare(`
        SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price,
               c.assigned_branch_id, prop.title AS property_title
        FROM payments p JOIN clients c ON c.id=p.client_id
        LEFT JOIN properties prop ON prop.id=p.property_id
        WHERE p.provider='alatpay' AND p.payment_mode=? AND
          (p.transaction_ref=? OR p.provider_reference=? OR p.transaction_ref=?)
        ORDER BY p.id DESC LIMIT 1
      `).bind(routeMode, String(reference), String(remoteTransactionId), String(transactionId)).first();
      let staticWallet = null;
      if (!payment && remoteAccount) {
        staticWallet = await env.DB.prepare(`
          SELECT * FROM client_static_wallets
          WHERE account_number=? AND payment_mode=? AND status='active'
          LIMIT 1
        `).bind(String(remoteAccount), routeMode).first();
        if (staticWallet) {
          const client = await env.DB.prepare("SELECT id, interested_property_id FROM clients WHERE id=? AND is_deleted=0")
            .bind(staticWallet.client_id).first();
          if (client) {
            const txRef = orderId || `ALATPAY-${transactionId}`;
            const inserted = await env.DB.prepare(`
              INSERT INTO payments
                (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo,
                 is_demo, provider, provider_reference, provider_account_number, payment_mode)
              VALUES (?, ?, ?, ?, 'NGN', 'ALATPay Static Wallet', 'pending', ?, 0, 'alatpay', ?, ?, ?)
            `).bind(client.id, client.interested_property_id || null, String(txRef), fromKobo(remoteAmountKobo),
              remoteAmountKobo, String(remoteTransactionId), String(remoteAccount), routeMode).run();
            payment = await env.DB.prepare(`
              SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price,
                     c.assigned_branch_id, prop.title AS property_title
              FROM payments p JOIN clients c ON c.id=p.client_id
              LEFT JOIN properties prop ON prop.id=p.property_id
              WHERE p.id=?
            `).bind(inserted.meta.last_row_id).first();
          }
        }
      }
      if (!payment) {
        await recordEvent("unmatched", reference, null);
        return json({ ok: true, status: "logged", matched: false }, 202);
      }
      const isStatic = Boolean(payment.provider_account_number || staticWallet);
      if (payment.provider_account_number && remoteAccount && String(payment.provider_account_number) !== String(remoteAccount)) {
        await recordEvent("account_mismatch", reference, payment.id, {
          expected_account: payment.provider_account_number, remote_account: remoteAccount
        });
        return json({ error: "ALATPay account number does not match the recorded payment" }, 409);
      }
      const expectedAmountKobo = Number(payment.amount_kobo || toKobo(payment.amount));
      if (!isStatic && expectedAmountKobo !== remoteAmountKobo) {
        await recordEvent("amount_mismatch", reference, payment.id, { expected_amount: expectedAmountKobo, remote_amount: remoteAmountKobo });
        return json({ error: "ALATPay amount does not match the pending payment" }, 409);
      }
      if (isStatic && expectedAmountKobo !== remoteAmountKobo && payment.status !== "pending") {
        await recordEvent("amount_mismatch", reference, payment.id, { existing_amount: expectedAmountKobo, remote_amount: remoteAmountKobo });
        return json({ error: "ALATPay amount does not match the recorded static-wallet payment" }, 409);
      }
      if (["pending", "processing", "initiated", "new"].includes(remoteStatus)) {
        await recordEvent("pending", reference, payment.id, { remote_status: remoteStatus });
        return json({ ok: true, status: "pending", payment_id: payment.id }, 202);
      }
      if (["failed", "cancelled", "canceled", "declined"].includes(remoteStatus)) {
        await env.DB.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").bind(payment.id).run();
        await recordEvent("failed", reference, payment.id, { remote_status: remoteStatus });
        return json({ ok: true, status: "failed", payment_id: payment.id }, 202);
      }
      if (["reversed", "reversal", "refunded", "refund"].includes(remoteStatus)) {
        await recordEvent("reversed", reference, payment.id, { remote_status: remoteStatus });
        return json({ ok: true, status: "reversed", credited: false, payment_id: payment.id }, 202);
      }
      if (!SUCCESS_EVENT_STATUSES.has(remoteStatus)) {
        await recordEvent("rejected", reference, payment.id, { remote_status: remoteStatus });
        return json({ error: `ALATPay transaction is not successful (${remoteStatus || "unknown"})` }, 409);
      }
      if (payment.status === "verified") {
        await recordEvent("duplicate", reference, payment.id);
        return json({ ok: true, already_processed: true });
      }
      if (payment.status !== "pending") {
        await recordEvent("rejected", reference, payment.id, { payment_status: payment.status });
        return json({ error: `Payment cannot be verified from status ${payment.status}` }, 409);
      }

      const now = new Date().toISOString();
      const updated = await env.DB.prepare(`
        UPDATE payments SET status='verified', verified_at=?, verified_by=NULL, provider='alatpay',
          provider_reference=?, provider_account_number=?, payment_mode=? WHERE id=? AND status='pending'
      `).bind(now, String(remoteTransactionId), remoteAccount ? String(remoteAccount) : null, routeMode, payment.id).run();
      if (updated.meta && Number(updated.meta.changes) === 0) {
        await recordEvent("duplicate", reference, payment.id);
        return json({ ok: true, already_processed: true });
      }
      await stampPaymentAttribution(env, payment.id, payment.client_id);
      const totalRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(amount_kobo),0) AS total_kobo FROM payments
        WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
      `).bind(payment.client_id).first();
      const remainingKobo = Math.max(0, toKobo(payment.agreed_purchase_price || 0) - Number(totalRow ? totalRow.total_kobo : 0));
      let receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      if (!receipt) {
        const receiptRef = newReceiptRef(false);
        await env.DB.prepare(`
          INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo, remaining_balance_kobo, is_demo, created_at)
          VALUES (?, ?, ?, ?, 'NGN', ?, ?, 0, datetime('now'))
        `).bind(payment.id, payment.client_id, receiptRef, fromKobo(remoteAmountKobo), remoteAmountKobo, remainingKobo).run();
        receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      }
      await ensureReceiptPdf(env, { ...payment, ...receipt, payment_status: "verified", payment_date: now }).catch(() => {});
      await env.DB.prepare("UPDATE virtual_accounts SET account_status='used', updated_at=datetime('now') WHERE order_id=? AND payment_mode=?")
        .bind(String(orderId || ""), routeMode).run().catch(() => {});
      await recordEvent("verified", reference, payment.id);
      await createNotification(env, {
        clientId: payment.client_id,
        type: "payment.verified",
        title: "Payment Successfully Verified",
        message: `Your ALATPay payment of ${formatNGN(remoteAmountKobo)} has been verified. Official Receipt #${receipt.receipt_ref} is now available.`,
        metadata: { payment_id: payment.id, receipt_ref: receipt.receipt_ref, order_id: reference, source: "alatpay", mode: routeMode }
      });
      await notifyPaymentVerified(env, payment, null);
      await sendPaymentReceivedSms(env, payment.id);
      await autoGenerateCommissionForPayment(env, payment);
      return json({ ok: true, status: "verified", provider: "alatpay", mode: routeMode, receipt_ref: receipt.receipt_ref });
    }

    // ALAT by Wema Bank Webhook Receiver (idempotent, signature-gated)
    if (path === "/api/webhooks/wema-alat" && request.method === "POST") {
      const conf = await env.DB.prepare("SELECT status, webhook_secret FROM provider_configs WHERE provider_key='wema_alat'").first();
      if (!conf || !["Configured", "Active"].includes(conf.status)) {
        return json({ error: "Wema ALAT integration is not configured" }, 503);
      }
      if (!conf.webhook_secret) {
        await audit(env, null, "webhook.rejected", "wema_alat", null, { reason: "missing_secret" });
        return json({ error: "Webhook verification is not configured" }, 503);
      }
      const supplied = request.headers.get("X-Webhook-Secret") || "";
      if (!secureCompare(supplied, conf.webhook_secret)) {
        await audit(env, null, "webhook.rejected", "wema_alat", null, { reason: "bad_signature" });
        return json({ error: "Invalid webhook signature" }, 401);
      }

      const body = await request.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON payload" }, 400);
      const { event, data } = body || {};
      const txRef = data?.transaction_reference || data?.tx_ref;
      const amountKobo = data?.amount_kobo !== undefined
        ? Number(data.amount_kobo)
        : (data?.amount !== undefined ? toKobo(data.amount) : null);
      const currency = String(data?.currency || body.currency || SUPPORTED_CURRENCY).trim().toUpperCase();
      const statusText = String(data?.status || body.status || event || "").trim().toLowerCase();
      const isSuccess = SUCCESS_EVENT_STATUSES.has(statusText);
      const eventId = String(body.id || body.event_id || data?.event_id || `${txRef}:${statusText}:${amountKobo || 0}`);

      if (!txRef) return json({ error: "Missing transaction reference" }, 400);

      // Replay protection: a provider event id is processed at most once.
      const seen = await env.DB.prepare("SELECT id, result FROM webhook_events WHERE event_id=?").bind(eventId).first();
      if (seen) return json({ ok: true, already_processed: true, result: seen.result });

      const recordEvent = async (result, paymentId) => {
        await env.DB.prepare(`
          INSERT INTO webhook_events (provider, event_id, event_type, transaction_ref, payload, result, processed_at)
          VALUES ('wema_alat', ?, ?, ?, ?, ?, datetime('now'))
        `).bind(eventId, event || null, txRef, JSON.stringify(body).slice(0, 4000), result).run().catch(() => {});
        await audit(env, null, "webhook.received", "payment", paymentId ? String(paymentId) : txRef, { event_id: eventId, result });
      };

      if (isSuccess) {
        const eventTime = parseWebhookTimestamp(
          body.timestamp ?? body.created_at ?? body.event_time ??
          data?.timestamp ?? data?.created_at ?? data?.event_time
        );
        if (!eventTime) {
          await recordEvent("rejected", null);
          return json({ error: "Webhook event timestamp is required" }, 400);
        }
        const age = Date.now() - eventTime.getTime();
        if (age > WEBHOOK_MAX_AGE_MS) {
          await recordEvent("expired", null);
          return json({ error: "Webhook event has expired" }, 409);
        }
        if (age < -WEBHOOK_FUTURE_SKEW_MS) {
          await recordEvent("rejected", null);
          return json({ error: "Webhook event timestamp is in the future" }, 409);
        }
        if (amountKobo === null || !Number.isFinite(Number(amountKobo)) || Number(amountKobo) <= 0) {
          await recordEvent("rejected", null);
          return json({ error: "A positive payment amount is required" }, 400);
        }
        if (currency !== SUPPORTED_CURRENCY) {
          await recordEvent("currency_mismatch", null);
          return json({ error: "Unsupported payment currency" }, 409);
        }
      }

      const payment = await env.DB.prepare(
        "SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price, prop.title AS property_title, prop.reference AS property_reference FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN properties prop ON prop.id=p.property_id WHERE p.transaction_ref=?"
      ).bind(txRef).first();

      if (!payment) {
        await recordEvent("unmatched", null);
        return json({ ok: true, status: "logged", matched: false }, 202);
      }

      if (payment.is_demo && !demoEnabled(env)) {
        await recordEvent("rejected", payment.id);
        return json({ error: "Demo payment events are disabled in this environment" }, 403);
      }
      if (String(payment.currency || SUPPORTED_CURRENCY).toUpperCase() !== SUPPORTED_CURRENCY) {
        await recordEvent("currency_mismatch", payment.id);
        return json({ error: "Only NGN payments can be verified" }, 409);
      }
      if (!isSuccess) {
        await recordEvent("received", payment.id);
        return json({ ok: true, status: "ignored", matched: true }, 202);
      }
      if (Number(amountKobo) !== Number(payment.amount_kobo || toKobo(payment.amount))) {
        await recordEvent("amount_mismatch", payment.id);
        return json({ error: "Webhook amount does not match recorded payment" }, 409);
      }
      if (payment.status === "verified") {
        await recordEvent("duplicate", payment.id);
        return json({ ok: true, already_processed: true });
      }
      if (payment.status !== "pending") {
        await recordEvent("rejected", payment.id);
        return json({ error: `Payment cannot be verified from status ${payment.status}` }, 409);
      }

      const now = new Date().toISOString();
      const upd = await env.DB.prepare("UPDATE payments SET status='verified', verified_at=?, verified_by=NULL, provider='wema_alat', provider_reference=COALESCE(provider_reference, ?) WHERE id=? AND status='pending'")
        .bind(now, txRef, payment.id).run();
      if (upd.meta && Number(upd.meta.changes) === 0) {
        await recordEvent("duplicate", payment.id);
        return json({ ok: true, already_processed: true });
      }
      await stampPaymentAttribution(env, payment.id, payment.client_id);

      const totalRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_kobo), 0) AS total_kobo FROM payments WHERE client_id=? AND status='verified' AND is_demo=? AND currency=?"
      ).bind(payment.client_id, payment.is_demo, SUPPORTED_CURRENCY).first();
      const remainingKobo = Math.max(0, toKobo(payment.agreed_purchase_price || 0) - Number(totalRow ? totalRow.total_kobo : 0));

      let receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      if (!receipt) {
        const receiptRef = newReceiptRef(payment.is_demo);
        await env.DB.prepare(`
          INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo, remaining_balance_kobo, is_demo, created_at)
          VALUES (?, ?, ?, ?, 'NGN', ?, ?, ?, datetime('now'))
        `).bind(payment.id, payment.client_id, receiptRef, fromKobo(payment.amount_kobo || toKobo(payment.amount)), payment.amount_kobo || toKobo(payment.amount), remainingKobo, payment.is_demo).run();
        receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      }
      await ensureReceiptPdf(env, { ...payment, ...receipt, payment_status: "verified", payment_date: now }).catch(() => {});

      await createNotification(env, {
        clientId: payment.client_id,
        type: "payment.verified",
        title: "Payment Successfully Verified",
        message: `Your payment of ${formatNGN(payment.amount_kobo || toKobo(payment.amount))} has been verified. Official Receipt #${receipt.receipt_ref} is now available.`,
        metadata: { payment_id: payment.id, receipt_ref: receipt.receipt_ref, transaction_ref: payment.transaction_ref, source: "webhook" }
      });
      await notifyPaymentVerified(env, payment, null);
      await sendPaymentReceivedSms(env, payment.id);
      await autoGenerateCommissionForPayment(env, payment);

      await recordEvent("verified", payment.id);
      return json({ ok: true, status: "verified", receipt_ref: receipt.receipt_ref });
    }

    // Generic provider webhook: every additional provider only needs an adapter
    // and a provider_configs row. Payment, receipt, attribution and idempotency
    // logic lives here and is shared by all adapters.
    const providerWebhookMatch = path.match(/^\/api\/webhooks\/([a-z0-9_]+)$/);
    if (providerWebhookMatch && request.method === "POST") {
      const providerKey = providerWebhookMatch[1];
      const adapter = getPaymentProviderAdapter(providerKey);
      if (!adapter || ["alatpay", "wema_alat"].includes(providerKey)) {
        return json({ error: "Unknown payment provider" }, 404);
      }
      const rawText = await request.text();
      let body;
      try { body = rawText ? JSON.parse(rawText) : null; } catch { body = null; }
      if (!body) return json({ error: "Invalid JSON payload" }, 400);
      const recordEvent = async (eventId, eventType, reference, payload, result) => {
        await env.DB.prepare(`
          INSERT INTO webhook_events (provider, event_id, event_type, transaction_ref, payload, result, processed_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(providerKey, eventId, eventType || null, reference || null, JSON.stringify(payload || {}).slice(0, 4000), result).run().catch(() => {});
      };
      let verification;
      try {
        verification = await adapter.verifyWebhook(env, request, body, rawText);
      } catch (error) {
        await audit(env, null, "webhook.rejected", providerKey, null, { reason: error.message });
        return json({ error: error.message || "Webhook verification failed" }, error.status || 503);
      }
      const event = adapter.normalizeEvent(body, verification);
      if (!event.reference) return json({ error: "Missing transaction reference" }, 400);
      const seen = await env.DB.prepare("SELECT id, result FROM webhook_events WHERE provider=? AND event_id=?")
        .bind(providerKey, event.eventId).first();
      if (seen) return json({ ok: true, already_processed: true, result: seen.result });
      if (!event.success) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "received");
        return json({ ok: true, status: "ignored", matched: false }, 202);
      }
      if (event.requireTimestamp) {
        const eventTime = parseWebhookTimestamp(event.occurredAt);
        if (!eventTime) {
          await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "rejected");
          return json({ error: "Webhook event timestamp is required" }, 400);
        }
        const age = Date.now() - eventTime.getTime();
        if (age > WEBHOOK_MAX_AGE_MS) {
          await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "expired");
          return json({ error: "Webhook event has expired" }, 409);
        }
        if (age < -WEBHOOK_FUTURE_SKEW_MS) {
          await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "rejected");
          return json({ error: "Webhook event timestamp is in the future" }, 409);
        }
      }
      if (!Number.isInteger(event.amountKobo) || event.amountKobo <= 0) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "rejected");
        return json({ error: "A positive payment amount is required" }, 400);
      }
      if (event.currency !== SUPPORTED_CURRENCY) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "currency_mismatch");
        return json({ error: "Unsupported payment currency" }, 409);
      }
      let payment = await env.DB.prepare(
        "SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price FROM payments p JOIN clients c ON c.id=p.client_id WHERE p.transaction_ref=? OR (p.provider=? AND p.provider_reference=?) ORDER BY p.id DESC LIMIT 1"
      ).bind(String(event.reference), providerKey, String(event.providerReference || event.reference)).first();
      let client = null;
      let va = null;
      if (!payment) {
        va = await env.DB.prepare(
          "SELECT * FROM virtual_accounts WHERE order_id=? OR transaction_id=? OR provider_reference=? ORDER BY id DESC LIMIT 1"
        ).bind(String(event.reference), String(event.providerReference || event.reference), String(event.providerReference || event.reference)).first();
        if (!va) {
          await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "unmatched");
          return json({ ok: true, status: "logged", matched: false }, 202);
        }
        client = await env.DB.prepare(
          "SELECT id, client_reference, interested_property_id, agreed_purchase_price FROM clients WHERE id=? AND is_deleted=0"
        ).bind(va.client_id).first();
        if (!client) return json({ error: "Client not found" }, 404);
        await env.DB.prepare(`
          INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
          VALUES (?, ?, ?, ?, 'NGN', ?, 'pending', ?, 0, ?, ?)
        `).bind(
          client.id, client.interested_property_id || null, String(event.reference),
          fromKobo(event.amountKobo), adapter.name, event.amountKobo, providerKey,
          String(event.providerReference || event.reference)
        ).run();
        payment = await env.DB.prepare(
          "SELECT p.*, c.full_name AS client_name, c.client_reference, c.agreed_purchase_price FROM payments p JOIN clients c ON c.id=p.client_id WHERE p.transaction_ref=? ORDER BY p.id DESC LIMIT 1"
        ).bind(String(event.reference)).first();
      }
      if (!payment) return json({ error: "Unable to record provider payment" }, 500);
      if (payment.is_demo && !demoEnabled(env)) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "rejected");
        return json({ error: "Demo payment events are disabled in this environment" }, 403);
      }
      if (String(payment.currency || SUPPORTED_CURRENCY).toUpperCase() !== SUPPORTED_CURRENCY) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "currency_mismatch");
        return json({ error: "Only NGN payments can be verified" }, 409);
      }
      if (Number(event.amountKobo) !== Number(payment.amount_kobo || toKobo(payment.amount))) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "amount_mismatch");
        return json({ error: "Webhook amount does not match recorded payment" }, 409);
      }
      if (payment.status === "verified") {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "duplicate");
        return json({ ok: true, already_processed: true });
      }
      if (payment.status !== "pending") {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "rejected");
        return json({ error: `Payment cannot be verified from status ${payment.status}` }, 409);
      }
      const now = new Date().toISOString();
      const updated = await env.DB.prepare(
        "UPDATE payments SET status='verified', verified_at=?, verified_by=NULL, provider=?, provider_reference=COALESCE(provider_reference, ?) WHERE id=? AND status='pending'"
      ).bind(now, providerKey, String(event.providerReference || event.reference), payment.id).run();
      if (updated.meta && Number(updated.meta.changes) === 0) {
        await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "duplicate");
        return json({ ok: true, already_processed: true });
      }
      await stampPaymentAttribution(env, payment.id, payment.client_id);
      const totalRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_kobo),0) AS total_kobo FROM payments WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'"
      ).bind(payment.client_id).first();
      const remainingKobo = Math.max(0, toKobo(payment.agreed_purchase_price || 0) - Number(totalRow ? totalRow.total_kobo : 0));
      let receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      if (!receipt) {
        const receiptRef = newReceiptRef(false);
        await env.DB.prepare(`
          INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo, remaining_balance_kobo, is_demo, created_at)
          VALUES (?, ?, ?, ?, 'NGN', ?, ?, 0, datetime('now'))
        `).bind(payment.id, payment.client_id, receiptRef, fromKobo(event.amountKobo), event.amountKobo, remainingKobo).run();
        receipt = await env.DB.prepare("SELECT * FROM receipts WHERE payment_id=?").bind(payment.id).first();
      }
      await ensureReceiptPdf(env, {
        ...payment, ...receipt, payment_status: "verified", payment_date: now
      }).catch(() => {});
      if (va) {
        await env.DB.prepare("UPDATE virtual_accounts SET account_status='used', updated_at=datetime('now') WHERE id=?").bind(va.id).run();
      }
      await recordEvent(event.eventId, event.eventType, event.reference, event.payload, "verified");
      await createNotification(env, {
        clientId: payment.client_id,
        type: "payment.verified",
        title: "Payment Successfully Verified",
        message: `Your payment of ${formatNGN(event.amountKobo)} has been verified. Official Receipt #${receipt.receipt_ref} is now available.`,
        metadata: { payment_id: payment.id, receipt_ref: receipt.receipt_ref, provider: providerKey }
      });
      await notifyPaymentVerified(env, payment, null);
      await sendPaymentReceivedSms(env, payment.id);
      await autoGenerateCommissionForPayment(env, payment);
      await audit(env, null, "webhook.received", "payment", String(payment.id), {
        provider: providerKey, event_id: event.eventId, reference: event.reference, result: "verified"
      });
      return json({ ok: true, status: "verified", provider: providerKey, receipt_ref: receipt.receipt_ref });
    }

    // ALAT Transaction Reconciliation Interface
    if (path === "/api/finance/reconciliation/alatpay" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const result = await reconcileAlatpayPayments(env);
      await audit(env, actor.id, "provider.reconcile", "alatpay", null, result, null);
      return json({ ok: !result.error, ...result });
    }

    if (path === "/api/finance/reconciliation" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || !["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const body = await request.json();
      const { transactions } = body || {};
      if (!Array.isArray(transactions)) return json({ error: "Transactions array required" }, 400);

      const matched = [];
      const missing = [];
      for (const tx of transactions) {
        const found = await env.DB.prepare("SELECT id, amount_kobo, status FROM payments WHERE transaction_ref=?").bind(tx.reference).first();
        if (found) {
          matched.push({ reference: tx.reference, payment_id: found.id, status: found.status });
        } else {
          missing.push(tx);
        }
      }

      return json({
        total_submitted: transactions.length,
        matched_count: matched.length,
        missing_count: missing.length,
        matched,
        missing
      });
    }

    // =========================================================================
    // 6. PAYMENT SCHEDULES & INSTALLMENTS (Staff CRUD)
    // =========================================================================
    if (path === "/api/installments" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const branchId = url.searchParams.get("branch_id");
      let where = [];
      const binds = [];
      if (actor.role_name === "Branch Manager") {
        where.push("c.assigned_branch_id = ?");
        binds.push(actor.branch_id);
      } else if (branchId) {
        where.push("c.assigned_branch_id = ?");
        binds.push(branchId);
      }

      const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
      const sql = `
        SELECT s.*, c.full_name AS client_name, c.client_reference, prop.title AS property_title
        FROM payment_schedules s
        JOIN clients c ON c.id=s.client_id
        LEFT JOIN properties prop ON prop.id=s.property_id
        ${whereSql}
        ORDER BY s.next_due_date ASC
      `;
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      const scheduleIds = results.map(row => row.id);
      const itemsBySchedule = new Map();
      if (scheduleIds.length) {
        const { results: itemRows } = await env.DB.prepare(`
          SELECT * FROM payment_schedule_items WHERE schedule_id IN (${placeholders(scheduleIds)})
          ORDER BY schedule_id, sequence_no
        `).bind(...scheduleIds).all();
        for (const item of itemRows) {
          if (!itemsBySchedule.has(item.schedule_id)) itemsBySchedule.set(item.schedule_id, []);
          itemsBySchedule.get(item.schedule_id).push(item);
        }
      }
      const clientIds = [...new Set(results.map(row => row.client_id))];
      const paidByClient = new Map();
      if (clientIds.length) {
        const { results: paidRows } = await env.DB.prepare(`
          SELECT client_id, COALESCE(SUM(amount_kobo),0) AS paid_kobo
          FROM payments WHERE status='verified' AND is_demo=0 AND currency='NGN'
            AND client_id IN (${placeholders(clientIds)})
          GROUP BY client_id
        `).bind(...clientIds).all();
        for (const paid of paidRows) paidByClient.set(paid.client_id, Number(paid.paid_kobo || 0));
      }
      const schedules = results.map(s => {
        const items = itemsBySchedule.get(s.id) || [];
        const defaulting = computeScheduleDefaulting(s, items, paidByClient.get(s.client_id) || 0);
        return {
          ...s,
          total_kobo: Number(s.total_kobo || toKobo(s.total_amount)),
          deposit_kobo: Number(s.deposit_kobo || toKobo(s.deposit_amount)),
          installment_kobo: Number(s.installment_kobo || toKobo(s.installment_amount)),
          total_agreed_price: fromKobo(Number(s.total_kobo || toKobo(s.total_amount))),
          deposit_amount: fromKobo(Number(s.deposit_kobo || toKobo(s.deposit_amount))),
          installment_amount: fromKobo(Number(s.installment_kobo || toKobo(s.installment_amount))),
          plan_type: normalizePlanType(s.plan_type),
          start_date: s.start_date || String(s.created_at || "").slice(0, 10),
          is_easy_buy: isEasyBuyPlan(s.plan_type),
          next_due_date: defaulting.next_due_date || s.next_due_date,
          is_overdue: defaulting.status === "defaulting",
          expected_items: items,
          ...defaulting
        };
      });
      return json({ schedules });
    }

    const installmentHistoryMatch = path.match(/^\/api\/installments\/(\d+)\/history$/);
    if (installmentHistoryMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const schedule = await env.DB.prepare(
        "SELECT s.*, c.assigned_branch_id FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE s.id=?"
      ).bind(installmentHistoryMatch[1]).first();
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      if (actor.role_name === "Branch Manager" && schedule.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const { results } = await env.DB.prepare(
        "SELECT h.*, u.full_name AS changed_by_name FROM payment_schedule_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.schedule_id=? ORDER BY h.created_at DESC, h.id DESC"
      ).bind(schedule.id).all();
      return json({ schedule, history: results });
    }

    const installmentDetailMatch = path.match(/^\/api\/installments\/(\d+)$/);
    if (installmentDetailMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer", "Team Lead", "Marketer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const schedule = await env.DB.prepare(
        "SELECT s.*, c.assigned_branch_id, c.full_name AS client_name, c.client_reference FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE s.id=?"
      ).bind(installmentDetailMatch[1]).first();
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      if (["Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name) && Number(schedule.assigned_branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (actor.role_name === "Marketer" && Number(schedule.created_by) !== Number(actor.id)) {
        return json({ error: "Forbidden" }, 403);
      }
      await ensureScheduleItems(env, schedule);
      const { results: items } = await env.DB.prepare(
        "SELECT * FROM payment_schedule_items WHERE schedule_id=? ORDER BY sequence_no"
      ).bind(schedule.id).all();
      const paid = await env.DB.prepare(`
        SELECT COALESCE(SUM(amount_kobo),0) AS paid_kobo FROM payments
        WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
      `).bind(schedule.client_id).first();
      const defaulting = computeScheduleDefaulting(schedule, items, Number(paid ? paid.paid_kobo : 0));
      return json({
        schedule: {
          ...schedule,
          plan_type: normalizePlanType(schedule.plan_type),
          is_easy_buy: isEasyBuyPlan(schedule.plan_type),
          total_agreed_price: fromKobo(Number(schedule.total_kobo || toKobo(schedule.total_amount))),
          deposit_amount: fromKobo(Number(schedule.deposit_kobo || toKobo(schedule.deposit_amount))),
          installment_amount: fromKobo(Number(schedule.installment_kobo || toKobo(schedule.installment_amount))),
          ...defaulting
        },
        items
      });
    }

    const installmentMatch = path.match(/^\/api\/installments\/(\d+)$/);
    if (installmentMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const scheduleId = installmentMatch[1];
      const schedule = await env.DB.prepare(
        "SELECT s.*, c.assigned_branch_id FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE s.id=?"
      ).bind(scheduleId).first();
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      if (actor.role_name === "Branch Manager" && schedule.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (schedule.status === "cancelled") return json({ error: "Cancelled schedules cannot be modified" }, 409);

      const body = await request.json();
      const totalKobo = body.total_amount !== undefined ? toKobo(body.total_amount) : Number(schedule.total_kobo || toKobo(schedule.total_amount));
      const depositKobo = body.deposit_amount !== undefined ? toKobo(body.deposit_amount) : Number(schedule.deposit_kobo || toKobo(schedule.deposit_amount));
      const installmentKobo = body.installment_amount !== undefined ? toKobo(body.installment_amount) : Number(schedule.installment_kobo || toKobo(schedule.installment_amount));
      const planType = normalizePlanType(
        body.plan_type || body.frequency || (body.frequency_days ? "part_payment" : schedule.plan_type),
        normalizePlanType(schedule.plan_type)
      );
      const frequencyMap = { daily: 1, weekly: 7, bi_monthly: 15, bi_monthly_: 15, monthly: 30, quarterly: 90 };
      const frequencyDays = Number(
        body.frequency && frequencyMap[body.frequency] ? frequencyMap[body.frequency]
          : (body.frequency_days !== undefined ? body.frequency_days
            : (planType === "daily" ? 1 : planType === "weekly" ? 7 : planType === "bi_monthly" ? 15 : planType === "monthly" ? 30 : schedule.frequency_days))
      );
      const startDate = dateOnly(body.start_date) || schedule.start_date || String(schedule.next_due_date || "").slice(0, 10) || todayOnly();
      const nextDue = dateOnly(body.next_due_date) || String(schedule.next_due_date || "").slice(0, 10) || startDate;
      const status = body.status || schedule.status;
      const graceDays = body.grace_days !== undefined ? Math.max(0, Number(body.grace_days) || 0) : Number(schedule.grace_days || 0);
      const numberOfInstallments = body.number_of_installments !== undefined
        ? Math.max(1, Math.floor(Number(body.number_of_installments) || 1))
        : Number(schedule.number_of_installments || 0) || null;
      const validation = validateScheduleInput({ totalKobo, depositKobo, installmentKobo, frequencyDays, nextDue, status });
      if (validation.error) return json({ error: validation.error }, 400);

      const reason = body.reason ? String(body.reason).trim() : null;
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE payment_schedules
        SET property_id=?, total_amount=?, total_kobo=?, deposit_amount=?, deposit_kobo=?,
            installment_amount=?, installment_kobo=?, frequency_days=?, next_due_date=?,
            status=?, notes=?, plan_type=?, start_date=?, grace_days=?, number_of_installments=?,
            is_easy_buy=?, schedule_version=COALESCE(schedule_version,1)+1, updated_at=?
        WHERE id=?
      `).bind(
        body.property_id !== undefined ? (body.property_id || null) : schedule.property_id,
        fromKobo(totalKobo), totalKobo,
        fromKobo(depositKobo), depositKobo,
        fromKobo(installmentKobo), installmentKobo,
        frequencyDays, nextDue, status,
        body.notes !== undefined ? (body.notes || null) : schedule.notes,
        planType, startDate, graceDays, numberOfInstallments,
        isEasyBuyPlan(planType) ? 1 : 0, updatedAt, scheduleId
      ).run();

      if (status === "active") {
        const generated = buildPlanScheduleItems({
          totalKobo, depositKobo, installmentKobo, planType, startDate, frequencyDays, numberOfInstallments
        });
        await replaceScheduleItems(env, scheduleId, generated);
      }

      await env.DB.prepare(`
        INSERT INTO payment_schedule_history (schedule_id, action, previous_json, new_json, reason, changed_by, created_at)
        VALUES (?, 'update', ?, ?, ?, ?, datetime('now'))
      `).bind(scheduleId, JSON.stringify(schedule), JSON.stringify(body), reason, actor.id).run();
      await audit(env, actor.id, "installment.update", "installment", String(scheduleId), { reason, ...body }, schedule.assigned_branch_id);

      await createNotification(env, {
        clientId: schedule.client_id,
        type: "installment.updated",
        title: "Installment Schedule Updated",
        message: `Your installment plan has been updated. Installments of ${formatNGN(installmentKobo)} are now due every ${frequencyDays} days. Next due date: ${nextDue}.`,
        metadata: { schedule_id: Number(scheduleId) }
      });
      return json({ ok: true, id: Number(scheduleId) });
    }

    if (path === "/api/installments" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }

      const body = await request.json();
      const {
        client_id, property_id, total_amount, deposit_amount, installment_amount,
        frequency_days, frequency, next_due_date, notes
      } = body || {};
      if (!client_id || total_amount === undefined || (!frequency_days && !frequency && !body.plan_type) || !next_due_date) {
        return json({ error: "Missing required fields for installment schedule" }, 400);
      }
      if (normalizePlanType(body.plan_type || frequency, "part_payment") !== "outright" && installment_amount === undefined) {
        return json({ error: "Installment amount is required for this plan type" }, 400);
      }

      const frequencyMap = { daily: 1, weekly: 7, bi_monthly: 15, monthly: 30, quarterly: 90 };
      const planType = normalizePlanType(
        body.plan_type || frequency || (Number(frequency_days) === 1 ? "daily" : Number(frequency_days) === 7 ? "weekly" : Number(frequency_days) === 15 ? "bi_monthly" : Number(frequency_days) === 30 ? "monthly" : "part_payment"),
        "part_payment"
      );
      const resolvedFrequency = planType === "outright"
        ? 1
        : (frequency && frequencyMap[frequency] ? frequencyMap[frequency]
          : (frequency_days ? Number(frequency_days) : planIntervalDays(planType)));
      const totalKobo = toKobo(total_amount);
      const depositKobo = toKobo(deposit_amount || 0);
      const installmentKobo = planType === "outright" ? totalKobo : toKobo(installment_amount);
      const startDate = dateOnly(body.start_date) || dateOnly(next_due_date) || todayOnly();
      const graceDays = body.grace_days !== undefined ? Math.max(0, Number(body.grace_days) || 0) : Math.max(0, Number(env.DEFAULT_GRACE_DAYS || 0));
      const numberOfInstallments = body.number_of_installments !== undefined
        ? Math.max(1, Math.floor(Number(body.number_of_installments) || 1))
        : null;
      const validation = validateScheduleInput({
        totalKobo, depositKobo, installmentKobo, frequencyDays: resolvedFrequency,
        nextDue: startDate, status: "active"
      });
      if (validation.error) return json({ error: validation.error }, 400);

      const client = await env.DB.prepare("SELECT id, full_name, assigned_branch_id FROM clients WHERE id=? AND is_deleted=0").bind(client_id).first();
      if (!client) return json({ error: "Client not found" }, 404);
      if (actor.role_name === "Branch Manager" && client.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (property_id) {
        const prop = await env.DB.prepare("SELECT id FROM properties WHERE id=?").bind(property_id).first();
        if (!prop) return json({ error: "Property not found" }, 404);
      }

      const res = await env.DB.prepare(`
        INSERT INTO payment_schedules (client_id, property_id, total_amount, total_kobo, deposit_amount, deposit_kobo,
          installment_amount, installment_kobo, frequency_days, next_due_date, status, notes, created_by, created_at, updated_at,
          plan_type, start_date, grace_days, number_of_installments, is_easy_buy, schedule_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, 1)
      `).bind(
        client_id, property_id || null,
        fromKobo(totalKobo), totalKobo,
        fromKobo(depositKobo), depositKobo,
        fromKobo(installmentKobo), installmentKobo,
        resolvedFrequency, startDate, notes || null, actor.id,
        planType, startDate, graceDays, numberOfInstallments, isEasyBuyPlan(planType) ? 1 : 0
      ).run();

      const newId = res.meta.last_row_id;
      const generated = buildPlanScheduleItems({
        totalKobo, depositKobo, installmentKobo, planType, startDate,
        frequencyDays: resolvedFrequency, numberOfInstallments
      });
      await replaceScheduleItems(env, newId, generated);
      await env.DB.prepare(`
        INSERT INTO payment_schedule_history (schedule_id, action, previous_json, new_json, reason, changed_by, created_at)
        VALUES (?, 'create', NULL, ?, ?, ?, datetime('now'))
      `).bind(newId, JSON.stringify({ totalKobo, depositKobo, installmentKobo, resolvedFrequency, planType, startDate, graceDays, next_due_date, property_id: property_id || null, notes: notes || null, schedule_items: generated }), body.reason || null, actor.id).run();
      await audit(env, actor.id, "installment.create", "installment", String(newId), body, client.assigned_branch_id);

      // Notify client
      await createNotification(env, {
        clientId: client.id,
        type: "installment.created",
        title: "Installment Schedule Configured",
        message: `A ${planType.replace(/_/g, " ")} payment plan has been configured. ${isEasyBuyPlan(planType) ? "This is an easy-buy plan. " : ""}Installments of ${formatNGN(installmentKobo)} are scheduled every ${resolvedFrequency} days. First due date: ${startDate}.`,
        metadata: { schedule_id: newId, plan_type: planType }
      });

      return json({ ok: true, id: newId, plan_type: planType, schedule_items: generated.length });
    }

    const cancelMatch = path.match(/^\/api\/installments\/(\d+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const schedule = await env.DB.prepare(
        "SELECT s.*, c.assigned_branch_id FROM payment_schedules s JOIN clients c ON c.id=s.client_id WHERE s.id=?"
      ).bind(cancelMatch[1]).first();
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      if (actor.role_name === "Branch Manager" && schedule.assigned_branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (schedule.status === "cancelled") return json({ ok: true, already_cancelled: true });
      const body = await request.json().catch(() => ({}));
      const reason = body.reason || "Schedule cancelled by authorised staff";
      await env.DB.prepare("UPDATE payment_schedules SET status='cancelled', updated_at=datetime('now') WHERE id=?").bind(schedule.id).run();
      await env.DB.prepare(`
        INSERT INTO payment_schedule_history (schedule_id, action, previous_json, new_json, reason, changed_by, created_at)
        VALUES (?, 'cancel', ?, NULL, ?, ?, datetime('now'))
      `).bind(schedule.id, JSON.stringify(schedule), reason, actor.id).run();
      await audit(env, actor.id, "installment.cancel", "installment", String(schedule.id), { reason }, schedule.assigned_branch_id);
      await createNotification(env, {
        clientId: schedule.client_id,
        type: "installment.cancelled",
        title: "Installment Schedule Cancelled",
        message: `Your installment schedule has been cancelled. Reason: ${reason}. Please contact our finance team for a revised plan.`,
        metadata: { schedule_id: schedule.id }
      });
      return json({ ok: true, status: "cancelled" });
    }

    // =========================================================================
    // DEFAULTING CLIENTS, PLAN STATUS AND FOLLOW-UP TOOLS
    // =========================================================================
    async function defaultingScheduleForActor(actor, scheduleId) {
      const schedule = await env.DB.prepare(`
        SELECT s.*, c.full_name AS client_name, c.client_reference, c.assigned_branch_id,
               c.created_by, c.original_marketer_id, c.team_lead_id, b.name AS branch_name
        FROM payment_schedules s
        JOIN clients c ON c.id=s.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        WHERE s.id=? AND c.is_deleted=0
      `).bind(scheduleId).first();
      if (!schedule) return null;
      const scope = await resolvePhase6Scope(env, actor);
      const actualRole = actor.actual_role_name || actor.role_name;
      if (["Super Admin", "Managing Director", "Head Accountant", "Finance Officer"].includes(actualRole)) return schedule;
      if (["Project Manager", "Branch Manager"].includes(actualRole)) {
        return Number(schedule.assigned_branch_id) === Number(actor.branch_id) ? schedule : null;
      }
      if (actualRole === "Team Lead") {
        return scope.memberIds.includes(Number(schedule.created_by)) ||
          scope.memberIds.includes(Number(schedule.original_marketer_id)) ||
          Number(schedule.team_lead_id) === Number(actor.id) ? schedule : null;
      }
      return Number(schedule.created_by) === Number(actor.id) ||
        Number(schedule.original_marketer_id) === Number(actor.id) ? schedule : null;
    }

    if (path === "/api/defaulting-clients" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const actualRole = actor.actual_role_name || actor.role_name;
      const scope = await resolvePhase6Scope(env, actor);
      const clientScope = clientScopeSql(scope, "c");
      const clauses = ["c.is_deleted=0", "s.status='active'", clientScope.clause];
      const binds = [...clientScope.binds];
      const branchId = url.searchParams.get("branch_id");
      const teamLeadId = url.searchParams.get("team_lead_id");
      const staffId = url.searchParams.get("staff_id");
      const planType = url.searchParams.get("plan_type");
      const requestedStatus = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      if (branchId) {
        if (!["Super Admin", "Managing Director", "Head Accountant", "Finance Officer"].includes(actualRole) && Number(branchId) !== Number(actor.branch_id)) {
          return json({ error: "Branch is outside your scope" }, 403);
        }
        clauses.push("c.assigned_branch_id=?");
        binds.push(Number(branchId));
      }
      if (teamLeadId) { clauses.push("c.team_lead_id=?"); binds.push(Number(teamLeadId)); }
      if (staffId) {
        if (actualRole === "Marketer" && Number(staffId) !== Number(actor.id)) return json({ error: "Staff is outside your scope" }, 403);
        if (actualRole === "Team Lead" && !scope.memberIds.includes(Number(staffId))) return json({ error: "Staff is outside your team" }, 403);
        clauses.push("(c.created_by=? OR c.original_marketer_id=?)");
        binds.push(Number(staffId), Number(staffId));
      }
      if (planType) { clauses.push("s.plan_type=?"); binds.push(normalizePlanType(planType)); }
      if (q) {
        clauses.push("(c.full_name LIKE ? OR c.client_reference LIKE ? OR c.phone_number LIKE ?)");
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const { results: schedules } = await env.DB.prepare(`
        SELECT s.*, c.full_name AS client_name, c.client_reference, c.phone_number,
               c.assigned_branch_id, b.name AS branch_name,
               COALESCE(u.full_name, '') AS follow_up_owner_name
        FROM payment_schedules s
        JOIN clients c ON c.id=s.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN users u ON u.id=s.follow_up_owner_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY s.next_due_date ASC, s.id DESC
      `).bind(...binds).all();
      const scheduleIds = schedules.map(row => row.id);
      const itemsBySchedule = new Map();
      if (scheduleIds.length) {
        const { results: itemRows } = await env.DB.prepare(`
          SELECT * FROM payment_schedule_items WHERE schedule_id IN (${placeholders(scheduleIds)})
          ORDER BY schedule_id, sequence_no
        `).bind(...scheduleIds).all();
        for (const item of itemRows) {
          if (!itemsBySchedule.has(item.schedule_id)) itemsBySchedule.set(item.schedule_id, []);
          itemsBySchedule.get(item.schedule_id).push(item);
        }
      }
      const clientIds = [...new Set(schedules.map(row => row.client_id))];
      const paidByClient = new Map();
      if (clientIds.length) {
        const { results: paidRows } = await env.DB.prepare(`
          SELECT client_id, COALESCE(SUM(amount_kobo),0) AS paid_kobo FROM payments
          WHERE status='verified' AND is_demo=0 AND currency='NGN'
            AND client_id IN (${placeholders(clientIds)}) GROUP BY client_id
        `).bind(...clientIds).all();
        for (const paid of paidRows) paidByClient.set(paid.client_id, Number(paid.paid_kobo || 0));
      }
      const latestFollowUps = new Map();
      if (scheduleIds.length) {
        const { results: followUps } = await env.DB.prepare(`
          SELECT f.*, u.full_name AS owner_name FROM defaulting_follow_ups f
          LEFT JOIN users u ON u.id=f.owner_user_id
          WHERE f.schedule_id IN (${placeholders(scheduleIds)})
          ORDER BY f.created_at DESC, f.id DESC
        `).bind(...scheduleIds).all();
        for (const followUp of followUps) {
          if (!latestFollowUps.has(followUp.schedule_id)) latestFollowUps.set(followUp.schedule_id, followUp);
        }
      }
      let rows = schedules.map(schedule => {
        const items = itemsBySchedule.get(schedule.id) || [];
        const state = computeScheduleDefaulting(schedule, items, paidByClient.get(schedule.client_id) || 0);
        return {
          schedule_id: schedule.id,
          client_id: schedule.client_id,
          client_name: schedule.client_name,
          client_reference: schedule.client_reference,
          phone_number: schedule.phone_number,
          branch_id: schedule.assigned_branch_id,
          branch_name: schedule.branch_name,
          plan_type: normalizePlanType(schedule.plan_type),
          total_kobo: Number(schedule.total_kobo || toKobo(schedule.total_amount)),
          installment_kobo: Number(schedule.installment_kobo || toKobo(schedule.installment_amount)),
          expected_items_count: items.length,
          follow_up_owner_id: schedule.follow_up_owner_id,
          follow_up_owner_name: schedule.follow_up_owner_name || null,
          follow_up_status: schedule.follow_up_status || null,
          next_follow_up_date: schedule.next_follow_up_date || null,
          latest_follow_up: latestFollowUps.get(schedule.id) || null,
          ...state
        };
      });
      const summaryRows = rows;
      const summary = {
        total: summaryRows.length,
        defaulting: summaryRows.filter(row => row.status === "defaulting").length,
        performing: summaryRows.filter(row => row.status === "performing").length,
        amount_behind_kobo: summaryRows.reduce((sum, row) => sum + Number(row.amount_behind_kobo || 0), 0),
        by_plan_type: PAYMENT_PLAN_TYPES.reduce((acc, type) => {
          const matching = summaryRows.filter(row => row.plan_type === type);
          acc[type] = {
            total: matching.length,
            defaulting: matching.filter(row => row.status === "defaulting").length
          };
          return acc;
        }, {})
      };
      if (requestedStatus && ["performing", "defaulting"].includes(requestedStatus)) {
        rows = rows.filter(row => row.status === requestedStatus);
      }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
      const total = rows.length;
      const paged = rows.slice((page - 1) * limit, page * limit);
      return json({ clients: paged, schedules: paged, summary, pagination: { page, limit, total } });
    }

    const defaultingFollowUpMatch = path.match(/^\/api\/defaulting-clients\/(\d+)\/follow-ups$/);
    if (defaultingFollowUpMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const schedule = await defaultingScheduleForActor(actor, defaultingFollowUpMatch[1]);
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      const { results } = await env.DB.prepare(`
        SELECT f.*, u.full_name AS owner_name, c.full_name AS created_by_name
        FROM defaulting_follow_ups f
        LEFT JOIN users u ON u.id=f.owner_user_id
        LEFT JOIN users c ON c.id=f.created_by
        WHERE f.schedule_id=? ORDER BY f.created_at DESC, f.id DESC
      `).bind(schedule.id).all();
      return json({ follow_ups: results });
    }

    if (defaultingFollowUpMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const schedule = await defaultingScheduleForActor(actor, defaultingFollowUpMatch[1]);
      if (!schedule) return json({ error: "Schedule not found" }, 404);
      const body = await request.json();
      const note = String(body.note || "").trim();
      if (!note) return json({ error: "Call note is required" }, 400);
      if (note.length > 4000) return json({ error: "Call note is too long" }, 400);
      const status = body.status || "contacted";
      if (!DEFAULT_FOLLOW_UP_STATUSES.includes(status)) return json({ error: "Follow-up status must be contacted, promised or escalated" }, 400);
      const nextDate = body.next_follow_up_date ? dateOnly(body.next_follow_up_date) : null;
      if (body.next_follow_up_date && !nextDate) return json({ error: "Invalid next follow-up date" }, 400);
      const ownerId = body.owner_user_id ? Number(body.owner_user_id) : actor.id;
      const owner = await env.DB.prepare(`
        SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND u.is_active=1 AND r.name<>'Client'
      `).bind(ownerId).first();
      if (!owner) return json({ error: "Follow-up owner must be an active staff member" }, 400);
      if (["Project Manager", "Branch Manager"].includes(actor.actual_role_name || actor.role_name) &&
          Number(owner.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Follow-up owner is outside your branch" }, 403);
      }
      const res = await env.DB.prepare(`
        INSERT INTO defaulting_follow_ups (schedule_id, client_id, owner_user_id, note, next_follow_up_date, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(schedule.id, schedule.client_id, owner.id, note, nextDate, status, actor.id).run();
      await env.DB.prepare(`
        UPDATE payment_schedules SET follow_up_owner_id=?, follow_up_status=?, next_follow_up_date=?, updated_at=datetime('now')
        WHERE id=?
      `).bind(owner.id, status, nextDate, schedule.id).run();
      await audit(env, actor.id, "defaulting.followup", "payment_schedule", String(schedule.id), {
        client_id: schedule.client_id, owner_user_id: owner.id, status, next_follow_up_date: nextDate
      }, schedule.assigned_branch_id);
      if (Number(owner.id) !== Number(actor.id)) {
        await createNotification(env, {
          userId: owner.id,
          type: "defaulting.followup",
          title: "Defaulting Client Follow-up Assigned",
          message: `${schedule.client_name} (${schedule.client_reference}) needs a follow-up call. Status: ${status}.`,
          metadata: { schedule_id: schedule.id, client_id: schedule.client_id }
        });
      }
      return json({ ok: true, id: res.meta.last_row_id, owner_user_id: owner.id, status, next_follow_up_date: nextDate });
    }

    // =========================================================================
    // CUSTOMER CARE — branch-level and national scopes
    // =========================================================================
    function isCustomerCare(actor) {
      return (actor.actual_role_name || actor.role_name) === "Customer Care";
    }

    async function careClientForActor(actor, clientId) {
      const scope = careScopeSql(actor, "c");
      return env.DB.prepare(`
        SELECT c.*, b.name AS branch_name,
               COALESCE(cc.care_status, 'pending_clearance') AS care_status,
               cc.clearance_note, cc.cleared_at, cc.last_call_at, cc.next_follow_up_date,
               cc.assigned_user_id, u.full_name AS assigned_user_name
        FROM clients c
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN client_care_records cc ON cc.client_id=c.id
        LEFT JOIN users u ON u.id=cc.assigned_user_id
        WHERE c.id=? AND c.is_deleted=0 AND ${scope.clause}
      `).bind(clientId, ...scope.binds).first();
    }

    if (path === "/api/customer-care/overview" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const scope = careScopeSql(actor, "c");
      const pending = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM clients c
        LEFT JOIN client_care_records cc ON cc.client_id=c.id
        WHERE c.is_deleted=0 AND COALESCE(cc.care_status,'pending_clearance')='pending_clearance' AND ${scope.clause}
      `).bind(...scope.binds).first();
      const cleared = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM clients c
        JOIN client_care_records cc ON cc.client_id=c.id
        WHERE c.is_deleted=0 AND cc.care_status='cleared' AND ${scope.clause}
      `).bind(...scope.binds).first();
      const callsToday = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM client_care_calls call
        JOIN clients c ON c.id=call.client_id
        WHERE date(call.created_at)=date('now') AND ${scope.clause}
      `).bind(...scope.binds).first();
      const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM clients c WHERE c.is_deleted=0 AND ${scope.clause}`)
        .bind(...scope.binds).first();
      return json({
        scope: String(actor.care_scope || "branch").toLowerCase(),
        branch_id: actor.branch_id,
        branch_name: actor.branch_name || null,
        pending_clearance: Number(pending ? pending.c : 0),
        cleared: Number(cleared ? cleared.c : 0),
        calls_today: Number(callsToday ? callsToday.c : 0),
        total_clients: Number(total ? total.c : 0)
      });
    }

    if (path === "/api/customer-care/clients" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const scope = careScopeSql(actor, "c");
      const clauses = ["c.is_deleted=0", scope.clause];
      const binds = [...scope.binds];
      const status = url.searchParams.get("status");
      if (["pending_clearance", "cleared"].includes(status)) {
        clauses.push("COALESCE(cc.care_status,'pending_clearance')=?"); binds.push(status);
      }
      const q = url.searchParams.get("q");
      if (q) {
        clauses.push("(c.full_name LIKE ? OR c.client_reference LIKE ? OR c.phone_number LIKE ?)");
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const branchId = url.searchParams.get("branch_id");
      if (branchId && String(actor.care_scope || "").toLowerCase() === "national") {
        clauses.push("c.assigned_branch_id=?"); binds.push(Number(branchId));
      }
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (from) { clauses.push("date(c.created_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(c.created_at) <= date(?)"); binds.push(to); }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const whereSql = "WHERE " + clauses.join(" AND ");
      const { results } = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.phone_number, c.email_address, c.status,
               c.assigned_branch_id, b.name AS branch_name, c.created_at, c.agreed_purchase_price,
               COALESCE(cc.care_status,'pending_clearance') AS care_status,
               cc.clearance_note, cc.cleared_at, cc.last_call_at, cc.next_follow_up_date,
               cc.assigned_user_id, u.full_name AS assigned_user_name,
               (SELECT COUNT(*) FROM client_care_calls call WHERE call.client_id=c.id) AS call_count
        FROM clients c
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN client_care_records cc ON cc.client_id=c.id
        LEFT JOIN users u ON u.id=cc.assigned_user_id
        ${whereSql}
        ORDER BY CASE COALESCE(cc.care_status,'pending_clearance') WHEN 'pending_clearance' THEN 0 ELSE 1 END,
                 c.created_at DESC
        LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM clients c LEFT JOIN client_care_records cc ON cc.client_id=c.id ${whereSql}
      `).bind(...binds).first();
      return json({ clients: results, pagination: { page, limit, total: Number(count ? count.c : 0) } });
    }

    const careClientMatch = path.match(/^\/api\/customer-care\/clients\/(\d+)$/);
    if (careClientMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const client = await careClientForActor(actor, careClientMatch[1]);
      if (!client) return json({ error: "Client not found in your care scope" }, 404);
      const { results: calls } = await env.DB.prepare(`
        SELECT call.*, u.full_name AS care_user_name FROM client_care_calls call
        LEFT JOIN users u ON u.id=call.care_user_id
        WHERE call.client_id=? ORDER BY call.created_at DESC, call.id DESC
      `).bind(client.id).all();
      const { results: payments } = await env.DB.prepare(`
        SELECT id, transaction_ref, amount_kobo, status, verified_at, method FROM payments
        WHERE client_id=? ORDER BY id DESC LIMIT 10
      `).bind(client.id).all();
      return json({ client, calls, payments });
    }

    const careClearanceMatch = path.match(/^\/api\/customer-care\/clients\/(\d+)\/clearance$/);
    if (careClearanceMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const client = await careClientForActor(actor, careClearanceMatch[1]);
      if (!client) return json({ error: "Client not found in your care scope" }, 404);
      const body = await request.json();
      const status = body.status || "cleared";
      if (!["pending_clearance", "cleared"].includes(status)) return json({ error: "Invalid care status" }, 400);
      const note = body.note ? String(body.note).trim() : null;
      const existing = await env.DB.prepare("SELECT * FROM client_care_records WHERE client_id=?").bind(client.id).first();
      if (existing) {
        await env.DB.prepare(`
          UPDATE client_care_records SET care_status=?, clearance_note=?, cleared_by=?, cleared_at=?,
            updated_by=?, updated_at=datetime('now') WHERE client_id=?
        `).bind(status, note, status === "cleared" ? actor.id : null,
          status === "cleared" ? new Date().toISOString() : null, actor.id, client.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO client_care_records (client_id, care_status, assigned_user_id, clearance_note,
            cleared_by, cleared_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(client.id, status, actor.id, note,
          status === "cleared" ? actor.id : null,
          status === "cleared" ? new Date().toISOString() : null, actor.id).run();
      }
      await audit(env, actor.id, "customer_care.clearance", "client", String(client.id), { status, note }, client.assigned_branch_id);
      return json({ ok: true, care_status: status });
    }

    const careCallMatch = path.match(/^\/api\/customer-care\/clients\/(\d+)\/calls$/);
    if (careCallMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const client = await careClientForActor(actor, careCallMatch[1]);
      if (!client) return json({ error: "Client not found in your care scope" }, 404);
      const { results } = await env.DB.prepare(`
        SELECT call.*, u.full_name AS care_user_name FROM client_care_calls call
        LEFT JOIN users u ON u.id=call.care_user_id
        WHERE call.client_id=? ORDER BY call.created_at DESC, call.id DESC
      `).bind(client.id).all();
      return json({ calls: results });
    }

    if (careCallMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!isCustomerCare(actor)) return json({ error: "Customer care access is required" }, 403);
      const client = await careClientForActor(actor, careCallMatch[1]);
      if (!client) return json({ error: "Client not found in your care scope" }, 404);
      const body = await request.json();
      const note = String(body.note || "").trim();
      if (!note) return json({ error: "Call note is required" }, 400);
      if (note.length > 4000) return json({ error: "Call note is too long" }, 400);
      const callType = CARE_CALL_TYPES.includes(body.call_type) ? body.call_type : "call";
      const nextDate = body.next_follow_up_date ? dateOnly(body.next_follow_up_date) : null;
      if (body.next_follow_up_date && !nextDate) return json({ error: "Invalid next follow-up date" }, 400);
      const res = await env.DB.prepare(`
        INSERT INTO client_care_calls (client_id, care_user_id, call_type, note, outcome, next_follow_up_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(client.id, actor.id, callType, note, body.outcome ? String(body.outcome).trim() : null, nextDate).run();
      await env.DB.prepare(`
        INSERT INTO client_care_records (client_id, care_status, assigned_user_id, last_call_at, next_follow_up_date, updated_by)
        VALUES (?, COALESCE((SELECT care_status FROM client_care_records WHERE client_id=?), 'pending_clearance'), ?, datetime('now'), ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET assigned_user_id=excluded.assigned_user_id,
          last_call_at=datetime('now'), next_follow_up_date=excluded.next_follow_up_date,
          updated_by=excluded.updated_by, updated_at=datetime('now')
      `).bind(client.id, client.id, actor.id, nextDate, actor.id).run();
      await audit(env, actor.id, "customer_care.call", "client", String(client.id), {
        call_id: res.meta.last_row_id, call_type: callType, next_follow_up_date: nextDate
      }, client.assigned_branch_id);
      return json({ ok: true, id: res.meta.last_row_id });
    }

    // =========================================================================
    // SMS DELIVERY, TEMPLATES, CONTROLS AND DELIVERY LOG
    // =========================================================================
    function smsScopeSql(actor, alias = "c") {
      const actual = actor.actual_role_name || actor.role_name;
      if (["Super Admin", "Managing Director", "Head Accountant", "Finance Officer"].includes(actual)) return { clause: "1=1", binds: [] };
      if (actual === "Customer Care") return careScopeSql(actor, alias);
      if (["Project Manager", "Branch Manager"].includes(actual)) return { clause: `${alias}.assigned_branch_id = ?`, binds: [actor.branch_id] };
      if (actual === "Team Lead") {
        return {
          clause: `(${alias}.team_lead_id=? OR ${alias}.created_by IN (SELECT user_id FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE t.team_lead_user_id=? AND t.is_active=1))`,
          binds: [actor.id, actor.id]
        };
      }
      return { clause: `${alias}.created_by = ?`, binds: [actor.id] };
    }

    if (path === "/api/sms/overview" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const settings = await getSmsSettings(env);
      const scope = smsScopeSql(actor, "c");
      const counts = await env.DB.prepare(`
        SELECT s.status, COUNT(*) AS c FROM sms_messages s
        LEFT JOIN clients c ON c.id=s.client_id
        WHERE ${scope.clause} GROUP BY s.status
      `).bind(...scope.binds).all();
      const totals = {};
      for (const row of counts.results) totals[row.status] = Number(row.c || 0);
      const providerReady = settings.provider === "mock"
        || (settings.provider === "termii" && Boolean(env.TERMII_API_KEY))
        || (settings.provider === "africastalking" && Boolean(env.AFRICASTALKING_API_KEY && env.AFRICASTALKING_USERNAME));
      return json({
        enabled: settings.enabled,
        provider: settings.provider,
        provider_ready: providerReady,
        sender_id: settings.senderId,
        balance: settings.creditBalance,
        balance_currency: settings.creditCurrency,
        balance_checked_at: settings.creditCheckedAt,
        low_credit_threshold: settings.lowCreditThreshold,
        low_credit: settings.creditBalance !== null && Number(settings.creditBalance) <= Number(settings.lowCreditThreshold),
        reminders_enabled: settings.remindersEnabled,
        defaulting_reminders_enabled: settings.defaultingRemindersEnabled,
        reminder_days: settings.reminderDays,
        defaulting_frequency_days: settings.defaultingFrequencyDays,
        statement_day: settings.statementDay,
        counts: totals,
        scope: (actor.actual_role_name || actor.role_name)
      });
    }

    if (path === "/api/sms/messages" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const scope = smsScopeSql(actor, "c");
      const clauses = [scope.clause];
      const binds = [...scope.binds];
      const status = url.searchParams.get("status");
      if (status) { clauses.push("s.status=?"); binds.push(status); }
      const templateKey = url.searchParams.get("template_key");
      if (templateKey) { clauses.push("s.template_key=?"); binds.push(templateKey); }
      const clientId = url.searchParams.get("client_id");
      if (clientId) { clauses.push("s.client_id=?"); binds.push(Number(clientId)); }
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (from) { clauses.push("date(s.created_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(s.created_at) <= date(?)"); binds.push(to); }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const whereSql = "WHERE " + clauses.join(" AND ");
      const { results } = await env.DB.prepare(`
        SELECT s.*, c.full_name AS client_name, c.client_reference, c.assigned_branch_id, b.name AS branch_name
        FROM sms_messages s
        LEFT JOIN clients c ON c.id=s.client_id
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM sms_messages s LEFT JOIN clients c ON c.id=s.client_id ${whereSql}
      `).bind(...binds).first();
      return json({ messages: results, pagination: { page, limit, total: Number(count ? count.c : 0) } });
    }

    if (path === "/api/sms/templates" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const { results } = await env.DB.prepare("SELECT * FROM sms_templates ORDER BY template_key").all();
      return json({ templates: results, placeholders: ["{name}", "{amount}", "{balance}", "{paid}", "{total}", "{property}", "{date}", "{reference}", "{due_date}", "{next_due}", "{days}"] });
    }

    const smsTemplateMatch = path.match(/^\/api\/sms\/templates\/([a-z0-9_]+)$/);
    if (smsTemplateMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const existing = await env.DB.prepare("SELECT * FROM sms_templates WHERE template_key=?").bind(smsTemplateMatch[1]).first();
      if (!existing) return json({ error: "SMS template not found" }, 404);
      const body = await request.json();
      const name = body.name !== undefined ? String(body.name).trim() : existing.name;
      const text = body.body !== undefined ? String(body.body).trim() : existing.body;
      if (!name || !text) return json({ error: "Template name and body are required" }, 400);
      if (text.length > 1000) return json({ error: "Template body is too long" }, 400);
      const language = ["en", "pcm", "yo", "ig", "ha"].includes(body.language) ? body.language : existing.language;
      const active = body.is_active === undefined ? existing.is_active : (isTruthy(body.is_active) ? 1 : 0);
      await env.DB.prepare(`
        UPDATE sms_templates SET name=?, body=?, language=?, is_active=?, updated_by=?, updated_at=datetime('now')
        WHERE template_key=?
      `).bind(name, text, language, active, actor.id, existing.template_key).run();
      await audit(env, actor.id, "sms.template.update", "sms_template", String(existing.id), {
        template_key: existing.template_key, language, active
      }, null);
      return json({ ok: true });
    }

    if (path === "/api/sms/settings" && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const body = await request.json();
      const booleanKeys = ["sms_enabled", "sms_reminders_enabled", "sms_defaulting_reminders_enabled"];
      const numberKeys = {
        sms_low_credit_threshold: { min: 0, max: 100000000 },
        sms_reminder_days: { min: 0, max: 60 },
        sms_defaulting_frequency_days: { min: 1, max: 60 },
        sms_statement_day: { min: 1, max: 28 }
      };
      if (body.sms_provider !== undefined && !["termii", "africastalking", "mock"].includes(String(body.sms_provider))) {
        return json({ error: "Invalid SMS provider" }, 400);
      }
      if (String(body.sms_provider) === "mock" && String(env.ENVIRONMENT || "").toLowerCase() === "production") {
        return json({ error: "Mock SMS provider is disabled in production" }, 400);
      }
      for (const key of booleanKeys) {
        if (body[key] !== undefined) await setSmsSetting(env, key, isTruthy(body[key]) ? "1" : "0", actor.id);
      }
      for (const [key, rule] of Object.entries(numberKeys)) {
        if (body[key] === undefined) continue;
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value < rule.min || value > rule.max) return json({ error: `Invalid value for ${key}` }, 400);
        await setSmsSetting(env, key, String(value), actor.id);
      }
      if (body.sms_provider !== undefined) await setSmsSetting(env, "sms_provider", String(body.sms_provider), actor.id);
      if (body.sms_sender_id !== undefined) {
        const sender = String(body.sms_sender_id || "").trim();
        if (sender.length > 11) return json({ error: "Sender ID must be at most 11 characters" }, 400);
        await setSmsSetting(env, "sms_sender_id", sender, actor.id);
      }
      await audit(env, actor.id, "sms.settings.update", "sms_settings", null, {
        keys: Object.keys(body)
      }, null);
      return json({ ok: true });
    }

    if (path === "/api/sms/test" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const body = await request.json();
      const phone = normalizeNigerianPhone(body.phone_number);
      if (!phone) return json({ error: "A valid Nigerian phone number is required" }, 400);
      let text = String(body.body || "").trim();
      if (!text && body.template_key) {
        const template = await getSmsTemplate(env, String(body.template_key));
        text = renderSmsTemplate(template ? template.body : "Bliss Legacy test message.", {
          name: actor.full_name, amount: "1,000", balance: "1,000", paid: "1,000", total: "2,000",
          property: "Test property", date: todayOnly(), reference: "TEST", due_date: todayOnly(),
          next_due: todayOnly(), days: "1"
        });
      }
      if (!text) return json({ error: "Message body or template is required" }, 400);
      const result = await enqueueSms(env, {
        clientId: null, templateKey: "test", phone, body: `[TEST] ${text}`.slice(0, 1000),
        idempotencyKey: `test:${Date.now()}:${crypto.randomUUID()}`, createdBy: actor.id
      });
      return json({ ok: true, ...result, phone_e164: phone });
    }

    if (path === "/api/sms/refresh-balance" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const settings = await getSmsSettings(env);
      try {
        const balance = await fetchSmsProviderBalance(env, settings);
        if (balance === null) return json({ error: "This provider does not expose a credit balance endpoint" }, 400);
        await setSmsSetting(env, "sms_credit_balance", balance, actor.id);
        await setSmsSetting(env, "sms_credit_checked_at", new Date().toISOString(), actor.id);
        await checkSmsLowBalance(env, { ...settings, creditBalance: balance });
        return json({ ok: true, balance, currency: settings.creditCurrency });
      } catch (error) {
        return json({ error: error.message || "Unable to read provider balance" }, 502);
      }
    }

    const smsOptoutMatch = path.match(/^\/api\/clients\/(\d+)\/sms-optout$/);
    if (smsOptoutMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const client = await env.DB.prepare("SELECT id, assigned_branch_id FROM clients WHERE id=?").bind(smsOptoutMatch[1]).first();
      if (!client) return json({ error: "Client not found" }, 404);
      const scope = smsScopeSql(actor, "c");
      if (scope.clause !== "1=1") {
        const allowed = await env.DB.prepare(`SELECT 1 AS ok FROM clients c WHERE c.id=? AND ${scope.clause}`)
          .bind(client.id, ...scope.binds).first();
        if (!allowed) return json({ error: "Client is outside your scope" }, 403);
      }
      const row = await env.DB.prepare("SELECT * FROM sms_optouts WHERE client_id=?").bind(client.id).first();
      return json({ opted_out: Boolean(row && Number(row.opted_out) === 1), reason: row ? row.reason : null, updated_at: row ? row.updated_at : null });
    }

    if (smsOptoutMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageSms(actor)) return json({ error: "SMS access is required" }, 403);
      const client = await env.DB.prepare("SELECT id, assigned_branch_id FROM clients WHERE id=?").bind(smsOptoutMatch[1]).first();
      if (!client) return json({ error: "Client not found" }, 404);
      const body = await request.json();
      const optedOut = body.opted_out === undefined ? true : isTruthy(body.opted_out);
      await env.DB.prepare(`
        INSERT INTO sms_optouts (client_id, opted_out, reason, updated_by, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(client_id) DO UPDATE SET opted_out=excluded.opted_out, reason=excluded.reason,
          updated_by=excluded.updated_by, updated_at=datetime('now')
      `).bind(client.id, optedOut ? 1 : 0, body.reason ? String(body.reason).trim() : null, actor.id).run();
      await audit(env, actor.id, optedOut ? "sms.optout" : "sms.optin", "client", String(client.id), { reason: body.reason || null }, client.assigned_branch_id);
      return json({ ok: true, opted_out: optedOut });
    }

    // =========================================================================
    // PHASE 6: STAFF DASHBOARDS, PERFORMANCE, STAFF/TEAM, LEADS & ACTIVITY
    // =========================================================================
    if (path === "/api/dashboard" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const analytics = await buildAnalytics(env, actor, scope, url);

      const me = await env.DB.prepare(`
        SELECT u.id, u.email, u.full_name, u.branch_id, u.last_login_at, u.created_at,
               r.name AS role_name, b.name AS branch_name,
               sp.phone_number, sp.job_title, sp.date_joined, sp.notes,
               (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id
                 WHERE tm.user_id=u.id AND t.is_active=1) AS team_names
        FROM users u JOIN roles r ON r.id=u.role_id
        LEFT JOIN branches b ON b.id=u.branch_id
        LEFT JOIN staff_profiles sp ON sp.user_id=u.id
        WHERE u.id=?
      `).bind(actor.id).first();

      const clientScope = clientScopeSql(scope, "c");
      const leadScope = leadScopeSql(scope, "l");
      const requestedBranch = url.searchParams.get("branch_id");
      const companyBranch = ["Managing Director", "Finance Officer"].includes(scope.role) && requestedBranch ? Number(requestedBranch) : null;
      let clientBranch = "";
      let leadBranch = "";
      const clientBinds = [...clientScope.binds];
      const leadBinds = [...leadScope.binds];
      if (companyBranch) {
        clientBranch = " AND c.assigned_branch_id=?";
        clientBinds.push(companyBranch);
        leadBranch = " AND l.branch_id=?";
        leadBinds.push(companyBranch);
      }

      const { results: assignedClients } = await env.DB.prepare(`
        SELECT c.id, c.client_reference, c.full_name, c.phone_number, c.email_address, c.status,
               c.agreed_purchase_price, c.created_at, b.name AS branch_name,
               m.full_name AS marketer_name, p.title AS property_title
        FROM clients c
        LEFT JOIN branches b ON b.id=c.assigned_branch_id
        LEFT JOIN users m ON m.id=c.original_marketer_id
        LEFT JOIN properties p ON p.id=c.interested_property_id
        WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%' AND ${clientScope.clause}${clientBranch}
        ORDER BY c.created_at DESC LIMIT 8
      `).bind(...clientBinds).all();

      let propertyWhere = "";
      let propertyBinds = [];
      if (["Managing Director", "Branch Manager", "Finance Officer"].includes(scope.role)) {
        if (scope.role === "Branch Manager") {
          propertyWhere = "WHERE p.branch_id=?";
          propertyBinds = [scope.branchId];
        } else if (companyBranch) {
          propertyWhere = "WHERE p.branch_id=?";
          propertyBinds = [companyBranch];
        }
      } else {
        propertyWhere = `WHERE p.id IN (
          SELECT c.interested_property_id FROM clients c
          WHERE c.interested_property_id IS NOT NULL AND c.is_deleted=0
            AND c.client_reference NOT LIKE 'DEMO-%' AND ${clientScope.clause}
          UNION
          SELECT l.property_id FROM leads l
          WHERE l.property_id IS NOT NULL AND l.is_demo=0 AND ${leadScope.clause}
        )`;
        propertyBinds = [...clientScope.binds, ...leadScope.binds];
      }
      const { results: assignedProperties } = await env.DB.prepare(`
        SELECT p.id, p.reference, p.title, p.sale_price, p.status, p.is_published,
               b.name AS branch_name
        FROM properties p LEFT JOIN branches b ON b.id=p.branch_id
        ${propertyWhere} ORDER BY p.id DESC LIMIT 8
      `).bind(...propertyBinds).all();

      const isFinance = actor.role_name === "Finance Officer";
      let recentLeads = [];
      let dueFollowUps = [];
      if (!isFinance) {
        const leadResult = await env.DB.prepare(`
          SELECT l.id, l.lead_reference, l.full_name, l.phone_number, l.status,
                 l.next_follow_up_date, l.estimated_value_kobo, l.created_at,
                 m.full_name AS marketer_name, b.name AS branch_name, p.title AS property_title
          FROM leads l
          LEFT JOIN users m ON m.id=l.assigned_marketer_id
          LEFT JOIN branches b ON b.id=l.branch_id
          LEFT JOIN properties p ON p.id=l.property_id
          WHERE l.is_demo=0 AND ${leadScope.clause}${leadBranch}
          ORDER BY l.created_at DESC LIMIT 8
        `).bind(...leadBinds).all();
        recentLeads = leadResult.results;

        const dueResult = await env.DB.prepare(`
          SELECT l.id, l.lead_reference, l.full_name, l.phone_number, l.status,
                 l.next_follow_up_date, m.full_name AS marketer_name
          FROM leads l LEFT JOIN users m ON m.id=l.assigned_marketer_id
          WHERE l.is_demo=0 AND ${leadScope.clause}${leadBranch}
            AND l.next_follow_up_date IS NOT NULL
            AND date(l.next_follow_up_date) <= date('now')
            AND l.status NOT IN ('Converted','Lost')
          ORDER BY l.next_follow_up_date ASC LIMIT 8
        `).bind(...leadBinds).all();
        dueFollowUps = dueResult.results;
      }

      let teamMembers = [];
      if (scope.role === "Team Lead" && scope.memberIds.length) {
        const result = await env.DB.prepare(`
          SELECT u.id, u.full_name, u.email, u.is_active, r.name AS role_name,
                 b.name AS branch_name
          FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id
          WHERE u.id IN (${placeholders(scope.memberIds)}) ORDER BY u.full_name
        `).bind(...scope.memberIds).all();
        teamMembers = result.results;
      }

      let teams = [];
      if (["Team Lead", "Marketer"].includes(scope.role) && scope.teamIds.length) {
        const result = await env.DB.prepare(`
          SELECT t.id, t.name, t.branch_id, t.team_lead_user_id, b.name AS branch_name,
                 u.full_name AS team_lead_name
          FROM teams t LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN users u ON u.id=t.team_lead_user_id
          WHERE t.id IN (${placeholders(scope.teamIds)}) AND t.is_active=1 ORDER BY t.name
        `).bind(...scope.teamIds).all();
        teams = result.results;
      }

      const activityData = await queryActivities(env, scope, new URL("http://local/api/activity?limit=8"), 8);
      let recentCommissions = [];
      if (canAccessCommissions(actor) || canViewOwnCommission(actor)) {
        const commissionScope = commissionScopeSql(scope, "ce");
        const result = await env.DB.prepare(`
          SELECT ce.id, ce.commission_ref, ce.commission_kobo, ce.paid_kobo, ce.adjusted_kobo,
                 ce.status, ce.recipient_role, ce.created_at, ce.basis,
                 c.full_name AS client_name, c.client_reference,
                 cp.name AS plan_name, u.full_name AS recipient_name
          FROM commission_entries ce
          JOIN clients c ON c.id=ce.client_id
          JOIN commission_plans cp ON cp.id=ce.plan_id
          JOIN users u ON u.id=ce.recipient_user_id
          WHERE ${commissionScope.clause}
          ORDER BY ce.created_at DESC LIMIT 8
        `).bind(...commissionScope.binds).all();
        recentCommissions = canAccessCommissions(actor)
          ? result.results
          : result.results.map(ownCommissionEntry);
      }
      return json({
        me,
        scope: analytics.scope,
        ...analytics,
        commission_summary: analytics.summary.commissions,
        recent_commissions: recentCommissions,
        assigned_clients: assignedClients,
        assigned_properties: assignedProperties,
        recent_leads: recentLeads,
        due_follow_ups: dueFollowUps,
        team_members: teamMembers,
        teams,
        recent_activities: activityData.activities
      });
    }

    if (path === "/api/analytics/performance" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const analytics = await buildAnalytics(env, actor, scope, url);
      return json({ me: { id: actor.id, role: actor.role_name, branch_id: actor.branch_id }, ...analytics });
    }

    if (path === "/api/activity" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const data = await queryActivities(env, scope, url);
      return json(data);
    }

    // ---- Staff management ----
    if (path === "/api/staff" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const q = url.searchParams.get("q") || "";
      const role = url.searchParams.get("role") || "";
      const branchId = url.searchParams.get("branch_id") || "";
      const status = url.searchParams.get("status") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const clauses = ["r.name<>'Client'"];
      const binds = [];
      if (actor.role_name === "Branch Manager") { clauses.push("u.branch_id=?"); binds.push(actor.branch_id); }
      else if (branchId) { clauses.push("u.branch_id=?"); binds.push(branchId); }
      if (role) { clauses.push("r.name=?"); binds.push(role); }
      if (status === "active") clauses.push("u.is_active=1");
      if (status === "inactive") clauses.push("u.is_active=0");
      if (q) {
        clauses.push("(u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(sp.phone_number,'') LIKE ?)");
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const whereSql = "WHERE " + clauses.join(" AND ");
      const { results: staff } = await env.DB.prepare(`
        SELECT u.id, u.email, u.full_name, u.is_active, u.branch_id, u.role_id,
               u.last_login_at, u.created_at, u.deactivated_at, u.commission_access,
               u.property_plans_access, u.sms_access, u.care_scope,
               r.name AS role_name, b.name AS branch_name,
               sp.phone_number, sp.job_title, sp.date_joined, sp.notes,
               (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id
                 WHERE tm.user_id=u.id AND t.is_active=1) AS team_names,
               (SELECT GROUP_CONCAT(t.id, ',') FROM team_members tm JOIN teams t ON t.id=tm.team_id
                 WHERE tm.user_id=u.id AND t.is_active=1) AS team_ids
        FROM users u JOIN roles r ON r.id=u.role_id
        LEFT JOIN branches b ON b.id=u.branch_id
        LEFT JOIN staff_profiles sp ON sp.user_id=u.id
        ${whereSql}
        ORDER BY u.is_active DESC, u.full_name ASC
        LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id
        LEFT JOIN staff_profiles sp ON sp.user_id=u.id ${whereSql}
      `).bind(...binds).first();
      return json({ staff, pagination: { page, limit, total: count ? count.c : 0 } });
    }

    if (path === "/api/staff" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { email, password, full_name, role_name, branch_id, branch_name, phone_number, job_title, date_joined, notes, team_id, care_scope } = body || {};
      if (!email || !password || !full_name || !role_name) return json({ error: "Email, password, full name and role are required" }, 400);
      if (!validPassword(password)) return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      const actorActualRole = actor.actual_role_name || actor.role_name;
      const allowed = actorActualRole === "Super Admin"
        ? ["Branch Manager", "Project Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care", "Super Admin"]
        : actor.role_name === "Managing Director"
          ? ["Branch Manager", "Project Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care"]
          : ["Team Lead", "Marketer", "Finance Officer"];
      if (!allowed.includes(role_name)) return json({ error: "Forbidden role" }, 403);
      let resolvedBranch = branch_id || null;
      if (!resolvedBranch && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        resolvedBranch = branch ? branch.id : null;
      }
      const resolvedCareScope = role_name === "Customer Care"
        ? (CARE_SCOPES.includes(String(care_scope || "").toLowerCase()) ? String(care_scope).toLowerCase() : "branch")
        : null;
      if (resolvedCareScope === "national") resolvedBranch = null;
      if (!resolvedBranch && resolvedCareScope !== "national") return json({ error: "Branch is required" }, 400);
      if (actor.role_name === "Branch Manager" && Number(resolvedBranch) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const branch = resolvedBranch ? await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(resolvedBranch).first() : null;
      if (resolvedBranch && !branch) return json({ error: "Branch not found" }, 400);
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(role_name).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(email.toLowerCase().trim()).first();
      if (existing) return json({ error: "Email already used" }, 409);
      const hash = await hashPassword(password);
      const referralCode = await allocateReferralCode(env);
      const res = await env.DB.prepare(`
        INSERT INTO users (email, password_hash, full_name, role_id, branch_id, referral_code, care_scope)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(email.toLowerCase().trim(), hash, full_name.trim(), role.id, resolvedBranch, referralCode, resolvedCareScope).run();
      const newId = res.meta.last_row_id;
      const managerId = await inferManagerId(env, role_name, resolvedBranch, team_id || null);
      await env.DB.prepare("UPDATE users SET manager_id=? WHERE id=?").bind(managerId, newId).run();
      if (role_name === "Marketer") {
        await env.DB.prepare("UPDATE users SET access_valid_until=? WHERE id=?")
          .bind(endOfMonth(currentDate(env)), newId).run();
      }
      if (body.commission_access !== undefined && ["Managing Director", "Super Admin"].includes(actorActualRole)) {
        await env.DB.prepare("UPDATE users SET commission_access=? WHERE id=?")
          .bind(isTruthy(body.commission_access) ? 1 : 0, newId).run();
      }
      if (body.property_plans_access !== undefined && ["Managing Director", "Super Admin", "Head Accountant"].includes(actorActualRole)) {
        await env.DB.prepare("UPDATE users SET property_plans_access=? WHERE id=?")
          .bind(isTruthy(body.property_plans_access) ? 1 : 0, newId).run();
      }
      if (body.sms_access !== undefined && ["Managing Director", "Super Admin", "Head Accountant"].includes(actorActualRole)) {
        await env.DB.prepare("UPDATE users SET sms_access=? WHERE id=?")
          .bind(isTruthy(body.sms_access) ? 1 : 0, newId).run();
      }
      await env.DB.prepare(`
        INSERT INTO staff_profiles (user_id, phone_number, job_title, date_joined, notes, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(newId, phone_number || null, job_title || null, dateOnly(date_joined), notes || null, actor.id).run();
      if (team_id) {
        const team = await env.DB.prepare("SELECT id, branch_id FROM teams WHERE id=? AND is_active=1").bind(team_id).first();
        if (team && Number(team.branch_id) === Number(resolvedBranch)) {
          await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(team_id, newId).run();
        }
      }
      await audit(env, actor.id, "staff.create", "user", String(newId), { email, role_name, branch_id: resolvedBranch }, resolvedBranch);
      return json({ ok: true, id: newId });
    }

    const staffMatch = path.match(/^\/api\/staff\/(\d+)$/);
    if (staffMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const staff = await env.DB.prepare(`
        SELECT u.id, u.email, u.full_name, u.is_active, u.branch_id, u.role_id,
               u.last_login_at, u.created_at, u.deactivated_at,
               r.name AS role_name, b.name AS branch_name,
               sp.phone_number, sp.job_title, sp.date_joined, sp.notes
        FROM users u JOIN roles r ON r.id=u.role_id
        LEFT JOIN branches b ON b.id=u.branch_id
        LEFT JOIN staff_profiles sp ON sp.user_id=u.id
        WHERE u.id=? AND r.name<>'Client'
      `).bind(staffMatch[1]).first();
      if (!staff) return json({ error: "Staff member not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(staff.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const { results: teams } = await env.DB.prepare(`
        SELECT t.id, t.name, t.branch_id, t.team_lead_user_id
        FROM teams t JOIN team_members tm ON tm.team_id=t.id
        WHERE tm.user_id=? AND t.is_active=1 ORDER BY t.name
      `).bind(staff.id).all();
      const clients = await env.DB.prepare(`
        SELECT COUNT(*) AS total, COALESCE(SUM(agreed_purchase_price),0) AS contract_value
        FROM clients WHERE is_deleted=0 AND client_reference NOT LIKE 'DEMO-%'
          AND (original_marketer_id=? OR created_by=?)
      `).bind(staff.id, staff.id).first();
      const leads = await env.DB.prepare(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN status='Converted' THEN 1 ELSE 0 END) AS converted
        FROM leads WHERE is_demo=0 AND assigned_marketer_id=?
      `).bind(staff.id).first();
      const { results: activity } = await env.DB.prepare(`
        SELECT al.id, al.action, al.target_type, al.target_id, al.metadata, al.created_at,
               u.full_name AS actor_name
        FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
        WHERE (al.actor_user_id=? OR (al.target_type='user' AND al.target_id=?))
        ${actor.role_name === "Branch Manager" ? "AND al.branch_id=?" : ""}
        ORDER BY al.id DESC LIMIT 20
      `).bind(staff.id, String(staff.id), ...(actor.role_name === "Branch Manager" ? [actor.branch_id] : [])).all();
      return json({
        staff,
        teams,
        summary: {
          clients: Number(clients ? clients.total : 0),
          contract_value_kobo: toKobo(clients ? clients.contract_value : 0),
          leads: Number(leads ? leads.total : 0),
          converted_leads: Number(leads ? leads.converted : 0)
        },
        activity
      });
    }

    if (staffMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const target = await env.DB.prepare(`
        SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND r.name<>'Client'
      `).bind(staffMatch[1]).first();
      if (!target) return json({ error: "Staff member not found" }, 404);
      if (actor.role_name === "Branch Manager") {
        if (Number(target.branch_id) !== Number(actor.branch_id) || ["Managing Director", "Branch Manager"].includes(target.role_name)) {
          return json({ error: "Cross-branch forbidden" }, 403);
        }
      }
      const body = await request.json();
      const allowedRoles = (actor.actual_role_name || actor.role_name) === "Super Admin"
        ? ["Branch Manager", "Project Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care", "Super Admin"]
        : actor.role_name === "Managing Director"
          ? ["Branch Manager", "Project Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care"]
          : ["Team Lead", "Marketer", "Finance Officer"];
      const nextRoleName = body.role_name || target.role_name;
      const editingOwnMdProfile = actor.role_name === "Managing Director" && target.role_name === "Managing Director";
      if (!allowedRoles.includes(nextRoleName) && !(editingOwnMdProfile && nextRoleName === "Managing Director")) {
        return json({ error: "Forbidden role" }, 403);
      }
      if (Number(target.id) === Number(actor.id) && body.role_name && body.role_name !== target.role_name) {
        return json({ error: "You cannot change your own role" }, 400);
      }
      let nextBranch = body.branch_id !== undefined ? (body.branch_id ? Number(body.branch_id) : null) : target.branch_id;
      const nextCareScope = nextRoleName === "Customer Care"
        ? (CARE_SCOPES.includes(String(body.care_scope || target.care_scope || "branch").toLowerCase())
          ? String(body.care_scope || target.care_scope || "branch").toLowerCase() : "branch")
        : null;
      if (nextCareScope === "national") nextBranch = null;
      if (actor.role_name === "Branch Manager" && nextBranch !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (nextBranch !== null) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(nextBranch).first();
        if (!branch) return json({ error: "Branch not found" }, 400);
      } else if (nextRoleName !== "Managing Director" && nextCareScope !== "national") {
        return json({ error: "Branch is required for staff accounts" }, 400);
      }
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(nextRoleName).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      if (body.email) {
        const duplicate = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=? AND id<>?").bind(String(body.email).toLowerCase().trim(), target.id).first();
        if (duplicate) return json({ error: "Email already used" }, 409);
      }
      const fullName = body.full_name !== undefined ? String(body.full_name).trim() : target.full_name;
      if (!fullName) return json({ error: "Full name is required" }, 400);
      const email = body.email !== undefined ? String(body.email).toLowerCase().trim() : target.email;
      await env.DB.prepare(`
        UPDATE users SET full_name=?, email=?, role_id=?, branch_id=?, care_scope=?, updated_at=datetime('now') WHERE id=?
      `).bind(fullName, email, role.id, nextBranch, nextCareScope, target.id).run();
      if (nextRoleName === "Marketer" && (!target.access_valid_until || target.role_name !== "Marketer")) {
        await env.DB.prepare("UPDATE users SET access_valid_until=? WHERE id=?")
          .bind(endOfMonth(currentDate(env)), target.id).run();
      }
      await env.DB.prepare(`
        INSERT INTO staff_profiles (user_id, phone_number, job_title, date_joined, notes, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          phone_number=COALESCE(excluded.phone_number, staff_profiles.phone_number),
          job_title=COALESCE(excluded.job_title, staff_profiles.job_title),
          date_joined=COALESCE(excluded.date_joined, staff_profiles.date_joined),
          notes=COALESCE(excluded.notes, staff_profiles.notes),
          updated_by=excluded.updated_by,
          updated_at=datetime('now')
      `).bind(
        target.id,
        body.phone_number !== undefined ? (body.phone_number || null) : null,
        body.job_title !== undefined ? (body.job_title || null) : null,
        body.date_joined !== undefined ? dateOnly(body.date_joined) : null,
        body.notes !== undefined ? (body.notes || null) : null,
        actor.id
      ).run();
      if (body.commission_access !== undefined) {
        if (!["Managing Director", "Super Admin"].includes(actor.actual_role_name || actor.role_name)) {
          return json({ error: "Only the MD or Super Admin can grant commission access" }, 403);
        }
        await env.DB.prepare("UPDATE users SET commission_access=? WHERE id=?")
          .bind(isTruthy(body.commission_access) ? 1 : 0, target.id).run();
      }
      if (body.property_plans_access !== undefined) {
        if (!["Managing Director", "Super Admin", "Head Accountant"].includes(actor.actual_role_name || actor.role_name)) {
          return json({ error: "Only the MD, Head Accountant or Super Admin can grant property plan access" }, 403);
        }
        await env.DB.prepare("UPDATE users SET property_plans_access=? WHERE id=?")
          .bind(isTruthy(body.property_plans_access) ? 1 : 0, target.id).run();
      }
      if (body.sms_access !== undefined) {
        if (!["Managing Director", "Super Admin", "Head Accountant"].includes(actor.actual_role_name || actor.role_name)) {
          return json({ error: "Only the MD, Head Accountant or Super Admin can grant SMS access" }, 403);
        }
        await env.DB.prepare("UPDATE users SET sms_access=? WHERE id=?")
          .bind(isTruthy(body.sms_access) ? 1 : 0, target.id).run();
      }
      if (body.branch_id !== undefined && Number(nextBranch) !== Number(target.branch_id)) {
        await env.DB.prepare(`
          DELETE FROM team_members WHERE user_id=? AND team_id IN (SELECT id FROM teams WHERE branch_id<>?)
        `).bind(target.id, nextBranch).run();
        await env.DB.prepare(`
          UPDATE teams SET team_lead_user_id=NULL WHERE team_lead_user_id=? AND branch_id<>?
        `).bind(target.id, nextBranch).run();
      }
      await audit(env, actor.id, "staff.update", "user", String(target.id), {
        before: { full_name: target.full_name, email: target.email, role: target.role_name, branch_id: target.branch_id },
        after: { full_name: fullName, email, role: nextRoleName, branch_id: nextBranch }
      }, nextBranch);
      return json({ ok: true });
    }

    if (path === "/api/staff/access-settings" && (request.method === "GET" || request.method === "PUT")) {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Super Admin"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      if (request.method === "PUT" && actor.actual_role_name !== "Super Admin" && actor.role_name !== "Managing Director") {
        return json({ error: "Only the MD or Super Admin can change access settings" }, 403);
      }
      if (request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT role_name, monthly_reactivation_enabled FROM role_access_settings ORDER BY role_name").all();
        return json({ settings: results });
      }
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const roleName = String(body.role_name || "").trim();
      if (!roleName) return json({ error: "Role name is required" }, 400);
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(roleName).first();
      if (!role) return json({ error: "Role not found" }, 404);
      const enabled = isTruthy(body.enabled) ? 1 : 0;
      await env.DB.prepare(`
        INSERT INTO role_access_settings (role_name, monthly_reactivation_enabled, updated_by, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(role_name) DO UPDATE SET monthly_reactivation_enabled=excluded.monthly_reactivation_enabled,
          updated_by=excluded.updated_by, updated_at=datetime('now')
      `).bind(roleName, enabled, actor.id).run();
      await audit(env, actor.id, "staff.access_setting", "role", roleName, { enabled }, actor.branch_id);
      return json({ ok: true, role_name: roleName, enabled });
    }

    if (path === "/api/staff/reactivation-pending" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Super Admin"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const clauses = ["r.name='Marketer'", "s.monthly_reactivation_enabled=1", "u.access_valid_until IS NOT NULL", "date(u.access_valid_until) < date(?)"];
      const binds = [currentDate(env)];
      if (actor.role_name === "Branch Manager") { clauses.push("u.branch_id=?"); binds.push(actor.branch_id); }
      const { results } = await env.DB.prepare(`
        SELECT u.id, u.email, u.full_name, u.is_active, u.branch_id, u.access_valid_until, u.access_lapsed_at,
               u.reactivated_at, b.name AS branch_name, r.name AS role_name
        FROM users u JOIN roles r ON r.id=u.role_id
        LEFT JOIN branches b ON b.id=u.branch_id
        JOIN role_access_settings s ON s.role_name=r.name
        WHERE ${clauses.join(" AND ")}
        ORDER BY u.access_valid_until, u.full_name
      `).bind(...binds).all();
      return json({ pending: results });
    }

    const staffReactivateMatch = path.match(/^\/api\/staff\/(\d+)\/reactivate$/);
    if (staffReactivateMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager", "Super Admin"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const target = await env.DB.prepare(`
        SELECT u.id, u.branch_id, u.email, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?
      `).bind(staffReactivateMatch[1]).first();
      if (!target) return json({ error: "Staff member not found" }, 404);
      if (target.role_name !== "Marketer") return json({ error: "Only marketer accounts use monthly reactivation" }, 400);
      if (actor.role_name === "Branch Manager" && Number(target.branch_id) !== Number(actor.branch_id)) return json({ error: "Cross-branch forbidden" }, 403);
      const validUntil = endOfMonth(currentDate(env));
      await env.DB.prepare(`
        UPDATE users SET is_active=1, access_valid_until=?, access_lapsed_at=NULL,
          reactivated_at=datetime('now'), reactivated_by=?, deactivated_at=NULL, updated_at=datetime('now')
        WHERE id=?
      `).bind(validUntil, actor.id, target.id).run();
      await audit(env, actor.id, "marketer.reactivated", "user", String(target.id), { valid_until: validUntil }, target.branch_id);
      return json({ ok: true, valid_until: validUntil });
    }


    const staffStatusMatch = path.match(/^\/api\/staff\/(\d+)\/status$/);
    if (staffStatusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const target = await env.DB.prepare(`
        SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND r.name<>'Client'
      `).bind(staffStatusMatch[1]).first();
      if (!target) return json({ error: "Staff member not found" }, 404);
      if (Number(target.id) === Number(actor.id)) return json({ error: "You cannot deactivate your own account" }, 400);
      if (actor.role_name === "Branch Manager" &&
          (Number(target.branch_id) !== Number(actor.branch_id) || ["Managing Director", "Branch Manager"].includes(target.role_name))) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json();
      if (body.active === undefined) return json({ error: "Active state is required" }, 400);
      const active = isTruthy(body.active);
      if (!active && target.role_name === "Managing Director") {
        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id
          WHERE r.name='Managing Director' AND u.is_active=1
        `).first();
        if (Number(count ? count.c : 0) <= 1) return json({ error: "Cannot deactivate the last active Managing Director" }, 400);
      }
      await env.DB.prepare(`
        UPDATE users SET is_active=?, deactivated_at=?, updated_at=datetime('now') WHERE id=?
      `).bind(active ? 1 : 0, active ? null : new Date().toISOString(), target.id).run();
      if (!active) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id).run();
      await audit(env, actor.id, active ? "staff.activate" : "staff.deactivate", "user", String(target.id), null, target.branch_id);
      return json({ ok: true, active });
    }

    const staffTeamsMatch = path.match(/^\/api\/staff\/(\d+)\/teams$/);
    if (staffTeamsMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const target = await env.DB.prepare(`
        SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=? AND r.name<>'Client'
      `).bind(staffTeamsMatch[1]).first();
      if (!target) return json({ error: "Staff member not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(target.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json();
      const teamIds = Array.isArray(body.team_ids) ? body.team_ids.map(Number).filter(Number.isFinite) : [];
      if (teamIds.length) {
        const { results: teams } = await env.DB.prepare(`
          SELECT id, branch_id FROM teams WHERE id IN (${placeholders(teamIds)}) AND is_active=1
        `).bind(...teamIds).all();
        if (teams.length !== teamIds.length || teams.some(t => Number(t.branch_id) !== Number(target.branch_id))) {
          return json({ error: "All teams must belong to the staff member's branch" }, 400);
        }
      }
      await env.DB.prepare("DELETE FROM team_members WHERE user_id=?").bind(target.id).run();
      for (const teamId of teamIds) {
        await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(teamId, target.id).run();
      }
      await audit(env, actor.id, "staff.teams", "user", String(target.id), { team_ids: teamIds }, target.branch_id);
      return json({ ok: true, team_ids: teamIds });
    }

    // ---- Team detail and management ----
    const teamMatch = path.match(/^\/api\/teams\/(\d+)$/);
    if (teamMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (["Client", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const team = await env.DB.prepare(`
        SELECT t.*, b.name AS branch_name, u.full_name AS team_lead_name
        FROM teams t LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN users u ON u.id=t.team_lead_user_id
        WHERE t.id=?
      `).bind(teamMatch[1]).first();
      if (!team) return json({ error: "Team not found" }, 404);
      const scope = await resolvePhase6Scope(env, actor);
      if (actor.role_name === "Branch Manager" && Number(team.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (["Team Lead", "Marketer"].includes(actor.role_name) && !scope.teamIds.includes(team.id)) {
        return json({ error: "Forbidden" }, 403);
      }
      const { results: members } = await env.DB.prepare(`
        SELECT u.id, u.full_name, u.email, u.is_active, r.name AS role_name, b.name AS branch_name
        FROM team_members tm JOIN users u ON u.id=tm.user_id
        JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id
        WHERE tm.team_id=? ORDER BY u.full_name
      `).bind(team.id).all();
      return json({ team, members });
    }

    if (teamMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageStaff(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const team = await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(teamMatch[1]).first();
      if (!team) return json({ error: "Team not found" }, 404);
      if (actor.role_name === "Branch Manager" && Number(team.branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json();
      const name = body.name !== undefined ? String(body.name).trim() : team.name;
      if (!name) return json({ error: "Team name is required" }, 400);
      let branchId = body.branch_id !== undefined ? Number(body.branch_id) : team.branch_id;
      if (actor.role_name === "Branch Manager" && branchId !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branchId).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      let teamLeadId = body.team_lead_user_id !== undefined ? (body.team_lead_user_id || null) : team.team_lead_user_id;
      if (teamLeadId) {
        const lead = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(teamLeadId).first();
        if (!lead || Number(lead.branch_id) !== Number(branchId) || !["Team Lead", "Branch Manager"].includes(lead.role_name)) {
          return json({ error: "Team lead must be an active Team Lead or Branch Manager in this branch" }, 400);
        }
      }
      const isActive = body.is_active !== undefined ? (isTruthy(body.is_active) ? 1 : 0) : team.is_active;
      await env.DB.prepare(`
        UPDATE teams SET name=?, branch_id=?, team_lead_user_id=?, is_active=? WHERE id=?
      `).bind(name, branchId, teamLeadId, isActive, team.id).run();
      if (Array.isArray(body.member_ids)) {
        const memberIds = body.member_ids.map(Number).filter(Number.isFinite);
        if (memberIds.length) {
          const { results: members } = await env.DB.prepare(`
            SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
            WHERE u.id IN (${placeholders(memberIds)}) AND u.is_active=1
          `).bind(...memberIds).all();
          if (members.length !== memberIds.length || members.some(m => Number(m.branch_id) !== Number(branchId) || m.role_name === "Client")) {
            return json({ error: "All team members must be active staff in this branch" }, 400);
          }
        }
        await env.DB.prepare("DELETE FROM team_members WHERE team_id=?").bind(team.id).run();
        for (const memberId of memberIds) {
          await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(team.id, memberId).run();
        }
      }
      await audit(env, actor.id, "team.update", "team", String(team.id), { name, branch_id: branchId, team_lead_user_id: teamLeadId, is_active: isActive }, branchId);
      return json({ ok: true });
    }

    // ---- Lead pipeline ----
    if (path === "/api/leads" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const leadScope = leadScopeSql(scope, "l");
      const clauses = ["l.is_demo=0", leadScope.clause];
      const binds = [...leadScope.binds];
      if (["Managing Director"].includes(actor.role_name)) {
        const branchId = url.searchParams.get("branch_id");
        if (branchId) { clauses.push("l.branch_id=?"); binds.push(branchId); }
      }
      const status = url.searchParams.get("status");
      const marketerId = url.searchParams.get("marketer_id");
      const teamLeadId = url.searchParams.get("team_lead_id");
      const temperature = normalizeTemperature(url.searchParams.get("temperature"));
      const q = url.searchParams.get("q");
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      const stage = url.searchParams.get("stage");
      if (status || stage) { clauses.push("l.status=?"); binds.push(normalizeLeadStatus(status || stage, status || stage)); }
      if (marketerId) { clauses.push("l.assigned_marketer_id=?"); binds.push(marketerId); }
      if (teamLeadId) { clauses.push("l.team_lead_id=?"); binds.push(teamLeadId); }
      if (temperature) { clauses.push("l.lead_temperature=?"); binds.push(temperature); }
      if (q) { clauses.push("(l.full_name LIKE ? OR l.phone_number LIKE ? OR l.email_address LIKE ? OR l.lead_reference LIKE ? OR l.referrer LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
      if (from) { clauses.push("date(l.created_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(l.created_at) <= date(?)"); binds.push(to); }
      if (url.searchParams.get("follow_up_due") === "1") {
        clauses.push("l.next_follow_up_date IS NOT NULL AND date(l.next_follow_up_date) <= date('now') AND l.status NOT IN ('Converted','Lost')");
      }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const whereSql = "WHERE " + clauses.join(" AND ");
      const { results: leads } = await env.DB.prepare(`
        SELECT l.*, p.title AS property_title, p.reference AS property_reference,
               b.name AS branch_name, m.full_name AS marketer_name, tl.full_name AS team_lead_name,
               (SELECT COUNT(*) FROM lead_follow_ups f WHERE f.lead_id=l.id) AS follow_up_count,
               (SELECT COUNT(*) FROM lead_follow_ups f WHERE f.lead_id=l.id AND f.contacted_at IS NOT NULL) AS contact_count
        FROM leads l
        LEFT JOIN properties p ON p.id=l.property_id
        LEFT JOIN branches b ON b.id=l.branch_id
        LEFT JOIN users m ON m.id=l.assigned_marketer_id
        LEFT JOIN users tl ON tl.id=l.team_lead_id
        ${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM leads l ${whereSql}`).bind(...binds).first();
      const temperatureRows = await env.DB.prepare(`
        SELECT COALESCE(l.lead_temperature,'Unset') AS temperature, COUNT(*) AS c
        FROM leads l ${whereSql} GROUP BY COALESCE(l.lead_temperature,'Unset')
      `).bind(...binds).all();
      const temperatureCounts = { Hot: 0, Warm: 0, Cold: 0, Unset: 0 };
      for (const row of temperatureRows.results) temperatureCounts[row.temperature] = Number(row.c || 0);
      return json({ leads, temperature_counts: temperatureCounts, pagination: { page, limit, total: count ? count.c : 0 } });
    }

    if (path === "/api/leads" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const body = await request.json();
      const { full_name, phone_number, email_address, source, referrer, status, lead_temperature, property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value, notes, next_follow_up_date, lost_reason } = body || {};
      if (!full_name || !phone_number) return json({ error: "Full name and phone number are required" }, 400);
      if (!isValidLeadPhone(phone_number)) return json({ error: "A valid Nigerian phone number is required" }, 400);
      const normalizedLeadPhone = normalizeNigerianPhone(phone_number);
      const leadStatus = normalizeLeadStatus(status, "New Lead");
      if (!LEAD_STATUSES.includes(leadStatus) || leadStatus === "Converted") {
        return json({ error: "Invalid initial lead status" }, 400);
      }
      const temperature = normalizeTemperature(lead_temperature);
      if (lead_temperature && !temperature) return json({ error: "Lead temperature must be Hot, Warm or Cold" }, 400);
      if (leadStatus === "Lost" && !String(lost_reason || "").trim()) {
        return json({ error: "A lost reason is required" }, 400);
      }
      if (actor.role_name !== "Managing Director" && branch_id && Number(branch_id) !== Number(actor.branch_id)) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      let resolvedBranch = branch_id || actor.branch_id;
      if (actor.role_name === "Branch Manager") resolvedBranch = actor.branch_id;
      if (["Team Lead", "Marketer"].includes(actor.role_name)) resolvedBranch = actor.branch_id;
      if (!resolvedBranch) return json({ error: "Branch is required" }, 400);
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(resolvedBranch).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      let marketerId = assigned_marketer_id || null;
      if (actor.role_name === "Marketer") marketerId = actor.id;
      if (marketerId) {
        const marketer = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(marketerId).first();
        if (!marketer || Number(marketer.branch_id) !== Number(resolvedBranch) || !["Marketer", "Team Lead", "Branch Manager"].includes(marketer.role_name)) {
          return json({ error: "Assigned marketer must be active staff in this branch" }, 400);
        }
        if (actor.role_name === "Team Lead" && !scope.memberIds.includes(Number(marketerId))) {
          return json({ error: "Marketer is not in your team" }, 403);
        }
      } else if (actor.role_name === "Marketer") {
        marketerId = actor.id;
      }
      let teamLead = team_lead_id || null;
      if (actor.role_name === "Team Lead") teamLead = actor.id;
      if (actor.role_name === "Marketer" && !teamLead) teamLead = scope.teamLeadIds[0] || null;
      if (teamLead) {
        const lead = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(teamLead).first();
        if (!lead || Number(lead.branch_id) !== Number(resolvedBranch) || !["Team Lead", "Branch Manager"].includes(lead.role_name)) {
          return json({ error: "Team lead must be an active Team Lead or Branch Manager in the same branch" }, 400);
        }
      }
      if (property_id) {
        const property = await env.DB.prepare("SELECT id, branch_id FROM properties WHERE id=?").bind(property_id).first();
        if (!property) return json({ error: "Property not found" }, 404);
        if (property.branch_id && Number(property.branch_id) !== Number(resolvedBranch)) {
          return json({ error: "Property must belong to the lead branch" }, 400);
        }
      }
      const followUp = next_follow_up_date ? dateOnly(next_follow_up_date) : null;
      if (next_follow_up_date && !followUp) return json({ error: "Invalid follow-up date" }, 400);
      const estimatedKobo = estimated_value !== undefined && estimated_value !== null && estimated_value !== "" ? toKobo(estimated_value) : 0;
      if (!Number.isFinite(estimatedKobo) || estimatedKobo < 0) return json({ error: "Estimated value is invalid" }, 400);
      const ref = "LEAD-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const res = await env.DB.prepare(`
        INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source, referrer, status,
          lead_temperature, temperature_updated_at, lost_reason,
          property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value_kobo,
          notes, next_follow_up_date, created_by, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      `).bind(
        ref, full_name.trim(), normalizedLeadPhone, email_address || null, source || null, referrer || null, leadStatus,
        temperature, temperature ? new Date().toISOString() : null,
        leadStatus === "Lost" ? String(lost_reason).trim() : null,
        property_id || null, marketerId, teamLead, resolvedBranch, estimatedKobo,
        notes || null, followUp, actor.id
      ).run();
      const leadId = res.meta.last_row_id;
      await audit(env, actor.id, "lead.create", "lead", String(leadId), { lead_reference: ref, status: leadStatus }, resolvedBranch);
      await createNotification(env, {
        userId: marketerId || teamLead || actor.id,
        type: "lead.assigned",
        title: "New Lead Assigned",
        message: `Lead ${ref} (${full_name}) has been added to the ${leadStatus} pipeline.`,
        metadata: { lead_id: leadId, lead_reference: ref }
      });
      return json({ ok: true, id: leadId, lead_reference: ref });
    }

    const leadMatch = path.match(/^\/api\/leads\/(\d+)$/);
    if (leadMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare(`
        SELECT l.*, p.title AS property_title, p.reference AS property_reference,
               b.name AS branch_name, m.full_name AS marketer_name, tl.full_name AS team_lead_name
        FROM leads l
        LEFT JOIN properties p ON p.id=l.property_id
        LEFT JOIN branches b ON b.id=l.branch_id
        LEFT JOIN users m ON m.id=l.assigned_marketer_id
        LEFT JOIN users tl ON tl.id=l.team_lead_id
        WHERE l.id=?
      `).bind(leadMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const { results: followUps } = await env.DB.prepare(`
        SELECT f.*, u.full_name AS staff_name FROM lead_follow_ups f
        LEFT JOIN users u ON u.id=f.staff_id WHERE f.lead_id=? ORDER BY f.created_at DESC, f.id DESC
      `).bind(lead.id).all();
      const { results: activity } = await env.DB.prepare(`
        SELECT al.id, al.action, al.created_at, u.full_name AS actor_name
        FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
        WHERE al.target_type='lead' AND al.target_id=? ORDER BY al.id DESC LIMIT 20
      `).bind(String(lead.id)).all();
      const { results: temperatureHistory } = await env.DB.prepare(`
        SELECT h.*, u.full_name AS changed_by_name FROM lead_temperature_history h
        LEFT JOIN users u ON u.id=h.changed_by WHERE h.lead_id=? ORDER BY h.id DESC
      `).bind(lead.id).all();
      return json({ lead, follow_ups: followUps, temperature_history: temperatureHistory, activity });
    }

    if (leadMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const body = await request.json();
      if (body.assigned_marketer_id !== undefined && actor.role_name === "Marketer") {
        return json({ error: "Marketers cannot reassign leads" }, 403);
      }
      if (body.branch_id !== undefined && actor.role_name !== "Managing Director") {
        return json({ error: "Only the Managing Director can move a lead between branches" }, 403);
      }
      const nextBranch = body.branch_id !== undefined ? Number(body.branch_id) : lead.branch_id;
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(nextBranch).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      let nextMarketer = body.assigned_marketer_id !== undefined ? (body.assigned_marketer_id || null) : lead.assigned_marketer_id;
      if (nextMarketer) {
        const marketer = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(nextMarketer).first();
        if (!marketer || Number(marketer.branch_id) !== Number(nextBranch) || !["Marketer", "Team Lead", "Branch Manager"].includes(marketer.role_name)) {
          return json({ error: "Assigned marketer must be active staff in this branch" }, 400);
        }
        if (actor.role_name === "Team Lead" && !scope.memberIds.includes(Number(nextMarketer))) {
          return json({ error: "Marketer is not in your team" }, 403);
        }
      }
      let nextTeamLead = body.team_lead_id !== undefined ? (body.team_lead_id || null) : lead.team_lead_id;
      if (nextTeamLead) {
        const tl = await env.DB.prepare(`
          SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=? AND u.is_active=1
        `).bind(nextTeamLead).first();
        if (!tl || Number(tl.branch_id) !== Number(nextBranch) || !["Team Lead", "Branch Manager"].includes(tl.role_name)) {
          return json({ error: "Team lead must be an active Team Lead or Branch Manager in the same branch" }, 400);
        }
      }
      if (body.property_id) {
        const property = await env.DB.prepare("SELECT id, branch_id FROM properties WHERE id=?").bind(body.property_id).first();
        if (!property) return json({ error: "Property not found" }, 404);
        if (property.branch_id && Number(property.branch_id) !== Number(nextBranch)) {
          return json({ error: "Property must belong to the lead branch" }, 400);
        }
      }
      const followUp = body.next_follow_up_date !== undefined
        ? (body.next_follow_up_date ? dateOnly(body.next_follow_up_date) : null)
        : lead.next_follow_up_date;
      if (body.next_follow_up_date && !followUp) return json({ error: "Invalid follow-up date" }, 400);
      let estimatedKobo = lead.estimated_value_kobo;
      if (body.estimated_value !== undefined) {
        estimatedKobo = body.estimated_value === null || body.estimated_value === "" ? 0 : toKobo(body.estimated_value);
        if (!Number.isFinite(estimatedKobo) || estimatedKobo < 0) return json({ error: "Estimated value is invalid" }, 400);
      }
      const nextStatus = body.status !== undefined ? normalizeLeadStatus(body.status, body.status) : lead.status;
      if (body.status !== undefined) {
        if (!LEAD_STATUSES.includes(nextStatus) || nextStatus === "Converted") {
          return json({ error: "Use the conversion endpoint to convert a lead" }, 400);
        }
        if (lead.converted_client_id || lead.status === "Converted") {
          return json({ error: "A converted lead cannot be moved back into the open pipeline" }, 409);
        }
      }
      const nextTemperature = body.lead_temperature !== undefined || body.temperature !== undefined
        ? normalizeTemperature(body.lead_temperature !== undefined ? body.lead_temperature : body.temperature)
        : lead.lead_temperature;
      if ((body.lead_temperature !== undefined || body.temperature !== undefined) && !nextTemperature) {
        return json({ error: "Lead temperature must be Hot, Warm or Cold" }, 400);
      }
      const nextLostReason = nextStatus === "Lost"
        ? String(body.lost_reason !== undefined ? body.lost_reason : (lead.lost_reason || "")).trim()
        : null;
      if (nextStatus === "Lost" && !nextLostReason) return json({ error: "A lost reason is required" }, 400);
      let nextPhone = lead.phone_number;
      if (body.phone_number !== undefined) {
        nextPhone = normalizeNigerianPhone(body.phone_number);
        if (!nextPhone) return json({ error: "A valid Nigerian phone number is required" }, 400);
      }
      await env.DB.prepare(`
        UPDATE leads SET full_name=?, phone_number=?, email_address=?, source=?, referrer=?, status=?,
          lead_temperature=?, temperature_updated_at=?, lost_reason=?,
          property_id=?, assigned_marketer_id=?, team_lead_id=?, branch_id=?,
          estimated_value_kobo=?, notes=?, next_follow_up_date=?, updated_at=datetime('now')
        WHERE id=?
      `).bind(
        body.full_name !== undefined ? String(body.full_name).trim() : lead.full_name,
        nextPhone,
        body.email_address !== undefined ? (body.email_address || null) : lead.email_address,
        body.source !== undefined ? (body.source || null) : lead.source,
        body.referrer !== undefined ? (body.referrer || null) : lead.referrer,
        nextStatus,
        nextTemperature,
        nextTemperature !== lead.lead_temperature ? new Date().toISOString() : lead.temperature_updated_at,
        nextLostReason,
        body.property_id !== undefined ? (body.property_id || null) : lead.property_id,
        nextMarketer,
        nextTeamLead,
        nextBranch,
        estimatedKobo,
        body.notes !== undefined ? (body.notes || null) : lead.notes,
        followUp,
        lead.id
      ).run();
      if (nextTemperature !== lead.lead_temperature) {
        await env.DB.prepare(`
          INSERT INTO lead_temperature_history (lead_id, old_temperature, new_temperature, changed_by, reason)
          VALUES (?, ?, ?, ?, ?)
        `).bind(lead.id, lead.lead_temperature || null, nextTemperature, actor.id, body.temperature_reason || null).run();
      }
      await audit(env, actor.id, "lead.update", "lead", String(lead.id), {
        before: { status: lead.status, marketer: lead.assigned_marketer_id, branch_id: lead.branch_id, temperature: lead.lead_temperature },
        after: { status: nextStatus, marketer: nextMarketer, branch_id: nextBranch, temperature: nextTemperature, lost_reason: nextLostReason }
      }, nextBranch);
      if (nextMarketer && Number(nextMarketer) !== Number(lead.assigned_marketer_id)) {
        await createNotification(env, {
          userId: nextMarketer,
          type: "lead.assigned",
          title: "Lead Reassigned",
          message: `Lead ${lead.lead_reference} (${lead.full_name}) has been assigned to you.`,
          metadata: { lead_id: lead.id }
        });
      }
      return json({ ok: true });
    }

    const leadStatusMatch = path.match(/^\/api\/leads\/(\d+)\/status$/);
    if (leadStatusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadStatusMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const body = await request.json();
      const status = normalizeLeadStatus(body.status, body.status);
      if (!LEAD_STATUSES.includes(status)) return json({ error: "Invalid lead status" }, 400);
      if (status === "Converted") return json({ error: "Use the conversion endpoint to convert a lead" }, 400);
      if (lead.converted_client_id || lead.status === "Converted") {
        return json({ error: "A converted lead cannot be moved back into the open pipeline" }, 409);
      }
      const lostReason = status === "Lost" ? String(body.lost_reason || "").trim() : null;
      if (status === "Lost" && !lostReason) return json({ error: "A lost reason is required" }, 400);
      await env.DB.prepare(`
        UPDATE leads SET status=?, lost_reason=?, last_contact_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(status, lostReason, lead.id).run();
      await audit(env, actor.id, "lead.status", "lead", String(lead.id), { from: lead.status, to: status, lost_reason: lostReason }, lead.branch_id);
      await createNotification(env, {
        userId: lead.assigned_marketer_id || actor.id,
        type: "lead.status",
        title: "Lead Status Updated",
        message: `Lead ${lead.lead_reference} moved from ${lead.status} to ${status}.`,
        metadata: { lead_id: lead.id, status }
      });
      return json({ ok: true, status });
    }

    const leadTemperatureMatch = path.match(/^\/api\/leads\/(\d+)\/temperature$/);
    if (leadTemperatureMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadTemperatureMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const body = await request.json();
      const temperature = normalizeTemperature(body.temperature);
      if (!temperature) return json({ error: "Lead temperature must be Hot, Warm or Cold" }, 400);
      if (temperature === lead.lead_temperature) return json({ ok: true, temperature, unchanged: true });
      await env.DB.prepare(`
        UPDATE leads SET lead_temperature=?, temperature_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(temperature, lead.id).run();
      await env.DB.prepare(`
        INSERT INTO lead_temperature_history (lead_id, old_temperature, new_temperature, changed_by, reason)
        VALUES (?, ?, ?, ?, ?)
      `).bind(lead.id, lead.lead_temperature || null, temperature, actor.id, body.reason ? String(body.reason).trim() : null).run();
      await audit(env, actor.id, "lead.temperature", "lead", String(lead.id), {
        from: lead.lead_temperature || null, to: temperature, reason: body.reason || null
      }, lead.branch_id);
      return json({ ok: true, temperature });
    }

    const leadFollowUpMatch = path.match(/^\/api\/leads\/(\d+)\/follow-ups$/);
    if (leadFollowUpMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadFollowUpMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const body = await request.json();
      const note = String(body.note || "").trim();
      if (!note) return json({ error: "Follow-up note is required" }, 400);
      if (note.length > 2000) return json({ error: "Follow-up note is too long" }, 400);
      const followUpDate = body.follow_up_date ? dateOnly(body.follow_up_date) : null;
      if (body.follow_up_date && !followUpDate) return json({ error: "Invalid follow-up date" }, 400);
      const contactType = CARE_CALL_TYPES.includes(body.contact_type) ? body.contact_type : (body.channel || "call");
      const contactedAt = body.contacted_at ? new Date(body.contacted_at) : new Date();
      if (body.contacted_at && isNaN(contactedAt.getTime())) return json({ error: "Invalid contact date" }, 400);
      const res = await env.DB.prepare(`
        INSERT INTO lead_follow_ups (lead_id, staff_id, note, channel, outcome, follow_up_date, contact_type, contacted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(lead.id, actor.id, note, body.channel || contactType, body.outcome || null, followUpDate, contactType, contactedAt.toISOString()).run();
      await env.DB.prepare(`
        UPDATE leads SET last_contact_at=?, next_follow_up_date=COALESCE(?, next_follow_up_date),
          updated_at=datetime('now') WHERE id=?
      `).bind(contactedAt.toISOString(), followUpDate, lead.id).run();
      await audit(env, actor.id, "lead.followup", "lead", String(lead.id), { follow_up_id: res.meta.last_row_id, follow_up_date: followUpDate }, lead.branch_id);
      await createNotification(env, {
        userId: lead.assigned_marketer_id || actor.id,
        type: "lead.followup",
        title: "Follow-up Recorded",
        message: `A follow-up was recorded for lead ${lead.lead_reference}${followUpDate ? `, next date ${followUpDate}` : ""}.`,
        metadata: { lead_id: lead.id, follow_up_id: res.meta.last_row_id }
      });
      return json({ ok: true, id: res.meta.last_row_id });
    }

    const leadFollowUpUpdateMatch = path.match(/^\/api\/leads\/(\d+)\/follow-ups\/(\d+)$/);
    if (leadFollowUpUpdateMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadFollowUpUpdateMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      const followUp = await env.DB.prepare("SELECT * FROM lead_follow_ups WHERE id=? AND lead_id=?")
        .bind(leadFollowUpUpdateMatch[2], lead.id).first();
      if (!followUp) return json({ error: "Follow-up not found" }, 404);
      const body = await request.json();
      const note = body.note !== undefined ? String(body.note).trim() : followUp.note;
      if (!note) return json({ error: "Follow-up note is required" }, 400);
      if (note.length > 2000) return json({ error: "Follow-up note is too long" }, 400);
      const followUpDate = body.follow_up_date !== undefined
        ? (body.follow_up_date ? dateOnly(body.follow_up_date) : null)
        : followUp.follow_up_date;
      if (body.follow_up_date && !followUpDate) return json({ error: "Invalid follow-up date" }, 400);
      await env.DB.prepare(`
        UPDATE lead_follow_ups SET note=?, channel=?, outcome=?, follow_up_date=?, contact_type=?, contacted_at=? WHERE id=?
      `).bind(note, body.channel !== undefined ? (body.channel || null) : followUp.channel,
        body.outcome !== undefined ? (body.outcome || null) : followUp.outcome,
        followUpDate,
        body.contact_type !== undefined ? (CARE_CALL_TYPES.includes(body.contact_type) ? body.contact_type : followUp.contact_type) : followUp.contact_type,
        body.contacted_at !== undefined ? (body.contacted_at ? new Date(body.contacted_at).toISOString() : null) : followUp.contacted_at,
        followUp.id).run();
      if (body.follow_up_date !== undefined) {
        await env.DB.prepare("UPDATE leads SET next_follow_up_date=?, updated_at=datetime('now') WHERE id=?")
          .bind(followUpDate, lead.id).run();
      }
      await audit(env, actor.id, "lead.followup.update", "lead", String(lead.id), { follow_up_id: followUp.id }, lead.branch_id);
      return json({ ok: true });
    }

    const leadInspectionMatch = path.match(/^\/api\/leads\/(\d+)\/inspection$/);
    if (leadInspectionMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadInspectionMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      if (lead.converted_client_id) return json({ error: "Converted leads cannot be scheduled" }, 409);
      const body = await request.json();
      const inspectionDate = dateOnly(body.inspection_date);
      if (!inspectionDate) return json({ error: "A valid inspection date is required" }, 400);
      const inspectionTime = String(body.inspection_time || "").trim();
      if (!/^\d{2}:\d{2}$/.test(inspectionTime)) return json({ error: "Inspection time must be HH:MM" }, 400);
      const inspectionPropertyId = body.property_id || body.inspection_property_id || lead.property_id || null;
      if (inspectionPropertyId) {
        const property = await env.DB.prepare("SELECT id, branch_id FROM properties WHERE id=?").bind(inspectionPropertyId).first();
        if (!property) return json({ error: "Property not found" }, 404);
        if (property.branch_id && Number(property.branch_id) !== Number(lead.branch_id)) {
          return json({ error: "Inspection property must belong to the lead branch" }, 400);
        }
      }
      const notes = body.notes !== undefined ? (String(body.notes || "").trim() || null) : lead.inspection_notes;
      await env.DB.prepare(`
        UPDATE leads SET inspection_date=?, inspection_time=?, inspection_property_id=?, inspection_notes=?,
          property_id=COALESCE(?, property_id), status='Inspection Scheduled',
          last_contact_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(inspectionDate, inspectionTime, inspectionPropertyId, notes, inspectionPropertyId, lead.id).run();
      await audit(env, actor.id, "lead.inspection", "lead", String(lead.id), {
        inspection_date: inspectionDate, inspection_time: inspectionTime, property_id: inspectionPropertyId
      }, lead.branch_id);
      await createNotification(env, {
        userId: lead.assigned_marketer_id || actor.id,
        type: "lead.inspection",
        title: "Inspection Scheduled",
        message: `Inspection for ${lead.full_name} (${lead.lead_reference}) is scheduled for ${inspectionDate} at ${inspectionTime}.`,
        metadata: { lead_id: lead.id, inspection_date: inspectionDate, inspection_time: inspectionTime }
      });
      return json({ ok: true, status: "Inspection Scheduled", inspection_date: inspectionDate, inspection_time: inspectionTime, property_id: inspectionPropertyId });
    }

    if (path === "/api/inspections/summary" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const leadScope = leadScopeSql(scope, "l");
      const today = todayOnly();
      const weekEnd = addDays(today, 7);
      const clauses = [leadScope.clause, "l.is_demo=0", "date(l.inspection_date) BETWEEN date(?) AND date(?)", "l.status='Inspection Scheduled'"];
      const binds = [...leadScope.binds, today, weekEnd];
      const branchId = url.searchParams.get("branch_id");
      if (branchId) { clauses.push("l.branch_id=?"); binds.push(Number(branchId)); }
      const marketerId = url.searchParams.get("marketer_id");
      if (marketerId) { clauses.push("l.assigned_marketer_id=?"); binds.push(Number(marketerId)); }
      const whereSql = clauses.join(" AND ");
      const todayRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${whereSql} AND date(l.inspection_date)=date(?)`)
        .bind(...binds, today).first();
      const weekRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${whereSql}`)
        .bind(...binds).first();
      const { results: byBranch } = await env.DB.prepare(`
        SELECT l.branch_id, b.name AS branch_name,
          SUM(CASE WHEN date(l.inspection_date)=date(?) THEN 1 ELSE 0 END) AS today_count,
          COUNT(*) AS week_count
        FROM leads l LEFT JOIN branches b ON b.id=l.branch_id
        WHERE ${whereSql} GROUP BY l.branch_id ORDER BY week_count DESC
      `).bind(today, ...binds).all();
      const { results: byMarketer } = await env.DB.prepare(`
        SELECT l.assigned_marketer_id AS marketer_id, u.full_name AS marketer_name,
          SUM(CASE WHEN date(l.inspection_date)=date(?) THEN 1 ELSE 0 END) AS today_count,
          COUNT(*) AS week_count
        FROM leads l LEFT JOIN users u ON u.id=l.assigned_marketer_id
        WHERE ${whereSql} GROUP BY l.assigned_marketer_id ORDER BY week_count DESC
      `).bind(today, ...binds).all();
      const { results: upcoming } = await env.DB.prepare(`
        SELECT l.id, l.lead_reference, l.full_name, l.phone_number, l.inspection_date, l.inspection_time,
               l.inspection_property_id, p.title AS property_title, b.name AS branch_name,
               m.full_name AS marketer_name
        FROM leads l
        LEFT JOIN properties p ON p.id=l.inspection_property_id
        LEFT JOIN branches b ON b.id=l.branch_id
        LEFT JOIN users m ON m.id=l.assigned_marketer_id
        WHERE ${whereSql} ORDER BY l.inspection_date, l.inspection_time LIMIT 100
      `).bind(...binds).all();
      return json({
        today: Number(todayRow ? todayRow.c : 0),
        this_week: Number(weekRow ? weekRow.c : 0),
        from: today,
        to: weekEnd,
        by_branch: byBranch,
        by_marketer: byMarketer,
        upcoming
      });
    }

    const leadBulkMatch = path === "/api/leads/bulk" && request.method === "POST";
    if (leadBulkMatch) {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      let rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length && typeof body.csv === "string") {
        rows = parseLeadCsv(body.csv);
      }
      if (!rows.length) return json({ error: "Provide rows or CSV/paste content" }, 400);
      if (rows.length > 500) return json({ error: "A maximum of 500 leads can be imported at once" }, 400);
      const created = [];
      const skipped = [];
      for (let index = 0; index < rows.length; index++) {
        const row = normalizeLeadImportRow(rows[index]);
        if (!row.full_name || !row.phone_number) {
          skipped.push({ row: index + 1, reason: "Full name and phone number are required" });
          continue;
        }
        if (!isValidLeadPhone(row.phone_number)) {
          skipped.push({ row: index + 1, reason: "A valid Nigerian phone number is required" });
          continue;
        }
        const status = normalizeLeadStatus(row.status, "New Lead");
        if (!LEAD_STATUSES.includes(status) || status === "Converted") {
          skipped.push({ row: index + 1, reason: "Invalid lead status" });
          continue;
        }
        const inferredMarketerId = row.assigned_marketer_id ? Number(row.assigned_marketer_id) : null;
        let inferredBranchId = row.branch_id ? Number(row.branch_id) : null;
        if (!inferredBranchId && inferredMarketerId) {
          const marketerBranch = await env.DB.prepare("SELECT branch_id FROM users WHERE id=?").bind(inferredMarketerId).first();
          if (marketerBranch && marketerBranch.branch_id) inferredBranchId = Number(marketerBranch.branch_id);
        }
        const branchId = actor.role_name === "Managing Director"
          ? (inferredBranchId || actor.branch_id)
          : actor.branch_id;
        if (!branchId) {
          skipped.push({ row: index + 1, reason: "Branch is required" });
          continue;
        }
        let marketerId = inferredMarketerId;
        if (!marketerId && actor.role_name === "Marketer") marketerId = actor.id;
        if (marketerId) {
          const marketer = await env.DB.prepare(`
            SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
            WHERE u.id=? AND u.is_active=1
          `).bind(marketerId).first();
          if (!marketer || Number(marketer.branch_id) !== Number(branchId) || !["Marketer", "Team Lead", "Branch Manager"].includes(marketer.role_name)) {
            skipped.push({ row: index + 1, reason: "Assigned marketer is not active in the branch" });
            continue;
          }
        }
        let teamLeadId = row.team_lead_id ? Number(row.team_lead_id) : null;
        if (actor.role_name === "Team Lead") teamLeadId = actor.id;
        if (teamLeadId) {
          const teamLead = await env.DB.prepare(`
            SELECT u.id, u.branch_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
            WHERE u.id=? AND u.is_active=1
          `).bind(teamLeadId).first();
          if (!teamLead || Number(teamLead.branch_id) !== Number(branchId) || !["Team Lead", "Branch Manager"].includes(teamLead.role_name)) {
            skipped.push({ row: index + 1, reason: "Team lead is not active in the branch" });
            continue;
          }
        }
        const propertyId = row.property_id ? Number(row.property_id) : null;
        if (propertyId) {
          const property = await env.DB.prepare("SELECT id, branch_id FROM properties WHERE id=?").bind(propertyId).first();
          if (!property || (property.branch_id && Number(property.branch_id) !== Number(branchId))) {
            skipped.push({ row: index + 1, reason: "Property is not valid for the branch" });
            continue;
          }
        }
        const estimatedKobo = row.estimated_value !== undefined && row.estimated_value !== ""
          ? toKobo(row.estimated_value) : 0;
        if (!Number.isFinite(estimatedKobo) || estimatedKobo < 0) {
          skipped.push({ row: index + 1, reason: "Estimated value is invalid" });
          continue;
        }
        const ref = "LEAD-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
        const res = await env.DB.prepare(`
          INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source, referrer, status, lead_temperature,
            property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value_kobo,
            notes, next_follow_up_date, created_by, is_demo, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
        `).bind(
          ref, row.full_name, normalizeNigerianPhone(row.phone_number) || row.phone_number,
          row.email_address || null, row.source || body.source || "Bulk import", row.referrer || null,
          status, normalizeTemperature(row.lead_temperature), propertyId, marketerId, teamLeadId, branchId, estimatedKobo,
          row.notes || null, row.next_follow_up_date ? dateOnly(row.next_follow_up_date) : null, actor.id
        ).run();
        created.push({ id: res.meta.last_row_id, lead_reference: ref, full_name: row.full_name });
      }
      if (created.length) {
        await audit(env, actor.id, "lead.bulk_import", "lead", null, {
          created: created.length, skipped: skipped.length, source: body.source || "Bulk import"
        }, actor.branch_id);
      }
      return json({ ok: true, created_count: created.length, skipped_count: skipped.length, created, skipped });
    }

    const leadConvertMatch = path.match(/^\/api\/leads\/(\d+)\/convert$/);
    if (leadConvertMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(leadConvertMatch[1]).first();
      if (!lead || lead.is_demo || !canAccessLeadScope(scope, lead)) return json({ error: "Lead not found" }, 404);
      if (lead.converted_client_id || lead.status === "Converted") return json({ error: "Lead has already been converted" }, 409);
      const body = await request.json().catch(() => ({}));
      let agreedPrice = null;
      let conversionPlan = null;
      if (lead.property_id) {
        const planResult = await resolvePropertyPlanForPurchase(env, Number(lead.property_id), body.property_plan_id ? Number(body.property_plan_id) : null);
        if (planResult.error) return json({ error: planResult.error, plans: planResult.plans || [] }, 400);
        conversionPlan = planResult.plan;
      } else if (body.property_plan_id) {
        return json({ error: "This lead has no property to attach a payment plan to" }, 400);
      }
      if (conversionPlan) {
        agreedPrice = fromKobo(Number(conversionPlan.total_price_kobo || 0));
      } else if (body.agreed_purchase_price !== undefined && body.agreed_purchase_price !== null && body.agreed_purchase_price !== "") {
        if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) {
          return json({ error: "Only a Managing Director or Branch Manager can set the contract price during conversion" }, 403);
        }
        const price = Number(body.agreed_purchase_price);
        if (!Number.isFinite(price) || price < 0) return json({ error: "Agreed purchase price is invalid" }, 400);
        agreedPrice = price;
      }
      const ref = "BLC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const clientStatus = body.client_status && ["Prospect", "Interested", "Negotiation", "Reserved", "Active Buyer"].includes(body.client_status)
        ? body.client_status : "Interested";
      const marketerId = lead.assigned_marketer_id || actor.id;
      const res = await env.DB.prepare(`
        INSERT INTO clients (client_reference, full_name, phone_number, email_address, notes, status,
          assigned_branch_id, created_by, original_marketer_id, team_lead_id,
          agreed_purchase_price, interested_property_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ref, lead.full_name, normalizeNigerianPhone(lead.phone_number) || lead.phone_number, lead.email_address, lead.notes, clientStatus,
        lead.branch_id, marketerId, marketerId, lead.team_lead_id || null,
        agreedPrice, lead.property_id || null
      ).run();
      const clientId = res.meta.last_row_id;
      if (lead.property_id) {
        await upsertClientPropertyAllocation(env, clientId, Number(lead.property_id), agreedPrice || 0, clientStatus);
      }
      let conversionScheduleId = null;
      if (conversionPlan) {
        await lockClientPurchasePlan(env, clientId, Number(lead.property_id), conversionPlan, clientStatus);
        const schedule = await createScheduleFromPropertyPlan(env, {
          id: clientId, interested_property_id: Number(lead.property_id), assigned_branch_id: lead.branch_id
        }, conversionPlan, actor.id, body.plan_start_date || todayOnly());
        if (schedule.error) return json({ error: schedule.error }, 400);
        conversionScheduleId = schedule.id;
      }
      await env.DB.prepare(`
        INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(clientId, marketerId, lead.branch_id, lead.team_lead_id || null, actor.id).run();
      await env.DB.prepare(`
        INSERT INTO client_status_history (client_id, old_status, new_status, changed_by)
        VALUES (?, NULL, ?, ?)
      `).bind(clientId, clientStatus, actor.id).run();
      await env.DB.prepare(`
        UPDATE leads SET status='Converted', converted_client_id=?, converted_at=datetime('now'),
          last_contact_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(clientId, lead.id).run();
      await audit(env, actor.id, "lead.converted", "lead", String(lead.id), { client_id: clientId, client_reference: ref }, lead.branch_id);
      await audit(env, actor.id, "client.create", "client", String(clientId), { source: "lead_conversion", lead_id: lead.id, branch_id: lead.branch_id }, lead.branch_id);
      await createNotification(env, {
        userId: marketerId,
        type: "lead.converted",
        title: "Lead Converted",
        message: `Lead ${lead.lead_reference} has been converted to client ${ref}.`,
        metadata: { lead_id: lead.id, client_id: clientId, client_reference: ref }
      });
      await sendAccountCreatedSms(env, clientId, actor.id);
      const verification = await autoSendClientVerification(env, {
        id: clientId,
        full_name: lead.full_name,
        phone_number: normalizeNigerianPhone(lead.phone_number) || lead.phone_number,
        email_address: lead.email_address || null,
        assigned_branch_id: lead.branch_id
      }, actor.id);
      return json({ ok: true, client_id: clientId, client_reference: ref, schedule_id: conversionScheduleId, verification });
    }

    // =========================================================================
    // PHASE 7: COMMISSIONS, WORKFLOW, PAYMENTS AND FINANCIAL REPORTS
    // =========================================================================
    async function normalizeCommissionRules(env, basis, rules) {
      if (!Array.isArray(rules) || !rules.length) return { error: "At least one commission rule is required" };
      const normalized = [];
      for (const raw of rules) {
        const roleName = raw.role_name;
        if (!COMMISSION_ROLES.includes(roleName)) return { error: "Commission rule role is invalid" };
        const rateBps = raw.rate_bps !== undefined
          ? Number(raw.rate_bps)
          : Math.round(Number(raw.rate_percent || 0) * 100);
        const fixedKobo = raw.fixed_amount_kobo !== undefined
          ? Number(raw.fixed_amount_kobo)
          : toKobo(raw.fixed_amount || 0);
        if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) return { error: "Commission rate must be between 0 and 100%" };
        if (!Number.isInteger(fixedKobo) || fixedKobo < 0) return { error: "Fixed commission amount is invalid" };
        if (basis === "fixed" && fixedKobo <= 0) return { error: "Fixed commission plans require a positive fixed amount" };
        if (basis !== "fixed" && rateBps <= 0) return { error: "Percentage commission plans require a positive rate" };
        const categoryId = raw.property_category_id ? Number(raw.property_category_id) : null;
        if (categoryId) {
          const category = await env.DB.prepare("SELECT id FROM property_categories WHERE id=?").bind(categoryId).first();
          if (!category) return { error: "Property category not found" };
        }
        const branchId = raw.branch_id ? Number(raw.branch_id) : null;
        if (branchId) {
          const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branchId).first();
          if (!branch) return { error: "Branch not found" };
        }
        const teamId = raw.team_id ? Number(raw.team_id) : null;
        if (teamId) {
          const team = await env.DB.prepare("SELECT id, branch_id FROM teams WHERE id=? AND is_active=1").bind(teamId).first();
          if (!team) return { error: "Team not found" };
          if (branchId && Number(team.branch_id) !== branchId) return { error: "Team does not belong to the selected branch" };
        }
        const salesType = raw.sales_type || null;
        if (salesType && !SALE_TYPES.includes(salesType)) return { error: "Sales type is invalid" };
        normalized.push({
          id: raw.id ? Number(raw.id) : null,
          role_name: roleName,
          rate_bps: basis === "fixed" ? 0 : rateBps,
          fixed_amount_kobo: basis === "fixed" ? fixedKobo : 0,
          property_category_id: categoryId,
          sales_type: salesType,
          branch_id: branchId,
          team_id: teamId,
          is_active: raw.is_active === undefined ? 1 : (isTruthy(raw.is_active) ? 1 : 0)
        });
      }
      return { rules: normalized };
    }

    async function validateCommissionPlanBody(env, body) {
      const name = String(body.name || "").trim();
      if (!name) return { error: "Commission plan name is required" };
      const basis = body.calculation_basis;
      if (!COMMISSION_BASES.includes(basis)) return { error: "Calculation basis must be contract_value, verified_collections or fixed" };
      const effectiveFrom = body.effective_from ? dateOnly(body.effective_from) : null;
      const effectiveTo = body.effective_to ? dateOnly(body.effective_to) : null;
      if (body.effective_from && !effectiveFrom) return { error: "Invalid effective start date" };
      if (body.effective_to && !effectiveTo) return { error: "Invalid effective end date" };
      if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) return { error: "Effective start date must be before the end date" };
      const ruleResult = await normalizeCommissionRules(env, basis, body.rules);
      if (ruleResult.error) return ruleResult;
      const commissionableMode = body.commissionable_mode || "full";
      if (!COMMISSIONABLE_MODES.includes(commissionableMode)) {
        return { error: "Commissionable basis must be full, first_months, percentage or capped_amount" };
      }
      const firstMonths = body.commissionable_first_months === undefined ? 2 : Number(body.commissionable_first_months);
      if (!Number.isInteger(firstMonths) || firstMonths < 0 || firstMonths > 120) {
        return { error: "Commissionable first-months value must be between 0 and 120" };
      }
      const percentBps = body.commissionable_percent_bps !== undefined
        ? Number(body.commissionable_percent_bps)
        : Math.round(Number(body.commissionable_percent || 100) * 100);
      if (!Number.isInteger(percentBps) || percentBps < 0 || percentBps > 10000) {
        return { error: "Commissionable percentage must be between 0 and 100%" };
      }
      const capKobo = body.commissionable_cap_kobo !== undefined
        ? Number(body.commissionable_cap_kobo)
        : toKobo(body.commissionable_cap_amount || 0);
      if (!Number.isInteger(capKobo) || capKobo < 0) {
        return { error: "Commissionable cap amount is invalid" };
      }
      return {
        plan: {
          name,
          description: body.description ? String(body.description).trim() : null,
          calculation_basis: basis,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          approval_required: body.approval_required === undefined ? 1 : (isTruthy(body.approval_required) ? 1 : 0),
          separation_of_duties: body.separation_of_duties === undefined ? 1 : (isTruthy(body.separation_of_duties) ? 1 : 0),
          is_active: body.is_active === undefined ? 1 : (isTruthy(body.is_active) ? 1 : 0),
          commissionable_mode: commissionableMode,
          commissionable_first_months: firstMonths,
          commissionable_percent_bps: percentBps,
          commissionable_cap_kobo: capKobo
        },
        rules: ruleResult.rules
      };
    }

    if (path === "/api/commission-options" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const categories = await env.DB.prepare("SELECT id, name FROM property_categories ORDER BY name").all();
      const branches = await env.DB.prepare("SELECT id, name FROM branches ORDER BY name").all();
      const teams = await env.DB.prepare(`
        SELECT t.id, t.name, t.branch_id, b.name AS branch_name
        FROM teams t LEFT JOIN branches b ON b.id=t.branch_id
        WHERE t.is_active=1 ORDER BY t.name
      `).all();
      return json({
        categories: categories.results,
        branches: branches.results,
        teams: teams.results,
        roles: COMMISSION_ROLES,
        sale_types: SALE_TYPES,
        bases: COMMISSION_BASES,
        commissionable_modes: COMMISSIONABLE_MODES,
        statuses: COMMISSION_STATUSES
      });
    }

    if (path === "/api/commission-plans" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const { results: plans } = await env.DB.prepare(`
        SELECT p.*, u.full_name AS created_by_name,
          (SELECT COUNT(*) FROM commission_plan_rules r WHERE r.plan_id=p.id AND r.is_active=1) AS rule_count
        FROM commission_plans p LEFT JOIN users u ON u.id=p.created_by
        ORDER BY p.is_active DESC, p.id DESC
      `).all();
      for (const plan of plans) {
        const rules = await env.DB.prepare(`
          SELECT r.*, pc.name AS category_name, b.name AS branch_name, t.name AS team_name
          FROM commission_plan_rules r
          LEFT JOIN property_categories pc ON pc.id=r.property_category_id
          LEFT JOIN branches b ON b.id=r.branch_id
          LEFT JOIN teams t ON t.id=r.team_id
          WHERE r.plan_id=? ORDER BY r.id
        `).bind(plan.id).all();
        plan.rules = rules.results;
      }
      return json({ plans });
    }

    if (path === "/api/commission-plans" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const validated = await validateCommissionPlanBody(env, body);
      if (validated.error) return json({ error: validated.error }, 400);
      const plan = validated.plan;
      const res = await env.DB.prepare(`
        INSERT INTO commission_plans (name, description, calculation_basis, effective_from, effective_to,
          approval_required, separation_of_duties, is_active, created_by,
          commissionable_mode, commissionable_first_months, commissionable_percent_bps,
          commissionable_cap_kobo, current_version_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(plan.name, plan.description, plan.calculation_basis, plan.effective_from, plan.effective_to,
        plan.approval_required, plan.separation_of_duties, plan.is_active, actor.id,
        plan.commissionable_mode, plan.commissionable_first_months, plan.commissionable_percent_bps,
        plan.commissionable_cap_kobo).run();
      const planId = res.meta.last_row_id;
      const createdRules = [];
      for (const rule of validated.rules) {
        const ruleRes = await env.DB.prepare(`
          INSERT INTO commission_plan_rules (plan_id, role_name, rate_bps, fixed_amount_kobo,
            property_category_id, sales_type, branch_id, team_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(planId, rule.role_name, rule.rate_bps, rule.fixed_amount_kobo,
          rule.property_category_id, rule.sales_type, rule.branch_id, rule.team_id, rule.is_active).run();
        createdRules.push({ id: ruleRes.meta.last_row_id, ...rule });
      }
      await createCommissionPlanVersion(env, planId, 1, plan, createdRules, body.change_reason || "Initial version", actor.id);
      await audit(env, actor.id, "commission_plan.create", "commission_plan", String(planId), { name: plan.name, basis: plan.calculation_basis, version: 1 }, null);
      return json({ ok: true, id: planId, version_no: 1 });
    }

    const commissionPlanMatch = path.match(/^\/api\/commission-plans\/(\d+)$/);
    if (commissionPlanMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const plan = await env.DB.prepare("SELECT * FROM commission_plans WHERE id=?").bind(commissionPlanMatch[1]).first();
      if (!plan) return json({ error: "Commission plan not found" }, 404);
      const rules = await env.DB.prepare(`
        SELECT r.*, pc.name AS category_name, b.name AS branch_name, t.name AS team_name
        FROM commission_plan_rules r
        LEFT JOIN property_categories pc ON pc.id=r.property_category_id
        LEFT JOIN branches b ON b.id=r.branch_id
        LEFT JOIN teams t ON t.id=r.team_id
        WHERE r.plan_id=? ORDER BY r.id
      `).bind(plan.id).all();
      const versions = await env.DB.prepare(
        "SELECT id, version_no, change_reason, created_at, effective_from, effective_to FROM commission_plan_versions WHERE plan_id=? ORDER BY version_no DESC"
      ).bind(plan.id).all();
      return json({ plan: { ...plan, rules: rules.results, versions: versions.results } });
    }

    if (commissionPlanMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const existing = await env.DB.prepare("SELECT * FROM commission_plans WHERE id=?").bind(commissionPlanMatch[1]).first();
      if (!existing) return json({ error: "Commission plan not found" }, 404);
      const body = await request.json();
      const validated = await validateCommissionPlanBody(env, body);
      if (validated.error) return json({ error: validated.error }, 400);
      const plan = validated.plan;
      const nextVersionNo = Number(existing.current_version_no || 1) + 1;
      await env.DB.prepare(`
        UPDATE commission_plans SET name=?, description=?, calculation_basis=?, effective_from=?, effective_to=?,
          approval_required=?, separation_of_duties=?, is_active=?, updated_by=?, updated_at=datetime('now'),
          commissionable_mode=?, commissionable_first_months=?, commissionable_percent_bps=?,
          commissionable_cap_kobo=?, current_version_no=?
        WHERE id=?
      `).bind(plan.name, plan.description, plan.calculation_basis, plan.effective_from, plan.effective_to,
        plan.approval_required, plan.separation_of_duties, plan.is_active, actor.id,
        plan.commissionable_mode, plan.commissionable_first_months, plan.commissionable_percent_bps,
        plan.commissionable_cap_kobo, nextVersionNo, existing.id).run();
      const keptRuleIds = [];
      for (const rule of validated.rules) {
        if (rule.id) {
          const owned = await env.DB.prepare("SELECT id FROM commission_plan_rules WHERE id=? AND plan_id=?").bind(rule.id, existing.id).first();
          if (!owned) return json({ error: "Commission rule does not belong to this plan" }, 400);
          await env.DB.prepare(`
            UPDATE commission_plan_rules SET role_name=?, rate_bps=?, fixed_amount_kobo=?, property_category_id=?,
              sales_type=?, branch_id=?, team_id=?, is_active=?, updated_at=datetime('now') WHERE id=?
          `).bind(rule.role_name, rule.rate_bps, rule.fixed_amount_kobo, rule.property_category_id,
            rule.sales_type, rule.branch_id, rule.team_id, rule.is_active, rule.id).run();
          keptRuleIds.push(rule.id);
        } else {
          const res = await env.DB.prepare(`
            INSERT INTO commission_plan_rules (plan_id, role_name, rate_bps, fixed_amount_kobo,
              property_category_id, sales_type, branch_id, team_id, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(existing.id, rule.role_name, rule.rate_bps, rule.fixed_amount_kobo,
            rule.property_category_id, rule.sales_type, rule.branch_id, rule.team_id, rule.is_active).run();
          keptRuleIds.push(res.meta.last_row_id);
        }
      }
      if (keptRuleIds.length) {
        await env.DB.prepare(`UPDATE commission_plan_rules SET is_active=0 WHERE plan_id=? AND id NOT IN (${placeholders(keptRuleIds)})`)
          .bind(existing.id, ...keptRuleIds).run();
      }
      const { results: currentRules } = await env.DB.prepare(
        "SELECT * FROM commission_plan_rules WHERE plan_id=? AND is_active=1 ORDER BY id"
      ).bind(existing.id).all();
      await createCommissionPlanVersion(env, existing.id, nextVersionNo, plan, currentRules,
        body.change_reason || `Plan edited to version ${nextVersionNo}`, actor.id);
      await audit(env, actor.id, "commission_plan.update", "commission_plan", String(existing.id), {
        name: plan.name, basis: plan.calculation_basis, version_no: nextVersionNo
      }, null);
      return json({ ok: true, version_no: nextVersionNo });
    }

    const commissionPlanStatusMatch = path.match(/^\/api\/commission-plans\/(\d+)\/status$/);
    if (commissionPlanStatusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      if (body.is_active === undefined) return json({ error: "Active state is required" }, 400);
      const active = isTruthy(body.is_active) ? 1 : 0;
      await env.DB.prepare("UPDATE commission_plans SET is_active=?, updated_by=?, updated_at=datetime('now') WHERE id=?")
        .bind(active, actor.id, commissionPlanStatusMatch[1]).run();
      await audit(env, actor.id, active ? "commission_plan.activate" : "commission_plan.deactivate", "commission_plan", commissionPlanStatusMatch[1], null, null);
      return json({ ok: true, is_active: active });
    }

    // =========================================================================
    // ELPIS REFERRAL COMMISSIONS
    // =========================================================================
    if (path === "/api/referral-commissions/rules" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canViewReferralCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const { results } = await env.DB.prepare(
        "SELECT rule_key, label, structure, min_months, max_months, stage_amount_kobo, stage1_commission_cap_kobo, stage2_commission_cap_kobo, max_commission_kobo, flat_rate_bps FROM referral_commission_rules WHERE is_active=1 ORDER BY id"
      ).all();
      return json({ rules: results });
    }

    if (path === "/api/referral-commissions" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canViewReferralCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const scoped = referralCommissionScopeSql(scope, "a");
      const clauses = [scoped.clause];
      const binds = [...scoped.binds];

      const status = String(url.searchParams.get("status") || "").trim();
      const marketerId = url.searchParams.get("marketer_id");
      const branchId = url.searchParams.get("branch_id");
      const q = String(url.searchParams.get("q") || "").trim();
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (status) { clauses.push("a.status=?"); binds.push(status); }
      if (marketerId) { clauses.push("a.marketer_id=?"); binds.push(Number(marketerId)); }
      if (branchId) { clauses.push("a.branch_id=?"); binds.push(Number(branchId)); }
      if (q) { clauses.push("(c.full_name LIKE ? OR c.client_reference LIKE ?)"); binds.push(`%${q}%`, `%${q}%`); }
      if (from) { clauses.push("date(a.updated_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(a.updated_at) <= date(?)"); binds.push(to); }
      const whereSql = "WHERE " + clauses.join(" AND ");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
      const offset = (page - 1) * limit;

      const { results: rows } = await env.DB.prepare(`
        SELECT a.*, c.full_name AS client_name, c.client_reference,
               u.full_name AS marketer_name, b.name AS branch_name,
               CASE WHEN a.status='Configuration Required' THEN 0
                    ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo) END AS net_commission_kobo,
               CASE WHEN a.status='Configuration Required' THEN 0
                    ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo - a.paid_kobo) END AS outstanding_kobo
        FROM referral_commission_accounts a
        JOIN clients c ON c.id=a.client_id
        LEFT JOIN users u ON u.id=a.marketer_id
        LEFT JOIN branches b ON b.id=a.branch_id
        ${whereSql}
        ORDER BY a.updated_at DESC, a.id DESC
        LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS c FROM referral_commission_accounts a JOIN clients c ON c.id=a.client_id ${whereSql}
      `).bind(...binds).first();
      const summaryRow = await env.DB.prepare(`
        SELECT COUNT(*) AS total_clients,
          COALESCE(SUM(CASE WHEN a.status='Configuration Required' THEN 0
            ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo) END),0) AS earned_kobo,
          COALESCE(SUM(a.paid_kobo),0) AS paid_kobo,
          COALESCE(SUM(CASE WHEN a.status='Configuration Required' THEN 0
            ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo - a.paid_kobo) END),0) AS outstanding_kobo,
          COALESCE(SUM(CASE WHEN a.status='Configuration Required' THEN 1 ELSE 0 END),0) AS configuration_required,
          COALESCE(SUM(CASE WHEN a.flag_reason IS NOT NULL THEN 1 ELSE 0 END),0) AS flagged,
          COALESCE(SUM(CASE WHEN a.structure='two_stage' THEN 1 ELSE 0 END),0) AS long_term,
          COALESCE(SUM(CASE WHEN a.structure='flat' THEN 1 ELSE 0 END),0) AS short_term
        FROM referral_commission_accounts a JOIN clients c ON c.id=a.client_id
        ${whereSql}
      `).bind(...binds).first();
      const { results: byStructure } = await env.DB.prepare(`
        SELECT a.structure, COUNT(*) AS client_count,
          COALESCE(SUM(CASE WHEN a.status='Configuration Required' THEN 0
            ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo) END),0) AS earned_kobo,
          COALESCE(SUM(CASE WHEN a.status='Configuration Required' THEN 0
            ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo - a.paid_kobo) END),0) AS outstanding_kobo
        FROM referral_commission_accounts a JOIN clients c ON c.id=a.client_id
        ${whereSql}
        GROUP BY a.structure ORDER BY a.structure
      `).bind(...binds).all();

      return json({
        entries: rows.map(row => ({
          ...row,
          structure_label: referralStructureLabel(row.structure, row.plan_type, row.plan_duration_months),
          net_commission_kobo: Number(row.net_commission_kobo || 0),
          outstanding_kobo: Number(row.outstanding_kobo || 0)
        })),
        summary: {
          total_clients: Number(summaryRow ? summaryRow.total_clients : 0),
          earned_kobo: Number(summaryRow ? summaryRow.earned_kobo : 0),
          paid_kobo: Number(summaryRow ? summaryRow.paid_kobo : 0),
          outstanding_kobo: Number(summaryRow ? summaryRow.outstanding_kobo : 0),
          configuration_required: Number(summaryRow ? summaryRow.configuration_required : 0),
          flagged: Number(summaryRow ? summaryRow.flagged : 0),
          long_term: Number(summaryRow ? summaryRow.long_term : 0),
          short_term: Number(summaryRow ? summaryRow.short_term : 0),
          by_structure: byStructure
        },
        pagination: { page, limit, total: Number(count ? count.c : 0) }
      });
    }

    const referralCommissionDetailMatch = path.match(/^\/api\/referral-commissions\/(\d+)$/);
    if (referralCommissionDetailMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canViewReferralCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const scoped = referralCommissionScopeSql(scope, "a");
      const account = await env.DB.prepare(`
        SELECT a.*, c.full_name AS client_name, c.client_reference, c.phone_number,
               c.agreed_purchase_price, u.full_name AS marketer_name, b.name AS branch_name,
               CASE WHEN a.status='Configuration Required' THEN 0
                    ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo) END AS net_commission_kobo,
               CASE WHEN a.status='Configuration Required' THEN 0
                    ELSE MAX(0, a.total_commission_kobo + a.adjusted_kobo - a.paid_kobo) END AS outstanding_kobo
        FROM referral_commission_accounts a
        JOIN clients c ON c.id=a.client_id
        LEFT JOIN users u ON u.id=a.marketer_id
        LEFT JOIN branches b ON b.id=a.branch_id
        WHERE a.id=? AND ${scoped.clause}
      `).bind(referralCommissionDetailMatch[1], ...scoped.binds).first();
      if (!account) return json({ error: "Referral commission account not found" }, 404);
      const { results: events } = await env.DB.prepare(`
        SELECT e.*, u.full_name AS actor_name
        FROM referral_commission_events e LEFT JOIN users u ON u.id=e.actor_user_id
        WHERE e.account_id=? ORDER BY e.created_at DESC, e.id DESC LIMIT 200
      `).bind(account.id).all();
      const { results: payments } = await env.DB.prepare(`
        SELECT p.*, u.full_name AS paid_by_name
        FROM referral_commission_payments p LEFT JOIN users u ON u.id=p.paid_by
        WHERE p.account_id=? ORDER BY p.paid_at DESC, p.id DESC
      `).bind(account.id).all();
      const { results: adjustments } = await env.DB.prepare(`
        SELECT a.*, u.full_name AS created_by_name
        FROM referral_commission_adjustments a LEFT JOIN users u ON u.id=a.created_by
        WHERE a.account_id=? ORDER BY a.created_at DESC, a.id DESC
      `).bind(account.id).all();
      return json({
        account: {
          ...account,
          structure_label: referralStructureLabel(account.structure, account.plan_type, account.plan_duration_months),
          net_commission_kobo: Number(account.net_commission_kobo || 0),
          outstanding_kobo: Number(account.outstanding_kobo || 0)
        },
        events,
        payments,
        adjustments,
        can_manage: canManageReferralCommissions(actor)
      });
    }

    if (path === "/api/referral-commissions/backfill" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageReferralCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const body = await request.json().catch(() => ({}));
      const runKey = `referral:backfill:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
      if (isTruthy(body.dry_run)) {
        const row = await env.DB.prepare(`
          SELECT COUNT(DISTINCT c.id) AS c FROM clients c
          JOIN payments p ON p.client_id=c.id AND p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
          WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        `).first();
        return json({ dry_run: true, eligible_clients: Number(row ? row.c : 0), note: "Run without dry_run to recalculate referral commissions." });
      }
      const result = await backfillReferralCommissions(env, actor.id, {
        limit: body.limit || 500, onlyStale: false, sourceKey: runKey, reason: "Manual referral commission backfill"
      });
      await audit(env, actor.id, "referral_commission.backfill", "referral_commission", null, result, null);
      return json({ ok: true, ...result });
    }

    const referralActionMatch = path.match(/^\/api\/referral-commissions\/(\d+)\/(recalculate|payments|adjustments)$/);
    if (referralActionMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageReferralCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const account = await env.DB.prepare(`
        SELECT a.*, c.full_name AS client_name, c.client_reference, u.full_name AS marketer_name
        FROM referral_commission_accounts a
        JOIN clients c ON c.id=a.client_id
        LEFT JOIN users u ON u.id=a.marketer_id
        WHERE a.id=?
      `).bind(referralActionMatch[1]).first();
      if (!account) return json({ error: "Referral commission account not found" }, 404);
      const action = referralActionMatch[2];
      const body = await request.json().catch(() => ({}));

      if (action === "recalculate") {
        const result = await recalculateReferralCommissionForClient(env, account.client_id, actor.id, {
          sourceKey: `referral:client:${account.client_id}:manual:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`,
          eventType: "recalculation",
          reason: body.reason || "Manual referral commission recalculation"
        });
        await audit(env, actor.id, "referral_commission.recalculate", "referral_commission", String(account.id), result, account.branch_id);
        return json({ ok: true, ...result });
      }

      const net = Math.max(0, Number(account.total_commission_kobo || 0) + Number(account.adjusted_kobo || 0));
      const paid = Number(account.paid_kobo || 0);
      const outstanding = Math.max(0, net - paid);

      if (action === "payments") {
        const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : null;
        if (idempotencyKey) {
          const existing = await env.DB.prepare("SELECT * FROM referral_commission_payments WHERE idempotency_key=?").bind(idempotencyKey).first();
          if (existing) return json({ ok: true, already_recorded: true, payment: existing });
        }
        const amountKobo = toKobo(body.amount);
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) return json({ error: "Payment amount must be positive" }, 400);
        if (account.status === "Configuration Required") return json({ error: "This referral commission account needs configuration before payment" }, 409);
        if (!account.marketer_id) return json({ error: "Assign an eligible marketer before paying referral commission" }, 409);
        if (outstanding <= 0) return json({ error: "There is no outstanding referral commission to pay" }, 409);
        if (amountKobo > outstanding) return json({ error: `Payment exceeds outstanding referral commission of ${formatNGN(outstanding)}` }, 400);
        const method = String(body.method || "Bank Transfer").trim();
        if (!method) return json({ error: "Payment method is required" }, 400);
        const paymentRef = "RCPAY-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
        const paymentRes = await env.DB.prepare(`
          INSERT INTO referral_commission_payments
            (payment_ref, idempotency_key, account_id, amount_kobo, method, external_reference, notes, paid_by, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(paymentRef, idempotencyKey, account.id, amountKobo, method,
          body.external_reference || null, body.notes || null, actor.id).run();
        const newPaid = paid + amountKobo;
        const newStatus = newPaid >= net ? "Paid" : "Partially Paid";
        await env.DB.prepare(`
          UPDATE referral_commission_accounts SET paid_kobo=?, status=?, updated_at=datetime('now') WHERE id=?
        `).bind(newPaid, newStatus, account.id).run();
        await env.DB.prepare(`
          INSERT OR IGNORE INTO referral_commission_events
            (event_ref, source_key, account_id, client_id, marketer_id, event_type, amount_kobo,
             total_paid_kobo, qualifying_paid_kobo, net_commission_kobo, reason, metadata, actor_user_id)
          VALUES (?, ?, ?, ?, ?, 'disbursement', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          "RCE-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
          `referral:account:${account.id}:payment:${paymentRes.meta.last_row_id}`,
          account.id, account.client_id, account.marketer_id, amountKobo, account.total_paid_kobo,
          account.qualifying_paid_kobo, net,
          body.notes || "Referral commission payment", JSON.stringify({ payment_ref: paymentRef, method }), actor.id
        ).run();
        await audit(env, actor.id, "referral_commission.payment", "referral_commission", String(account.id), {
          payment_ref: paymentRef, amount_kobo: amountKobo, status: newStatus
        }, account.branch_id);
        if (account.marketer_id) {
          await createNotification(env, {
            userId: account.marketer_id,
            type: "referral_commission.paid",
            title: "Referral commission paid",
            message: `${formatNGN(amountKobo)} referral commission was recorded for ${account.client_name} (${account.client_reference}).`,
            metadata: { account_id: account.id, payment_ref: paymentRef }
          }).catch(() => {});
        }
        return json({
          ok: true, payment_id: paymentRes.meta.last_row_id, payment_ref: paymentRef,
          status: newStatus, paid_kobo: newPaid, outstanding_kobo: Math.max(0, net - newPaid)
        });
      }

      if (action === "adjustments") {
        const adjustmentType = String(body.adjustment_type || "correction").trim();
        if (!["correction", "reversal", "refund", "manual"].includes(adjustmentType)) {
          return json({ error: "Invalid adjustment type" }, 400);
        }
        const amountKobo = toKobo(body.amount);
        if (!Number.isInteger(amountKobo) || amountKobo === 0) return json({ error: "Adjustment amount must be non-zero" }, 400);
        const reason = String(body.reason || "").trim();
        if (!reason) return json({ error: "Adjustment reason is required" }, 400);
        const currentAdjusted = Number(account.adjusted_kobo || 0);
        const newAdjusted = currentAdjusted + amountKobo;
        const newNet = Number(account.total_commission_kobo || 0) + newAdjusted;
        if (newNet < 0) return json({ error: "Adjustment would make the referral commission negative" }, 400);
        if (newNet < paid) return json({ error: "Adjustment cannot reduce the commission below the amount already paid" }, 400);
        const sourceKey = `referral:account:${account.id}:adjustment:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
        const adjRes = await env.DB.prepare(`
          INSERT INTO referral_commission_adjustments
            (account_id, adjustment_type, amount_kobo, reason, source_payment_id, source_key, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(account.id, adjustmentType, amountKobo, reason, body.source_payment_id || null, sourceKey, actor.id).run();
        const newStatus = newNet <= 0 ? "Reversed" : (paid >= newNet ? "Paid" : (paid > 0 ? "Partially Paid" : "Earned"));
        await env.DB.prepare(`
          UPDATE referral_commission_accounts SET adjusted_kobo=?, status=?, updated_at=datetime('now') WHERE id=?
        `).bind(newAdjusted, newStatus, account.id).run();
        await env.DB.prepare(`
          INSERT OR IGNORE INTO referral_commission_events
            (event_ref, source_key, account_id, client_id, marketer_id, event_type, amount_kobo,
             total_paid_kobo, qualifying_paid_kobo, net_commission_kobo, reason, metadata, actor_user_id)
          VALUES (?, ?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          "RCE-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
          `referral:account:${account.id}:adjustment-event:${adjRes.meta.last_row_id}`,
          account.id, account.client_id, account.marketer_id, amountKobo, account.total_paid_kobo,
          Number(account.qualifying_paid_kobo || 0), newNet, reason,
          JSON.stringify({ adjustment_type: adjustmentType }), actor.id
        ).run();
        await audit(env, actor.id, "referral_commission.adjustment", "referral_commission", String(account.id), {
          adjustment_type: adjustmentType, amount_kobo: amountKobo, reason, status: newStatus
        }, account.branch_id);
        return json({ ok: true, status: newStatus, adjusted_kobo: newAdjusted, outstanding_kobo: Math.max(0, newNet - paid) });
      }
    }

    if (path === "/api/commissions" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const fullAccess = canAccessCommissions(actor);
      const ownView = !fullAccess && canViewOwnCommission(actor);
      if (!fullAccess && !ownView) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const clauses = [];
      const binds = [];
      if (fullAccess) {
        clauses.push("1=1");
        const branchId = url.searchParams.get("branch_id");
        const teamId = url.searchParams.get("team_id");
        const marketerId = url.searchParams.get("marketer_id");
        if (branchId) { clauses.push("ce.branch_id=?"); binds.push(branchId); }
        if (teamId) { clauses.push("ce.team_id=?"); binds.push(teamId); }
        if (marketerId) { clauses.push("ce.marketer_id=?"); binds.push(marketerId); }
      } else {
        clauses.push("ce.recipient_user_id=?");
        binds.push(actor.id);
      }
      const status = url.searchParams.get("status");
      const planId = url.searchParams.get("plan_id");
      const clientId = url.searchParams.get("client_id");
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (status) { clauses.push("ce.status=?"); binds.push(status); }
      if (planId && fullAccess) { clauses.push("ce.plan_id=?"); binds.push(planId); }
      if (clientId) { clauses.push("ce.client_id=?"); binds.push(clientId); }
      if (from) { clauses.push("date(ce.created_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(ce.created_at) <= date(?)"); binds.push(to); }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const whereSql = "WHERE " + clauses.join(" AND ");
      if (!fullAccess) {
        const { results: allOwn } = await env.DB.prepare(`
          SELECT ce.id, ce.commission_ref, ce.commission_kobo, ce.adjusted_kobo, ce.paid_kobo,
                 ce.status, ce.created_at, c.full_name AS client_name, c.client_reference
          FROM commission_entries ce JOIN clients c ON c.id=ce.client_id
          ${whereSql} ORDER BY ce.created_at DESC, ce.id DESC
        `).bind(...binds).all();
        const sanitized = allOwn.map(ownCommissionEntry);
        return json({
          entries: sanitized.slice(offset, offset + limit),
          summary: ownCommissionSummary(sanitized),
          pagination: { page, limit, total: sanitized.length }
        });
      }
      const { results: entries } = await env.DB.prepare(`
        SELECT ce.*, c.full_name AS client_name, c.client_reference,
               cp.name AS plan_name, u.full_name AS recipient_name,
               prop.title AS property_title,
               MAX(0, ce.commission_kobo + ce.adjusted_kobo - ce.paid_kobo) AS outstanding_kobo
        FROM commission_entries ce
        JOIN clients c ON c.id=ce.client_id
        JOIN commission_plans cp ON cp.id=ce.plan_id
        JOIN users u ON u.id=ce.recipient_user_id
        LEFT JOIN properties prop ON prop.id=ce.property_id
        ${whereSql} ORDER BY ce.created_at DESC, ce.id DESC LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM commission_entries ce ${whereSql}`).bind(...binds).first();
      const summary = await getCommissionSummary(env, scope);
      return json({ entries, summary, pagination: { page, limit, total: count ? count.c : 0 } });
    }

    if (path === "/api/commissions/generate" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      try {
        const result = await generateCommissionEntries(env, actor, body || {});
        await audit(env, actor.id, "commission.generate", "commission", null, result, null);
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ error: error.message || "Commission generation failed" }, 400);
      }
    }

    const commissionReceiptMatch = path.match(/^\/api\/commissions\/payments\/(\d+)\/receipt$/);
    if (commissionReceiptMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const fullAccess = canAccessCommissions(actor);
      const ownView = !fullAccess && canViewOwnCommission(actor);
      if (!fullAccess && !ownView) return json({ error: "Commission access is required" }, 403);
      const scoped = fullAccess ? { clause: "1=1", binds: [] } : { clause: "ce.recipient_user_id = ?", binds: [actor.id] };
      const payment = await env.DB.prepare(`
        SELECT cpay.*, ce.commission_ref, ce.recipient_role, ce.commission_kobo,
               u.full_name AS recipient_name, cp.name AS plan_name,
               c.full_name AS client_name
        FROM commission_payments cpay
        JOIN commission_entries ce ON ce.id=cpay.entry_id
        JOIN users u ON u.id=ce.recipient_user_id
        JOIN commission_plans cp ON cp.id=ce.plan_id
        JOIN clients c ON c.id=ce.client_id
        WHERE cpay.id=? AND ${scoped.clause}
      `).bind(commissionReceiptMatch[1], ...scoped.binds).first();
      if (!payment) return json({ error: "Commission receipt not found" }, 404);
      let key = payment.r2_key;
      if (key && !key.startsWith("commission-receipts/")) return json({ error: "Commission receipt unavailable" }, 404);
      if (!key) {
        const receiptRef = payment.receipt_ref || ("CRCP-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase());
        const logoBytes = await getReceiptLogoBytes(env);
        const pdf = buildCommissionReceiptPdf({
          receiptRef, paymentRef: payment.payment_ref, recipientName: payment.recipient_name,
          planName: payment.plan_name, clientName: payment.client_name,
          amountKobo: Number(payment.amount_kobo || 0), paidAt: payment.paid_at,
          method: payment.method, logoBytes
        });
        key = `commission-receipts/${payment.recipient_name ? payment.recipient_name.replace(/[^a-zA-Z0-9._-]/g, "_") : "staff"}/${receiptRef}.pdf`;
        await env.FILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
        await env.DB.prepare("UPDATE commission_payments SET r2_key=?, receipt_ref=? WHERE id=?").bind(key, receiptRef, payment.id).run();
      }
      const object = await env.FILES.get(key);
      if (!object) return json({ error: "Commission receipt unavailable" }, 503);
      const bytes = await object.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(payment.receipt_ref || payment.commission_ref, "commission-receipt")}.pdf"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const commissionMatch = path.match(/^\/api\/commissions\/(\d+)$/);
    if (commissionMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const fullAccess = canAccessCommissions(actor);
      const ownView = !fullAccess && canViewOwnCommission(actor);
      if (!fullAccess && !ownView) return json({ error: "Forbidden" }, 403);
      if (ownView) {
        const own = await env.DB.prepare(`
          SELECT ce.id, ce.commission_ref, ce.commission_kobo, ce.adjusted_kobo, ce.paid_kobo,
                 ce.status, ce.created_at, c.full_name AS client_name, c.client_reference
          FROM commission_entries ce JOIN clients c ON c.id=ce.client_id
          WHERE ce.id=? AND ce.recipient_user_id=?
        `).bind(commissionMatch[1], actor.id).first();
        if (!own) return json({ error: "Commission not found" }, 404);
        const payments = await env.DB.prepare(`
          SELECT payment_ref, amount_kobo, method, external_reference, paid_at
          FROM commission_payments WHERE entry_id=? ORDER BY paid_at DESC
        `).bind(own.id).all();
        return json({ entry: ownCommissionEntry(own), payments: payments.results });
      }
      const scope = await resolvePhase6Scope(env, actor);
      const scoped = commissionScopeSql(scope, "ce");
      const entry = await env.DB.prepare(`
        SELECT ce.*, c.full_name AS client_name, c.client_reference,
               cp.name AS plan_name, cp.calculation_basis, cp.separation_of_duties,
               u.full_name AS recipient_name, prop.title AS property_title,
               MAX(0, ce.commission_kobo + ce.adjusted_kobo - ce.paid_kobo) AS outstanding_kobo
        FROM commission_entries ce
        JOIN clients c ON c.id=ce.client_id
        JOIN commission_plans cp ON cp.id=ce.plan_id
        JOIN users u ON u.id=ce.recipient_user_id
        LEFT JOIN properties prop ON prop.id=ce.property_id
        WHERE ce.id=? AND ${scoped.clause}
      `).bind(commissionMatch[1], ...scoped.binds).first();
      if (!entry) return json({ error: "Commission not found" }, 404);
      const approvals = await env.DB.prepare(`
        SELECT a.*, u.full_name AS actor_name FROM commission_approvals a
        LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.entry_id=? ORDER BY a.id DESC
      `).bind(entry.id).all();
      const payments = await env.DB.prepare(`
        SELECT p.*, u.full_name AS paid_by_name FROM commission_payments p
        LEFT JOIN users u ON u.id=p.paid_by WHERE p.entry_id=? ORDER BY p.paid_at DESC
      `).bind(entry.id).all();
      const adjustments = await env.DB.prepare(`
        SELECT a.*, u.full_name AS created_by_name FROM commission_adjustments a
        LEFT JOIN users u ON u.id=a.created_by WHERE a.entry_id=? ORDER BY a.id DESC
      `).bind(entry.id).all();
      const attribution = await env.DB.prepare("SELECT * FROM commission_attributions WHERE entry_id=?").bind(entry.id).first();
      return json({ entry, approvals: approvals.results, payments: payments.results, adjustments: adjustments.results, attribution });
    }

    const commissionActionMatch = path.match(/^\/api\/commissions\/(\d+)\/(submit|approve|reject|payments|adjustments)$/);
    if (commissionActionMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const action = commissionActionMatch[2];
      const entry = await env.DB.prepare(`
        SELECT ce.*, cp.name AS plan_name, cp.separation_of_duties
        FROM commission_entries ce JOIN commission_plans cp ON cp.id=ce.plan_id WHERE ce.id=?
      `).bind(commissionActionMatch[1]).first();
      if (!entry) return json({ error: "Commission not found" }, 404);
      const body = await request.json().catch(() => ({}));

      if (action === "submit") {
        if (!["Draft", "Calculated"].includes(entry.status)) return json({ error: "Only Draft or Calculated commissions can be submitted" }, 409);
        const nextStatus = entry.approval_required ? "Pending Approval" : "Approved";
        await env.DB.prepare(`
          UPDATE commission_entries SET status=?, approved_by=?, approved_at=?, updated_at=datetime('now') WHERE id=?
        `).bind(nextStatus, entry.approval_required ? null : actor.id, entry.approval_required ? null : new Date().toISOString(), entry.id).run();
        await env.DB.prepare("INSERT INTO commission_approvals (entry_id, action, actor_user_id, reason) VALUES (?, 'submit', ?, ?)")
          .bind(entry.id, actor.id, body.reason || null).run();
        await audit(env, actor.id, "commission.submit", "commission", String(entry.id), { status: nextStatus }, entry.branch_id);
        return json({ ok: true, status: nextStatus });
      }

      if (action === "approve" || action === "reject") {
        if (entry.status !== "Pending Approval") return json({ error: "Only Pending Approval commissions can be reviewed" }, 409);
        if (entry.separation_of_duties && Number(entry.recipient_user_id) === Number(actor.id)) {
          return json({ error: "You cannot approve or reject your own commission" }, 403);
        }
        if (action === "reject") {
          const reason = String(body.reason || "").trim();
          if (!reason) return json({ error: "Rejection reason is required" }, 400);
          await env.DB.prepare(`
            UPDATE commission_entries SET status='Rejected', rejected_by=?, rejected_at=datetime('now'),
              rejection_reason=?, updated_at=datetime('now') WHERE id=?
          `).bind(actor.id, reason, entry.id).run();
          await env.DB.prepare("INSERT INTO commission_approvals (entry_id, action, actor_user_id, reason) VALUES (?, 'reject', ?, ?)")
            .bind(entry.id, actor.id, reason).run();
          await audit(env, actor.id, "commission.reject", "commission", String(entry.id), { reason }, entry.branch_id);
          await createNotification(env, { userId: entry.recipient_user_id, type: "commission.rejected", title: "Commission Rejected", message: `Commission ${entry.commission_ref} was rejected. Reason: ${reason}.`, metadata: { commission_id: entry.id } });
          return json({ ok: true, status: "Rejected" });
        }
        await env.DB.prepare(`
          UPDATE commission_entries SET status='Approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?
        `).bind(actor.id, entry.id).run();
        await env.DB.prepare("INSERT INTO commission_approvals (entry_id, action, actor_user_id, reason) VALUES (?, 'approve', ?, ?)")
          .bind(entry.id, actor.id, body.reason || null).run();
        await audit(env, actor.id, "commission.approve", "commission", String(entry.id), null, entry.branch_id);
        await createNotification(env, { userId: entry.recipient_user_id, type: "commission.approved", title: "Commission Approved", message: `Commission ${entry.commission_ref} has been approved.`, metadata: { commission_id: entry.id } });
        return json({ ok: true, status: "Approved" });
      }

      if (action === "payments") {
        if (!["Approved", "Partially Paid"].includes(entry.status)) return json({ error: "Commission must be approved before payment" }, 409);
        const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : null;
        if (idempotencyKey) {
          const existing = await env.DB.prepare("SELECT * FROM commission_payments WHERE idempotency_key=?").bind(idempotencyKey).first();
          if (existing) return json({ ok: true, already_recorded: true, payment: existing });
        }
        const amountKobo = toKobo(body.amount);
        const net = commissionNet(entry);
        const outstanding = Math.max(0, net - Number(entry.paid_kobo || 0));
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) return json({ error: "Payment amount must be positive" }, 400);
        if (amountKobo > outstanding) return json({ error: `Payment exceeds outstanding commission of ${formatNGN(outstanding)}` }, 400);
        const method = String(body.method || "Bank Transfer").trim();
        if (!method) return json({ error: "Payment method is required" }, 400);
        const paymentRef = "CPAY-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
        const receiptRef = "CRCP-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
        const paidAt = new Date().toISOString();
        const res = await env.DB.prepare(`
          INSERT INTO commission_payments (payment_ref, idempotency_key, entry_id, amount_kobo, method,
            external_reference, evidence, notes, paid_by, paid_at, receipt_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(paymentRef, idempotencyKey, entry.id, amountKobo, method,
          body.external_reference || null, body.evidence || null, body.notes || null, actor.id, paidAt, receiptRef).run();
        const paidTotal = Number(entry.paid_kobo || 0) + amountKobo;
        const newStatus = paidTotal >= net ? "Paid" : "Partially Paid";
        await env.DB.prepare("UPDATE commission_entries SET paid_kobo=?, status=?, updated_at=datetime('now') WHERE id=?")
          .bind(paidTotal, newStatus, entry.id).run();
        const logoBytes = await getReceiptLogoBytes(env);
        const pdf = buildCommissionReceiptPdf({
          receiptRef, paymentRef, recipientName: entry.recipient_user_id ? (await env.DB.prepare("SELECT full_name FROM users WHERE id=?").bind(entry.recipient_user_id).first()).full_name : "Staff",
          planName: entry.plan_name, clientName: (await env.DB.prepare("SELECT full_name FROM clients WHERE id=?").bind(entry.client_id).first()).full_name,
          amountKobo, paidAt, method, logoBytes
        });
        const key = `commission-receipts/${entry.recipient_user_id || "staff"}/${receiptRef}.pdf`;
        await env.FILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
        await env.DB.prepare("UPDATE commission_payments SET r2_key=? WHERE id=?").bind(key, res.meta.last_row_id).run();
        await audit(env, actor.id, "commission.payment", "commission", String(entry.id), { payment_ref: paymentRef, amount_kobo: amountKobo, status: newStatus }, entry.branch_id);
        await createNotification(env, { userId: entry.recipient_user_id, type: "commission.paid", title: "Commission Payment Recorded", message: `A commission payment of ${formatNGN(amountKobo)} has been recorded for ${entry.commission_ref}.`, metadata: { commission_id: entry.id, payment_ref: paymentRef } });
        return json({ ok: true, payment_id: res.meta.last_row_id, payment_ref: paymentRef, receipt_ref: receiptRef, status: newStatus, outstanding_kobo: Math.max(0, net - paidTotal) });
      }

      if (action === "adjustments") {
        if (["Rejected", "Cancelled"].includes(entry.status)) return json({ error: "Rejected or cancelled commissions cannot be adjusted" }, 409);
        const adjustmentType = body.adjustment_type || "correction";
        if (!["refund", "reversal", "correction", "manual"].includes(adjustmentType)) return json({ error: "Invalid adjustment type" }, 400);
        const amountKobo = toKobo(body.amount);
        if (!Number.isInteger(amountKobo) || amountKobo === 0) return json({ error: "Adjustment amount must be non-zero" }, 400);
        const reason = String(body.reason || "").trim();
        if (!reason) return json({ error: "Adjustment reason is required" }, 400);
        const sourceKey = body.source_payment_id ? `payment:${body.source_payment_id}:entry:${entry.id}:${adjustmentType}` : `manual:${crypto.randomUUID()}`;
        const inserted = await env.DB.prepare(`
          INSERT OR IGNORE INTO commission_adjustments (entry_id, adjustment_type, amount_kobo, reason,
            source_payment_id, source_key, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(entry.id, adjustmentType, amountKobo, reason, body.source_payment_id || null, sourceKey, actor.id).run();
        if (!inserted.meta || Number(inserted.meta.changes) === 0) return json({ error: "This adjustment has already been recorded" }, 409);
        const newAdjusted = Number(entry.adjusted_kobo || 0) + amountKobo;
        const net = Number(entry.commission_kobo || 0) + newAdjusted;
        const newStatus = net <= 0 && Number(entry.paid_kobo || 0) === 0 ? "Reversed" : entry.status;
        await env.DB.prepare("UPDATE commission_entries SET adjusted_kobo=?, status=?, updated_at=datetime('now') WHERE id=?")
          .bind(newAdjusted, newStatus, entry.id).run();
        await audit(env, actor.id, "commission.adjustment", "commission", String(entry.id), { adjustment_type: adjustmentType, amount_kobo: amountKobo, reason }, entry.branch_id);
        return json({ ok: true, status: newStatus, adjusted_kobo: newAdjusted });
      }
    }

    // ---- Financial reports ----
    function csvEscape(value) {
      return `"${String(value === undefined || value === null ? "" : value).replace(/"/g, '""')}"`;
    }

    if (path === "/api/reports" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      const allowedRoles = ["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"];
      if (!allowedRoles.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const reportType = body.report_type;
      const format = body.format || "csv";
      if (!REPORT_TYPES.includes(reportType)) return json({ error: "Invalid report type" }, 400);
      if (!["csv", "pdf"].includes(format)) return json({ error: "Format must be csv or pdf" }, 400);
      if (actor.role_name === "Marketer" && !["commission", "commission_liability"].includes(reportType)) {
        return json({ error: "Marketers may export only their own commission reports" }, 403);
      }
      if (["commission", "commission_liability"].includes(reportType) && !canAccessCommissions(actor)) {
        return json({ error: "Commission access is required" }, 403);
      }
      if (actor.role_name === "Team Lead" && reportType === "branch_performance") {
        return json({ error: "Branch reports are not available to Team Leads" }, 403);
      }
      const scope = await resolvePhase6Scope(env, actor);
      let dataset;
      try {
        dataset = await buildReportDataset(env, actor, scope, { ...body, report_type: reportType });
      } catch (error) {
        return json({ error: error.message || "Unable to build report" }, 400);
      }
      const reportRef = "RPT-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
      const requestedAt = new Date().toISOString();
      let payload;
      let contentType;
      let key;
      if (format === "csv") {
        const lines = [
          ["Report Ref", reportRef].map(csvEscape).join(","),
          ["Generated At", requestedAt].map(csvEscape).join(","),
          ["Generated By", actor.full_name].map(csvEscape).join(","),
          ["Filters", dataset.filtersLabel].map(csvEscape).join(","),
          "",
          dataset.columns.map(csvEscape).join(","),
          ...dataset.rows.map(row => row.map(csvEscape).join(","))
        ];
        const csv = lines.join("\n");
        payload = new TextEncoder().encode(csv);
        contentType = "text/csv;charset=utf-8";
        key = `reports/${reportRef}.csv`;
      } else {
        const logoBytes = await getReceiptLogoBytes(env);
        payload = buildFinancialReportPdf({
          title: dataset.title,
          reportRef,
          generatedAt: requestedAt,
          generatedBy: actor.full_name,
          filters: dataset.filtersLabel,
          summaryLines: dataset.summaryLines,
          columns: dataset.columns,
          rows: dataset.rows,
          logoBytes
        });
        contentType = "application/pdf";
        key = `reports/${reportRef}.pdf`;
      }
      await env.FILES.put(key, payload, { httpMetadata: { contentType } });
      const res = await env.DB.prepare(`
        INSERT INTO financial_report_jobs (report_ref, report_type, format, filters_json, status,
          r2_key, requested_by, completed_at)
        VALUES (?, ?, ?, ?, 'Generated', ?, ?, datetime('now'))
      `).bind(reportRef, reportType, format, JSON.stringify({ ...body, filters_label: dataset.filtersLabel }), key, actor.id).run();
      await audit(env, actor.id, "report.generate", "financial_report", String(res.meta.last_row_id), { report_ref: reportRef, report_type: reportType, format }, null);
      return json({
        ok: true, id: res.meta.last_row_id, report_ref: reportRef, format,
        r2_key: key, summary: dataset.summaryLines
      });
    }

    if (path === "/api/reports" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canAccessCommissions(actor)) return json({ error: "Forbidden" }, 403);
      const admin = ["Managing Director", "Finance Officer"].includes(actor.role_name);
      const clauses = [];
      const binds = [];
      if (!admin) { clauses.push("j.requested_by=?"); binds.push(actor.id); }
      const type = url.searchParams.get("report_type");
      if (type) { clauses.push("j.report_type=?"); binds.push(type); }
      const whereSql = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const { results: jobs } = await env.DB.prepare(`
        SELECT j.*, u.full_name AS requested_by_name FROM financial_report_jobs j
        LEFT JOIN users u ON u.id=j.requested_by ${whereSql}
        ORDER BY j.id DESC LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM financial_report_jobs j ${whereSql}`).bind(...binds).first();
      return json({ jobs, pagination: { page, limit, total: count ? count.c : 0 } });
    }

    const reportDownloadMatch = path.match(/^\/api\/reports\/(\d+)\/download$/);
    if (reportDownloadMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!STAFF_ROLES.includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const job = await env.DB.prepare("SELECT * FROM financial_report_jobs WHERE id=?").bind(reportDownloadMatch[1]).first();
      if (!job) return json({ error: "Report not found" }, 404);
      const admin = ["Managing Director", "Finance Officer"].includes(actor.role_name);
      if (!admin && Number(job.requested_by) !== Number(actor.id)) return json({ error: "Forbidden" }, 403);
      if (!job.r2_key || !job.r2_key.startsWith("reports/")) return json({ error: "Report file unavailable" }, 404);
      const object = await env.FILES.get(job.r2_key);
      if (!object) return json({ error: "Report file unavailable" }, 404);
      const bytes = await object.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": job.format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="${job.report_ref}.${job.format}"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    // Unknown API routes must never fall through to static assets.
    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // Staging (and any non-production environment) must never be indexed.
    if (env.ENVIRONMENT !== "production" && path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow"
        }
      });
    }

    // Static Assets Fallback
    return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: "Invalid JSON request body" }, 400);
      console.error("Unhandled request error", error);
      return json({ error: "Internal server error" }, 500);
    }
}

export default {
  async fetch(request, env) {
    const response = await handleFetch(request, env);
    if (env.ENVIRONMENT !== "production" && response.status !== 101) {
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    return response;
  },

  // Cloudflare Queues consumer: notification delivery and SMS retries.
  async queue(batch, env) {
    for (const message of batch.messages || []) {
      try {
        await processNotificationQueue(env, message);
        if (message.ack) message.ack();
      } catch {
        const body = message.body || message;
        if (body.type === "sms.send" && body.sms_message_id) {
          const row = await env.DB.prepare("SELECT attempts, status FROM sms_messages WHERE id=?")
            .bind(Number(body.sms_message_id)).first().catch(() => null);
          if (row && ["failed", "sent", "delivered", "opted_out", "skipped"].includes(row.status)) {
            if (message.ack) message.ack();
            continue;
          }
          const attempts = Number(row ? row.attempts : 1);
          const delaySeconds = Math.min(900, 30 * Math.pow(2, Math.max(1, attempts)));
          if (message.retry) message.retry({ delaySeconds });
        } else if (message.retry) {
          message.retry();
        }
      }
    }
  },

  // Cron trigger: upcoming / overdue installment notifications (deduplicated)
  // and configurable SMS statements/reminders.
  async scheduled(event, env, ctx) {
    const task = (async () => {
      await dispatchPaymentReminders(env);
      await dispatchSmsSchedules(env);
      await reconcileAlatpayPayments(env);
      await retryCommissionGeneration(env);
      await backfillReferralCommissions(env, null, { limit: 100, onlyStale: true, reason: "Scheduled referral commission reconciliation" }).catch(() => {});
      await expireTestAccounts(env);
      await expireMonthlyMarketerAccess(env);
      const settings = await getSmsSettings(env);
      if (settings.enabled && settings.provider !== "mock") {
        try {
          const balance = await fetchSmsProviderBalance(env, settings);
          if (balance !== null) {
            await setSmsSetting(env, "sms_credit_balance", balance, null);
            await setSmsSetting(env, "sms_credit_checked_at", new Date().toISOString(), null);
            await checkSmsLowBalance(env, { ...settings, creditBalance: balance });
          }
        } catch { /* provider balance is optional */ }
      }
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
    await task;
  }
};
