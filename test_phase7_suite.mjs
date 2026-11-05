import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import worker from './src/index.js';
import { resolveLiveDb } from './test_db_paths.mjs';

const LIVE_DB = resolveLiveDb();
const TEST_DB = join(dirname(LIVE_DB), 'phase7-test.sqlite');

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
        bind(...args) { boundArgs = args.map(a => (a === undefined ? null : a)); return stmtObj; },
        async all() { return { results: database.prepare(sql).all(...boundArgs) }; },
        async first() { return database.prepare(sql).get(...boundArgs) || null; },
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
  db.prepare(`INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, full_name=excluded.full_name,
      role_id=excluded.role_id, branch_id=excluded.branch_id, is_active=1`).run(email, hashPw('password123'), fullName, roleId, branchId);
  return db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
}
function upsertClient(ref, data) {
  const existing = db.prepare('SELECT id FROM clients WHERE client_reference=?').get(ref);
  if (existing) {
    db.prepare(`UPDATE clients SET full_name=?, phone_number=?, email_address=?, status=?, sale_type=?,
      assigned_branch_id=?, created_by=?, original_marketer_id=?, team_lead_id=?, agreed_purchase_price=?,
      interested_property_id=?, user_id=?, is_deleted=0 WHERE id=?`).run(
      data.full_name, data.phone_number, data.email || null, data.status || 'Active Buyer', data.saleType || 'New Sale',
      data.branchId, data.createdBy, data.marketerId, data.teamLeadId || null, data.agreedPrice || 0,
      data.propertyId || null, data.userId || null, existing.id
    );
    return existing.id;
  }
  return Number(db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address,
    status, sale_type, assigned_branch_id, created_by, original_marketer_id, team_lead_id,
    agreed_purchase_price, interested_property_id, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ref, data.full_name, data.phone_number, data.email || null, data.status || 'Active Buyer', data.saleType || 'New Sale',
    data.branchId, data.createdBy, data.marketerId, data.teamLeadId || null, data.agreedPrice || 0,
    data.propertyId || null, data.userId || null
  ).lastInsertRowid);
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
// Phase 12: commission access must be granted explicitly. This test grants it
// to the finance user while verifying that staff/team leads remain excluded.
db.prepare('UPDATE users SET commission_access=1 WHERE id=?').run(finId);
const adaUserId = upsertUser('ada@example.com', 'Ada Nwosu', 6, 1);
const musaUserId = upsertUser('musa@example.com', 'Musa Dike', 6, 1);
const demoUserId = upsertUser('demo@bliss.com', 'Demo Investor', 6, 1);

// Isolated deterministic Phase 7 fixtures.
db.exec(`
  DELETE FROM commission_adjustments;
  DELETE FROM commission_payments;
  DELETE FROM commission_approvals;
  DELETE FROM commission_attributions;
  DELETE FROM commission_entries;
  DELETE FROM commission_plan_rules;
  DELETE FROM commission_plans;
  DELETE FROM financial_report_jobs;
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

const prop1 = Number(db.prepare(`INSERT INTO properties (reference,title,description,category_id,sale_price,state,city,address,branch_id,status,is_published,created_by)
  VALUES ('BLP-P7-IKEJA','Phase 7 Ikeja Property','Commission test inventory',1,10000000,'Lagos','Ikeja','7 Phase Close',1,'Available',1,?)`).run(mdId).lastInsertRowid);
const prop2 = Number(db.prepare(`INSERT INTO properties (reference,title,description,category_id,sale_price,state,city,address,branch_id,status,is_published,created_by)
  VALUES ('BLP-P7-AJAH','Phase 7 Ajah Property','Commission test inventory',2,8000000,'Lagos','Ajah','8 Phase Close',2,'Reserved',1,?)`).run(mdId).lastInsertRowid);

const adaId = upsertClient('BLC-P7-ADA', { full_name: 'Ada Nwosu', phone_number: '08071000001', email: 'ada@example.com', status: 'Active Buyer', saleType: 'New Sale', branchId: 1, createdBy: mkt1Id, marketerId: mkt1Id, teamLeadId: tl1Id, agreedPrice: 10000000, propertyId: prop1, userId: adaUserId });
const musaId = upsertClient('BLC-P7-MUSA', { full_name: 'Musa Dike', phone_number: '08071000002', email: 'musa@example.com', status: 'Interested', saleType: 'Resale', branchId: 1, createdBy: mkt2Id, marketerId: mkt2Id, teamLeadId: tl1Id, agreedPrice: 8000000, propertyId: prop1, userId: musaUserId });
const crossId = upsertClient('BLC-P7-CROSS', { full_name: 'Cross Branch Client', phone_number: '08071000003', email: 'cross@example.com', status: 'Active Buyer', saleType: 'New Sale', branchId: 2, createdBy: mkt3Id, marketerId: mkt3Id, teamLeadId: tl2Id, agreedPrice: 8000000, propertyId: prop2 });
const demoId = upsertClient('DEMO-CLIENT-001', { full_name: 'Demo Investor', phone_number: '08071000004', email: 'demo@bliss.com', status: 'Active Buyer', saleType: 'New Sale', branchId: 1, createdBy: mkt1Id, marketerId: mkt1Id, teamLeadId: tl1Id, agreedPrice: 15000000, propertyId: prop1, userId: demoUserId });

// Phase 7.1 multi-property allocations. Ada owns two properties.
for (const [clientId, propertyId, price] of [
  [adaId, prop1, 10000000], [adaId, prop2, 5000000],
  [musaId, prop1, 8000000], [crossId, prop2, 8000000], [demoId, prop1, 15000000]
]) {
  db.prepare(`INSERT OR IGNORE INTO client_properties (client_id, property_id, agreed_purchase_price, status)
    VALUES (?, ?, ?, 'Active')`).run(clientId, propertyId, price);
}

const teamAlphaId = Number(db.prepare('INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, 1)').run('Phase 7 Team Alpha', 1, tl1Id).lastInsertRowid);
const teamAjahId = Number(db.prepare('INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?, ?, ?, 1)').run('Phase 7 Team Ajah', 2, tl2Id).lastInsertRowid);
for (const [team, user] of [[teamAlphaId, tl1Id], [teamAlphaId, mkt1Id], [teamAlphaId, mkt2Id], [teamAjahId, tl2Id], [teamAjahId, mkt3Id]]) {
  db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)').run(team, user);
}
for (const [uid, phone, title] of [[mdId,'08070000000','Managing Director'],[bm1Id,'08070000001','Branch Manager'],[bm2Id,'08070000002','Branch Manager'],[tl1Id,'08070000003','Team Lead'],[tl2Id,'08070000004','Team Lead'],[mkt1Id,'08070000005','Marketer'],[mkt2Id,'08070000006','Marketer'],[mkt3Id,'08070000007','Marketer'],[finId,'08070000008','Finance Officer']]) {
  db.prepare(`INSERT INTO staff_profiles (user_id, phone_number, job_title, date_joined, updated_by)
    VALUES (?, ?, ?, date('now','-1 year'), ?)`).run(uid, phone, title, mdId);
}

function insertPayment(clientId, ref, amountKobo, status = 'pending', options = {}) {
  const verifiedAt = options.verifiedAt !== undefined ? options.verifiedAt : (status === 'verified' ? new Date().toISOString() : null);
  return Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, verified_at, verified_by, created_at)
    VALUES (?, ?, ?, ?, 'NGN', 'Bank Transfer', ?, ?, ?, ?, ?, ?)`).run(
    clientId, options.propertyId || prop1, ref, amountKobo / 100, status, amountKobo,
    options.isDemo ? 1 : 0, verifiedAt, null, options.createdAt || new Date().toISOString()
  ).lastInsertRowid);
}
const adaPayment1 = insertPayment(adaId, 'TX-P7-ADA-01', 400000000, 'verified', { createdAt: new Date(Date.now() - 5 * 86400000).toISOString() });
const adaPayment2 = insertPayment(adaId, 'TX-P7-ADA-02', 200000000, 'verified', { createdAt: new Date(Date.now() - 4 * 86400000).toISOString() });
insertPayment(adaId, 'TX-P7-ADA-PENDING', 100000000, 'pending');
insertPayment(musaId, 'TX-P7-MUSA-01', 300000000, 'verified');
insertPayment(crossId, 'TX-P7-CROSS-01', 200000000, 'verified', { propertyId: prop2 });
insertPayment(demoId, 'TX-P7-DEMO-01', 300000000, 'verified', { isDemo: true });

for (const [action, targetType, targetId, metadata, branch] of [
  ['client.create', 'client', String(adaId), { full_name: 'Ada Nwosu' }, 1],
  ['payment.verify', 'payment', String(adaPayment1), { amount_kobo: 400000000 }, 1],
  ['client.create', 'client', String(crossId), { full_name: 'Cross Branch Client' }, 2]
]) {
  db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, branch_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(action === 'payment.verify' ? finId : mkt1Id, action, targetType, targetId, JSON.stringify(metadata), branch);
}

const r2 = new Map();
const queued = [];
function makeEnv(overrides = {}) {
  return {
    DB: createD1Adapter(db),
    FILES: {
      async put(key, body, options = {}) {
        const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
        r2.set(key, { bytes, contentType: options?.httpMetadata?.contentType || 'application/octet-stream' });
        return {};
      },
      async get(key) {
        const item = r2.get(key);
        if (!item) return null;
        return {
          httpMetadata: { contentType: item.contentType },
          async arrayBuffer() { return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength); }
        };
      },
      async delete(key) { r2.delete(key); return {}; }
    },
    TASKS: { async send(msg) { queued.push(msg); return true; } },
    ASSETS: {
      async fetch(input) {
        const url = typeof input === 'string' ? input : (input.url || String(input));
        if (url.includes('bliss-legacy-logo')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        return new Response('Not found', { status: 404 });
      }
    },
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
  if (res.status !== 200) throw new Error(`login ${email} failed ${res.status}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (error) { failed++; failures.push({ name, error: error.message }); console.error(`  ❌ ${name}\n     ${error.message}`); }
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function pdfText(bytes) { return Buffer.from(bytes).toString('latin1'); }

console.log('\n========================================================');
console.log('   BLISS LEGACY — PHASE 7 COMMISSION & REPORT SUITE');
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

console.log('--- 1. Commission plan configuration ---');
let contractPlanId, collectionPlanId, fixedPlanId;
await test('management can create percentage, collection and fixed commission plans with role rules', async () => {
  const contract = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Contract Marketer 5%', calculation_basis: 'contract_value',
      effective_from: '2020-01-01', approval_required: true, separation_of_duties: true,
      rules: [{ role_name: 'Marketer', rate_bps: 500 }]
    }
  });
  assert(contract.status === 200, `contract plan expected 200, got ${contract.status}: ${JSON.stringify(contract.data)}`);
  contractPlanId = contract.data.id;

  const collections = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: finCookie }, body: {
      name: 'Phase 7 Collections Marketer 2%', calculation_basis: 'verified_collections',
      effective_from: '2020-01-01', approval_required: true,
      rules: [{ role_name: 'Marketer', rate_bps: 200 }]
    }
  });
  assert(collections.status === 200, 'collections plan expected 200');
  collectionPlanId = collections.data.id;

  const fixed = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Fixed Marketer', calculation_basis: 'fixed',
      effective_from: '2020-01-01', approval_required: false,
      rules: [{ role_name: 'Marketer', fixed_amount: 50000 }]
    }
  });
  assert(fixed.status === 200, 'fixed plan expected 200');
  fixedPlanId = fixed.data.id;

  const listed = await request('/api/commission-plans', { headers: { Cookie: mdCookie } });
  assert(listed.status === 200 && listed.data.plans.length >= 3, 'commission plan list missing');
  assert(listed.data.plans.every(p => Array.isArray(p.rules)), 'plan rules missing');
});

await test('commission plan validation rejects invalid rates, fixed amounts, roles and dates', async () => {
  const zeroRate = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Bad Rate', calculation_basis: 'contract_value', rules: [{ role_name: 'Marketer', rate_bps: 0 }]
    }
  });
  assert(zeroRate.status === 400, 'zero percentage rate expected 400');
  const badRole = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Bad Role', calculation_basis: 'contract_value', rules: [{ role_name: 'Client', rate_bps: 100 }]
    }
  });
  assert(badRole.status === 400, 'invalid commission role expected 400');
  const badFixed = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Bad Fixed', calculation_basis: 'fixed', rules: [{ role_name: 'Marketer', fixed_amount: 0 }]
    }
  });
  assert(badFixed.status === 400, 'fixed plan without amount expected 400');
  const badDate = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Bad Date', calculation_basis: 'contract_value', effective_from: '2030-01-01', effective_to: '2029-01-01',
      rules: [{ role_name: 'Marketer', rate_bps: 100 }]
    }
  });
  assert(badDate.status === 400, 'invalid effective dates expected 400');
  const marketerPlan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      name: 'Unauthorized', calculation_basis: 'contract_value', rules: [{ role_name: 'Marketer', rate_bps: 100 }]
    }
  });
  assert(marketerPlan.status === 403, 'marketer plan creation expected 403');

  const restricted = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Restricted Eligibility', calculation_basis: 'contract_value',
      rules: [{ role_name: 'Marketer', rate_bps: 100, branch_id: 2, property_category_id: 2, sales_type: 'Resale' }]
    }
  });
  assert(restricted.status === 200, 'restricted plan expected 200');
  const restrictedRun = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: restricted.data.id, client_id: adaId }
  });
  assert(restrictedRun.status === 200 && restrictedRun.data.created === 0, 'plan branch/category/sales-type rules must exclude non-matching clients');
});

console.log('\n--- 2. Commission calculation and idempotency ---');
await test('contract-value commission uses the agreed contract price and is idempotent', async () => {
  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: contractPlanId, client_id: adaId }
  });
  assert(generated.status === 200, `contract generation expected 200, got ${generated.status}: ${JSON.stringify(generated.data)}`);
  assert(generated.data.created === 1, `expected 1 contract entry, got ${generated.data.created}`);
  const entry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(contractPlanId, adaId);
  assert(entry, 'contract commission entry missing');
  assert(entry.basis === 'contract_value', 'contract basis not stored');
  assert(entry.qualifying_amount_kobo === 1000000000, `qualifying contract kobo expected 1,000,000,000, got ${entry.qualifying_amount_kobo}`);
  assert(entry.rate_bps === 500, 'contract rate snapshot incorrect');
  assert(entry.commission_kobo === 50000000, `5% of 10,000,000 should be 500,000 NGN = 50,000,000 kobo, got ${entry.commission_kobo}`);
  assert(entry.recipient_user_id === mkt1Id, 'contract entry recipient should be marketer one');
  assert(entry.branch_id === 1 && entry.team_id === teamAlphaId, 'attribution snapshot branch/team incorrect');
  const duplicate = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: contractPlanId, client_id: adaId }
  });
  assert(duplicate.status === 200 && duplicate.data.created === 0, 'duplicate contract generation must not create entries');
  assert(db.prepare('SELECT COUNT(*) AS c FROM commission_entries WHERE plan_id=? AND client_id=?').get(contractPlanId, adaId).c === 1, 'duplicate contract entry exists');
});

await test('verified-collection commission accrues per verified payment and excludes pending/demo', async () => {
  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: finCookie }, body: { plan_id: collectionPlanId, client_id: adaId }
  });
  assert(generated.status === 200, `collection generation expected 200, got ${generated.status}: ${JSON.stringify(generated.data)}`);
  assert(generated.data.created === 2, `expected 2 verified-collection entries, got ${generated.data.created}`);
  const entries = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=? ORDER BY payment_id").all(collectionPlanId, adaId);
  assert(entries.length === 2, 'collection entries missing');
  const total = entries.reduce((sum, row) => sum + Number(row.commission_kobo), 0);
  assert(total === 12000000, `2% of 6,000,000 verified collections should be 120,000 NGN = 12,000,000 kobo, got ${total}`);
  assert(entries.every(row => row.basis === 'verified_collections'), 'collection basis snapshot incorrect');
  assert(!entries.some(row => row.payment_id === null), 'collection entry lacks payment reference');
  const demoGenerated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: finCookie }, body: { plan_id: collectionPlanId, client_id: demoId }
  });
  assert(demoGenerated.status === 200 && demoGenerated.data.created === 0, 'demo client must not generate commissions');
});

await test('fixed commission is created once per qualifying client and is not multiplied by payments', async () => {
  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: fixedPlanId, client_id: adaId }
  });
  assert(generated.status === 200, 'fixed generation expected 200');
  assert(generated.data.created === 1, `fixed plan expected one entry, got ${generated.data.created}`);
  const entry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(fixedPlanId, adaId);
  assert(entry.commission_kobo === 5000000, `fixed commission expected 50,000 NGN = 5,000,000 kobo, got ${entry.commission_kobo}`);
  assert(entry.rate_bps === 0, 'fixed plan should have zero rate');
  const duplicate = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: fixedPlanId, client_id: adaId }
  });
  assert(duplicate.data.created === 0, 'fixed commission duplicated');
});

await test('commission attribution snapshot survives client reassignment', async () => {
  const original = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(contractPlanId, adaId);
  const assignment = await request(`/api/clients/${adaId}/assign`, {
    method: 'POST', headers: { Cookie: bm1Cookie },
    body: { relationship_manager_id: mkt2Id, branch_id: 1, reason: 'Phase 7 attribution test' }
  });
  assert(assignment.status === 200, `client reassignment expected 200, got ${assignment.status}`);
  const after = db.prepare("SELECT * FROM commission_entries WHERE id=?").get(original.id);
  assert(after.recipient_user_id === mkt1Id, 'existing commission recipient changed after reassignment');
  const attribution = db.prepare("SELECT * FROM commission_attributions WHERE entry_id=?").get(original.id);
  assert(attribution && attribution.marketer_id === mkt1Id, 'attribution snapshot not preserved');
  const newPlan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Post-Reassignment Contract', calculation_basis: 'contract_value',
      rules: [{ role_name: 'Marketer', rate_bps: 100 }]
    }
  });
  const newEntry = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: newPlan.data.id, client_id: adaId }
  });
  assert(newEntry.status === 200 && newEntry.data.created === 1, 'new plan should generate a new entry');
  const entry = db.prepare("SELECT recipient_user_id FROM commission_entries WHERE plan_id=? AND client_id=?").get(newPlan.data.id, adaId);
  assert(entry.recipient_user_id === mkt2Id, 'new commission should use current marketer attribution');
});

console.log('\n--- 3. Property portfolio and assignment visibility ---');
await test('client dashboard and authorised staff see every allocated property with progress', async () => {
  const dash = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(dash.status === 200, `client dashboard expected 200, got ${dash.status}`);
  assert(Array.isArray(dash.data.properties) && dash.data.properties.length === 2, 'client dashboard must expose both allocated properties');
  const first = dash.data.properties.find(p => Number(p.property_id) === prop1);
  const second = dash.data.properties.find(p => Number(p.property_id) === prop2);
  assert(first && second, 'client dashboard property allocations missing');
  assert(first.agreed_purchase_price_kobo === 1000000000, 'primary contract allocation incorrect');
  assert(first.verified_kobo === 600000000 && first.outstanding_kobo === 400000000, 'primary verified/outstanding allocation incorrect');
  assert(first.progress === 60, `primary progress expected 60, got ${first.progress}`);
  assert(second.agreed_purchase_price_kobo === 500000000 && second.verified_kobo === 0, 'secondary allocation incorrect');
  assert(second.outstanding_kobo === 500000000, 'secondary outstanding incorrect');
  const fin = dash.data.financials;
  assert(fin.agreed_price_kobo === 1500000000, 'portfolio contract total should be 15,000,000');
  assert(fin.total_verified_kobo === 600000000, 'portfolio verified total should be 6,000,000');
  assert(fin.outstanding_balance_kobo === 900000000, 'portfolio outstanding should be 9,000,000');
  assert(fin.payment_percentage === 40, `portfolio progress expected 40, got ${fin.payment_percentage}`);

  for (const [label, cookie] of [['current marketer', mkt2Cookie], ['branch manager', bm1Cookie], ['managing director', mdCookie], ['finance', finCookie]]) {
    const detail = await request(`/api/clients/${adaId}`, { headers: { Cookie: cookie } });
    assert(detail.status === 200, `${label} client detail expected 200, got ${detail.status}`);
    assert(Array.isArray(detail.data.properties) && detail.data.properties.length === 2, `${label} must see both client properties`);
    assert(detail.data.financials.outstanding_balance_kobo === 900000000, `${label} sees incorrect portfolio balance`);
  }

  const propsFile = readFileSync('assets/js/data/properties.js', 'utf8');
  const ids = [...propsFile.matchAll(/id: "prop-(\d+)"/g)].map(m => m[1]);
  const landCount = (propsFile.match(/category: "Land"/g) || []).length;
  const mainJs = readFileSync('assets/js/main.js', 'utf8');
  assert(ids.length === 10, `landing catalogue should contain ten listings, found ${ids.length}`);
  assert(ids.includes('009') && ids.includes('010'), 'landing catalogue is missing the latest listings');
  assert(landCount >= 3, 'landing catalogue must include land opportunities');
  assert(mainJs.includes('allProperties.slice(0, 10)'), 'landing page must cap merged listings at ten');
  assert(mainJs.includes("String(p.category).toLowerCase() === 'land'"), 'landing page must preserve a land listing');
  assert(mainJs.includes('isDemo ?'), 'demo listings should be labelled on the landing page');
});

await test('a reassigned client and their property/payment data disappear for the previous marketer and branch', async () => {
  const oldMarketer = await request(`/api/clients/${adaId}`, { headers: { Cookie: mkt1Cookie } });
  assert(oldMarketer.status === 403, `previous marketer must lose client detail, got ${oldMarketer.status}`);
  const oldMarketerList = await request('/api/clients?limit=50', { headers: { Cookie: mkt1Cookie } });
  assert(oldMarketerList.status === 200, 'previous marketer client list failed');
  assert(!oldMarketerList.data.clients.some(c => Number(c.id) === adaId), 'previous marketer still sees the reassigned client');

  const oldBranch = await request(`/api/clients/${adaId}`, { headers: { Cookie: bm2Cookie } });
  assert(oldBranch.status === 403, `cross-branch manager must not see client, got ${oldBranch.status}`);
});

console.log('\n--- 4. Workflow, approvals and payments ---');
let approvedEntryId;
await test('calculated commission can be submitted, approved and rejected with separation of duties', async () => {
  const contractEntry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(contractPlanId, adaId);
  approvedEntryId = contractEntry.id;
  const submit = await request(`/api/commissions/${approvedEntryId}/submit`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(submit.status === 200 && submit.data.status === 'Pending Approval', 'submit should move to Pending Approval');
  const approve = await request(`/api/commissions/${approvedEntryId}/approve`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(approve.status === 200 && approve.data.status === 'Approved', 'approve expected Approved');

  const rejectTarget = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=? LIMIT 1").get(collectionPlanId, adaId);
  await request(`/api/commissions/${rejectTarget.id}/submit`, { method: 'POST', headers: { Cookie: finCookie }, body: {} });
  const reject = await request(`/api/commissions/${rejectTarget.id}/reject`, {
    method: 'POST', headers: { Cookie: finCookie }, body: { reason: 'Phase 7 rejection test' }
  });
  assert(reject.status === 200 && reject.data.status === 'Rejected', 'reject expected Rejected');
  assert(db.prepare("SELECT rejection_reason FROM commission_entries WHERE id=?").get(rejectTarget.id).rejection_reason === 'Phase 7 rejection test', 'rejection reason not stored');
});

await test('a recipient cannot approve their own commission request', async () => {
  const plan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Self Approval Test', calculation_basis: 'fixed', approval_required: true, separation_of_duties: true,
      rules: [{ role_name: 'Marketer', fixed_amount: 1000 }]
    }
  });
  const entry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(contractPlanId, adaId);
  // Insert a controlled pending entry whose recipient is the Finance approver.
  const id = Number(db.prepare(`INSERT INTO commission_entries
    (commission_ref, plan_id, rule_id, client_id, property_id, recipient_user_id, recipient_role,
     branch_id, team_id, marketer_id, team_lead_id, source_type, source_key, basis,
     qualifying_amount_kobo, rate_bps, commission_kobo, status, approval_required, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'Marketer', 1, ?, ?, ?, 'fixed', ?, 'fixed', 1000, 0, 1000, 'Pending Approval', 1, ?)`)
    .run('COM-SELF-APPROVAL', plan.data.id, db.prepare("SELECT id FROM commission_plan_rules WHERE plan_id=?").get(plan.data.id).id,
      adaId, prop1, finId, teamAlphaId, mkt1Id, tl1Id, 'self-approval:test', finId).lastInsertRowid);
  const selfApprove = await request(`/api/commissions/${id}/approve`, {
    method: 'POST', headers: { Cookie: finCookie }, body: {}
  });
  assert(selfApprove.status === 403, `self approval expected 403, got ${selfApprove.status}`);
});

await test('commission payments support partial payment, idempotency, double-payment prevention and receipts', async () => {
  const partial = await request(`/api/commissions/${approvedEntryId}/payments`, {
    method: 'POST', headers: { Cookie: finCookie }, body: {
      amount: 200000, method: 'Bank Transfer', external_reference: 'CPAY-REF-1', idempotency_key: 'phase7-payment-1'
    }
  });
  assert(partial.status === 200, `partial payment expected 200, got ${partial.status}: ${JSON.stringify(partial.data)}`);
  assert(partial.data.status === 'Partially Paid', 'partial payment status incorrect');
  assert(partial.data.outstanding_kobo === 30000000, `outstanding expected 30,000,000 kobo, got ${partial.data.outstanding_kobo}`);
  const duplicate = await request(`/api/commissions/${approvedEntryId}/payments`, {
    method: 'POST', headers: { Cookie: finCookie }, body: {
      amount: 200000, method: 'Bank Transfer', idempotency_key: 'phase7-payment-1'
    }
  });
  assert(duplicate.status === 200 && duplicate.data.already_recorded === true, 'idempotent commission payment expected');
  const overpay = await request(`/api/commissions/${approvedEntryId}/payments`, {
    method: 'POST', headers: { Cookie: finCookie }, body: { amount: 400000, method: 'Bank Transfer' }
  });
  assert(overpay.status === 400, 'overpayment must be rejected');
  const finalPayment = await request(`/api/commissions/${approvedEntryId}/payments`, {
    method: 'POST', headers: { Cookie: finCookie }, body: { amount: 300000, method: 'Bank Transfer', external_reference: 'CPAY-REF-2' }
  });
  assert(finalPayment.status === 200 && finalPayment.data.status === 'Paid', 'final payment should mark commission Paid');
  const receipt = await request(`/api/commissions/payments/${finalPayment.data.payment_id}/receipt`, {
    headers: { Cookie: finCookie }
  });
  assert(receipt.status === 200, `commission receipt expected 200, got ${receipt.status}`);
  const text = pdfText(receipt.data);
  assert(text.startsWith('%PDF-1.4') && text.includes('COMMISSION RECEIPT') && text.includes('/DCTDecode'), 'commission receipt PDF/logo invalid');
  const otherMarketer = await request(`/api/commissions/payments/${finalPayment.data.payment_id}/receipt`, {
    headers: { Cookie: mkt2Cookie }
  });
  assert(otherMarketer.status === 404, 'another recipient must not download the receipt');
  const paymentRow = db.prepare("SELECT r2_key FROM commission_payments WHERE id=?").get(finalPayment.data.payment_id);
  assert(paymentRow.r2_key && paymentRow.r2_key.startsWith('commission-receipts/'), 'commission receipt not stored in R2');
  const publicLeak = await request(`/api/files/${encodeURIComponent(paymentRow.r2_key)}`);
  assert(publicLeak.status === 404, 'commission receipt must not be public');
});

await test('payment reversals create traceable commission adjustments without overwriting the original entry', async () => {
  const entry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND payment_id=? ORDER BY id LIMIT 1").get(collectionPlanId, adaPayment2);
  assert(entry, 'collection commission entry missing');
  const originalAmount = entry.commission_kobo;
  const reversal = await request(`/api/finance/payments/${adaPayment2}/adjust`, {
    method: 'POST', headers: { Cookie: finCookie }, body: { adjustment_type: 'reversal', reason: 'Phase 7 commission reversal test' }
  });
  assert(reversal.status === 200, `payment reversal expected 200, got ${reversal.status}: ${JSON.stringify(reversal.data)}`);
  const adjusted = db.prepare("SELECT * FROM commission_entries WHERE id=?").get(entry.id);
  assert(adjusted.commission_kobo === originalAmount, 'original commission amount was overwritten');
  assert(adjusted.adjusted_kobo === -originalAmount, 'commission adjustment amount incorrect');
  assert(adjusted.status === 'Reversed', 'reversed commission status incorrect');
  const adjustment = db.prepare("SELECT * FROM commission_adjustments WHERE entry_id=? AND source_payment_id=?").get(entry.id, adaPayment2);
  assert(adjustment && adjustment.amount_kobo === -originalAmount, 'commission adjustment row missing');
});

await test('plan updates preserve existing entries and manual corrections remain traceable', async () => {
  const detail = await request(`/api/commission-plans/${contractPlanId}`, { headers: { Cookie: mdCookie } });
  assert(detail.status === 200, 'plan detail expected 200');
  const existingRule = detail.data.plan.rules[0];
  const update = await request(`/api/commission-plans/${contractPlanId}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 7 Contract Marketer 5% Updated',
      calculation_basis: 'contract_value',
      effective_from: '2020-01-01',
      approval_required: true,
      separation_of_duties: true,
      rules: [{ id: existingRule.id, role_name: 'Marketer', rate_bps: 500, is_active: true }]
    }
  });
  assert(update.status === 200, `plan update expected 200, got ${update.status}: ${JSON.stringify(update.data)}`);
  const updated = await request(`/api/commission-plans/${contractPlanId}`, { headers: { Cookie: mdCookie } });
  assert(updated.data.plan.name.includes('Updated') && updated.data.plan.rules[0].id === existingRule.id, 'plan update did not preserve rule identity');
  const deactivate = await request(`/api/commission-plans/${contractPlanId}/status`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { is_active: false }
  });
  assert(deactivate.status === 200 && deactivate.data.is_active === 0, 'plan deactivation failed');
  await request(`/api/commission-plans/${contractPlanId}/status`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { is_active: true }
  });

  const fixedEntry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?").get(fixedPlanId, adaId);
  const before = Number(fixedEntry.adjusted_kobo || 0);
  const adjustment = await request(`/api/commissions/${fixedEntry.id}/adjustments`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      adjustment_type: 'correction', amount: -1000, reason: 'Phase 7 manual correction test'
    }
  });
  assert(adjustment.status === 200, `manual adjustment expected 200, got ${adjustment.status}: ${JSON.stringify(adjustment.data)}`);
  const after = db.prepare("SELECT * FROM commission_entries WHERE id=?").get(fixedEntry.id);
  assert(after.commission_kobo === fixedEntry.commission_kobo, 'manual adjustment overwrote original commission');
  assert(after.adjusted_kobo === before - 100000, 'manual adjustment amount incorrect');
  assert(db.prepare("SELECT COUNT(*) AS c FROM commission_adjustments WHERE entry_id=?").get(fixedEntry.id).c >= 1, 'manual adjustment history missing');
});

console.log('\n--- 5. Isolation and analytics ---');
await test('staff see only their own commission amounts while permitted users see everything', async () => {
  const mkt1 = await request('/api/commissions?limit=100', { headers: { Cookie: mkt1Cookie } });
  assert(mkt1.status === 200, 'marketer own commission list expected 200');
  assert(mkt1.data.entries.length > 0, 'marketer own commission list should not be empty');
  const ownKeys = ['id','commission_ref','client_name','client_reference','status','earned_kobo','expected_kobo','adjusted_kobo','paid_kobo','outstanding_kobo','created_at'];
  assert(Object.keys(mkt1.data.entries[0]).sort().join(',') === ownKeys.sort().join(','), `marketer keys leaked calculation fields: ${Object.keys(mkt1.data.entries[0])}`);
  assert(!('rate_bps' in mkt1.data.entries[0]) && !('basis' in mkt1.data.entries[0]) && !('plan_name' in mkt1.data.entries[0]), 'marketer saw rate/calculation fields');
  const mkt2 = await request('/api/commissions?limit=100', { headers: { Cookie: mkt2Cookie } });
  assert(mkt2.status === 200, 'second marketer own commission expected 200');
  const mkt1Db = db.prepare('SELECT COUNT(*) AS c FROM commission_entries WHERE recipient_user_id=?').get(mkt1Id).c;
  assert(mkt1.data.pagination.total === mkt1Db, 'marketer saw another recipient commission');
  const otherEntry = db.prepare('SELECT id FROM commission_entries WHERE recipient_user_id=? LIMIT 1').get(mkt2Id);
  if (otherEntry) {
    const otherRead = await request(`/api/commissions/${otherEntry.id}`, { headers: { Cookie: mkt1Cookie } });
    assert(otherRead.status === 404, 'marketer read another marketer commission');
  }
  if (!db.prepare('SELECT id FROM commission_entries WHERE recipient_user_id=? LIMIT 1').get(tl1Id)) {
    const plan = db.prepare('SELECT id FROM commission_plans ORDER BY id LIMIT 1').get();
    const rule = db.prepare('SELECT id FROM commission_plan_rules WHERE plan_id=? ORDER BY id LIMIT 1').get(plan.id);
    db.prepare(`INSERT INTO commission_entries (commission_ref, plan_id, rule_id, client_id, recipient_user_id,
      recipient_role, branch_id, team_id, marketer_id, team_lead_id, source_type, source_key, basis,
      qualifying_amount_kobo, rate_bps, commission_kobo, status, approval_required, created_by)
      VALUES ('AUDIT-TL-OWN', ?, ?, ?, ?, 'Team Lead', 1, ?, ?, ?, 'fixed', 'audit:tl:own', 'fixed', 10000, 0, 100, 'Calculated', 0, ?)`).run(
      plan.id, rule.id, adaId, tl1Id, teamAlphaId, mkt1Id, tl1Id, mdId);
  }
  const tl1 = await request('/api/commissions?limit=100', { headers: { Cookie: tl1Cookie } });
  assert(tl1.status === 200 && Object.keys(tl1.data.entries[0] || {}).sort().join(',') === ownKeys.sort().join(','), 'team lead own commission shape incorrect');
  const bm1 = await request('/api/commissions?limit=100', { headers: { Cookie: bm1Cookie } });
  assert(bm1.status === 200, 'branch manager own commission should be visible');
  const fin = await request('/api/commissions?limit=100', { headers: { Cookie: finCookie } });
  assert(fin.status === 200 && fin.data.entries.length > 0, 'explicitly granted finance should see all commissions');
  assert('rate_bps' in fin.data.entries[0] && 'plan_name' in fin.data.entries[0], 'full-access response is missing rate/plan fields');
  const branches = [...new Set(fin.data.entries.map(e => e.branch_id))];
  assert(branches.length >= 1, 'full-access user should see all branch entries');
  const careRoleId = db.prepare("SELECT id FROM roles WHERE name='Customer Care'").get().id;
  const careId = upsertUser('care.commission.p7@bliss.com', 'Care P7', careRoleId, 1);
  const careCookie = await login('care.commission.p7@bliss.com');
  const careCommission = await request('/api/commissions', { headers: { Cookie: careCookie } });
  assert(careCommission.status === 403, 'customer care must see no commission data');
  const client = await request('/api/commissions', { headers: { Cookie: adaCookie } });
  assert(client.status === 403, 'client commission access expected 403');
  const crossRead = await request(`/api/commissions/${fin.data.entries[0].id}`, { headers: { Cookie: bm2Cookie } });
  assert(crossRead.status === 404, 'own-only branch manager must not read another recipient commission');
});

await test('dashboards show own commission amounts without rates and full data for permitted users', async () => {
  const mkt = await request('/api/dashboard', { headers: { Cookie: mkt1Cookie } });
  assert(mkt.status === 200 && mkt.data.commission_summary.total_count > 0, 'marketer own commission summary missing');
  assert(!('rate_bps' in (mkt.data.recent_commissions[0] || {})), 'marketer dashboard leaked rate fields');
  assert('expected_kobo' in mkt.data.commission_summary, 'marketer dashboard summary missing expected amount');
  const tl = await request('/api/dashboard', { headers: { Cookie: tl1Cookie } });
  assert(tl.data.commission_summary.total_count > 0 && !('rate_bps' in (tl.data.recent_commissions[0] || {})), 'team lead own commission dashboard incorrect');
  const bm = await request('/api/dashboard', { headers: { Cookie: bm1Cookie } });
  assert(bm.data.commission_summary && !('gross_earned_kobo' in bm.data.commission_summary), 'branch manager dashboard should be own-amount shape');
  const finance = await request('/api/dashboard', { headers: { Cookie: finCookie } });
  assert(finance.data.commission_summary.gross_earned_kobo > 0, 'granted finance full commission summary missing');
});

await test('MD analytics include commission liabilities, category sales and refund summaries', async () => {
  const res = await request('/api/analytics/performance', { headers: { Cookie: mdCookie } });
  assert(res.status === 200, 'management analytics expected 200');
  assert(res.data.summary.commissions, 'commission analytics missing');
  assert(res.data.summary.commissions.earned_kobo > 0, 'commission earned missing');
  assert(res.data.summary.commissions.paid_kobo > 0, 'commission paid missing');
  assert(res.data.summary.commissions.outstanding_kobo >= 0, 'commission outstanding invalid');
  assert(Array.isArray(res.data.property_category_sales) && res.data.property_category_sales.length > 0, 'category sales analytics missing');
  assert(Array.isArray(res.data.refund_summary), 'refund summary missing');
  assert(res.data.summary.financials.contract_sales_value_kobo === 2600000000, `company contract value expected 26,000,000, got ${res.data.summary.financials.contract_sales_value_kobo}`);
  assert(res.data.summary.financials.verified_payments_kobo === 900000000, `verified collections expected 9,000,000 after reversal, got ${res.data.summary.financials.verified_payments_kobo}`);

  const filtered = await request('/api/analytics/performance?property_category_id=1', { headers: { Cookie: mdCookie } });
  assert(filtered.status === 200, 'category-filtered analytics expected 200');
  assert(filtered.data.summary.financials.contract_sales_value_kobo === 1800000000, 'category-filtered contract value should be 18,000,000');
  assert(filtered.data.summary.financials.verified_payments_kobo === 700000000, 'category-filtered verified collections should be 7,000,000');
});

console.log('\n--- 6. Financial reports ---');
await test('CSV and PDF commission reports are generated, permission-scoped and stored privately in R2', async () => {
  const csv = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { report_type: 'commission', format: 'csv' }
  });
  assert(csv.status === 200, `CSV report expected 200, got ${csv.status}: ${JSON.stringify(csv.data)}`);
  assert(csv.data.report_ref && csv.data.r2_key.startsWith('reports/'), 'CSV report ref/R2 key missing');
  const csvJob = db.prepare('SELECT * FROM financial_report_jobs WHERE report_ref=?').get(csv.data.report_ref);
  assert(csvJob && csvJob.requested_by === mdId, 'CSV report job not stored');
  const csvDownload = await request(`/api/reports/${csvJob.id}/download`, { headers: { Cookie: mdCookie } });
  assert(csvDownload.status === 200 && csvDownload.headers.get('content-type').includes('csv'), 'CSV download failed');
  const csvText = Buffer.from(csvDownload.data).toString('utf8');
  assert(csvText.includes('Commission Ref') && csvText.includes('Recipient'), 'CSV report columns missing');
  const publicCsv = await request(`/api/files/${encodeURIComponent(csv.data.r2_key)}`);
  assert(publicCsv.status === 404, 'CSV report must not be publicly accessible');

  const pdf = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { report_type: 'commission_liability', format: 'pdf' }
  });
  assert(pdf.status === 200, `PDF report expected 200, got ${pdf.status}`);
  const pdfJob = db.prepare('SELECT * FROM financial_report_jobs WHERE report_ref=?').get(pdf.data.report_ref);
  const pdfDownload = await request(`/api/reports/${pdfJob.id}/download`, { headers: { Cookie: mdCookie } });
  assert(pdfDownload.status === 200, 'PDF download failed');
  const text = pdfText(pdfDownload.data);
  assert(text.startsWith('%PDF-1.4') && text.includes('Commission Liability Report') && text.includes('/DCTDecode'), 'PDF report content/logo invalid');
  const publicPdf = await request(`/api/files/${encodeURIComponent(pdf.data.r2_key)}`);
  assert(publicPdf.status === 404, 'PDF report must not be publicly accessible');
});

await test('report permissions and date filters are enforced', async () => {
  const bmReport = await request('/api/reports', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: { report_type: 'sales', format: 'csv' }
  });
  assert(bmReport.status === 200, 'BM sales report expected 200');
  const bmJob = db.prepare('SELECT * FROM financial_report_jobs WHERE report_ref=?').get(bmReport.data.report_ref);
  const bmDownload = await request(`/api/reports/${bmJob.id}/download`, { headers: { Cookie: bm1Cookie } });
  const bmText = Buffer.from(bmDownload.data).toString('utf8');
  assert(bmText.includes('Ada Nwosu'), 'BM report should include own branch client');
  assert(!bmText.includes('Cross Branch Client'), 'BM report leaked another branch client');
  const tlBranch = await request('/api/reports', {
    method: 'POST', headers: { Cookie: tl1Cookie }, body: { report_type: 'branch_performance', format: 'csv' }
  });
  assert(tlBranch.status === 403, 'Team Lead branch report expected 403');
  const marketerSales = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { report_type: 'sales', format: 'csv' }
  });
  assert(marketerSales.status === 403, 'marketer sales export expected 403');
  const marketerCommission = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { report_type: 'commission', format: 'csv' }
  });
  assert(marketerCommission.status === 403, 'staff commission export must be denied');
  const empty = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { report_type: 'sales', format: 'csv', from: '2020-01-01', to: '2020-12-31' }
  });
  assert(empty.status === 200, 'empty-range report expected 200');
  const emptyJob = db.prepare('SELECT * FROM financial_report_jobs WHERE report_ref=?').get(empty.data.report_ref);
  const emptyDownload = await request(`/api/reports/${emptyJob.id}/download`, { headers: { Cookie: mdCookie } });
  const emptyText = Buffer.from(emptyDownload.data).toString('utf8');
  assert(!emptyText.includes('Ada Nwosu'), 'empty-range report should not include current clients');

  const mdJob = db.prepare('SELECT id FROM financial_report_jobs WHERE requested_by=? ORDER BY id DESC LIMIT 1').get(mdId);
  const bmDownloadMd = await request(`/api/reports/${mdJob.id}/download`, { headers: { Cookie: bm1Cookie } });
  assert(bmDownloadMd.status === 403, 'BM must not download another creator report');
  const marketerDownloadMd = await request(`/api/reports/${mdJob.id}/download`, { headers: { Cookie: mkt1Cookie } });
  assert(marketerDownloadMd.status === 403, 'marketer must not download management report');
  const guessed = await request('/api/files/reports/RPT-GUESSED-KEY.pdf');
  assert(guessed.status === 404, 'guessed report R2 key must not be public');
});

await test('cross-branch reassignment revokes property access from the previous branch manager', async () => {
  const before = await request(`/api/clients/${crossId}`, { headers: { Cookie: bm2Cookie } });
  assert(before.status === 200, 'Ajah manager should initially see the Ajah client');
  const transfer = await request(`/api/clients/${crossId}/assign`, {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { relationship_manager_id: mkt1Id, branch_id: 1, team_lead_id: tl1Id, reason: 'Phase 7.1 cross-branch visibility audit' }
  });
  assert(transfer.status === 200, `cross-branch transfer expected 200, got ${transfer.status}: ${JSON.stringify(transfer.data)}`);
  const previousBm = await request(`/api/clients/${crossId}`, { headers: { Cookie: bm2Cookie } });
  assert(previousBm.status === 403, 'previous cross-branch manager must lose client properties');
  const previousBmList = await request('/api/clients?limit=50', { headers: { Cookie: bm2Cookie } });
  assert(!previousBmList.data.clients.some(c => Number(c.id) === crossId), 'previous branch manager still sees the transferred client');
  const newBm = await request(`/api/clients/${crossId}`, { headers: { Cookie: bm1Cookie } });
  assert(newBm.status === 200 && newBm.data.properties.length === 1, 'new branch manager must see the transferred client property');
  const newMarketer = await request(`/api/clients/${crossId}`, { headers: { Cookie: mkt1Cookie } });
  assert(newMarketer.status === 200 && newMarketer.data.financials.outstanding_balance_kobo === 600000000, 'new marketer must see the transferred client financials');
});

console.log('\n--- 7. Security and Phase 1–6 regression ---');
await test('commission endpoints reject unauthenticated and unauthorized roles', async () => {
  for (const path of ['/api/commission-plans', '/api/commissions', '/api/reports']) {
    const res = await request(path);
    assert([401, 403].includes(res.status), `${path} unauthenticated expected 401/403`);
  }
  const marketerGenerate = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { plan_id: contractPlanId }
  });
  assert(marketerGenerate.status === 403, 'marketer commission generation expected 403');
  const bmGenerate = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: { plan_id: contractPlanId }
  });
  assert(bmGenerate.status === 403, 'BM commission generation expected 403');
  for (const cookie of [tl1Cookie, bm1Cookie, mkt1Cookie]) {
    const approve = await request(`/api/commissions/${approvedEntryId}/approve`, {
      method: 'POST', headers: { Cookie: cookie }, body: {}
    });
    assert(approve.status === 403, 'non-finance role cannot approve commission');
    const pay = await request(`/api/commissions/${approvedEntryId}/payments`, {
      method: 'POST', headers: { Cookie: cookie }, body: { amount: 1, method: 'Bank Transfer' }
    });
    assert(pay.status === 403, 'non-finance role cannot pay commission');
  }
  for (const path of ['/api/commission-plans', '/api/reports']) {
    const res = await request(path, { headers: { Cookie: adaCookie } });
    assert(res.status === 403, `client must not access ${path}`);
  }
});

await test('Phase 1–6 regression remains intact', async () => {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, 'health regression');
  const props = await request('/api/properties?limit=50');
  assert(props.status === 200 && props.data.properties.some(p => p.reference === 'BLP-P7-IKEJA'), 'public properties regression');
  const clientDash = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(clientDash.status === 200 && clientDash.data.financials.agreed_price_ngn === 15000000, 'client portal regression');
  const finance = await request('/api/finance/overview', { headers: { Cookie: finCookie } });
  assert(finance.status === 200 && finance.data.summary.total_verified_kobo === 900000000, 'finance overview regression');
  const phase6 = await request('/api/analytics/performance', { headers: { Cookie: mdCookie } });
  assert(phase6.status === 200 && phase6.data.summary && phase6.data.trends, 'Phase 6 analytics regression');
  const demoFinance = await request('/api/finance/overview?demo=1', { headers: { Cookie: finCookie } });
  assert(demoFinance.status === 200 && demoFinance.data.summary.total_verified_kobo === 300000000, 'demo finance separation regression');
  const setup = await request('/api/setup', { method: 'POST', headers: { 'X-Setup-Secret': 'x' }, body: { email: 'x@x.com', password: 'password123', full_name: 'X' } });
  assert([403, 409].includes(setup.status), 'setup lock regression');
});

console.log('\n--- 8. Signup security, refund reconciliation and branding ---');
await test('refunded payments create commission adjustments and commission liability reconciles', async () => {
  const musaPayment = db.prepare("SELECT id FROM payments WHERE transaction_ref='TX-P7-MUSA-01'").get();
  assert(musaPayment, 'Musa verified payment missing');
  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: finCookie }, body: { plan_id: collectionPlanId, client_id: musaId }
  });
  assert(generated.status === 200 && generated.data.created === 1, 'Musa collection commission should generate one entry');
  const entry = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND payment_id=?").get(collectionPlanId, musaPayment.id);
  assert(entry, 'Musa commission entry missing');
  const originalAmount = entry.commission_kobo;
  const refund = await request(`/api/finance/payments/${musaPayment.id}/adjust`, {
    method: 'POST', headers: { Cookie: finCookie }, body: { adjustment_type: 'refund', reason: 'Phase 7 refund audit' }
  });
  assert(refund.status === 200, `refund expected 200, got ${refund.status}`);
  const adjusted = db.prepare("SELECT * FROM commission_entries WHERE id=?").get(entry.id);
  assert(adjusted.commission_kobo === originalAmount, 'refund overwrote original commission');
  assert(adjusted.adjusted_kobo === -originalAmount && adjusted.status === 'Reversed', 'refund commission adjustment incorrect');
  const adjustment = db.prepare("SELECT * FROM commission_adjustments WHERE entry_id=? AND adjustment_type='refund'").get(entry.id);
  assert(adjustment && adjustment.amount_kobo === -originalAmount, 'refund commission adjustment row missing');

  const ledger = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('Calculated','Pending Approval','Approved','Partially Paid','Paid','Reversed') THEN MAX(0,commission_kobo+adjusted_kobo) ELSE 0 END),0) AS earned,
      COALESCE(SUM(CASE WHEN status IN ('Approved','Partially Paid','Paid') THEN MAX(0,commission_kobo+adjusted_kobo) ELSE 0 END),0) AS approved,
      COALESCE(SUM(paid_kobo),0) AS paid,
      COALESCE(SUM(CASE WHEN status IN ('Approved','Partially Paid','Paid','Reversed') THEN MAX(0,commission_kobo+adjusted_kobo-paid_kobo) ELSE 0 END),0) AS outstanding
    FROM commission_entries
  `).get();
  for (const cookie of [mdCookie, finCookie]) {
    const summary = await request('/api/commissions?limit=1', { headers: { Cookie: cookie } });
    assert(summary.status === 200, 'commission summary expected 200');
    assert(summary.data.summary.earned_kobo === Number(ledger.earned), 'commission earned does not reconcile');
    assert(summary.data.summary.approved_kobo === Number(ledger.approved), 'commission approved does not reconcile');
    assert(summary.data.summary.paid_kobo === Number(ledger.paid), 'commission paid does not reconcile');
    assert(summary.data.summary.outstanding_kobo === Number(ledger.outstanding), 'commission liability does not reconcile');
  }
});

await test('public client sign-up creates a client portal account and auto-login session', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'New Portal Client', email: 'new.portal@example.com', phone_number: '08079990001',
      residential_address: '1 Signup Test Street', state: 'Lagos', city: 'Ikeja',
      password: 'password123', branch_id: 1, terms_accepted: true
    }
  });
  assert(signup.status === 200, `sign-up expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  assert(signup.data.client_reference && signup.data.user.role === 'Client', 'sign-up did not return a client account');
  const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
  assert(cookie, 'sign-up did not auto-login the client');
  const me = await request('/api/me', { headers: { Cookie: cookie } });
  assert(me.status === 200 && me.data.role === 'Client' && me.data.client.client_reference === signup.data.client_reference, 'sign-up session/client link invalid');
  const dashboard = await request('/api/client/dashboard', { headers: { Cookie: cookie } });
  assert(dashboard.status === 200 && dashboard.data.client.client_reference === signup.data.client_reference, 'new client dashboard failed');
  const clientRow = db.prepare('SELECT * FROM clients WHERE client_reference=?').get(signup.data.client_reference);
  assert(clientRow && clientRow.user_id === signup.data.user.id, 'sign-up client/user link missing');
  assert(clientRow.agreed_purchase_price === null, 'public sign-up must not set a contract price');
  const duplicateEmail = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'Duplicate Email', email: 'new.portal@example.com', phone_number: '08079990002',
      residential_address: '2 Signup Test Street', password: 'password123', branch_id: 1, terms_accepted: true
    }
  });
  assert(duplicateEmail.status === 409, 'duplicate sign-up email expected 409');
  const duplicatePhone = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'Duplicate Phone', email: 'new.portal2@example.com', phone_number: '08079990001',
      residential_address: '3 Signup Test Street', password: 'password123', branch_id: 1, terms_accepted: true
    }
  });
  assert(duplicatePhone.status === 409, 'duplicate sign-up phone expected 409');
  const weak = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'Weak Password', email: 'new.portal3@example.com', phone_number: '08079990003',
      residential_address: '4 Signup Test Street', password: 'short', branch_id: 1, terms_accepted: true
    }
  });
  assert(weak.status === 400, 'weak sign-up password expected 400');
});

await test('public sign-up ignores privileged role/marketer/team/price and assigned-branch fields and isolates the client', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'Privilege Injection Test', email: 'inject.portal@example.com', phone_number: '08079990100',
      residential_address: '5 Signup Test Street', state: 'Lagos', city: 'Ikeja',
      password: 'password123', role_name: 'Managing Director', role_id: 1,
      branch_id: db.prepare("SELECT id FROM branches WHERE name='Head Office'").get().id,
      assigned_branch_id: 2, original_marketer_id: mkt1Id, team_lead_id: tl1Id,
      agreed_purchase_price: 5000000, status: 'Completed', terms_accepted: true
    }
  });
  assert(signup.status === 200, `sign-up injection test expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  const headOffice = db.prepare("SELECT id FROM branches WHERE name='Head Office'").get();
  const user = db.prepare(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=?`).get('inject.portal@example.com');
  const client = db.prepare('SELECT * FROM clients WHERE user_id=?').get(user.id);
  assert(user && user.role_name === 'Client', 'sign-up must always create a Client role');
  assert(user.password_hash.startsWith('pbkdf2$100000$'), 'sign-up password was not PBKDF2-hashed');
  assert(user.password_hash !== 'password123', 'sign-up stored a plaintext password');
  assert(client.assigned_branch_id === headOffice.id, 'client must not self-assign assigned_branch_id directly');
  assert(client.original_marketer_id === mdId, 'client must not self-assign a marketer');
  assert(client.team_lead_id === null, 'client must not self-assign a team lead');
  assert(client.agreed_purchase_price === null, 'client must not set a contract price');
  assert(client.status === 'Prospect', 'public sign-up must create a Prospect record');
  const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
  const own = await request('/api/client/dashboard', { headers: { Cookie: cookie } });
  assert(own.status === 200 && own.data.client.client_reference === signup.data.client_reference, 'new client cannot access own portal');
  const other = await request(`/api/clients/${adaId}`, { headers: { Cookie: cookie } });
  assert(other.status === 403, 'new client accessed another client record');
  const receipts = await request('/api/client/receipts', { headers: { Cookie: cookie } });
  assert(receipts.status === 200 && receipts.data.receipts.length === 0, 'new client saw another client receipt');
  for (const path of ['/api/staff', '/api/finance/overview', '/api/commissions', '/api/reports', '/api/commission-plans', '/api/leads', '/api/activity']) {
    const res = await request(path, { headers: { Cookie: cookie } });
    assert(res.status === 403, `client must not access ${path}`);
  }
});

await test('client sign-up session cookie, login, logout and expiry are enforced', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', body: {
      full_name: 'Session Test Client', email: 'session.portal@example.com', phone_number: '08079990101',
      residential_address: '6 Signup Test Street', password: 'password123', branch_id: 1, terms_accepted: true
    }
  });
  assert(signup.status === 200, 'session test sign-up expected 200');
  const setCookie = signup.headers.get('set-cookie') || '';
  assert(setCookie.includes('HttpOnly') && setCookie.includes('Secure') && setCookie.includes('SameSite=Lax'), 'sign-up cookie flags incorrect');
  const cookie = setCookie.split(';')[0];
  assert((await request('/api/me', { headers: { Cookie: cookie } })).status === 200, 'sign-up session invalid');
  const logout = await request('/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert(logout.status === 200, 'client logout failed');
  assert((await request('/api/me', { headers: { Cookie: cookie } })).status === 401, 'logged-out session still valid');

  const login = await request('/api/login', { method: 'POST', body: { email: 'session.portal@example.com', password: 'password123' } });
  assert(login.status === 200, 'new client login failed');
  const freshCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const badLogin = await request('/api/login', { method: 'POST', body: { email: 'session.portal@example.com', password: 'wrongpassword' } });
  assert(badLogin.status === 401, 'wrong client password expected 401');
  const sid = freshCookie.split('=')[1];
  db.prepare("UPDATE sessions SET expires_at=datetime('now','-1 hour') WHERE id=?").run(sid);
  assert((await request('/api/me', { headers: { Cookie: freshCookie } })).status === 401, 'expired client session still valid');
});

await test('official logo is used across pages, login screens and receipt assets', async () => {
  const rootLogo = readFileSync('bliss-legacy-logo.png');
  const assetLogo = readFileSync('assets/images/bliss-legacy-logo.png');
  assert(rootLogo.equals(assetLogo), 'assets logo must match the official root logo');
  const jpg = readFileSync('assets/images/bliss-legacy-logo.jpg');
  assert(jpg.length > 10000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'official JPEG logo for PDFs is missing/invalid');
  const pages = readdirSync('.').filter(f => f.endsWith('.html'));
  for (const page of pages) {
    const text = readFileSync(page, 'utf8');
    const injectsLogo = text.includes('bliss-legacy-logo') || text.includes('assets/js/staff-shell.js') || text.includes('assets/js/components.js');
    assert(injectsLogo, `${page} does not include the official logo or shared logo shell`);
  }
  const ignore = readFileSync('.assetsignore', 'utf8');
  assert(ignore.includes('/bliss-legacy-logo.png'), '.assetsignore must exclude only the root logo, not assets/images/logo');
  assert(!/^bliss-legacy-logo\.png$/m.test(ignore), '.assetsignore must not exclude the served assets logo');
  assert(readFileSync('client-login.html', 'utf8').includes('signup.html'), 'client login missing sign-up link');
  assert(readFileSync('login.html', 'utf8').includes('signup.html'), 'staff portal login missing sign-up link');
  assert(readFileSync('signup.html', 'utf8').includes('assets/images/bliss-legacy-logo.png'), 'sign-up page missing official logo');
  assert(readFileSync('src/index.js', 'utf8').includes('assets/images/bliss-legacy-logo.jpg'), 'receipt/report PDFs must use official logo asset');
});

console.log('\n========================================================');
console.log(`   RESULT: ${passed} PASSED | ${failed} FAILED`);
if (failures.length) for (const f of failures) console.log(`   - ${f.name}: ${f.error}`);
console.log('========================================================\n');
db.close();
process.exit(failed ? 1 : 0);
