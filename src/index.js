const SESSION_COOKIE = "bliss_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
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
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
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
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, keyMaterial, 256);
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return hash === expected;
}
function newSessionId() { return crypto.randomUUID(); }
async function createSession(env, userId) {
  const id = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(id, userId, expires).run();
  return { id, expires };
}
async function getSessionUser(env, request) {
  const cookies = parseCookies(request);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = await env.DB.prepare("SELECT s.id AS sid, s.expires_at, u.id, u.email, u.full_name, u.role_id, u.branch_id, u.is_active, r.name AS role_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.id=?").bind(sid).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) { await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run(); return null; }
  if (!row.is_active) return null;
  return row;
}
async function audit(env, actorId, action, targetType, targetId, metadata) {
  await env.DB.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?)").bind(actorId, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null).run();
}
function csrfOk(request) {
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (!origin) return true;
  try { const o = new URL(origin); return o.host === host; } catch { return false; }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/health") return json({ ok: true });
    if (path === "/api/setup" && request.method === "POST") {
      const setupSecret = request.headers.get("X-Setup-Secret");
      if (!env.SETUP_SECRET || setupSecret !== env.SETUP_SECRET) return json({ error: "Forbidden" }, 403);
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
    if (path === "/api/login" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const body = await request.json();
      const { email, password } = body || {};
      if (!email || !password) return json({ error: "Missing credentials" }, 400);
      const user = await env.DB.prepare("SELECT u.id, u.email, u.password_hash, u.is_active, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=?").bind(email.toLowerCase()).first();
      if (!user || !user.is_active) { await audit(env, null, "login.failure", "user", email, { reason: "not_found_or_inactive" }); return json({ error: "Invalid credentials" }, 401); }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) { await audit(env, user.id, "login.failure", "user", String(user.id), { reason: "bad_password" }); return json({ error: "Invalid credentials" }, 401); }
      const sess = await createSession(env, user.id);
      await audit(env, user.id, "login.success", "user", String(user.id), null);
      const cookie = `${SESSION_COOKIE}=${sess.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(sess.expires).toUTCString()}`;
      return json({ ok: true, user: { id: user.id, email: user.email, role: user.role_name } }, 200, { "Set-Cookie": cookie });
    }

    if (path === "/api/logout" && request.method === "POST") {
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
      return json({ id: user.id, email: user.email, full_name: user.full_name, role: user.role_name, role_id: user.role_id, branch_id: user.branch_id });
    }
    if (path === "/api/users" && request.method === "GET") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(user.role_name)) return json({ error: "Forbidden" }, 403);
      let stmt;
      if (user.role_name === "Managing Director") {
        stmt = env.DB.prepare("SELECT u.id,u.email,u.full_name,u.branch_id,u.is_active,r.name AS role_name,b.name AS branch_name FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.id");
      } else {
        stmt = env.DB.prepare("SELECT u.id,u.email,u.full_name,u.branch_id,u.is_active,r.name AS role_name,b.name AS branch_name FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id WHERE u.branch_id=? ORDER BY u.id").bind(user.branch_id);
      }
      const { results } = await stmt.all();
      return json({ users: results });
    }

    if (path === "/api/users" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { email, password, full_name, role_name, branch_name, team_id } = body || {};
      if (!email || !password || !full_name || !role_name) return json({ error: "Missing fields" }, 400);
      const allowedForBM = ["Team Lead", "Marketer", "Finance Officer"];
      if (actor.role_name === "Branch Manager" && !allowedForBM.includes(role_name)) return json({ error: "Forbidden role" }, 403);
      if (role_name === "Managing Director") return json({ error: "Cannot create MD" }, 403);
      const role = await env.DB.prepare("SELECT id FROM roles WHERE name=?").bind(role_name).first();
      if (!role) return json({ error: "Unknown role" }, 400);
      let branchId = null;
      if (role_name !== "Managing Director") {
        if (!branch_name) return json({ error: "Branch required" }, 400);
        const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
        if (!branch) return json({ error: "Unknown branch" }, 400);
        branchId = branch.id;
        if (actor.role_name === "Branch Manager" && branchId !== actor.branch_id) return json({ error: "Cross-branch forbidden" }, 403);
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email.toLowerCase()).first();
      if (existing) return json({ error: "Email already used" }, 409);
      const hash = await hashPassword(password);
      const res = await env.DB.prepare("INSERT INTO users (email, password_hash, full_name, role_id, branch_id) VALUES (?, ?, ?, ?, ?)").bind(email.toLowerCase(), hash, full_name, role.id, branchId).run();
      const newId = res.meta.last_row_id;
      if (role_name === "Marketer" && team_id) {
        const team = await env.DB.prepare("SELECT id, branch_id FROM teams WHERE id=?").bind(team_id).first();
        if (team && team.branch_id === branchId) {
          await env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").bind(team_id, newId).run();
        }
      }
      await audit(env, actor.id, "user.create", "user", String(newId), { email, role_name, branch_name });
      return json({ ok: true, user_id: newId });
    }
    if (path === "/api/branches" && request.method === "GET") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Unauthenticated" }, 401);
      const { results } = await env.DB.prepare("SELECT id, name FROM branches ORDER BY name").all();
      return json({ branches: results });
    }
    if (path === "/api/teams" && request.method === "GET") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Unauthenticated" }, 401);
      const branch = url.searchParams.get("branch_id");
      let stmt;
      if (branch) stmt = env.DB.prepare("SELECT id, name, branch_id FROM teams WHERE branch_id=?").bind(branch);
      else if (user.role_name === "Managing Director") stmt = env.DB.prepare("SELECT id, name, branch_id FROM teams");
      else stmt = env.DB.prepare("SELECT id, name, branch_id FROM teams WHERE branch_id=?").bind(user.branch_id);
      const { results } = await stmt.all();
      return json({ teams: results });
    }
    if (path === "/api/teams" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { name, branch_name, team_lead_user_id } = body || {};
      if (!name || !branch_name) return json({ error: "Missing fields" }, 400);
      const branch = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first();
      if (!branch) return json({ error: "Unknown branch" }, 400);
      if (actor.role_name === "Branch Manager" && branch.id !== actor.branch_id) return json({ error: "Cross-branch forbidden" }, 403);
      const res = await env.DB.prepare("INSERT INTO teams (name, branch_id, team_lead_user_id) VALUES (?, ?, ?)").bind(name, branch.id, team_lead_user_id || null).run();
      await audit(env, actor.id, "team.create", "team", String(res.meta.last_row_id), { name, branch_name });
      return json({ ok: true, team_id: res.meta.last_row_id });
    }
    // ---- Property categories ----
    if (path === "/api/property-categories" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name FROM property_categories ORDER BY name").all();
      return json({ categories: results });
    }
    if (path === "/api/property-categories" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor || actor.role_name !== "Managing Director") return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { name } = body || {};
      if (!name) return json({ error: "Missing name" }, 400);
      try {
        const res = await env.DB.prepare("INSERT INTO property_categories (name) VALUES (?)").bind(name).run();
        await audit(env, actor.id, "category.create", "property_category", String(res.meta.last_row_id), { name });
        return json({ ok: true, id: res.meta.last_row_id });
      } catch (e) { return json({ error: "Category exists" }, 409); }
    }
    // ---- List properties ----
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
      let where = []; const binds = [];
      if (!actor || ["Client","Marketer"].includes(actor && actor.role_name)) where.push("p.is_published=1");
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
    // ---- Property details ----
    const propMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propMatch && request.method === "GET") {
      const id = propMatch[1];
      const actor = await getSessionUser(env, request);
      const prop = await env.DB.prepare("SELECT p.*, pc.name AS category_name, b.name AS branch_name FROM properties p LEFT JOIN property_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=p.branch_id WHERE p.id=?").bind(id).first();
      if (!prop) return json({ error: "Not found" }, 404);
      if ((!actor || ["Client","Marketer"].includes(actor.role_name)) && !prop.is_published) return json({ error: "Not found" }, 404);
      const { results: images } = await env.DB.prepare("SELECT id, r2_key, is_main, sort_order FROM property_images WHERE property_id=? ORDER BY is_main DESC, sort_order").bind(id).all();
      const { results: docs } = await env.DB.prepare("SELECT id, r2_key, filename FROM property_documents WHERE property_id=?").bind(id).all();
      return json({ property: prop, images, documents: docs });
    }

    // ---- Create property ----
    if (path === "/api/properties" && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const { title, description, category_name, property_type, sale_price, promotional_price, state, city, address, branch_name, land_size, bedrooms, bathrooms, toilets, parking_spaces, features, is_featured, is_published } = body || {};
      if (!title || !sale_price) return json({ error: "Missing required fields" }, 400);
      let categoryId = null;
      if (category_name) { const c = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(category_name).first(); categoryId = c ? c.id : null; }
      let branchId = null;
      if (branch_name) { const b = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(branch_name).first(); branchId = b ? b.id : null; }
      if (actor.role_name === "Branch Manager" && branchId !== actor.branch_id) return json({ error: "Cross-branch forbidden" }, 403);
      const ref = "BLP-" + Date.now().toString(36).toUpperCase();
      const res = await env.DB.prepare(`INSERT INTO properties (reference,title,description,category_id,property_type,sale_price,promotional_price,state,city,address,branch_id,land_size,bedrooms,bathrooms,toilets,parking_spaces,features,is_featured,is_published,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ref, title, description || null, categoryId, property_type || null, sale_price, promotional_price || null, state || null, city || null, address || null, branchId, land_size || null, bedrooms || null, bathrooms || null, toilets || null, parking_spaces || null, features ? JSON.stringify(features) : null, is_featured ? 1 : 0, is_published ? 1 : 0, actor.id, actor.id).run();
      const newId = res.meta.last_row_id;
      await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)").bind(newId, null, "Available", actor.id).run();
      await audit(env, actor.id, "property.create", "property", String(newId), { title, sale_price });
      return json({ ok: true, id: newId, reference: ref });
    }

    // ---- Update property ----
    const propUpdateMatch = path.match(/^\/api\/properties\/(\d+)$/);
    if (propUpdateMatch && request.method === "PUT") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = propUpdateMatch[1];
      const existing = await env.DB.prepare("SELECT * FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) return json({ error: "Forbidden" }, 403);
      const body = await request.json();
      const fields = ["title","description","property_type","sale_price","promotional_price","state","city","address","land_size","bedrooms","bathrooms","toilets","parking_spaces","is_featured","is_published"];
      const sets = []; const vals = [];
      for (const f of fields) { if (body[f] !== undefined) { sets.push(`${f}=?`); vals.push(body[f]); } }
      if (body.category_name !== undefined) { const c = await env.DB.prepare("SELECT id FROM property_categories WHERE name=?").bind(body.category_name).first(); sets.push("category_id=?"); vals.push(c ? c.id : null); }
      if (body.features !== undefined) { sets.push("features=?"); vals.push(JSON.stringify(body.features)); }
      if (body.branch_name !== undefined) {
        const b = await env.DB.prepare("SELECT id FROM branches WHERE name=?").bind(body.branch_name).first();
        if (actor.role_name === "Branch Manager" && b && b.id !== actor.branch_id) return json({ error: "Cross-branch forbidden" }, 403);
        sets.push("branch_id=?"); vals.push(b ? b.id : null);
      }
      if (sets.length === 0) return json({ error: "No fields" }, 400);
      sets.push("updated_by=?"); vals.push(actor.id);
      sets.push("updated_at=datetime('now')");
      vals.push(id);
      await env.DB.prepare(`UPDATE properties SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      await audit(env, actor.id, "property.update", "property", id, body);
      return json({ ok: true });
    }
    // ---- Status change ----
    const statusMatch = path.match(/^\/api\/properties\/(\d+)\/status$/);
    if (statusMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = statusMatch[1];
      const body = await request.json();
      const newStatus = body.status;
      if (!["Available","Reserved","Sold","Unavailable"].includes(newStatus)) return json({ error: "Invalid status" }, 400);
      const existing = await env.DB.prepare("SELECT status, branch_id FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) return json({ error: "Forbidden" }, 403);
      await env.DB.prepare("UPDATE properties SET status=?, updated_by=?, updated_at=datetime('now') WHERE id=?").bind(newStatus, actor.id, id).run();
      await env.DB.prepare("INSERT INTO property_status_history (property_id, old_status, new_status, changed_by) VALUES (?,?,?,?)").bind(id, existing.status, newStatus, actor.id).run();
      await audit(env, actor.id, "property.status", "property", id, { from: existing.status, to: newStatus });
      return json({ ok: true });
    }
    // ---- Status history ----
    const histParts = path.split('/');
    if (histParts.length === 5 && histParts[1] === 'api' && histParts[2] === 'properties' && histParts[4] === 'status-history' && request.method === 'GET') {
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: 'Unauthorized' }, 401);
      const id = histParts[3];
      const { results } = await env.DB.prepare("SELECT h.old_status, h.new_status, h.changed_at, u.full_name AS changed_by FROM property_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.property_id=? ORDER BY h.changed_at DESC").bind(id).all();
      return json({ history: results });
    }


    // ---- Image upload to R2 ----
    const imgMatch = path.match(/^\/api\/properties\/(\d+)\/images$/);
    if (imgMatch && request.method === "POST") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const id = imgMatch[1];
      const existing = await env.DB.prepare("SELECT branch_id FROM properties WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Not found" }, 404);
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) return json({ error: "Forbidden" }, 403);
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);
      const allowed = ["image/jpeg","image/png","image/webp","image/gif"];
      if (!allowed.includes(file.type)) return json({ error: "Invalid file type" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "File too large (5MB max)" }, 400);
      const key = `properties/${id}/${crypto.randomUUID()}-${String(file.name).replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
      const isMain = formData.get("is_main") === "1" ? 1 : 0;
      if (isMain) await env.DB.prepare("UPDATE property_images SET is_main=0 WHERE property_id=?").bind(id).run();
      const res = await env.DB.prepare("INSERT INTO property_images (property_id, r2_key, is_main) VALUES (?,?,?)").bind(id, key, isMain).run();
      await audit(env, actor.id, "property.image.upload", "property", id, { key });
      return json({ ok: true, image_id: res.meta.last_row_id, key });
    }
    // ---- Serve R2 object ----
    const fileMatch = path.match(/^\/api\/files\/(.+)$/);
    if (fileMatch && request.method === "GET") {
      const key = decodeURIComponent(fileMatch[1]);
      const obj = await env.FILES.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      return new Response(obj.body, { headers });
    }
    // ---- Delete image ----
    const delImgMatch = path.match(/^\/api\/properties\/(\d+)\/images\/(\d+)$/);
    if (delImgMatch && request.method === "DELETE") {
      if (!csrfOk(request)) return json({ error: "CSRF check failed" }, 403);
      const actor = await getSessionUser(env, request);
      if (!actor) return json({ error: "Unauthenticated" }, 401);
      if (!["Managing Director", "Branch Manager"].includes(actor.role_name)) return json({ error: "Forbidden" }, 403);
      const propId = delImgMatch[1]; const imgId = delImgMatch[2];
      const img = await env.DB.prepare("SELECT r2_key, property_id FROM property_images WHERE id=?").bind(imgId).first();
      if (!img || String(img.property_id) !== propId) return json({ error: "Not found" }, 404);
      const existing = await env.DB.prepare("SELECT branch_id FROM properties WHERE id=?").bind(propId).first();
      if (actor.role_name === "Branch Manager" && existing.branch_id !== actor.branch_id) return json({ error: "Forbidden" }, 403);
      await env.FILES.delete(img.r2_key);
      await env.DB.prepare("DELETE FROM property_images WHERE id=?").bind(imgId).run();
      await audit(env, actor.id, "property.image.delete", "property", propId, { key: img.r2_key });
      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
};

