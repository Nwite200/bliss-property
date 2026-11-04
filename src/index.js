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
    "SELECT s.id AS sid, s.expires_at, u.id, u.email, u.full_name, u.role_id, u.branch_id, u.is_active, r.name AS role_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.id=?"
  ).bind(sid).first();
  if (!row) return null;
  if (parseDbDate(row.expires_at) < new Date()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    return null;
  }
  if (!row.is_active) return null;
  return row;
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
const STAFF_ROLES = ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"];
const GRANULARITIES = ["day", "week", "month", "year"];
const COMMISSION_BASES = ["contract_value", "verified_collections", "fixed"];
const COMMISSION_STATUSES = ["Draft", "Calculated", "Pending Approval", "Approved", "Partially Paid", "Paid", "Rejected", "Reversed", "Cancelled"];
const COMMISSION_ROLES = ["Marketer", "Team Lead", "Branch Manager"];
const SALE_TYPES = ["New Sale", "Resale", "Referral", "Other"];
const REPORT_TYPES = [
  "sales", "collections", "outstanding", "commission",
  "branch_performance", "marketer_performance", "refunds", "commission_liability"
];

function dateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !isNaN(new Date(text + "T00:00:00Z").getTime()) ? text : null;
}

function todayOnly() {
  return new Date().toISOString().slice(0, 10);
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
    actorId: actor.id,
    branchId: actor.branch_id,
    teamIds: [],
    memberIds: [actor.id],
    teamLeadIds: []
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
      clause: `(${alias}.team_lead_id = ? OR ${alias}.original_marketer_id IN (${ph}) OR ${alias}.created_by IN (${ph}) OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=${alias}.id AND ca.is_primary=1 AND ca.relationship_manager_id IN (${ph})))`,
      binds: [scope.actorId, ...scope.memberIds, ...scope.memberIds, ...scope.memberIds]
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
      )`,
      binds: [scope.actorId, scope.actorId, scope.actorId]
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

function commissionScopeSql(scope, alias = "ce") {
  if (["Managing Director", "Finance Officer"].includes(scope.role)) return { clause: "1=1", binds: [] };
  if (scope.role === "Branch Manager") return { clause: `${alias}.branch_id = ?`, binds: [scope.branchId] };
  if (scope.role === "Team Lead") {
    const clauses = [`${alias}.team_lead_id = ?`];
    const binds = [scope.actorId];
    if (scope.teamIds.length) {
      clauses.push(`${alias}.team_id IN (${placeholders(scope.teamIds)})`);
      binds.push(...scope.teamIds);
    }
    return { clause: `(${clauses.join(" OR ")})`, binds };
  }
  if (scope.role === "Marketer") return { clause: `${alias}.recipient_user_id = ?`, binds: [scope.actorId] };
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

      const { results: verifiedPayments } = await env.DB.prepare(`
        SELECT id, amount_kobo, verified_at FROM payments
        WHERE client_id=? AND status='verified' AND is_demo=0 AND currency='NGN'
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

        const makeEntry = async ({ sourceType, sourceKey, paymentId, qualifyingKobo, sourceDate, metadata }) => {
          if (from && String(sourceDate).slice(0, 10) < from) return;
          if (to && String(sourceDate).slice(0, 10) > to) return;
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
              status, approval_required, metadata, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            commissionRef, plan.id, rule.id, client.id, client.interested_property_id || null, paymentId || null,
            recipient.userId, recipient.role, recipient.branchId, recipient.teamId || null,
            recipient.marketerId, recipient.teamLeadId, sourceType, sourceKey,
            plan.calculation_basis, qualifyingKobo, fixed ? 0 : Number(rule.rate_bps || 0), amount,
            status, plan.approval_required ? 1 : 0,
            metadata ? JSON.stringify(metadata) : null, actor.id
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
            await makeEntry({
              sourceType: "payment",
              sourceKey: `plan:${plan.id}:rule:${rule.id}:payment:${payment.id}`,
              paymentId: payment.id,
              qualifyingKobo: Number(payment.amount_kobo || 0),
              sourceDate: payment.verified_at,
              metadata: { payment_id: payment.id }
            });
          }
        }
      }
    }
  }
  return { created, skipped, created_refs: createdRefs };
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

  if (type === "sales") {
    const { results } = await env.DB.prepare(`
      SELECT c.client_reference, c.full_name, c.status, c.sale_type,
             b.name AS branch_name, m.full_name AS marketer_name,
             c.agreed_purchase_price, c.created_at
      FROM clients c
      LEFT JOIN branches b ON b.id=c.assigned_branch_id
      LEFT JOIN users m ON m.id=c.original_marketer_id
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.status NOT IN ('Cancelled','Inactive') AND ${clientScope.clause}${branchFilter}
        AND date(c.created_at) BETWEEN date(?) AND date(?)
      ORDER BY c.created_at DESC
    `).bind(...clientBinds, range.from, range.to).all();
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
      WHERE p.status='verified' AND p.is_demo=0 AND p.currency='NGN'
        AND ${clientScope.clause}${branchFilter}
        AND date(p.verified_at) BETWEEN date(?) AND date(?)
      ORDER BY p.verified_at DESC
    `).bind(...clientBinds, range.from, range.to).all();
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
               WHERE p.client_id=c.id AND p.status='verified' AND p.is_demo=0 AND p.currency='NGN'),0) AS verified_kobo
      FROM clients c LEFT JOIN branches b ON b.id=c.assigned_branch_id
      WHERE c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%'
        AND c.agreed_purchase_price IS NOT NULL AND c.agreed_purchase_price > 0
        AND ${clientScope.clause}${branchFilter}
      ORDER BY c.agreed_purchase_price DESC
    `).bind(...clientBinds).all();
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

  const clientWhere = `c.is_deleted=0 AND c.client_reference NOT LIKE 'DEMO-%' AND ${clientScope.clause}${clientBranch}${categoryFilter}`;
  const leadWhere = `l.is_demo=0 AND ${leadScope.clause}${leadBranch}`;
  const paymentWhere = `p.status='verified' AND p.is_demo=0 AND p.currency='NGN' AND ${clientScope.clause}${clientBranch}${categoryFilter}`;

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

  const commissionSummary = await getCommissionSummary(env, scope);

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

export default {
  async fetch(request, env) {
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
      const res = await env.DB.prepare("INSERT INTO users (email, password_hash, full_name, role_id, branch_id) VALUES (?, ?, ?, ?, NULL)").bind(email.toLowerCase(), hash, full_name, mdRole.id).run();
      await audit(env, res.meta.last_row_id, "setup.initialize", "user", String(res.meta.last_row_id), { email });
      return json({ ok: true, user_id: res.meta.last_row_id });
    }

    // =========================================================================
    // PUBLIC CLIENT SIGN-UP
    // =========================================================================
    if (path === "/api/signup" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { full_name, email, phone_number, password, interested_property_id } = body || {};
      if (!full_name || !email || !phone_number || !password) {
        return json({ error: "Full name, email, phone number and password are required" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
        return json({ error: "A valid email address is required" }, 400);
      }
      if (!/^[+0-9()\s-]{7,25}$/.test(String(phone_number).trim())) {
        return json({ error: "A valid phone number is required" }, 400);
      }
      if (!validPassword(password)) {
        return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedPhone = String(phone_number).trim();
      const existingUser = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(normalizedEmail).first();
      if (existingUser) return json({ error: "An account with this email already exists" }, 409);
      const existingClient = await env.DB.prepare(
        "SELECT id FROM clients WHERE (LOWER(email_address)=? OR phone_number=?) AND is_deleted=0 LIMIT 1"
      ).bind(normalizedEmail, normalizedPhone).first();
      if (existingClient) return json({ error: "A client record with this email or phone already exists" }, 409);

      const system = await env.DB.prepare(`
        SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE r.name='Managing Director' AND u.is_active=1 ORDER BY u.id LIMIT 1
      `).first();
      if (!system) return json({ error: "Client registration is not available until the portal is initialized" }, 503);

      // Clients cannot self-assign a branch. New accounts are parked in Head
      // Office until authorised staff review and assign the relationship.
      const defaultBranch = await env.DB.prepare(`
        SELECT id FROM branches ORDER BY CASE WHEN name='Head Office' THEN 0 ELSE 1 END, id LIMIT 1
      `).first();
      const resolvedBranch = defaultBranch ? defaultBranch.id : null;
      if (!resolvedBranch) return json({ error: "No branch is available for registration" }, 503);

      let propertyId = interested_property_id ? Number(interested_property_id) : null;
      if (propertyId) {
        const property = await env.DB.prepare("SELECT id FROM properties WHERE id=? AND is_published=1").bind(propertyId).first();
        if (!property) return json({ error: "Selected property is not available" }, 400);
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
      const clientRes = await env.DB.prepare(`
        INSERT INTO clients (client_reference, full_name, phone_number, email_address, notes, status,
          sale_type, assigned_branch_id, created_by, original_marketer_id, team_lead_id,
          agreed_purchase_price, interested_property_id, user_id)
        VALUES (?, ?, ?, ?, ?, 'Prospect', 'New Sale', ?, ?, ?, NULL, NULL, ?, ?)
      `).bind(
        clientRef, String(full_name).trim(), normalizedPhone, normalizedEmail,
        "Self-registered through the public client portal.", resolvedBranch,
        system.id, system.id, propertyId, userId
      ).run();
      const clientId = clientRes.meta.last_row_id;
      if (propertyId) await upsertClientPropertyAllocation(env, clientId, propertyId, 0, "Prospect");
      await env.DB.prepare(`
        INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by)
        VALUES (?, ?, ?, NULL, ?)
      `).bind(clientId, system.id, resolvedBranch, system.id).run();
      await env.DB.prepare(`
        INSERT INTO client_status_history (client_id, old_status, new_status, changed_by)
        VALUES (?, NULL, 'Prospect', ?)
      `).bind(clientId, userId).run();
      await audit(env, userId, "client.self_register", "client", String(clientId), {
        client_reference: clientRef, email: normalizedEmail, branch_id: resolvedBranch
      }, resolvedBranch);
      await createNotification(env, {
        userId,
        type: "client.welcome",
        title: "Welcome to Bliss Legacy",
        message: `Your client portal account is ready. Your client reference is ${clientRef}.`,
        metadata: { client_id: clientId, client_reference: clientRef }
      });
      const session = await createSession(env, userId);
      const cookie = `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(session.expires).toUTCString()}`;
      return json({
        ok: true,
        client_id: clientId,
        client_reference: clientRef,
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
        "SELECT u.id, u.email, u.password_hash, u.is_active, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=?"
      ).bind(ident).first();

      if (!user) {
        // Try resolving client reference or phone number
        const clientMatch = await env.DB.prepare(
          "SELECT user_id, email_address FROM clients WHERE (LOWER(client_reference)=? OR phone_number=?) AND is_deleted=0"
        ).bind(ident, ident).first();
        if (clientMatch) {
          if (clientMatch.user_id) {
            user = await env.DB.prepare(
              "SELECT u.id, u.email, u.password_hash, u.is_active, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?"
            ).bind(clientMatch.user_id).first();
          } else if (clientMatch.email_address) {
            user = await env.DB.prepare(
              "SELECT u.id, u.email, u.password_hash, u.is_active, u.full_name, u.branch_id, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=?"
            ).bind(clientMatch.email_address.toLowerCase()).first();
          }
        }
      }

      if (!user || !user.is_active) {
        await audit(env, null, "login.failure", "user", ident, { reason: "not_found_or_inactive" });
        return json({ error: "Invalid credentials" }, 401);
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        await audit(env, user.id, "login.failure", "user", ident, { reason: "bad_password" });
        return json({ error: "Invalid credentials" }, 401);
      }

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
        role_id: user.role_id,
        branch_id: user.branch_id,
        branch_name: staffDetails ? staffDetails.branch_name : null,
        phone_number: staffDetails ? staffDetails.phone_number : null,
        job_title: staffDetails ? staffDetails.job_title : null,
        date_joined: staffDetails ? staffDetails.date_joined : null,
        last_login_at: staffDetails ? staffDetails.last_login_at : null,
        team_names: staffDetails ? staffDetails.team_names : null,
        client: clientDetails
      });
    }

    // Password Reset Request
    if (path === "/api/password-reset-request" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { email } = body || {};
      if (!email) return json({ error: "Email required" }, 400);
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
      if (!["Managing Director", "Branch Manager", "Finance Officer"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      let role = url.searchParams.get("role");
      const branch = url.searchParams.get("branch");
      let where = ["u.is_active=1"];
      const binds = [];
      if (role) { where.push("r.name = ?"); binds.push(role); }
      if (branch) { where.push("u.branch_id = ?"); binds.push(branch); }
      if (actor.role_name === "Branch Manager") { where.push("u.branch_id = ?"); binds.push(actor.branch_id); }
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
      const { email, password, full_name, role_name, branch_name, branch_id, team_id } = body || {};
      if (!email || !password || !full_name || !role_name) return json({ error: "Missing fields" }, 400);
      const allowedForBM = ["Team Lead", "Marketer", "Finance Officer", "Client"];
      if (actor.role_name === "Branch Manager" && !allowedForBM.includes(role_name)) return json({ error: "Forbidden role" }, 403);
      if (role_name === "Managing Director") return json({ error: "Cannot create MD" }, 403);
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(role_name).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      let branchId = branch_id || null;
      if (!branchId && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        if (branch) branchId = branch.id;
      }
      if (!branchId) return json({ error: "Branch is required" }, 400);
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(branchId).first();
      if (!branch) return json({ error: "Unknown branch" }, 400);
      if (actor.role_name === "Branch Manager" && Number(branchId) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(email.toLowerCase()).first();
      if (existing) return json({ error: "Email already used" }, 409);
      const hash = await hashPassword(password);
      const res = await env.DB.prepare("INSERT INTO users (email, password_hash, full_name, role_id, branch_id) VALUES (?, ?, ?, ?, ?)")
        .bind(email.toLowerCase(), hash, full_name, role.id, branchId).run();
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
      const q = url.searchParams.get("q") || "";
      const category = url.searchParams.get("category") || "";
      const location = url.searchParams.get("location") || "";
      const status = url.searchParams.get("status") || "";
      const branch = url.searchParams.get("branch") || "";
      const featured = url.searchParams.get("featured");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
      const offset = (page - 1) * limit;

      let where = [];
      const binds = [];
      if (!actor || ["Client", "Marketer"].includes(actor.role_name)) where.push("p.is_published=1");
      if (q) { where.push("(p.title LIKE ? OR p.city LIKE ? OR p.state LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (category) { where.push("pc.name=?"); binds.push(category); }
      if (location) { where.push("(p.city=? OR p.state=?)"); binds.push(location, location); }
      if (status) { where.push("p.status=?"); binds.push(status); }
      if (branch) { where.push("b.name=?"); binds.push(branch); }
      if (featured === "1") { where.push("p.is_featured=1"); }
      if (actor && actor.role_name === "Branch Manager") { where.push("p.branch_id=?"); binds.push(actor.branch_id); }

      const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
      const sql = `SELECT p.*, pc.name AS category_name, b.name AS branch_name FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id ${whereSql} ORDER BY p.id DESC LIMIT ? OFFSET ?`;
      const countSql = `SELECT COUNT(*) AS c FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id ${whereSql}`;
      const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
      const cnt = await env.DB.prepare(countSql).bind(...binds).first();
      return json({ properties: results, page, limit, total: cnt ? cnt.c : 0 });
    }

    const propMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propMatch && request.method === "GET") {
      const id = propMatch[1];
      const actor = await getSessionUser(env, request);
      const prop = await env.DB.prepare("SELECT p.*, pc.name AS category_name, b.name AS branch_name FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id WHERE p.id=?").bind(id).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if ((!actor || ["Client", "Marketer"].includes(actor.role_name)) && !prop.is_published) return json({ error: "Not found" }, 404);
      const { results: images } = await env.DB.prepare("SELECT id, r2_key, is_main, sort_order FROM property_images WHERE property_id=? ORDER BY is_main DESC, sort_order").bind(id).all();
      // Internal property documents are never exposed to anonymous or client callers.
      let documents = [];
      if (actor && actor.role_name !== "Client") {
        const result = await env.DB.prepare("SELECT id, r2_key, filename FROM property_documents WHERE property_id=?").bind(id).all();
        documents = result.results;
      }
      return json({ property: prop, images, documents });
    }

    // ---- Create property (Phase 3) ----
    if (path === "/api/properties" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const {
        title, description, category_name, property_type, sale_price, promotional_price,
        state, city, address, branch_name, land_size, bedrooms, bathrooms, toilets,
        parking_spaces, features, is_featured, is_published
      } = body || {};
      const price = Number(sale_price);
      if (!title || !Number.isFinite(price) || price <= 0) return json({ error: "Title and a positive sale price are required" }, 400);

      let categoryId = null;
      if (category_name) {
        const category = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(category_name).first();
        categoryId = category ? category.id : null;
      }
      let branchId = null;
      if (branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        branchId = branch ? branch.id : null;
      }
      if (actor.role_name === "Branch Manager") {
        if (branchId !== null && branchId !== actor.branch_id) return json({ error: "Cross-branch forbidden" }, 403);
        branchId = actor.branch_id;
      }
      const ref = "BLP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const res = await env.DB.prepare(`INSERT INTO properties (reference,title,description,category_id,property_type,sale_price,promotional_price,state,city,address,branch_id,land_size,bedrooms,bathrooms,toilets,parking_spaces,features,is_featured,is_published,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ref, title, description || null, categoryId, property_type || null, price, promotional_price || null,
          state || null, city || null, address || null, branchId, land_size || null, bedrooms || null,
          bathrooms || null, toilets || null, parking_spaces || null, features ? JSON.stringify(features) : null,
          isTruthy(is_featured) ? 1 : 0, isTruthy(is_published) ? 1 : 0, actor.id, actor.id).run();
      const newId = res.meta.last_row_id;
      await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)")
        .bind(newId, null, "Available", actor.id).run();
      await audit(env, actor.id, "property.create", "property", String(newId), { title, sale_price: price, branch_id: branchId }, branchId);
      return json({ ok: true, id: newId, reference: ref });
    }

    // ---- Update property (Phase 3) ----
    const propUpdateMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propUpdateMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = propUpdateMatch[1];
      const existing = await env.DB.prepare("SELECT * FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const body = await request.json();
      if (body.sale_price !== undefined) {
        const price = Number(body.sale_price);
        if (!Number.isFinite(price) || price <= 0) return json({ error: "Sale price must be positive" }, 400);
      }
      const fields = ["title", "description", "property_type", "sale_price", "promotional_price", "state",
        "city", "address", "land_size", "bedrooms", "bathrooms", "toilets", "parking_spaces",
        "is_featured", "is_published"];
      const sets = [];
      const vals = [];
      for (const field of fields) {
        if (body[field] === undefined) continue;
        sets.push(`${field}=?`);
        vals.push(["is_featured", "is_published"].includes(field) ? (isTruthy(body[field]) ? 1 : 0) : body[field]);
      }
      if (body.category_name !== undefined) {
        const category = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(body.category_name).first();
        sets.push("category_id=?");
        vals.push(category ? category.id : null);
      }
      if (body.features !== undefined) {
        sets.push("features=?");
        vals.push(JSON.stringify(body.features));
      }
      if (body.branch_name !== undefined) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(body.branch_name).first();
        if (actor.role_name === "Branch Manager" && (!branch || branch.id !== actor.branch_id)) {
          return json({ error: "Cross-branch forbidden" }, 403);
        }
        sets.push("branch_id=?");
        vals.push(branch ? branch.id : null);
      }
      if (!sets.length) return json({ error: "No fields" }, 400);
      sets.push("updated_by=?");
      vals.push(actor.id);
      sets.push("updated_at=datetime('now')");
      vals.push(id);
      await env.DB.prepare(`UPDATE properties SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      await audit(env, actor.id, "property.update", "property", id, body, existing.branch_id);
      return json({ ok: true });
    }

    // ---- Property status change (Phase 3) ----
    const statusMatch = path.match(/^\/api\/properties\/(\d+)\/status$/);
    if (statusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = statusMatch[1];
      const body = await request.json();
      const newStatus = body.status;
      if (!["Available", "Reserved", "Sold", "Unavailable"].includes(newStatus)) {
        return json({ error: "Invalid status" }, 400);
      }
      const existing = await env.DB.prepare("SELECT status, branch_id FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      await env.DB.prepare("UPDATE properties SET status=?, updated_by=?, updated_at=datetime('now') WHERE id=?")
        .bind(newStatus, actor.id, id).run();
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
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = imageUploadMatch[1];
      const existing = await env.DB.prepare("SELECT branch_id FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type)) return json({ error: "Invalid file type" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "File too large (5MB max)" }, 400);
      const key = `properties/${id}/${crypto.randomUUID()}-${String(file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
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
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const propId = imageDeleteMatch[1];
      const imgId = imageDeleteMatch[2];
      const image = await env.DB.prepare("SELECT r2_key, property_id FROM property_images WHERE id=?").bind(imgId).first();
      if (!image || String(image.property_id) !== propId) return json({ error: "Not found" }, 404);
      const prop = await env.DB.prepare("SELECT branch_id FROM properties WHERE id=?").bind(propId).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && prop.branch_id !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (env.FILES.delete) await env.FILES.delete(image.r2_key);
      await env.DB.prepare("DELETE FROM property_images WHERE id=?").bind(imgId).run();
      await audit(env, actor.id, "property.image.delete", "property", propId, { key: image.r2_key }, prop.branch_id);
      return json({ ok: true });
    }

    // Serve public property images from R2. Receipts and other private
    // objects are never exposed through this anonymous route.
    const fileMatch = path.match(/^\/api\/files\/(.+)$/);
    if (fileMatch && request.method === "GET") {
      const key = decodeURIComponent(fileMatch[1]);
      if (!key.startsWith("properties/")) return new Response("Not found", { status: 404 });
      const registered = await env.DB.prepare(`
        SELECT pi.id, p.is_published FROM property_images pi
        JOIN properties p ON p.id=pi.property_id
        WHERE pi.r2_key=? LIMIT 1
      `).bind(key).first();
      if (!registered) return new Response("Not found", { status: 404 });
      if (!registered.is_published) {
        const actor = await getSessionUser(env, request);
        if (!actor || actor.role_name === "Client") return new Response("Not found", { status: 404 });
      }
      const obj = await env.FILES.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      if (typeof obj.writeHttpMetadata === "function") obj.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=3600");
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
      if (role === "Team Lead") return { clause: "(c.team_lead_id = ? OR c.original_marketer_id = ? OR c.created_by = ?)", binds: [actor.id, actor.id, actor.id] };
      if (role === "Marketer") {
        return {
          clause: `(
            (EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1)
             AND EXISTS (SELECT 1 FROM client_assignments ca2 WHERE ca2.client_id=c.id AND ca2.is_primary=1 AND ca2.relationship_manager_id=?))
            OR
            (NOT EXISTS (SELECT 1 FROM client_assignments ca3 WHERE ca3.client_id=c.id AND ca3.is_primary=1)
             AND (c.original_marketer_id=? OR c.created_by=?))
          )`,
          binds: [actor.id, actor.id, actor.id]
        };
      }
      return { clause: "c.id = -1", binds: [] };
    }

    function canManageClient(actor, client) {
      const role = actor.role_name;
      if (role === "Managing Director") return true;
      if (role === "Branch Manager") return client.assigned_branch_id === actor.branch_id;
      if (role === "Team Lead") {
        return client.team_lead_id === actor.id || client.original_marketer_id === actor.id || client.created_by === actor.id;
      }
      if (role === "Marketer") {
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
      const { full_name, phone_number, email_address, residential_address, state, city, next_of_kin, notes, preferred_channel, status, assigned_branch_id, agreed_purchase_price, interested_property_id, sale_type } = body || {};
      if (!full_name || !phone_number) return json({ error: "Full name and phone number required" }, 400);
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

      if (agreed_purchase_price !== undefined && agreed_purchase_price !== null && agreed_purchase_price !== "") {
        if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) {
          return json({ error: "Only a Managing Director or Branch Manager can establish a contract price" }, 403);
        }
        const price = Number(agreed_purchase_price);
        if (!Number.isFinite(price) || price < 0) return json({ error: "Agreed purchase price is invalid" }, 400);
      }

      const dup = await env.DB.prepare("SELECT id FROM clients WHERE phone_number = ? AND assigned_branch_id = ? AND is_deleted = 0 LIMIT 1")
        .bind(phone_number, resolvedBranchId).first();
      if (dup) return json({ error: "A client with this phone number already exists in this branch" }, 409);

      const ref = "BLC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      const teamLeadId = actor.role_name === "Team Lead" ? actor.id : null;
      const agreedPrice = agreed_purchase_price === undefined || agreed_purchase_price === null || agreed_purchase_price === ""
        ? null : Number(agreed_purchase_price);

      const res = await env.DB.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, residential_address, state, city, next_of_kin, notes, preferred_channel, status, assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id, sale_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ref, full_name, phone_number, email_address || null, residential_address || null, state || null, city || null, next_of_kin || null, notes || null, preferred_channel || null, status || "Prospect", resolvedBranchId, actor.id, actor.id, teamLeadId, agreedPrice, interested_property_id || null, resolvedSaleType).run();
      const newId = res.meta.last_row_id;
      if (interested_property_id) {
        await upsertClientPropertyAllocation(env, newId, Number(interested_property_id), agreedPrice || 0, status || "Prospect");
      }

      await env.DB.prepare("INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by) VALUES (?, ?, ?, ?, ?)")
        .bind(newId, actor.id, resolvedBranchId, teamLeadId, actor.id).run();
      await env.DB.prepare("INSERT INTO client_status_history (client_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)")
        .bind(newId, null, status || "Prospect", actor.id).run();
      await audit(env, actor.id, "client.create", "client", String(newId), { full_name, phone_number, branch_id: resolvedBranchId }, resolvedBranchId);
      if (env.TASKS && typeof env.TASKS.send === "function") {
        await env.TASKS.send({ type: "client.registered", client_id: newId }).catch(() => {});
      }

      return json({ ok: true, id: newId, client_reference: ref });
    }

    // ---- Client details (Phase 4) ----
    const clientDetailMatch = path.match(/^\/api\/clients\/(\d+)$/);
    if (clientDetailMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (actor.role_name === "Client") return json({ error: "Forbidden" }, 403);
      const id = clientDetailMatch[1];
      const client = await env.DB.prepare(`
        SELECT c.*, u.full_name AS created_by_name, m.full_name AS original_marketer_name,
               b.name AS branch_name,
               (SELECT ca.relationship_manager_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id,
               (SELECT ca.team_lead_id FROM client_assignments ca
                 WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_team_lead_id
        FROM clients c
        LEFT JOIN users u ON u.id=c.created_by
        LEFT JOIN users m ON m.id=c.original_marketer_id
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
      return json({
        client,
        properties: portfolio.properties,
        financials: portfolio.financials,
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
      if (!["Managing Director", "Branch Manager", "Team Lead"].includes(actor.role_name)) {
        return json({ error: "Forbidden" }, 403);
      }
      const id = clientDetailMatch[1];
      const client = await env.DB.prepare("SELECT c.*, (SELECT ca.relationship_manager_id FROM client_assignments ca WHERE ca.client_id=c.id AND ca.is_primary=1 ORDER BY ca.assigned_at DESC LIMIT 1) AS current_relationship_manager_id FROM clients c WHERE c.id=? AND c.is_deleted=0").bind(id).first();
      if (!client) return json({ error: "Not found" }, 404);
      if (!canManageClient(actor, client)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
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
      const fields = ["full_name", "phone_number", "email_address", "residential_address", "state", "city",
        "next_of_kin", "notes", "preferred_channel", "agreed_purchase_price", "interested_property_id", "sale_type"];
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
          email_address: client.email_address,
          residential_address: client.residential_address,
          state: client.state,
          city: client.city,
          next_of_kin: client.next_of_kin,
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
          email_address: client.email_address,
          residential_address: client.residential_address,
          state: client.state,
          city: client.city,
          next_of_kin: client.next_of_kin,
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
      const permittedFields = ["full_name", "phone_number", "email_address", "residential_address", "state", "city", "next_of_kin"];
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

    // 8 & 9. ALAT by Wema Bank Virtual Account (Client View)
    if (path === "/api/client/virtual-account" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Client") return json({ error: "Forbidden" }, 403);
      const client = await getClientForActor(env, actor);
      if (!client) return json({ error: "Not found" }, 404);

      // Check ALAT provider configuration status
      const provider = await env.DB.prepare(
        "SELECT status, environment FROM provider_configs WHERE provider_key='wema_alat'"
      ).first();
      const providerStatus = provider ? provider.status : "Not configured";

      // Check if the real provider has provisioned an account for this client
      let va = null;
      if (providerStatus === "Active") {
        va = await env.DB.prepare(
          "SELECT * FROM virtual_accounts WHERE client_id=? AND provider='wema_alat'"
        ).bind(client.id).first();
      }

      const hasRealAccount = Boolean(
        va &&
        providerStatus === "Active" &&
        va.account_number &&
        va.account_status === "active"
      );

      if (!hasRealAccount) {
        return json({
          is_active: false,
          provider: "ALAT by Wema Bank",
          provider_status: providerStatus,
          status: providerStatus,
          notice: WEMA_PENDING_MESSAGE,
          message: WEMA_PENDING_MESSAGE,
          client_reference: client.client_reference
        });
      }

      return json({
        is_active: true,
        provider: "ALAT by Wema Bank",
        provider_status: providerStatus,
        status: providerStatus,
        bank_name: va.bank_name || "Wema Bank",
        account_name: va.account_name,
        account_number: va.account_number,
        account_status: va.account_status,
        client_reference: client.client_reference
      });
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
          "Content-Disposition": `attachment; filename="${row.receipt_ref}.pdf"`,
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
          "Content-Disposition": `attachment; filename="${row.receipt_ref}.pdf"`,
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
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN' ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();
      const totalVerifiedKobo = totalVerifiedRow ? Number(totalVerifiedRow.total_kobo) : 0;

      // Today's collections
      const today = new Date().toISOString().slice(0, 10);
      const todayRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS today_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN' AND date(p.verified_at)=? ${branchFilter}
      `).bind(isDemo, today, ...branchBinds).first();

      // Monthly collections (current month)
      const curMonth = today.slice(0, 7);
      const monthRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS month_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='verified' AND p.is_demo=? AND p.currency='NGN' AND strftime('%Y-%m', p.verified_at)=? ${branchFilter}
      `).bind(isDemo, curMonth, ...branchBinds).first();

      // Pending payments
      const pendingRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS pending_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='pending' AND p.is_demo=? AND p.currency='NGN' ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Failed payments
      const failedRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS failed_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status='failed' AND p.is_demo=? AND p.currency='NGN' ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Refunds & reversals
      const refundsRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount_kobo), 0) AS refunds_kobo, COUNT(*) AS count
        FROM payments p
        JOIN clients c ON c.id=p.client_id
        WHERE p.status IN ('reversed', 'refunded') AND p.is_demo=? AND p.currency='NGN' ${branchFilter}
      `).bind(isDemo, ...branchBinds).first();

      // Outstanding client balances. Demo and live contract totals are kept in
      // separate ledgers so demo data can never distort live reporting.
      const demoClientFilter = isDemo
        ? "AND c.client_reference LIKE 'DEMO-%'"
        : "AND c.client_reference NOT LIKE 'DEMO-%'";
      const agreedSumRow = await env.DB.prepare(`
        SELECT COALESCE(SUM(agreed_purchase_price), 0) AS agreed_total
        FROM clients c
        WHERE c.is_deleted=0 ${demoClientFilter} ${branchFilter}
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
        res = await env.DB.prepare(`
          INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
        `).bind(client_id, property_id || null, txRef, fromKobo(kobo), SUPPORTED_CURRENCY, method, kobo, demoFlag).run();
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
      const upd = await env.DB.prepare("UPDATE payments SET status='verified', verified_at=?, verified_by=NULL WHERE id=? AND status='pending'")
        .bind(now, payment.id).run();
      if (upd.meta && Number(upd.meta.changes) === 0) {
        await recordEvent("duplicate", payment.id);
        return json({ ok: true, already_processed: true });
      }

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

      await recordEvent("verified", payment.id);
      return json({ ok: true, status: "verified", receipt_ref: receipt.receipt_ref });
    }

    // ALAT Transaction Reconciliation Interface
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
      const schedules = results.map(s => ({
        ...s,
        total_kobo: Number(s.total_kobo || toKobo(s.total_amount)),
        deposit_kobo: Number(s.deposit_kobo || toKobo(s.deposit_amount)),
        installment_kobo: Number(s.installment_kobo || toKobo(s.installment_amount)),
        total_agreed_price: fromKobo(Number(s.total_kobo || toKobo(s.total_amount))),
        deposit_amount: fromKobo(Number(s.deposit_kobo || toKobo(s.deposit_amount))),
        installment_amount: fromKobo(Number(s.installment_kobo || toKobo(s.installment_amount)))
      }));
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
      const frequencyDays = Number(body.frequency_days !== undefined ? body.frequency_days : schedule.frequency_days);
      const nextDue = body.next_due_date || schedule.next_due_date;
      const status = body.status || schedule.status;
      const validation = validateScheduleInput({ totalKobo, depositKobo, installmentKobo, frequencyDays, nextDue, status });
      if (validation.error) return json({ error: validation.error }, 400);

      const reason = body.reason ? String(body.reason).trim() : null;
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE payment_schedules
        SET property_id=?, total_amount=?, total_kobo=?, deposit_amount=?, deposit_kobo=?,
            installment_amount=?, installment_kobo=?, frequency_days=?, next_due_date=?,
            status=?, notes=?, updated_at=?
        WHERE id=?
      `).bind(
        body.property_id !== undefined ? (body.property_id || null) : schedule.property_id,
        fromKobo(totalKobo), totalKobo,
        fromKobo(depositKobo), depositKobo,
        fromKobo(installmentKobo), installmentKobo,
        frequencyDays, nextDue, status,
        body.notes !== undefined ? (body.notes || null) : schedule.notes,
        updatedAt, scheduleId
      ).run();

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
      if (!client_id || total_amount === undefined || installment_amount === undefined || (!frequency_days && !frequency) || !next_due_date) {
        return json({ error: "Missing required fields for installment schedule" }, 400);
      }

      const frequencyMap = { weekly: 7, monthly: 30, quarterly: 90 };
      const resolvedFrequency = frequency && frequencyMap[frequency] ? frequencyMap[frequency] : Number(frequency_days);
      const totalKobo = toKobo(total_amount);
      const depositKobo = toKobo(deposit_amount || 0);
      const installmentKobo = toKobo(installment_amount);
      const validation = validateScheduleInput({
        totalKobo, depositKobo, installmentKobo, frequencyDays: resolvedFrequency,
        nextDue: next_due_date, status: "active"
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
          installment_amount, installment_kobo, frequency_days, next_due_date, status, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
      `).bind(
        client_id, property_id || null,
        fromKobo(totalKobo), totalKobo,
        fromKobo(depositKobo), depositKobo,
        fromKobo(installmentKobo), installmentKobo,
        resolvedFrequency, next_due_date, notes || null, actor.id
      ).run();

      const newId = res.meta.last_row_id;
      await env.DB.prepare(`
        INSERT INTO payment_schedule_history (schedule_id, action, previous_json, new_json, reason, changed_by, created_at)
        VALUES (?, 'create', NULL, ?, ?, ?, datetime('now'))
      `).bind(newId, JSON.stringify({ totalKobo, depositKobo, installmentKobo, resolvedFrequency, next_due_date, property_id: property_id || null, notes: notes || null }), body.reason || null, actor.id).run();
      await audit(env, actor.id, "installment.create", "installment", String(newId), body, client.assigned_branch_id);

      // Notify client
      await createNotification(env, {
        clientId: client.id,
        type: "installment.created",
        title: "Installment Schedule Configured",
        message: `An installment plan has been configured for your property. Installments of ${formatNGN(installmentKobo)} are scheduled every ${resolvedFrequency} days. First due date: ${next_due_date}.`,
        metadata: { schedule_id: newId }
      });

      return json({ ok: true, id: newId });
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
      const commissionScope = commissionScopeSql(scope, "ce");
      const { results: recentCommissions } = await env.DB.prepare(`
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
               u.last_login_at, u.created_at, u.deactivated_at,
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
      const { email, password, full_name, role_name, branch_id, branch_name, phone_number, job_title, date_joined, notes, team_id } = body || {};
      if (!email || !password || !full_name || !role_name) return json({ error: "Email, password, full name and role are required" }, 400);
      if (!validPassword(password)) return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
      const allowed = actor.role_name === "Managing Director"
        ? ["Branch Manager", "Team Lead", "Marketer", "Finance Officer"]
        : ["Team Lead", "Marketer", "Finance Officer"];
      if (!allowed.includes(role_name)) return json({ error: "Forbidden role" }, 403);
      let resolvedBranch = branch_id || null;
      if (!resolvedBranch && branch_name) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        resolvedBranch = branch ? branch.id : null;
      }
      if (!resolvedBranch) return json({ error: "Branch is required" }, 400);
      if (actor.role_name === "Branch Manager" && Number(resolvedBranch) !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(resolvedBranch).first();
      if (!branch) return json({ error: "Branch not found" }, 400);
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(role_name).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(email)=?").bind(email.toLowerCase().trim()).first();
      if (existing) return json({ error: "Email already used" }, 409);
      const hash = await hashPassword(password);
      const res = await env.DB.prepare(`
        INSERT INTO users (email, password_hash, full_name, role_id, branch_id)
        VALUES (?, ?, ?, ?, ?)
      `).bind(email.toLowerCase().trim(), hash, full_name.trim(), role.id, resolvedBranch).run();
      const newId = res.meta.last_row_id;
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
      const allowedRoles = actor.role_name === "Managing Director"
        ? ["Branch Manager", "Team Lead", "Marketer", "Finance Officer"]
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
      if (actor.role_name === "Branch Manager" && nextBranch !== actor.branch_id) {
        return json({ error: "Cross-branch forbidden" }, 403);
      }
      if (nextBranch !== null) {
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE id=?").bind(nextBranch).first();
        if (!branch) return json({ error: "Branch not found" }, 400);
      } else if (nextRoleName !== "Managing Director") {
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
        UPDATE users SET full_name=?, email=?, role_id=?, branch_id=?, updated_at=datetime('now') WHERE id=?
      `).bind(fullName, email, role.id, nextBranch, target.id).run();
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
      const q = url.searchParams.get("q");
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (status) { clauses.push("l.status=?"); binds.push(status); }
      if (marketerId) { clauses.push("l.assigned_marketer_id=?"); binds.push(marketerId); }
      if (teamLeadId) { clauses.push("l.team_lead_id=?"); binds.push(teamLeadId); }
      if (q) { clauses.push("(l.full_name LIKE ? OR l.phone_number LIKE ? OR l.email_address LIKE ? OR l.lead_reference LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
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
               (SELECT COUNT(*) FROM lead_follow_ups f WHERE f.lead_id=l.id) AS follow_up_count
        FROM leads l
        LEFT JOIN properties p ON p.id=l.property_id
        LEFT JOIN branches b ON b.id=l.branch_id
        LEFT JOIN users m ON m.id=l.assigned_marketer_id
        LEFT JOIN users tl ON tl.id=l.team_lead_id
        ${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
      `).bind(...binds, limit, offset).all();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM leads l ${whereSql}`).bind(...binds).first();
      return json({ leads, pagination: { page, limit, total: count ? count.c : 0 } });
    }

    if (path === "/api/leads" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!canManageLeads(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const body = await request.json();
      const { full_name, phone_number, email_address, source, status, property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value, notes, next_follow_up_date } = body || {};
      if (!full_name || !phone_number) return json({ error: "Full name and phone number are required" }, 400);
      const leadStatus = status || "New Lead";
      if (!LEAD_STATUSES.includes(leadStatus) || leadStatus === "Converted") {
        return json({ error: "Invalid initial lead status" }, 400);
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
        INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source, status,
          property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value_kobo,
          notes, next_follow_up_date, created_by, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      `).bind(
        ref, full_name.trim(), phone_number.trim(), email_address || null, source || null, leadStatus,
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
        LEFT JOIN users u ON u.id=f.staff_id WHERE f.lead_id=? ORDER BY f.created_at DESC
      `).bind(lead.id).all();
      const { results: activity } = await env.DB.prepare(`
        SELECT al.id, al.action, al.created_at, u.full_name AS actor_name
        FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
        WHERE al.target_type='lead' AND al.target_id=? ORDER BY al.id DESC LIMIT 20
      `).bind(String(lead.id)).all();
      return json({ lead, follow_ups: followUps, activity });
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
      const nextStatus = body.status !== undefined ? body.status : lead.status;
      if (body.status !== undefined) {
        if (!LEAD_STATUSES.includes(nextStatus) || nextStatus === "Converted") {
          return json({ error: "Use the conversion endpoint to convert a lead" }, 400);
        }
        if (lead.converted_client_id || lead.status === "Converted") {
          return json({ error: "A converted lead cannot be moved back into the open pipeline" }, 409);
        }
      }
      await env.DB.prepare(`
        UPDATE leads SET full_name=?, phone_number=?, email_address=?, source=?, status=?,
          property_id=?, assigned_marketer_id=?, team_lead_id=?, branch_id=?,
          estimated_value_kobo=?, notes=?, next_follow_up_date=?, updated_at=datetime('now')
        WHERE id=?
      `).bind(
        body.full_name !== undefined ? String(body.full_name).trim() : lead.full_name,
        body.phone_number !== undefined ? String(body.phone_number).trim() : lead.phone_number,
        body.email_address !== undefined ? (body.email_address || null) : lead.email_address,
        body.source !== undefined ? (body.source || null) : lead.source,
        nextStatus,
        body.property_id !== undefined ? (body.property_id || null) : lead.property_id,
        nextMarketer,
        nextTeamLead,
        nextBranch,
        estimatedKobo,
        body.notes !== undefined ? (body.notes || null) : lead.notes,
        followUp,
        lead.id
      ).run();
      await audit(env, actor.id, "lead.update", "lead", String(lead.id), {
        before: { status: lead.status, marketer: lead.assigned_marketer_id, branch_id: lead.branch_id },
        after: { status: nextStatus, marketer: nextMarketer, branch_id: nextBranch }
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
      const status = body.status;
      if (!LEAD_STATUSES.includes(status)) return json({ error: "Invalid lead status" }, 400);
      if (status === "Converted") return json({ error: "Use the conversion endpoint to convert a lead" }, 400);
      if (lead.converted_client_id || lead.status === "Converted") {
        return json({ error: "A converted lead cannot be moved back into the open pipeline" }, 409);
      }
      await env.DB.prepare(`
        UPDATE leads SET status=?, last_contact_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(status, lead.id).run();
      await audit(env, actor.id, "lead.status", "lead", String(lead.id), { from: lead.status, to: status }, lead.branch_id);
      await createNotification(env, {
        userId: lead.assigned_marketer_id || actor.id,
        type: "lead.status",
        title: "Lead Status Updated",
        message: `Lead ${lead.lead_reference} moved from ${lead.status} to ${status}.`,
        metadata: { lead_id: lead.id, status }
      });
      return json({ ok: true, status });
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
      const res = await env.DB.prepare(`
        INSERT INTO lead_follow_ups (lead_id, staff_id, note, channel, outcome, follow_up_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(lead.id, actor.id, note, body.channel || null, body.outcome || null, followUpDate).run();
      await env.DB.prepare(`
        UPDATE leads SET last_contact_at=datetime('now'), next_follow_up_date=COALESCE(?, next_follow_up_date),
          updated_at=datetime('now') WHERE id=?
      `).bind(followUpDate, lead.id).run();
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
        UPDATE lead_follow_ups SET note=?, channel=?, outcome=?, follow_up_date=? WHERE id=?
      `).bind(note, body.channel !== undefined ? (body.channel || null) : followUp.channel,
        body.outcome !== undefined ? (body.outcome || null) : followUp.outcome,
        followUpDate, followUp.id).run();
      if (body.follow_up_date !== undefined) {
        await env.DB.prepare("UPDATE leads SET next_follow_up_date=?, updated_at=datetime('now') WHERE id=?")
          .bind(followUpDate, lead.id).run();
      }
      await audit(env, actor.id, "lead.followup.update", "lead", String(lead.id), { follow_up_id: followUp.id }, lead.branch_id);
      return json({ ok: true });
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
      if (body.agreed_purchase_price !== undefined && body.agreed_purchase_price !== null && body.agreed_purchase_price !== "") {
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
        ref, lead.full_name, lead.phone_number, lead.email_address, lead.notes, clientStatus,
        lead.branch_id, actor.id, marketerId, lead.team_lead_id || null,
        agreedPrice, lead.property_id || null
      ).run();
      const clientId = res.meta.last_row_id;
      if (lead.property_id) {
        await upsertClientPropertyAllocation(env, clientId, Number(lead.property_id), agreedPrice || 0, clientStatus);
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
      return json({ ok: true, client_id: clientId, client_reference: ref });
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
      return {
        plan: {
          name,
          description: body.description ? String(body.description).trim() : null,
          calculation_basis: basis,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          approval_required: body.approval_required === undefined ? 1 : (isTruthy(body.approval_required) ? 1 : 0),
          separation_of_duties: body.separation_of_duties === undefined ? 1 : (isTruthy(body.separation_of_duties) ? 1 : 0),
          is_active: body.is_active === undefined ? 1 : (isTruthy(body.is_active) ? 1 : 0)
        },
        rules: ruleResult.rules
      };
    }

    if (path === "/api/commission-options" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
        statuses: COMMISSION_STATUSES
      });
    }

    if (path === "/api/commission-plans" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const validated = await validateCommissionPlanBody(env, body);
      if (validated.error) return json({ error: validated.error }, 400);
      const plan = validated.plan;
      const res = await env.DB.prepare(`
        INSERT INTO commission_plans (name, description, calculation_basis, effective_from, effective_to,
          approval_required, separation_of_duties, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(plan.name, plan.description, plan.calculation_basis, plan.effective_from, plan.effective_to,
        plan.approval_required, plan.separation_of_duties, plan.is_active, actor.id).run();
      const planId = res.meta.last_row_id;
      for (const rule of validated.rules) {
        await env.DB.prepare(`
          INSERT INTO commission_plan_rules (plan_id, role_name, rate_bps, fixed_amount_kobo,
            property_category_id, sales_type, branch_id, team_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(planId, rule.role_name, rule.rate_bps, rule.fixed_amount_kobo,
          rule.property_category_id, rule.sales_type, rule.branch_id, rule.team_id, rule.is_active).run();
      }
      await audit(env, actor.id, "commission_plan.create", "commission_plan", String(planId), { name: plan.name, basis: plan.calculation_basis }, null);
      return json({ ok: true, id: planId });
    }

    const commissionPlanMatch = path.match(/^\/api\/commission-plans\/(\d+)$/);
    if (commissionPlanMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
      return json({ plan: { ...plan, rules: rules.results } });
    }

    if (commissionPlanMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const existing = await env.DB.prepare("SELECT * FROM commission_plans WHERE id=?").bind(commissionPlanMatch[1]).first();
      if (!existing) return json({ error: "Commission plan not found" }, 404);
      const body = await request.json();
      const validated = await validateCommissionPlanBody(env, body);
      if (validated.error) return json({ error: validated.error }, 400);
      const plan = validated.plan;
      await env.DB.prepare(`
        UPDATE commission_plans SET name=?, description=?, calculation_basis=?, effective_from=?, effective_to=?,
          approval_required=?, separation_of_duties=?, is_active=?, updated_by=?, updated_at=datetime('now')
        WHERE id=?
      `).bind(plan.name, plan.description, plan.calculation_basis, plan.effective_from, plan.effective_to,
        plan.approval_required, plan.separation_of_duties, plan.is_active, actor.id, existing.id).run();
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
      await audit(env, actor.id, "commission_plan.update", "commission_plan", String(existing.id), { name: plan.name, basis: plan.calculation_basis }, null);
      return json({ ok: true });
    }

    const commissionPlanStatusMatch = path.match(/^\/api\/commission-plans\/(\d+)\/status$/);
    if (commissionPlanStatusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      if (body.is_active === undefined) return json({ error: "Active state is required" }, 400);
      const active = isTruthy(body.is_active) ? 1 : 0;
      await env.DB.prepare("UPDATE commission_plans SET is_active=?, updated_by=?, updated_at=datetime('now') WHERE id=?")
        .bind(active, actor.id, commissionPlanStatusMatch[1]).run();
      await audit(env, actor.id, active ? "commission_plan.activate" : "commission_plan.deactivate", "commission_plan", commissionPlanStatusMatch[1], null, null);
      return json({ ok: true, is_active: active });
    }

    if (path === "/api/commissions" && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const scope = await resolvePhase6Scope(env, actor);
      const scoped = commissionScopeSql(scope, "ce");
      const clauses = [scoped.clause];
      const binds = [...scoped.binds];
      const status = url.searchParams.get("status");
      const planId = url.searchParams.get("plan_id");
      const clientId = url.searchParams.get("client_id");
      const from = dateOnly(url.searchParams.get("from"));
      const to = dateOnly(url.searchParams.get("to"));
      if (status) { clauses.push("ce.status=?"); binds.push(status); }
      if (planId) { clauses.push("ce.plan_id=?"); binds.push(planId); }
      if (clientId) { clauses.push("ce.client_id=?"); binds.push(clientId); }
      if (["Managing Director", "Finance Officer"].includes(actor.role_name)) {
        const branchId = url.searchParams.get("branch_id");
        const teamId = url.searchParams.get("team_id");
        const marketerId = url.searchParams.get("marketer_id");
        if (branchId) { clauses.push("ce.branch_id=?"); binds.push(branchId); }
        if (teamId) { clauses.push("ce.team_id=?"); binds.push(teamId); }
        if (marketerId) { clauses.push("ce.marketer_id=?"); binds.push(marketerId); }
      }
      if (from) { clauses.push("date(ce.created_at) >= date(?)"); binds.push(from); }
      if (to) { clauses.push("date(ce.created_at) <= date(?)"); binds.push(to); }
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
      const offset = (page - 1) * limit;
      const whereSql = "WHERE " + clauses.join(" AND ");
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
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
      const scope = await resolvePhase6Scope(env, actor);
      const scoped = commissionScopeSql(scope, "ce");
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
          "Content-Disposition": `attachment; filename="${payment.receipt_ref || payment.commission_ref}.pdf"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const commissionMatch = path.match(/^\/api\/commissions\/(\d+)$/);
    if (commissionMatch && request.method === "GET") {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
      if (!["Managing Director", "Finance Officer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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
      if (!["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
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

    // Static Assets Fallback
    return env.ASSETS.fetch(request);
  },

  // Cloudflare Queues consumer: records configurable email/WhatsApp delivery attempts.
  async queue(batch, env) {
    for (const message of batch.messages || []) {
      try {
        await processNotificationQueue(env, message);
        if (message.ack) message.ack();
      } catch {
        if (message.retry) message.retry();
      }
    }
  },

  // Cron trigger: upcoming / overdue installment notifications (deduplicated).
  async scheduled(event, env, ctx) {
    const task = dispatchPaymentReminders(env);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
    await task;
  }
};
