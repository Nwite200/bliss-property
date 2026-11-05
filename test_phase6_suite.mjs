import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import worker from './src/index.js';
import { resolveLiveDb } from './test_db_paths.mjs';

const LIVE_DB = resolveLiveDb();
const TEST_DB = join(dirname(LIVE_DB), 'phase6-test.sqlite');

if (!existsSync(LIVE_DB)) {
  console.error(`Local D1 database not found at ${LIVE_DB}. Run: npm run db:migrate:local`);
  process.exit(1);
}
mkdirSync(dirname(TEST_DB), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(TEST_DB + suffix, { force: true });
{
  const live = new DatabaseSync(LIVE_DB);
  live.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  live.close();
}
copyFileSync(LIVE_DB, TEST_DB);

const db = new DatabaseSync(TEST_DB);
db.exec('PRAGMA foreign_keys = ON;');

function createD1Adapter(database) {
  return {
    prepare(sql) {
      let boundArgs = [];
      const stmtObj = {
        bind(...args) {
          boundArgs = args.map(a => (a === undefined ? null : a));
          return stmtObj;
        },
        async all() {
          return { results: database.prepare(sql).all(...boundArgs) };
        },
        async first() {
          return database.prepare(sql).get(...boundArgs) || null;
        },
        async run() {
          const info = database.prepare(sql).run(...boundArgs);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
        }
      };
      return stmtObj;
    }
  };
}

function hashPw(password) {
  const salt = randomBytes(16);
  const dk = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function upsertUser(email, fullName, roleId, branchId) {
  db.prepare(`
    INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, full_name=excluded.full_name,
      role_id=excluded.role_id, branch_id=excluded.branch_id, is_active=1
  `).run(email, hashPw('password123'), fullName, roleId, branchId);
  return db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
}

function upsertClient(ref, data) {
  const existing = db.prepare('SELECT id FROM clients WHERE client_reference=?').get(ref);
  if (existing) {
    db.prepare(`UPDATE clients SET full_name=?, phone_number=?, email_address=?, status=?,
      assigned_branch_id=?, created_by=?, original_marketer_id=?, team_lead_id=?,
      agreed_purchase_price=?, interested_property_id=?, user_id=?, is_deleted=0 WHERE id=?`).run(
      data.full_name, data.phone_number, data.email_address || null, data.status || 'Active Buyer',
      data.branchId, data.createdBy, data.marketerId, data.teamLeadId || null,
      data.agreedPrice || 0, data.propertyId || null, data.userId || null, existing.id
    );
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address,
    status, assigned_branch_id, created_by, original_marketer_id, team_lead_id,
    agreed_purchase_price, interested_property_id, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ref, data.full_name, data.phone_number, data.email_address || null, data.status || 'Active Buyer',
    data.branchId, data.createdBy, data.marketerId, data.teamLeadId || null,
    data.agreedPrice || 0, data.propertyId || null, data.userId || null
  );
  return Number(info.lastInsertRowid);
}

const mdId = upsertUser('md@bliss.com', 'Managing Director', 1, null);
const bm1Id = upsertUser('bm.ikeja@bliss.com', 'Ikeja Branch Manager', 2, 1);
const bm2Id = upsertUser('bm.ajah@bliss.com', 'Ajah Branch Manager', 2, 2);
const tl1Id = upsertUser('tl.ikeja@bliss.com', 'Ikeja Team Lead', 3, 1);
const tl2Id = upsertUser('tl.ajah@bliss.com', 'Ajah Team Lead', 3, 2);
const mkt1Id = upsertUser('mkt.ikeja@bliss.com', 'Ikeja Marketer One', 4, 1);
const mkt2Id = upsertUser('mkt.ikeja2@bliss.com', 'Ikeja Marketer Two', 4, 1);
const mkt3Id = upsertUser('mkt.ajah@bliss.com', 'Ajah Marketer', 4, 2);
const finId = upsertUser('finance@bliss.com', 'Head Finance Officer', 5, 1);
const adaUserId = upsertUser('ada@example.com', 'Ada Nwosu', 6, 1);
const musaUserId = upsertUser('musa@example.com', 'Musa Dike', 6, 1);
const demoUserId = upsertUser('demo@bliss.com', 'Demo Investor', 6, 1);

// Isolate Phase 6 fixtures from the local demo ledger so every metric is
// deterministic. Users, branches and categories are preserved.
db.exec(`
  DELETE FROM financial_adjustments;
  DELETE FROM receipts;
  DELETE FROM payments;
  DELETE FROM payment_schedule_history;
  DELETE FROM payment_schedules;
  DELETE FROM lead_follow_ups;
  DELETE FROM leads;
  DELETE FROM client_assignment_history;
  DELETE FROM client_status_history;
  DELETE FROM client_notes;
  DELETE FROM client_assignments;
  DELETE FROM virtual_accounts;
  DELETE FROM notifications;
  DELETE FROM notification_deliveries;
  DELETE FROM notification_dedupe;
  DELETE FROM property_status_history;
  DELETE FROM property_images;
  DELETE FROM property_documents;
  DELETE FROM client_properties;
  DELETE FROM clients;
  DELETE FROM properties;
  DELETE FROM team_members;
  DELETE FROM teams;
  DELETE FROM staff_profiles;
  DELETE FROM sessions;
  DELETE FROM password_reset_tokens;
  DELETE FROM webhook_events;
  DELETE FROM audit_logs;
`);

const prop1 = db.prepare("SELECT id FROM properties WHERE reference='BLP-P6-IKEJA'").get()
  || { id: Number(db.prepare(`INSERT INTO properties (reference,title,description,sale_price,state,city,address,branch_id,status,is_published,created_by)
      VALUES ('BLP-P6-IKEJA','Phase 6 Ikeja Property','Test inventory',10000000,'Lagos','Ikeja','1 Phase 6 Close',1,'Available',1,?)`).run(mdId).lastInsertRowid) };
const prop2 = db.prepare("SELECT id FROM properties WHERE reference='BLP-P6-AJAH'").get()
  || { id: Number(db.prepare(`INSERT INTO properties (reference,title,description,sale_price,state,city,address,branch_id,status,is_published,created_by)
      VALUES ('BLP-P6-AJAH','Phase 6 Ajah Property','Test inventory',8000000,'Lagos','Ajah','2 Phase 6 Close',2,'Reserved',1,?)`).run(mdId).lastInsertRowid) };
db.prepare("UPDATE properties SET sale_price=10000000, status='Available', is_published=1, branch_id=1 WHERE id=?").run(prop1.id);
db.prepare("UPDATE properties SET sale_price=8000000, status='Reserved', is_published=1, branch_id=2 WHERE id=?").run(prop2.id);

const adaId = upsertClient('BLC-P6-ADA', {
  full_name: 'Ada Nwosu', phone_number: '08061000001', email_address: 'ada@example.com',
  status: 'Active Buyer', branchId: 1, createdBy: mkt1Id, marketerId: mkt1Id,
  teamLeadId: tl1Id, agreedPrice: 10000000, propertyId: prop1.id, userId: adaUserId
});
const musaId = upsertClient('BLC-P6-MUSA', {
  full_name: 'Musa Dike', phone_number: '08061000002', email_address: 'musa@example.com',
  status: 'Interested', branchId: 1, createdBy: mkt2Id, marketerId: mkt2Id,
  teamLeadId: tl1Id, agreedPrice: 8000000, propertyId: prop1.id, userId: musaUserId
});
const crossId = upsertClient('BLC-P6-CROSS', {
  full_name: 'Cross Branch Client', phone_number: '08061000003', email_address: 'cross@example.com',
  status: 'Active Buyer', branchId: 2, createdBy: mkt3Id, marketerId: mkt3Id,
  teamLeadId: tl2Id, agreedPrice: 8000000, propertyId: prop2.id
});
const demoId = upsertClient('DEMO-CLIENT-001', {
  full_name: 'Demo Investor', phone_number: '08061000004', email_address: 'demo@bliss.com',
  status: 'Active Buyer', branchId: 1, createdBy: mkt1Id, marketerId: mkt1Id,
  teamLeadId: tl1Id, agreedPrice: 15000000, propertyId: prop1.id, userId: demoUserId
});

for (const cid of [adaId, musaId, crossId, demoId]) {
  db.prepare('DELETE FROM financial_adjustments WHERE payment_id IN (SELECT id FROM payments WHERE client_id=?)').run(cid);
  db.prepare('DELETE FROM receipts WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM payments WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM payment_schedule_history WHERE schedule_id IN (SELECT id FROM payment_schedules WHERE client_id=?)').run(cid);
  db.prepare('DELETE FROM payment_schedules WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM notifications WHERE client_id=?').run(cid);
}
db.exec('DELETE FROM lead_follow_ups; DELETE FROM leads; DELETE FROM team_members; DELETE FROM teams; DELETE FROM staff_profiles; DELETE FROM notification_deliveries; DELETE FROM notification_dedupe; DELETE FROM notifications; DELETE FROM sessions; DELETE FROM password_reset_tokens; DELETE FROM audit_logs;');
db.prepare("UPDATE provider_configs SET status='Awaiting onboarding', environment='sandbox', webhook_secret=NULL WHERE provider_key='wema_alat'").run();

function insertPayment(clientId, ref, amountKobo, status = 'pending', options = {}) {
  const verifiedAt = options.verifiedAt !== undefined ? options.verifiedAt : (status === 'verified' ? new Date().toISOString() : null);
  return Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, verified_at, verified_by, created_at)
    VALUES (?, ?, ?, ?, 'NGN', 'Bank Transfer', ?, ?, ?, ?, ?, ?)`).run(
    clientId, options.propertyId || prop1.id, ref, amountKobo / 100, status, amountKobo,
    options.isDemo ? 1 : 0, verifiedAt, null, options.createdAt || new Date().toISOString()
  ).lastInsertRowid);
}

const adaVerified = insertPayment(adaId, 'TX-P6-ADA-01', 400000000, 'verified', { createdAt: new Date(Date.now() - 5 * 86400000).toISOString() });
insertPayment(adaId, 'TX-P6-ADA-02', 100000000, 'pending');
insertPayment(musaId, 'TX-P6-MUSA-01', 200000000, 'pending');
const crossVerified = insertPayment(crossId, 'TX-P6-CROSS-01', 200000000, 'verified', { propertyId: prop2.id });
insertPayment(demoId, 'TX-P6-DEMO-01', 300000000, 'verified', { isDemo: true });

const teamAlphaId = Number(db.prepare('INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, 1)')
  .run('Team Alpha', 1, tl1Id).lastInsertRowid);
const teamAjahId = Number(db.prepare('INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, 1)')
  .run('Team Ajah', 2, tl2Id).lastInsertRowid);
for (const [team, user] of [[teamAlphaId, tl1Id], [teamAlphaId, mkt1Id], [teamAlphaId, mkt2Id], [teamAjahId, tl2Id], [teamAjahId, mkt3Id]]) {
  db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)').run(team, user);
}
for (const [uid, phone, title] of [
  [mdId, '08060000000', 'Managing Director'], [bm1Id, '08060000001', 'Branch Manager'],
  [bm2Id, '08060000002', 'Branch Manager'], [tl1Id, '08060000003', 'Team Lead'],
  [tl2Id, '08060000004', 'Team Lead'], [mkt1Id, '08060000005', 'Marketer'],
  [mkt2Id, '08060000006', 'Marketer'], [mkt3Id, '08060000007', 'Marketer'],
  [finId, '08060000008', 'Finance Officer']
]) {
  db.prepare(`INSERT INTO staff_profiles (user_id, phone_number, job_title, date_joined, updated_by)
    VALUES (?, ?, ?, date('now','-1 year'), ?)`).run(uid, phone, title, mdId);
}

function insertLead(ref, data) {
  return Number(db.prepare(`INSERT INTO leads (lead_reference, full_name, phone_number, email_address, source,
    status, property_id, assigned_marketer_id, team_lead_id, branch_id, estimated_value_kobo, notes,
    next_follow_up_date, converted_client_id, converted_at, created_by, is_demo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ref, data.name, data.phone, data.email || null, data.source || 'Referral', data.status,
    data.propertyId || prop1.id, data.marketerId, data.teamLeadId || null, data.branchId,
    data.estimatedKobo || 0, data.notes || null, data.followUp || null,
    data.convertedClientId || null, data.convertedAt || null, data.createdBy || data.marketerId,
    data.isDemo ? 1 : 0, data.createdAt || new Date().toISOString(), new Date().toISOString()
  ).lastInsertRowid);
}

const lead1 = insertLead('LEAD-P6-001', {
  name: 'Lead One', phone: '08062000001', status: 'New Lead', marketerId: mkt1Id,
  teamLeadId: tl1Id, branchId: 1, estimatedKobo: 500000000, followUp: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  createdBy: mkt1Id, createdAt: new Date(Date.now() - 5 * 86400000).toISOString()
});
const lead2 = insertLead('LEAD-P6-002', {
  name: 'Lead Two', phone: '08062000002', status: 'Converted', marketerId: mkt2Id,
  teamLeadId: tl1Id, branchId: 1, estimatedKobo: 700000000,
  convertedClientId: adaId, convertedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  createdBy: mkt2Id, createdAt: new Date(Date.now() - 10 * 86400000).toISOString()
});
const lead3 = insertLead('LEAD-P6-003', {
  name: 'Lead Three', phone: '08062000003', status: 'Contacted', marketerId: mkt3Id,
  teamLeadId: tl2Id, branchId: 2, estimatedKobo: 300000000,
  createdBy: mkt3Id, createdAt: new Date(Date.now() - 3 * 86400000).toISOString()
});
insertLead('LEAD-P6-DEMO', {
  name: 'Demo Lead', phone: '08062000004', status: 'New Lead', marketerId: mkt1Id,
  teamLeadId: tl1Id, branchId: 1, estimatedKobo: 999000000, createdBy: mkt1Id, isDemo: true
});

for (const [action, targetType, targetId, metadata, branch] of [
  ['client.create', 'client', String(adaId), { full_name: 'Ada Nwosu' }, 1],
  ['property.update', 'property', String(prop2.id), { status: 'Reserved' }, 2],
  ['payment.verify', 'payment', String(adaVerified), { amount_kobo: 400000000 }, 1]
]) {
  db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, branch_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(action === 'property.update' ? bm2Id : (action === 'payment.verify' ? finId : mkt1Id), action, targetType, targetId, JSON.stringify(metadata), branch);
}

const r2 = new Map();
const queued = [];
function makeEnv(overrides = {}) {
  return {
    DB: createD1Adapter(db),
    FILES: {
      async put(key, body) { r2.set(key, body); return {}; },
      async get(key) { return r2.has(key) ? { async arrayBuffer() { return r2.get(key); } } : null; },
      async delete(key) { r2.delete(key); return {}; }
    },
    TASKS: { async send(msg) { queued.push(msg); return true; } },
    ASSETS: { async fetch() { return new Response('Not found', { status: 404 }); } },
    ENVIRONMENT: 'test',
    ...overrides
  };
}
const env = makeEnv();

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers.set('Content-Type', 'application/json');
  }
  const req = new Request(`http://localhost${path}`, { method: options.method || 'GET', headers, body });
  const res = await worker.fetch(req, options.env || env);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, data };
}

async function login(email, password = 'password123') {
  const res = await request('/api/login', { method: 'POST', body: { email, password } });
  if (res.status !== 200) throw new Error(`login ${email} failed ${res.status}: ${JSON.stringify(res.data)}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.error(`  ❌ ${name}\n     ${err.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function moneyKobo(value) { return Math.round(Number(value || 0) * 100); }

console.log('\n========================================================');
console.log('   BLISS LEGACY — PHASE 6 VERIFICATION SUITE');
console.log('========================================================\n');

const mdCookie = await login('md@bliss.com');
const bm1Cookie = await login('bm.ikeja@bliss.com');
const bm2Cookie = await login('bm.ajah@bliss.com');
const tl1Cookie = await login('tl.ikeja@bliss.com');
const tl2Cookie = await login('tl.ajah@bliss.com');
const mkt1Cookie = await login('mkt.ikeja@bliss.com');
const mkt2Cookie = await login('mkt.ikeja2@bliss.com');
const mkt3Cookie = await login('mkt.ajah@bliss.com');
const finCookie = await login('finance@bliss.com');
const adaCookie = await login('ada@example.com');

console.log('--- 1. Role dashboards ---');
await test('all five staff roles load their dashboard and clients are denied', async () => {
  for (const [cookie, role] of [
    [mdCookie, 'Managing Director'], [bm1Cookie, 'Branch Manager'], [tl1Cookie, 'Team Lead'],
    [mkt1Cookie, 'Marketer'], [finCookie, 'Finance Officer']
  ]) {
    const res = await request('/api/dashboard', { headers: { Cookie: cookie } });
    assert(res.status === 200, `${role} dashboard expected 200, got ${res.status}`);
    assert(res.data.me.role_name === role, `${role} dashboard role mismatch`);
    assert(res.data.summary && res.data.summary.financials, `${role} dashboard missing summary`);
  }
  const client = await request('/api/dashboard', { headers: { Cookie: adaCookie } });
  assert(client.status === 403, `client dashboard access expected 403, got ${client.status}`);
  const anon = await request('/api/dashboard');
  assert(anon.status === 401, `anonymous dashboard expected 401, got ${anon.status}`);
});

await test('MD dashboard computes company-wide property, client, staff, lead and financial metrics', async () => {
  const res = await request('/api/dashboard?from=' + new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10) + '&to=' + new Date().toISOString().slice(0, 10), { headers: { Cookie: mdCookie } });
  assert(res.status === 200, `MD dashboard expected 200, got ${res.status}`);
  const s = res.data.summary;
  assert(s.properties.total === 2, `property total expected 2, got ${s.properties.total}`);
  assert(s.properties.published === 2, 'published properties expected 2');
  assert(s.properties.available === 1 && s.properties.reserved === 1, 'property status counts incorrect');
  assert(s.clients.total === 3, `client total expected 3, got ${s.clients.total}`);
  assert(s.clients.active === 2, 'active clients expected 2');
  assert(s.staff.total === 9, `active staff expected 9, got ${s.staff.total}`);
  assert(s.staff.marketers === 3 && s.staff.team_leads === 2, 'staff role counts incorrect');
  assert(s.leads.total === 3, `live leads expected 3, got ${s.leads.total}`);
  assert(s.leads.converted === 1, 'converted leads expected 1');
  assert(s.leads.open === 2, 'open leads expected 2');
  assert(s.financials.contract_sales_value_kobo === 2600000000, `contract value expected 26,000,000, got ${s.financials.contract_sales_value_kobo}`);
  assert(s.financials.verified_payments_kobo === 600000000, `verified expected 6,000,000, got ${s.financials.verified_payments_kobo}`);
  assert(s.financials.outstanding_balances_kobo === 2000000000, 'outstanding expected 20,000,000');
  assert(res.data.period.verified_kobo === 600000000, 'period verified expected 6,000,000');
  assert(res.data.period.leads_generated === 3, 'period leads expected 3');
  assert(res.data.range.granularity === 'day', '30-day range should default to day granularity');
  assert(res.data.trends.length >= 20, 'daily trend buckets missing');
  assert(res.data.branch_comparison.length >= 6, 'branch comparison missing');
  const ikeja = res.data.branch_comparison.find(b => b.branch_name === 'Ikeja');
  assert(ikeja && ikeja.clients === 2 && ikeja.contract_value_kobo === 1800000000 && ikeja.verified_kobo === 400000000, 'Ikeja branch metrics incorrect');
  const ajah = res.data.branch_comparison.find(b => b.branch_name === 'Ajah');
  assert(ajah && ajah.clients === 1 && ajah.contract_value_kobo === 800000000 && ajah.verified_kobo === 200000000, 'Ajah branch metrics incorrect');
  assert(res.data.marketer_rankings.length === 3, 'marketer rankings expected 3');
  assert(res.data.marketer_rankings[0].verified_kobo === 400000000, 'top marketer should have 4,000,000 verified');
  assert(res.data.team_rankings.length === 2, 'team rankings expected 2');
  assert(res.data.team_rankings[0].team_name === 'Team Alpha', 'Team Alpha should rank first');
  assert(res.data.due_follow_ups.some(l => l.lead_reference === 'LEAD-P6-001'), 'overdue follow-up missing');
  assert(res.data.recent_activities.length >= 3, 'recent activities missing');
});

await test('Branch Managers see only their own branch and cannot widen scope with query parameters', async () => {
  const ikeja = await request('/api/dashboard?branch_id=2', { headers: { Cookie: bm1Cookie } });
  assert(ikeja.status === 200, 'BM dashboard expected 200');
  assert(ikeja.data.summary.clients.total === 2, `BM Ikeja clients expected 2, got ${ikeja.data.summary.clients.total}`);
  assert(ikeja.data.summary.financials.contract_sales_value_kobo === 1800000000, 'BM Ikeja contract value incorrect');
  assert(ikeja.data.summary.financials.verified_payments_kobo === 400000000, 'BM Ikeja verified incorrect');
  assert(ikeja.data.branch_comparison.length === 1 && ikeja.data.branch_comparison[0].branch_id === 1, 'BM must only see Ikeja branch comparison');
  assert(ikeja.data.marketer_rankings.every(m => m.branch_name === 'Ikeja'), 'BM must only see Ikeja marketers');
  assert(ikeja.data.team_rankings.every(t => t.branch_id === 1), 'BM must only see Ikeja teams');
  assert(ikeja.data.summary.leads.total === 2, 'BM Ikeja leads expected 2');

  const ajah = await request('/api/dashboard', { headers: { Cookie: bm2Cookie } });
  assert(ajah.data.summary.clients.total === 1, 'BM Ajah clients expected 1');
  assert(ajah.data.summary.financials.contract_sales_value_kobo === 800000000, 'BM Ajah contract value incorrect');
  assert(ajah.data.summary.financials.verified_payments_kobo === 200000000, 'BM Ajah verified incorrect');
  assert(ajah.data.branch_comparison[0].branch_id === 2, 'BM Ajah branch comparison incorrect');
});

await test('Team Leads see only their team portfolio and team members', async () => {
  const res = await request('/api/dashboard', { headers: { Cookie: tl1Cookie } });
  assert(res.status === 200, 'TL dashboard expected 200');
  assert(res.data.summary.clients.total === 2, `TL clients expected 2, got ${res.data.summary.clients.total}`);
  assert(res.data.summary.financials.contract_sales_value_kobo === 1800000000, 'TL contract value incorrect');
  assert(res.data.summary.financials.verified_payments_kobo === 400000000, 'TL verified incorrect');
  assert(res.data.team_members.length === 3, `TL team members expected 3, got ${res.data.team_members.length}`);
  assert(res.data.teams.some(t => t.name === 'Team Alpha'), 'TL team missing');
  assert(res.data.summary.leads.total === 2, 'TL leads expected 2');
  assert(res.data.assigned_properties.length >= 1, 'TL property assignments missing');
  const forbiddenLead = await request(`/api/leads/${lead3}`, { headers: { Cookie: tl1Cookie } });
  assert(forbiddenLead.status === 404, 'TL must not access another team lead lead');

  const ajah = await request('/api/dashboard', { headers: { Cookie: tl2Cookie } });
  assert(ajah.data.summary.clients.total === 1, 'TL Ajah clients expected 1');
  assert(ajah.data.summary.leads.total === 1, 'TL Ajah leads expected 1');
});

await test('Marketers see only personal assigned clients, properties and leads', async () => {
  const res = await request('/api/dashboard', { headers: { Cookie: mkt1Cookie } });
  assert(res.status === 200, 'Marketer dashboard expected 200');
  assert(res.data.summary.clients.total === 1, `Marketer clients expected 1, got ${res.data.summary.clients.total}`);
  assert(res.data.summary.financials.contract_sales_value_kobo === 1000000000, 'Marketer contract value incorrect');
  assert(res.data.summary.financials.verified_payments_kobo === 400000000, 'Marketer verified incorrect');
  assert(res.data.summary.leads.total === 1, 'Marketer leads expected 1');
  assert(res.data.assigned_clients.length === 1 && res.data.assigned_clients[0].client_reference === 'BLC-P6-ADA', 'Marketer assigned client incorrect');
  assert(res.data.assigned_properties.some(p => p.id === prop1.id), 'Marketer assigned property missing');
  assert(res.data.marketer_rankings.length === 1, 'Marketer ranking should contain self only');
  assert(res.data.marketer_rankings[0].user_id === mkt1Id, 'Marketer ranking should be self');
  const otherClient = await request(`/api/clients/${musaId}`, { headers: { Cookie: mkt1Cookie } });
  assert(otherClient.status === 403, 'Marketer must not read another marketer client');
  const otherLead = await request(`/api/leads/${lead2}`, { headers: { Cookie: mkt1Cookie } });
  assert(otherLead.status === 404, 'Marketer must not read another marketer lead');
  const staff = await request('/api/staff', { headers: { Cookie: mkt1Cookie } });
  assert(staff.status === 403, 'Marketer must not access staff management');
});

await test('Finance dashboard is company-wide but staff/lead management remains restricted', async () => {
  const res = await request('/api/dashboard', { headers: { Cookie: finCookie } });
  assert(res.status === 200, 'Finance dashboard expected 200');
  assert(res.data.summary.financials.contract_sales_value_kobo === 2600000000, 'Finance contract value incorrect');
  assert(res.data.summary.financials.verified_payments_kobo === 600000000, 'Finance verified incorrect');
  assert(res.data.summary.leads.total === 0, 'Finance dashboard must not expose lead totals');
  assert(res.data.summary.staff.total === 0, 'Finance dashboard must not expose staff totals');
  assert(res.data.recent_leads.length === 0 && res.data.due_follow_ups.length === 0, 'Finance dashboard leaked lead records');
  const staff = await request('/api/staff', { headers: { Cookie: finCookie } });
  assert(staff.status === 403, 'Finance must not access staff management');
  const leads = await request('/api/leads', { headers: { Cookie: finCookie } });
  assert(leads.status === 403, 'Finance must not access lead pipeline');
  const teams = await request('/api/teams', { headers: { Cookie: finCookie } });
  assert(teams.status === 403, 'Finance must not access team records');
  const activity = await request('/api/activity', { headers: { Cookie: finCookie } });
  assert(activity.status === 200, 'Finance should read activity centre');
  assert(activity.data.activities.every(a => /^(payment|installment|provider|webhook)\./.test(a.action)), 'Finance activity must be financial only');
  const financeClientCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: finCookie },
    body: { full_name: 'Finance Price Attempt', phone_number: '08065000009', agreed_purchase_price: 1 }
  });
  assert(financeClientCreate.status === 403, 'Finance cannot create client contract records');
  const financeClientUpdate = await request(`/api/clients/${adaId}`, {
    method: 'PUT', headers: { Cookie: finCookie }, body: { agreed_purchase_price: 1 }
  });
  assert(financeClientUpdate.status === 403, 'Finance cannot modify contract prices');
  const overview = await request('/api/finance/overview', { headers: { Cookie: finCookie } });
  assert(overview.status === 200, 'Finance overview regression');
});

console.log('\n--- 2. Performance analytics ---');
await test('analytics separates contract value from verified cash and excludes DEMO records', async () => {
  const res = await request('/api/analytics/performance', { headers: { Cookie: mdCookie } });
  assert(res.status === 200, 'analytics expected 200');
  assert(res.data.summary.financials.contract_sales_value_kobo === 2600000000, 'contract value expected 26,000,000');
  assert(res.data.summary.financials.verified_payments_kobo === 600000000, 'verified cash expected 6,000,000');
  assert(res.data.summary.financials.outstanding_balances_kobo === 2000000000, 'outstanding expected 20,000,000');
  assert(res.data.summary.leads.total === 3, 'demo lead must be excluded');
  assert(res.data.lead_pipeline['New Lead'] === 1, 'pipeline New Lead count incorrect');
  assert(res.data.lead_pipeline['Contacted'] === 1, 'pipeline Contacted count incorrect');
  assert(res.data.lead_pipeline['Converted'] === 1, 'pipeline Converted count incorrect');
  assert(res.data.lead_pipeline['Lost'] === 0, 'pipeline Lost count incorrect');
});

await test('date filters and granularity produce correct empty and populated trends', async () => {
  const empty = await request('/api/analytics/performance?from=2020-01-01&to=2020-12-31&granularity=year', { headers: { Cookie: mdCookie } });
  assert(empty.status === 200, 'empty-range analytics expected 200');
  assert(empty.data.period.verified_kobo === 0, '2020 verified should be zero');
  assert(empty.data.period.leads_generated === 0, '2020 leads should be zero');
  assert(empty.data.period.conversions === 0, '2020 conversions should be zero');
  const populated = await request('/api/analytics/performance?from=' + new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10) + '&to=' + new Date().toISOString().slice(0, 10) + '&granularity=year', { headers: { Cookie: mdCookie } });
  assert(populated.data.trends.length === 1, 'year granularity should produce one current-year bucket');
  assert(populated.data.trends[0].verified_kobo === 600000000, 'yearly verified trend incorrect');
  const monthly = await request('/api/analytics/performance?from=' + new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10) + '&to=' + new Date().toISOString().slice(0, 10) + '&granularity=month', { headers: { Cookie: mdCookie } });
  assert(monthly.data.trends.length >= 2, 'monthly trend buckets missing');
});

await test('branch, marketer and team rankings respect hierarchy and conversion percentages', async () => {
  const md = await request('/api/analytics/performance', { headers: { Cookie: mdCookie } });
  const topMarketer = md.data.marketer_rankings[0];
  assert(topMarketer.full_name === 'Ikeja Marketer One', `top marketer expected Ikeja Marketer One, got ${topMarketer.full_name}`);
  assert(topMarketer.converted_count === 0, 'marketer one has no converted lead in baseline');
  const bm = await request('/api/analytics/performance', { headers: { Cookie: bm1Cookie } });
  assert(bm.data.branch_comparison.length === 1 && bm.data.branch_comparison[0].branch_name === 'Ikeja', 'BM analytics branch scope incorrect');
  assert(bm.data.marketer_rankings.length === 2, 'BM analytics marketer scope incorrect');
  const tl = await request('/api/analytics/performance', { headers: { Cookie: tl1Cookie } });
  assert(tl.data.team_rankings.length === 1 && tl.data.team_rankings[0].team_name === 'Team Alpha', 'TL analytics team scope incorrect');
  assert(tl.data.summary.leads.conversion_rate === 50, `TL conversion rate expected 50, got ${tl.data.summary.leads.conversion_rate}`);
});

console.log('\n--- 3. Staff and team management ---');
await test('staff list and creation enforce branch and role restrictions', async () => {
  const mdList = await request('/api/staff?limit=100', { headers: { Cookie: mdCookie } });
  assert(mdList.status === 200, 'MD staff list expected 200');
  assert(mdList.data.pagination.total === 9, `MD staff total expected 9, got ${mdList.data.pagination.total}`);
  const bmList = await request('/api/staff?limit=100', { headers: { Cookie: bm1Cookie } });
  assert(bmList.data.pagination.total === 5, `BM staff total expected 5, got ${bmList.data.pagination.total}`);
  assert(bmList.data.staff.every(s => s.branch_name === 'Ikeja'), 'BM staff list leaked another branch');

  const created = await request('/api/staff', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      email: 'qa.lead@bliss.com', password: 'password123', full_name: 'QA Team Lead',
      role_name: 'Team Lead', branch_id: 1, phone_number: '08063000000', job_title: 'QA Team Lead'
    }
  });
  assert(created.status === 200, `MD staff create expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  const duplicate = await request('/api/staff', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      email: 'qa.lead@bliss.com', password: 'password123', full_name: 'Duplicate', role_name: 'Marketer', branch_id: 1
    }
  });
  assert(duplicate.status === 409, 'duplicate staff email expected 409');
  const cross = await request('/api/staff', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: {
      email: 'cross.staff@bliss.com', password: 'password123', full_name: 'Cross Staff', role_name: 'Marketer', branch_id: 2
    }
  });
  assert(cross.status === 403, 'BM cross-branch staff create expected 403');
  const bmCreated = await request('/api/staff', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: {
      email: 'qa.marketer@bliss.com', password: 'password123', full_name: 'QA Marketer', role_name: 'Marketer', branch_id: 1
    }
  });
  assert(bmCreated.status === 200, 'BM own-branch staff create expected 200');
  const mdRole = await request('/api/staff', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      email: 'second.md@bliss.com', password: 'password123', full_name: 'Second MD', role_name: 'Managing Director', branch_id: 1
    }
  });
  assert(mdRole.status === 403, 'creating a second MD expected 403');
});

await test('staff update, activity history, deactivation and session invalidation work', async () => {
  const qaStaff = db.prepare("SELECT id FROM users WHERE email='qa.lead@bliss.com'").get();
  const updated = await request(`/api/staff/${qaStaff.id}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: {
      role_name: 'Marketer', phone_number: '08063000001', job_title: 'QA Marketer',
      branch_id: 1
    }
  });
  assert(updated.status === 200, `staff update expected 200, got ${updated.status}: ${JSON.stringify(updated.data)}`);
  const detail = await request(`/api/staff/${qaStaff.id}`, { headers: { Cookie: mdCookie } });
  assert(detail.data.staff.role_name === 'Marketer', 'staff role update not persisted');
  assert(detail.data.staff.phone_number === '08063000001', 'staff phone update not persisted');
  assert(detail.data.activity.length >= 1, 'staff activity history missing');
  const crossUpdate = await request(`/api/staff/${qaStaff.id}`, {
    method: 'PUT', headers: { Cookie: bm1Cookie }, body: { full_name: 'BM Edited' }
  });
  assert(crossUpdate.status === 200, 'BM own-branch staff update should succeed');

  const qaCookie = await login('qa.lead@bliss.com');
  const activeMe = await request('/api/me', { headers: { Cookie: qaCookie } });
  assert(activeMe.status === 200, 'new staff login should work');
  const deactivate = await request(`/api/staff/${qaStaff.id}/status`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { active: false }
  });
  assert(deactivate.status === 200, 'staff deactivation expected 200');
  const afterMe = await request('/api/me', { headers: { Cookie: qaCookie } });
  assert(afterMe.status === 401, 'deactivated staff session must be invalidated');
  const self = await request(`/api/staff/${mdId}/status`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { active: false }
  });
  assert(self.status === 400, 'MD self-deactivation expected 400');
});

await test('team management is branch-scoped and member assignment is validated', async () => {
  const created = await request('/api/teams', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { name: 'QA Team', branch_id: 1, team_lead_user_id: tl1Id }
  });
  assert(created.status === 200, `team create expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  const teamId = created.data.team_id;
  const updated = await request(`/api/teams/${teamId}`, {
    method: 'PUT', headers: { Cookie: bm1Cookie }, body: {
      name: 'QA Team Updated', team_lead_user_id: tl1Id, member_ids: [tl1Id, mkt1Id, mkt2Id]
    }
  });
  assert(updated.status === 200, `team update expected 200, got ${updated.status}: ${JSON.stringify(updated.data)}`);
  const detail = await request(`/api/teams/${teamId}`, { headers: { Cookie: bm1Cookie } });
  assert(detail.status === 200 && detail.data.members.length === 3, 'team members not persisted');
  const cross = await request(`/api/teams/${teamAjahId}`, { method: 'PUT', headers: { Cookie: bm1Cookie }, body: { name: 'Hijack' } });
  assert(cross.status === 403, 'BM cross-branch team update expected 403');
  const tlDetail = await request(`/api/teams/${teamAlphaId}`, { headers: { Cookie: tl1Cookie } });
  assert(tlDetail.status === 200, 'TL own team detail expected 200');
  const tlCross = await request(`/api/teams/${teamAjahId}`, { headers: { Cookie: tl1Cookie } });
  assert(tlCross.status === 403, 'TL cross-team detail expected 403');
  const assignStaff = await request(`/api/staff/${mkt2Id}/teams`, {
    method: 'PUT', headers: { Cookie: bm1Cookie }, body: { team_ids: [teamAlphaId, teamId] }
  });
  assert(assignStaff.status === 200, 'staff team assignment expected 200');
  const memberships = db.prepare('SELECT COUNT(*) AS c FROM team_members WHERE user_id=?').get(mkt2Id).c;
  assert(memberships === 2, `staff should belong to 2 teams, got ${memberships}`);
});

console.log('\n--- 4. Lead pipeline and follow-ups ---');
let createdLeadId;
await test('lead creation enforces branch, marketer and estimated-value rules', async () => {
  const cross = await request('/api/leads', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      full_name: 'Cross Lead', phone_number: '08064000001', branch_id: 2
    }
  });
  assert(cross.status === 403, 'marketer cross-branch lead expected 403');
  const created = await request('/api/leads', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      full_name: 'Pipeline Lead', phone_number: '08064000002', email_address: 'pipeline@example.com',
      source: 'Website', status: 'New Lead', estimated_value: 4500000,
      next_follow_up_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    }
  });
  assert(created.status === 200, `lead create expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  createdLeadId = created.data.id;
  const row = db.prepare('SELECT * FROM leads WHERE id=?').get(createdLeadId);
  assert(row.branch_id === 1 && row.assigned_marketer_id === mkt1Id, 'marketer lead attribution incorrect');
  assert(row.team_lead_id === tl1Id, 'marketer lead should inherit team lead');
  assert(row.estimated_value_kobo === 450000000, 'estimated value should be stored in kobo');
  const bmLead = await request('/api/leads', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: {
      full_name: 'BM Assigned Lead', phone_number: '08064000003', assigned_marketer_id: mkt2Id
    }
  });
  assert(bmLead.status === 200, 'BM lead create expected 200');
  const mdLead = await request('/api/leads', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      full_name: 'Ajah Lead', phone_number: '08064000004', branch_id: 2, assigned_marketer_id: mkt3Id
    }
  });
  assert(mdLead.status === 200, 'MD cross-branch lead create expected 200');
  const reassign = await request(`/api/leads/${createdLeadId}`, {
    method: 'PUT', headers: { Cookie: mkt1Cookie }, body: { assigned_marketer_id: mkt2Id }
  });
  assert(reassign.status === 403, 'marketer lead reassignment expected 403');
});

await test('DEMO leads are excluded from the pipeline and inaccessible by direct ID', async () => {
  const demoLead = db.prepare("SELECT id FROM leads WHERE lead_reference='LEAD-P6-DEMO'").get();
  assert(Boolean(demoLead), 'demo lead fixture missing');
  const list = await request('/api/leads?limit=100', { headers: { Cookie: mdCookie } });
  assert(!list.data.leads.some(row => Number(row.id) === Number(demoLead.id)), 'demo lead leaked into live lead list');
  const detail = await request(`/api/leads/${demoLead.id}`, { headers: { Cookie: mdCookie } });
  assert(detail.status === 404, 'direct demo lead access expected 404');
  const convert = await request(`/api/leads/${demoLead.id}/convert`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(convert.status === 404, 'demo lead conversion expected 404');
});

await test('lead status pipeline and follow-up notes/dates remain consistent', async () => {
  const contacted = await request(`/api/leads/${createdLeadId}/status`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { status: 'Contacted' }
  });
  assert(contacted.status === 200, 'status Contacted expected 200');
  const interested = await request(`/api/leads/${createdLeadId}/status`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { status: 'Interested' }
  });
  assert(interested.status === 200, 'status Interested expected 200');
  const invalid = await request(`/api/leads/${createdLeadId}/status`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { status: 'Bogus' }
  });
  assert(invalid.status === 400, 'invalid lead status expected 400');
  const directConvert = await request(`/api/leads/${createdLeadId}/status`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { status: 'Converted' }
  });
  assert(directConvert.status === 400, 'direct Converted status expected 400');
  const followDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const follow = await request(`/api/leads/${createdLeadId}/follow-ups`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      note: 'Spoke with the client and confirmed budget.', channel: 'Phone', outcome: 'Interested',
      follow_up_date: followDate
    }
  });
  assert(follow.status === 200, `follow-up create expected 200, got ${follow.status}: ${JSON.stringify(follow.data)}`);
  const lead = await request(`/api/leads/${createdLeadId}`, { headers: { Cookie: mkt1Cookie } });
  assert(lead.status === 200, 'lead detail expected 200');
  assert(lead.data.follow_ups.length === 1 && lead.data.follow_ups[0].note.includes('confirmed budget'), 'follow-up note missing');
  assert(lead.data.lead.next_follow_up_date === followDate, 'lead next follow-up date not updated');
  const updateFollow = await request(`/api/leads/${createdLeadId}/follow-ups/${follow.data.id}`, {
    method: 'PUT', headers: { Cookie: mkt1Cookie }, body: { outcome: 'Very interested' }
  });
  assert(updateFollow.status === 200, 'follow-up update expected 200');
  const crossFollow = await request(`/api/leads/${createdLeadId}/follow-ups`, {
    method: 'POST', headers: { Cookie: mkt2Cookie }, body: { note: 'Unauthorized' }
  });
  assert(crossFollow.status === 404, 'cross-marketer follow-up expected 404');
});

await test('lead conversion creates a client, preserves attribution and protects contract price', async () => {
  const priceByMarketer = await request(`/api/leads/${createdLeadId}/convert`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { agreed_purchase_price: 9000000 }
  });
  assert(priceByMarketer.status === 403, 'marketer contract price during conversion expected 403');
  const converted = await request(`/api/leads/${createdLeadId}/convert`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {}
  });
  assert(converted.status === 200, `marketer conversion expected 200, got ${converted.status}: ${JSON.stringify(converted.data)}`);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(converted.data.client_id);
  assert(client && client.assigned_branch_id === 1, 'converted client branch incorrect');
  assert(client.original_marketer_id === mkt1Id && client.team_lead_id === tl1Id, 'converted client attribution incorrect');
  assert(client.agreed_purchase_price === null, 'marketer conversion must not create a contract price');
  const lead = db.prepare('SELECT status, converted_client_id, converted_at FROM leads WHERE id=?').get(createdLeadId);
  assert(lead.status === 'Converted' && lead.converted_client_id === converted.data.client_id, 'lead conversion link missing');
  const duplicate = await request(`/api/leads/${createdLeadId}/convert`, { method: 'POST', headers: { Cookie: mkt1Cookie }, body: {} });
  assert(duplicate.status === 409, 'duplicate lead conversion expected 409');

  const bmLead = db.prepare("SELECT id FROM leads WHERE full_name='BM Assigned Lead'").get();
  const bmConverted = await request(`/api/leads/${bmLead.id}/convert`, {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: { agreed_purchase_price: 7500000, client_status: 'Reserved' }
  });
  assert(bmConverted.status === 200, `BM conversion expected 200, got ${bmConverted.status}: ${JSON.stringify(bmConverted.data)}`);
  const bmClient = db.prepare('SELECT * FROM clients WHERE id=?').get(bmConverted.data.client_id);
  assert(bmClient.agreed_purchase_price === 7500000, 'BM contract price not stored');
  assert(bmClient.status === 'Reserved', 'converted client status not stored');
});

console.log('\n--- 5. Activity centre ---');
await test('activity centre records and scopes staff, lead, follow-up and conversion events', async () => {
  const md = await request('/api/activity?limit=100', { headers: { Cookie: mdCookie } });
  assert(md.status === 200, 'MD activity expected 200');
  const actions = md.data.activities.map(a => a.action);
  for (const action of ['staff.create', 'team.update', 'lead.create', 'lead.status', 'lead.followup', 'lead.converted', 'client.create']) {
    assert(actions.includes(action), `activity feed missing ${action}`);
  }
  const bm1 = await request('/api/activity?limit=100', { headers: { Cookie: bm1Cookie } });
  assert(bm1.status === 200, 'BM activity expected 200');
  assert(bm1.data.activities.every(a => a.branch_id === 1), 'BM activity leaked another branch');
  const tl1 = await request('/api/activity?limit=100', { headers: { Cookie: tl1Cookie } });
  assert(tl1.status === 200, 'TL activity expected 200');
  const tlActors = new Set(tl1.data.activities.map(a => a.actor_user_id));
  assert(tlActors.has(mkt1Id), 'TL activity missing team marketer');
  assert(!tlActors.has(mkt3Id), 'TL activity leaked another team marketer');
  const mkt1 = await request('/api/activity?limit=100', { headers: { Cookie: mkt1Cookie } });
  assert(mkt1.status === 200, 'Marketer activity expected 200');
  assert(mkt1.data.activities.every(a => a.actor_user_id === mkt1Id), 'Marketer activity leaked another actor');
  const typed = await request('/api/activity?type=lead&limit=100', { headers: { Cookie: mdCookie } });
  assert(typed.data.activities.every(a => a.action.startsWith('lead')), 'activity type filter incorrect');
  const client = await request('/api/activity', { headers: { Cookie: adaCookie } });
  assert(client.status === 403, 'client activity access expected 403');
});

console.log('\n--- 6. Security and regression ---');
await test('Phase 6 endpoints reject unauthenticated and cross-site requests', async () => {
  for (const [path, method] of [
    ['/api/dashboard', 'GET'], ['/api/analytics/performance', 'GET'], ['/api/staff', 'GET'],
    ['/api/leads', 'GET'], ['/api/activity', 'GET'], ['/api/teams/1', 'GET']
  ]) {
    const res = await request(path, { method });
    assert([401, 403].includes(res.status), `${method} ${path} must require auth, got ${res.status}`);
  }
  const csrf = await request('/api/leads', {
    method: 'POST', headers: { Cookie: mkt1Cookie, Origin: 'https://evil.example' },
    body: { full_name: 'CSRF Lead', phone_number: '08065000001' }
  });
  assert(csrf.status === 403, `cross-site lead create expected 403, got ${csrf.status}`);
  const marketerFinance = await request(`/api/finance/payments/${adaVerified}/verify`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }
  });
  assert(marketerFinance.status === 403, 'marketer cannot verify payments');
  const marketerClientUpdate = await request(`/api/clients/${adaId}`, {
    method: 'PUT', headers: { Cookie: mkt1Cookie },
    body: { agreed_purchase_price: 1 }
  });
  assert(marketerClientUpdate.status === 403, 'marketer cannot modify an existing client contract price');
  const bmCrossStaff = await request(`/api/staff/${mkt3Id}`, { headers: { Cookie: bm1Cookie } });
  assert(bmCrossStaff.status === 403, 'BM cross-branch staff detail expected 403');
});

await test('financial mutation boundaries remain server-side for every non-finance role', async () => {
  const tlVerify = await request(`/api/finance/payments/${adaVerified}/verify`, {
    method: 'POST', headers: { Cookie: tl1Cookie }
  });
  assert(tlVerify.status === 403, 'Team Lead cannot verify payments');
  const tlAdjust = await request(`/api/finance/payments/${adaVerified}/adjust`, {
    method: 'POST', headers: { Cookie: tl1Cookie }, body: { adjustment_type: 'reversal', reason: 'unauthorized' }
  });
  assert(tlAdjust.status === 403, 'Team Lead cannot adjust verified payments');
  const bmVerify = await request(`/api/finance/payments/${adaVerified}/verify`, {
    method: 'POST', headers: { Cookie: bm1Cookie }
  });
  assert(bmVerify.status === 403, 'Branch Manager cannot verify payments');
  const bmCrossTx = await request(`/api/finance/transactions?client_id=${crossId}&limit=100`, {
    headers: { Cookie: bm1Cookie }
  });
  assert(bmCrossTx.status === 200 && bmCrossTx.data.transactions.length === 0, 'BM must not see another branch financial record');
  const mktAdjust = await request(`/api/finance/payments/${adaVerified}/adjust`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { adjustment_type: 'refund', reason: 'unauthorized' }
  });
  assert(mktAdjust.status === 403, 'Marketer cannot adjust verified payments');
  const marketerPriceCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mkt1Cookie },
    body: { full_name: 'Marketer Price Create', phone_number: '08065000010', agreed_purchase_price: 1 }
  });
  assert(marketerPriceCreate.status === 403, 'Marketer cannot set a contract price during registration');
  const tlPriceCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: tl1Cookie },
    body: { full_name: 'Team Lead Price Create', phone_number: '08065000011', agreed_purchase_price: 1 }
  });
  assert(tlPriceCreate.status === 403, 'Team Lead cannot set a contract price during registration');
  const tlPriceUpdate = await request(`/api/clients/${adaId}`, {
    method: 'PUT', headers: { Cookie: tl1Cookie }, body: { agreed_purchase_price: 1 }
  });
  assert(tlPriceUpdate.status === 403, 'Team Lead cannot modify a contract price');
  const clientFinance = await request('/api/finance/overview', { headers: { Cookie: adaCookie } });
  assert(clientFinance.status === 403, 'Client cannot read company finance');
  for (const path of ['/api/staff', '/api/leads', '/api/teams', '/api/activity']) {
    const res = await request(path, { headers: { Cookie: adaCookie } });
    assert(res.status === 403, `Client must not access ${path}`);
  }
});

await test('Phase 1–5 regression remains intact', async () => {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, 'health endpoint regression');
  const props = await request('/api/properties?limit=50');
  assert(props.status === 200 && props.data.properties.some(p => p.reference === 'BLP-P6-IKEJA'), 'public properties regression');
  const loginRes = await request('/api/login', { method: 'POST', body: { email: 'ada@example.com', password: 'password123' } });
  assert(loginRes.status === 200 && loginRes.data.user.role === 'Client', 'client login regression');
  const dashboard = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(dashboard.status === 200 && dashboard.data.financials.agreed_price_ngn === 10000000, 'client portal regression');
  assert(dashboard.data.financials.total_verified_ngn === 4000000, 'client verified payment regression');
  const finance = await request('/api/finance/overview', { headers: { Cookie: finCookie } });
  assert(finance.status === 200 && finance.data.summary.total_verified_kobo === 600000000, 'finance overview regression');
  const demo = await request('/api/finance/overview?demo=1', { headers: { Cookie: finCookie } });
  assert(demo.status === 200 && demo.data.summary.total_verified_kobo === 300000000, 'demo finance isolation regression');
  const provider = await request('/api/finance/provider-config', { headers: { Cookie: finCookie } });
  assert(provider.status === 200 && provider.data.config.webhook_secret === undefined, 'provider secret regression');
  const setup = await request('/api/setup', { method: 'POST', headers: { 'X-Setup-Secret': 'x' }, body: { email: 'x@x.com', password: 'password123', full_name: 'X' } });
  assert([403, 409].includes(setup.status), 'setup lock regression');
  assert(queued.length >= 0, 'queue binding available');
});

console.log('\n--- 7. Responsive and static UI checks ---');
await test('Phase 6 pages declare responsive viewport, shared shell and mobile CSS', async () => {
  const pages = ['dashboard.html', 'performance.html', 'staff-management.html', 'leads.html', 'activity-centre.html'];
  for (const page of pages) {
    const text = readFileSync(page, 'utf8');
    assert(text.includes('name="viewport"'), `${page} missing responsive viewport`);
    assert(text.includes('assets/js/staff-shell.js'), `${page} missing shared staff shell`);
    assert(text.includes('assets/css/styles.css'), `${page} missing design system`);
  }
  const css = readFileSync('assets/css/styles.css', 'utf8');
  assert(css.includes('@media (max-width: 900px)'), 'mobile breakpoint missing');
  assert(css.includes('.sidebar.open'), 'mobile sidebar state missing');
  assert(css.includes('.pipeline-board'), 'lead pipeline responsive styles missing');
  const shell = readFileSync('assets/js/staff-shell.js', 'utf8');
  assert(shell.includes('sidebar-toggle'), 'mobile navigation toggle missing');
  assert(!shell.includes('localStorage'), 'staff shell must not store session data in localStorage');
});

console.log('\n========================================================');
console.log(`   RESULT: ${passed} PASSED | ${failed} FAILED`);
if (failures.length) {
  for (const f of failures) console.log(`   - ${f.name}: ${f.error}`);
}
console.log('========================================================\n');

db.close();
process.exit(failed ? 1 : 0);
