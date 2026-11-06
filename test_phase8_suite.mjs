import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes, createHmac } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import worker from './src/index.js';
import { resolveLiveDb } from './test_db_paths.mjs';

const LIVE_DB = resolveLiveDb();
const TEST_DB = join(dirname(LIVE_DB), 'phase8-test.sqlite');

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
function roleId(name) { return db.prepare('SELECT id FROM roles WHERE name=?').get(name).id; }
function branchId(name) { return db.prepare('SELECT id FROM branches WHERE name=?').get(name).id; }
function upsertUser(email, fullName, roleName, branch) {
  db.prepare(`INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, full_name=excluded.full_name,
      role_id=excluded.role_id, branch_id=excluded.branch_id, is_active=1`)
    .run(email, hashPw('password123'), fullName, roleId(roleName), branch);
  return db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
}

const headOffice = branchId('Head Office');
const ikeja = branchId('Ikeja');
const ajah = branchId('Ajah');

db.exec(`
  DELETE FROM terms_acceptances;
  DELETE FROM terms_versions;
  DELETE FROM commission_adjustments;
  DELETE FROM commission_payments;
  DELETE FROM commission_approvals;
  DELETE FROM commission_attributions;
  DELETE FROM commission_generation_failures;
  DELETE FROM commission_entries;
  DELETE FROM commission_plan_rules;
  DELETE FROM commission_plans;
  DELETE FROM sms_messages;
  DELETE FROM sms_optouts;
  DELETE FROM client_verification_otps;
  DELETE FROM client_static_wallets;
  DELETE FROM client_care_calls;
  DELETE FROM client_care_records;
  DELETE FROM property_payment_plans;
  DELETE FROM lead_temperature_history;
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

db.prepare("INSERT INTO terms_versions (version_no, title, body_text, is_active) VALUES (1, 'Terms and Conditions', 'Phase 8 test terms and conditions', 1)").run();

const mdId = upsertUser('md.p8@bliss.com', 'Phase 8 MD', 'Managing Director', null);
const bm1Id = upsertUser('bm.ikeja.p8@bliss.com', 'Phase 8 Ikeja BM', 'Branch Manager', ikeja);
const bm2Id = upsertUser('bm.ajah.p8@bliss.com', 'Phase 8 Ajah BM', 'Branch Manager', ajah);
const tlId = upsertUser('tl.ikeja.p8@bliss.com', 'Phase 8 Ikeja TL', 'Team Lead', ikeja);
const mkt1Id = upsertUser('mkt1.p8@bliss.com', 'Phase 8 Marketer One', 'Marketer', ikeja);
const mkt2Id = upsertUser('mkt2.p8@bliss.com', 'Phase 8 Marketer Two', 'Marketer', ikeja);
const mkt3Id = upsertUser('mkt3.p8@bliss.com', 'Phase 8 Ajah Marketer', 'Marketer', ajah);
const finId = upsertUser('fin.p8@bliss.com', 'Phase 8 Finance', 'Finance Officer', headOffice);
const clientUserId = upsertUser('client.p8@example.com', 'Phase 8 Client', 'Client', ikeja);
const saId = upsertUser('sa.p8@bliss.com', 'Phase 8 Super Admin', 'Super Admin', headOffice);
const pmId = upsertUser('pm.ikeja.p8@bliss.com', 'Phase 8 Project Manager', 'Project Manager', ikeja);
const haId = upsertUser('ha.p8@bliss.com', 'Phase 8 Head Accountant', 'Head Accountant', headOffice);
const mktNoTeamId = upsertUser('mkt.noteam.p8@bliss.com', 'Phase 8 Ikeja Direct Marketer', 'Marketer', ikeja);
const careBranchId = upsertUser('care.branch.p8@bliss.com', 'Phase 13 Branch Care', 'Customer Care', ikeja);
const careNationalId = upsertUser('care.national.p8@bliss.com', 'Phase 13 National Care', 'Customer Care', null);
db.prepare("UPDATE users SET care_scope='branch' WHERE id=?").run(careBranchId);
db.prepare("UPDATE users SET care_scope='national' WHERE id=?").run(careNationalId);
db.prepare("UPDATE users SET referral_code='BL-P8-MD' WHERE id=?").run(mdId);
db.prepare("UPDATE users SET referral_code='BL-P8-MKT' WHERE id=?").run(mkt1Id);

const categoryId = Number(db.prepare("INSERT INTO property_categories (name) VALUES ('Phase 8 Category')").run().lastInsertRowid);
const propPublished = Number(db.prepare(`INSERT INTO properties (reference,title,description,category_id,sale_price,state,city,address,branch_id,status,is_published,created_by)
  VALUES ('BLP-P8-PUB','Phase 8 Published Property','Audit property',?,20000000,'Lagos','Ikeja','8 Audit Road',?,'Available',1,?)`).run(categoryId, ikeja, mdId).lastInsertRowid);
const propDraft = Number(db.prepare(`INSERT INTO properties (reference,title,description,category_id,sale_price,state,city,address,branch_id,status,is_published,created_by)
  VALUES ('BLP-P8-DRAFT','Phase 8 Draft Property','Audit property',?,15000000,'Lagos','Ikeja','8 Draft Road',?,'Available',0,?)`).run(categoryId, ikeja, mdId).lastInsertRowid);

const adaId = Number(db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
  assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id, user_id)
  VALUES ('BLC-P8-ADA','Phase 8 Client','08088000001','client.p8@example.com','Active Buyer','New Sale',?,?,?,?,20000000,?,?)`)
  .run(ikeja, mkt1Id, mkt1Id, tlId, propPublished, clientUserId).lastInsertRowid);
db.prepare("INSERT INTO client_properties (client_id, property_id, agreed_purchase_price, status) VALUES (?,?,?, 'Active')").run(adaId, propPublished, 20000000);
db.prepare("INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary) VALUES (?,?,?,?,?,1)")
  .run(adaId, mkt1Id, ikeja, tlId, bm1Id);
db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
  assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id)
  VALUES ('BLC-P8-OTHER','Other Phase 8 Client','08088000002','other.p8@example.com','Active Buyer','New Sale',?,?,?,?,10000000,?)`)
  .run(ikeja, mkt2Id, mkt2Id, tlId, propPublished);
const teamIkejaId = Number(db.prepare("INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES (?,?,?,1)")
  .run('Phase 8 Ikeja Team', ikeja, tlId).lastInsertRowid);
for (const userId of [tlId, mkt1Id, mkt2Id]) {
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?,?)").run(teamIkejaId, userId);
}
db.prepare("UPDATE users SET manager_id=? WHERE id IN (?,?,?)").run(mdId, bm1Id, bm2Id, pmId);
db.prepare("UPDATE users SET manager_id=? WHERE id=?").run(bm1Id, tlId);
db.prepare("UPDATE users SET manager_id=? WHERE id IN (?,?,?)").run(tlId, mkt1Id, mkt2Id, mktNoTeamId);
db.prepare("UPDATE users SET manager_id=? WHERE id=?").run(bm1Id, mktNoTeamId);
db.prepare("UPDATE users SET manager_id=? WHERE id=?").run(bm2Id, mkt3Id);
db.prepare("UPDATE users SET manager_id=? WHERE id=?").run(mdId, haId);

const ajahClientId = Number(db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
  assigned_branch_id, created_by, original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id)
  VALUES ('BLC-P8-AJAH','Ajah Revenue Client','08088000401','ajah.p8@example.com','Active Buyer','New Sale',?,?,?,NULL,8000000,?)`)
  .run(ajah, mkt3Id, mkt3Id, propPublished).lastInsertRowid);

function insertRevenuePayment(clientId, ref, amountKobo, attribution) {
  db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo,
     verified_at, revenue_staff_id, revenue_team_lead_id, revenue_pm_id, revenue_branch_id, revenue_attributed_at)
    VALUES (?, ?, ?, ?, 'NGN', 'Bank Transfer', 'verified', ?, 0, datetime('now'), ?, ?, ?, ?, datetime('now'))`)
    .run(clientId, propPublished, ref, amountKobo / 100, amountKobo,
      attribution.staffId, attribution.teamLeadId || null, attribution.pmId || null, attribution.branchId);
}
insertRevenuePayment(adaId, 'TX-P8-REV-ADA', 100000000, { staffId: mkt1Id, teamLeadId: tlId, pmId: bm1Id, branchId: ikeja });
insertRevenuePayment(adaId, 'TX-P8-REV-OTHER', 200000000, { staffId: mkt2Id, teamLeadId: tlId, pmId: bm1Id, branchId: ikeja });
insertRevenuePayment(ajahClientId, 'TX-P8-REV-AJAH', 300000000, { staffId: mkt3Id, teamLeadId: null, pmId: bm2Id, branchId: ajah });
db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo,
  verified_at, revenue_staff_id, revenue_team_lead_id, revenue_pm_id, revenue_branch_id, revenue_attributed_at)
  VALUES (?, ?, 'TX-P8-REV-DIRECT', 5000000, 'NGN', 'Bank Transfer', 'verified', 500000000, 0, datetime('now'), ?, NULL, ?, ?, datetime('now'))`)
  .run(adaId, propPublished, mktNoTeamId, bm1Id, ikeja);

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
          body: item.bytes,
          writeHttpMetadata(headers) { headers.set('Content-Type', item.contentType); },
          async arrayBuffer() { return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength); }
        };
      },
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
async function login(email, password = 'password123', extraHeaders = {}) {
  const res = await request('/api/login', { method: 'POST', headers: extraHeaders, body: { email, password } });
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

console.log('\n========================================================');
console.log('   BLISS LEGACY — PHASE 8 INTEGRATION & SECURITY SUITE');
console.log('========================================================\n');

const mdCookie = await login('md.p8@bliss.com');
const bm1Cookie = await login('bm.ikeja.p8@bliss.com');
const bm2Cookie = await login('bm.ajah.p8@bliss.com');
const tlCookie = await login('tl.ikeja.p8@bliss.com');
const mkt1Cookie = await login('mkt1.p8@bliss.com');
const mkt2Cookie = await login('mkt2.p8@bliss.com');
const mkt3Cookie = await login('mkt3.p8@bliss.com');
const finCookie = await login('fin.p8@bliss.com');
const saCookie = await login('sa.p8@bliss.com');
const pmCookie = await login('pm.ikeja.p8@bliss.com');
const haCookie = await login('ha.p8@bliss.com');
const mktNoTeamCookie = await login('mkt.noteam.p8@bliss.com');
const careBranchCookie = await login('care.branch.p8@bliss.com');
const careNationalCookie = await login('care.national.p8@bliss.com');
const clientCookie = await login('client.p8@example.com');

console.log('--- 1. Authentication, sessions and CSRF ---');
await test('login cookies are HttpOnly/Secure/SameSite and session fixation is prevented', async () => {
  const first = await request('/api/login', { method: 'POST', body: { email: 'md.p8@bliss.com', password: 'password123' } });
  const setCookie = first.headers.get('set-cookie') || '';
  assert(first.status === 200, 'login expected 200');
  assert(/HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), 'cookie flags incorrect');
  const oldCookie = setCookie.split(';')[0];
  const second = await request('/api/login', { method: 'POST', headers: { Cookie: oldCookie }, body: { email: 'md.p8@bliss.com', password: 'password123' } });
  assert(second.status === 200, 'second login expected 200');
  const oldMe = await request('/api/me', { headers: { Cookie: oldCookie } });
  assert(oldMe.status === 401, 'pre-login session must be invalidated');
});

await test('cross-site state-changing requests are rejected by fetch metadata and origin checks', async () => {
  const fetchSite = await request('/api/clients', {
    method: 'POST', headers: { Cookie: bm1Cookie, 'Sec-Fetch-Site': 'cross-site' },
    body: { full_name: 'CSRF Blocked', phone_number: '08088000999' }
  });
  assert(fetchSite.status === 403, `cross-site fetch expected 403, got ${fetchSite.status}`);
  const origin = await request('/api/clients', {
    method: 'POST', headers: { Cookie: bm1Cookie, Origin: 'https://evil.example' },
    body: { full_name: 'Origin Blocked', phone_number: '08088000998' }
  });
  assert(origin.status === 403, `cross-origin request expected 403, got ${origin.status}`);
});

await test('malformed JSON returns a controlled 400 instead of an unhandled worker error', async () => {
  const res = await request('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert(res.status === 400 && res.data.error, 'malformed JSON must return a JSON 400');
});

console.log('\n--- 2. Public enquiry and signup protection ---');
await test('public enquiry creates a real lead with branch/property attribution', async () => {
  const res = await request('/api/public/enquiries', {
    method: 'POST', body: {
      full_name: 'Public Enquiry Person', phone_number: '08088000111', email_address: 'public.enquiry@example.com',
      message: 'I would like a site inspection.', branch_name: 'Ikeja', property_reference: 'BLP-P8-PUB',
      acquisition_mode: 'inspection', source: 'Phase 8 test'
    }
  });
  assert(res.status === 200 && res.data.reference, `public enquiry expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  const lead = db.prepare('SELECT * FROM leads WHERE lead_reference=?').get(res.data.reference);
  assert(lead && lead.status === 'New Lead' && lead.branch_id === ikeja, 'public enquiry lead attribution incorrect');
  assert(lead.property_id === propPublished, 'public enquiry property was not linked');
  assert(lead.assigned_marketer_id === null && lead.team_lead_id === null, 'public enquiry must not self-assign staff');
  assert(lead.notes.includes('I would like a site inspection.'), 'public enquiry message missing');
});

await test('public enquiry rejects invalid phone and rate limits repeated attempts', async () => {
  const invalid = await request('/api/public/enquiries', {
    method: 'POST', body: { full_name: 'Bad Phone', phone_number: 'abc', message: 'Hello' }
  });
  assert(invalid.status === 400, 'invalid enquiry phone expected 400');
  for (let i = 0; i < 10; i++) {
    db.prepare("INSERT INTO audit_logs (action, target_type, target_id, metadata) VALUES ('enquiry.attempt','enquiry',?, '{}')")
      .run('ip:203.0.113.77');
  }
  const limited = await request('/api/public/enquiries', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.77' },
    body: { full_name: 'Rate Limited', phone_number: '08088000112', message: 'Hello' }
  });
  assert(limited.status === 429, `rate limited enquiry expected 429, got ${limited.status}`);
});

await test('signup rate limiting blocks excessive registration attempts before hashing', async () => {
  for (let i = 0; i < 5; i++) {
    db.prepare("INSERT INTO audit_logs (action, target_type, target_id, metadata) VALUES ('signup.attempt','signup',?, '{}')")
      .run('ip:203.0.113.88');
  }
  const res = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.88' },
    body: { full_name: 'Rate Limited Signup', email: 'ratelimit.p8@example.com', phone_number: '08088000222', residential_address: '7 Signup Test Street', branch_id: ikeja, password: 'password123', terms_accepted: true }
  });
  assert(res.status === 429, `rate limited signup expected 429, got ${res.status}`);
});

await test('client onboarding stores alternate phone, next of kin and valid staff referral attribution', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.55' },
    body: {
      full_name: 'Referred Client', email: 'referred.p8@example.com', phone_number: '08088000331',
      residential_address: '8 Signup Test Street', state: 'Lagos', city: 'Ikeja', branch_id: ikeja,
      alternate_phone: '08088000332', next_of_kin_name: 'Next Kin', next_of_kin_phone: '08088000333',
      next_of_kin_relationship: 'Sibling', next_of_kin_address: '3 Next of Kin Street',
      referral_code: 'BL-P8-MD', password: 'password123', terms_accepted: true
    }
  });
  assert(signup.status === 200, `referred signup expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  const client = db.prepare('SELECT * FROM clients WHERE client_reference=?').get(signup.data.client_reference);
  assert(client, 'referred client record missing');
  assert(client.alternate_phone === '08088000332', 'alternate phone not stored');
  assert(client.next_of_kin_name === 'Next Kin' && client.next_of_kin_phone === '08088000333', 'next-of-kin details not stored');
  assert(client.next_of_kin_relationship === 'Sibling' && client.next_of_kin_address === '3 Next of Kin Street', 'next-of-kin relationship/address missing');
  assert(client.referral_code_used === 'BL-P8-MD' && client.referred_by_staff_id === mdId, 'staff referral attribution missing');
  assert(client.identity_type === null && client.bvn_last4 === null, 'identity and BVN must remain optional at signup');
  assert(signup.data.virtual_account && signup.data.virtual_account.status === 'bvn_required', 'signup without BVN should mark the virtual account as BVN-required');
  assert(client.assigned_branch_id === ikeja, 'signup should use the branch selected by the client');
  const referredAssignment = db.prepare("SELECT relationship_manager_id FROM client_assignments WHERE client_id=? AND is_primary=1").get(client.id);
  assert(referredAssignment && referredAssignment.relationship_manager_id === mdId, 'referred client was not automatically assigned to the referring staff member');
  const self = await request('/api/me', { headers: { Cookie: (signup.headers.get('set-cookie') || '').split(';')[0] } });
  assert(self.status === 200 && self.data.role === 'Client', 'referred client session invalid');
  const mdMe = await request('/api/me', { headers: { Cookie: mdCookie } });
  assert(mdMe.data.referral_code === 'BL-P8-MD', 'staff referral code missing from /api/me');
  assert(mdMe.data.referral_link && mdMe.data.referral_link.includes('ref=BL-P8-MD'), 'staff referral link missing');
});

await test('invalid referral codes are rejected and ALATPay never invents virtual accounts', async () => {
  const invalid = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.56' },
    body: {
      full_name: 'Invalid Referral', email: 'invalid-ref.p8@example.com', phone_number: '08088000334',
      residential_address: '9 Signup Test Street', branch_id: ikeja,
      referral_code: 'DOES-NOT-EXIST', password: 'password123', terms_accepted: true
    }
  });
  assert(invalid.status === 400, `invalid referral expected 400, got ${invalid.status}`);
  const clientCookie = (await request('/api/login', {
    method: 'POST', body: { email: 'referred.p8@example.com', password: 'password123' }
  })).headers.get('set-cookie').split(';')[0];
  const account = await request('/api/client/virtual-account', { headers: { Cookie: clientCookie } });
  assert(account.status === 200, 'virtual account status expected 200');
  assert(account.data.is_active === false && account.data.can_generate === false, 'ALATPay must not report a fake ready account');
  assert(!account.data.account_number, 'ALATPay virtual account number was invented');
  const create = await request('/api/client/virtual-account', {
    method: 'POST', headers: { Cookie: clientCookie }, body: { amount: 100 }
  });
  assert(create.status === 503, `ALATPay without business ID expected 503, got ${create.status}`);
  assert(!db.prepare("SELECT id FROM virtual_accounts WHERE account_status='active'").get(), 'no active virtual account should be created');
});

await test('signup captures address, branch, masked identity and dedicated-account readiness', async () => {
  const ajahBranch = db.prepare("SELECT id FROM branches WHERE name='Ajah'").get();
  const signup = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.58' },
    body: {
      full_name: 'Identity Phase 15 Client', email: 'identity.phase15@example.com', phone_number: '08088000336',
      residential_address: '12 Identity Way', state: 'Lagos', city: 'Ajah', branch_id: ajahBranch.id,
      identity_type: 'NIN', identity_number: '12345678901', bvn: '22222222222', password: 'password123', terms_accepted: true
    }
  });
  assert(signup.status === 200, `identity signup expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  const client = db.prepare('SELECT * FROM clients WHERE client_reference=?').get(signup.data.client_reference);
  assert(client.residential_address === '12 Identity Way' && client.state === 'Lagos' && client.city === 'Ajah', 'signup address not stored');
  assert(client.assigned_branch_id === ajahBranch.id, 'signup did not honour the client-selected branch');
  assert(client.identity_type === 'NIN', 'identity type not stored');
  assert(client.identity_number_masked === '12*****8901', `unexpected identity mask: ${client.identity_number_masked}`);
  assert(client.identity_number_last4 === '8901', 'identity last4 not stored');
  assert(client.identity_number_hash && client.identity_number_hash.length === 64, 'identity hash missing');
  assert(client.kyc_status === 'pending', 'new identity should await KYC review');
  assert(client.bvn_last4 === '2222', 'BVN last4 not stored');
  const serialized = JSON.stringify(client);
  assert(!serialized.includes('12345678901'), 'raw identity number must never be stored');
  assert(!serialized.includes('22222222222'), 'raw BVN must never be stored');
  assert(signup.data.virtual_account && ['bvn_required', 'pending_provider', 'otp_pending', 'active'].includes(signup.data.virtual_account.status), 'dedicated virtual-account readiness missing');

  const lookup = await request('/api/referral/BL-P8-MKT');
  assert(lookup.status === 200 && lookup.data.referral_code === 'BL-P8-MKT' && lookup.data.branch_name, 'public referral lookup failed');

  const review = await request(`/api/clients/${signup.data.client_id}/kyc`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { status: 'verified', notes: 'Identity checked by MD' }
  });
  assert(review.status === 200 && review.data.kyc_status === 'verified', 'KYC review endpoint failed');
  const reviewed = db.prepare('SELECT kyc_status, kyc_reviewed_by, kyc_notes FROM clients WHERE id=?').get(signup.data.client_id);
  assert(reviewed.kyc_status === 'verified' && reviewed.kyc_reviewed_by === mdId && reviewed.kyc_notes === 'Identity checked by MD', 'KYC review was not persisted');
});

await test('terms and conditions are published, versioned, accepted and downloadable', async () => {
  const initial = await request('/api/terms');
  assert(initial.status === 200 && initial.data.terms && /Phase 8 test terms/.test(initial.data.terms.body_text), 'public terms endpoint missing active terms');
  const initialVersion = initial.data.terms.version_no;

  const noAccept = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.59' },
    body: {
      full_name: 'No Terms Client', email: 'no-terms.phase18@example.com', phone_number: '08088000337',
      residential_address: '11 Signup Test Street', branch_id: ikeja, password: 'password123', terms_accepted: false
    }
  });
  assert(noAccept.status === 400 && /Terms and Conditions/i.test(noAccept.data.error || ''), 'signup must require explicit terms acceptance');

  const publish = await request('/api/admin/terms', {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { title: 'Updated Terms', body_text: 'Updated terms body for Phase 18.' }
  });
  assert(publish.status === 200 && publish.data.version_no === initialVersion + 1, `terms publish expected version ${initialVersion + 1}, got ${JSON.stringify(publish.data)}`);
  const afterPublish = await request('/api/terms');
  assert(afterPublish.data.terms.title === 'Updated Terms' && afterPublish.data.terms.body_text.includes('Phase 18'), 'public terms did not update');

  const signup = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.60' },
    body: {
      full_name: 'Terms Accepted Client', email: 'terms.phase18@example.com', phone_number: '08088000338',
      residential_address: '12 Signup Test Street', branch_id: ikeja, password: 'password123', terms_accepted: true
    }
  });
  assert(signup.status === 200 && signup.data.terms.version_no === publish.data.version_no, 'signup did not return the accepted terms version');
  const acceptance = db.prepare('SELECT * FROM terms_acceptances WHERE client_id=?').get(signup.data.client_id);
  assert(acceptance && acceptance.terms_version_id === publish.data.id, 'terms acceptance was not recorded against the client');

  const adminClients = await request('/api/admin/clients?q=terms.phase18', { headers: { Cookie: mdCookie } });
  assert(adminClients.status === 200 && adminClients.data.clients.length === 1, 'super admin client data view failed');
  const adminClient = adminClients.data.clients[0];
  assert(adminClient.residential_address === '12 Signup Test Street' && adminClient.assigned_branch_id === ikeja, 'super admin client view missing signup address or branch');
  assert(adminClient.terms_version_no === publish.data.version_no && adminClient.terms_accepted_at, 'super admin client view missing accepted terms version');
  assert(adminClient.branch_name && adminClient.client_reference, 'super admin client view missing branch or reference');
  const forbiddenClients = await request('/api/admin/clients', { headers: { Cookie: mkt1Cookie } });
  assert(forbiddenClients.status === 403, 'non-admin must not read the super admin client data view');

  const form = new FormData();
  form.append('title', 'Terms With PDF');
  form.append('body_text', 'Terms body with an uploaded PDF document.');
  form.append('file', new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'terms.pdf', { type: 'application/pdf' }));
  const upload = await request('/api/admin/terms', { method: 'POST', headers: { Cookie: mdCookie }, body: form });
  assert(upload.status === 200 && upload.data.document_url, `terms PDF upload failed: ${JSON.stringify(upload.data)}`);
  const document = await request(upload.data.document_url);
  assert(document.status === 200 && new TextDecoder().decode(document.data).startsWith('%PDF'), 'terms PDF download failed');
  const withDocument = await request('/api/terms');
  assert(withDocument.data.terms.document_url === upload.data.document_url, 'active terms missing document link');

  const forbidden = await request('/api/admin/terms', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { title: 'Blocked Terms', body_text: 'Blocked' }
  });
  assert(forbidden.status === 403, 'marketer must not publish terms');

  const activate = await request(`/api/admin/terms/${publish.data.id}/activate`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(activate.status === 200, 'activating a previous terms version failed');
  const rolledBack = await request('/api/terms');
  assert(rolledBack.data.terms.version_no === publish.data.version_no, 'terms version activation did not roll back');
});

await test('property listing permissions, approval workflow, plan validation and test/demo controls', async () => {
  const createProperty = (cookie, body) => request('/api/properties', {
    method: 'POST', headers: { Cookie: cookie }, body
  });
  const baseProperty = {
    title: 'Phase 19 Workflow Property', description: 'Workflow test property', property_type: 'Apartment',
    sale_price: 1000000, state: 'Lagos', city: 'Ikeja', address: '19 Workflow Road', branch_id: ikeja
  };
  const mdCreate = await createProperty(mdCookie, baseProperty);
  assert(mdCreate.status === 200 && mdCreate.data.id, `MD property creation failed: ${JSON.stringify(mdCreate.data)}`);
  const mdPropertyId = mdCreate.data.id;

  for (const [cookie, label] of [[mkt1Cookie, 'marketer'], [careNationalCookie, 'customer care'], [haCookie, 'head accountant']]) {
    const denied = await createProperty(cookie, { ...baseProperty, title: `Denied ${label}` });
    assert(denied.status === 403, `${label} must not create properties (got ${denied.status})`);
  }
  const bmCross = await createProperty(bm2Cookie, { ...baseProperty, title: 'Cross branch property', branch_id: ikeja });
  assert(bmCross.status === 403, 'branch manager must not create a property in another branch');
  const bmOwn = await createProperty(bm1Cookie, { ...baseProperty, title: 'BM Own Branch Property', branch_id: ikeja });
  assert(bmOwn.status === 200, `branch manager own-branch creation failed: ${JSON.stringify(bmOwn.data)}`);
  const bmPropertyId = bmOwn.data.id;

  const publicNoPlan = await request(`/api/properties/${mdPropertyId}`);
  assert(publicNoPlan.status === 404, 'draft property must not be public');

  const goodPlan = await request(`/api/properties/${mdPropertyId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie },
    body: { plans: [{ plan_type: 'part_payment', total_price: 1000000, deposit: 100000, installment: 225000, number_of_installments: 4, first_payment_rule: 'Deposit at allocation' }] }
  });
  assert(goodPlan.status === 200, `plan save failed: ${JSON.stringify(goodPlan.data)}`);
  const savedPlan = goodPlan.data.plans.find(plan => plan.plan_type === 'part_payment');
  assert(savedPlan && Number(savedPlan.balance_difference_kobo) === 0, 'plan balance validation should report zero difference');

  const mdPublish = await request(`/api/properties/${mdPropertyId}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { is_published: true }
  });
  assert(mdPublish.status === 200 && mdPublish.data.workflow_status === 'published', 'MD publish failed');

  const bmPlan = await request(`/api/properties/${bmPropertyId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: bm1Cookie },
    body: { plans: [{ plan_type: 'outright', total_price: 1000000, deposit: 0, installment: 1000000 }] }
  });
  assert(bmPlan.status === 200, 'branch manager plan save failed');
  const bmPublish = await request(`/api/properties/${bmPropertyId}`, {
    method: 'PUT', headers: { Cookie: bm1Cookie }, body: { is_published: true }
  });
  assert(bmPublish.status === 200 && bmPublish.data.workflow_status === 'pending_approval', `branch manager publish should require approval, got ${JSON.stringify(bmPublish.data)}`);
  const pendingList = await request('/api/properties?pending_approval=1&limit=50', { headers: { Cookie: mdCookie } });
  assert(pendingList.data.properties.some(p => Number(p.id) === Number(bmPropertyId)), 'pending approval list missing branch manager property');
  const approve = await request(`/api/properties/${bmPropertyId}/approve`, { method: 'POST', headers: { Cookie: mdCookie }, body: {} });
  assert(approve.status === 200 && approve.data.workflow_status === 'published', 'MD approval failed');

  const noPlanProperty = await createProperty(mdCookie, { ...baseProperty, title: 'No Plan Property' });
  const publishNoPlan = await request(`/api/properties/${noPlanProperty.data.id}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { is_published: true }
  });
  assert(publishNoPlan.status === 409, 'publishing without an enabled plan must be blocked');

  const differencePlan = await request(`/api/properties/${noPlanProperty.data.id}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie },
    body: { plans: [{ plan_type: 'part_payment', total_price: 1000000, deposit: 100000, installment: 200000, number_of_installments: 4 }] }
  });
  assert(differencePlan.status === 200, 'difference plan save failed');
  const differenceSaved = differencePlan.data.plans.find(plan => plan.plan_type === 'part_payment');
  assert(Number(differenceSaved.balance_difference_kobo) === 10000000, `expected a 100,000 NGN balance difference, got ${differenceSaved.balance_difference_kobo}`);

  const testProperty = await createProperty(mdCookie, {
    ...baseProperty, title: 'Phase 19 Internal Test Property', sale_price: 1000,
    address: '19 Test Road', is_internal_test: true
  });
  assert(testProperty.status === 200, 'internal test property creation failed');
  const testPropertyId = testProperty.data.id;
  await request(`/api/properties/${testPropertyId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie },
    body: { plans: [{ plan_type: 'outright', total_price: 1000, deposit: 0, installment: 1000 }] }
  });
  await request(`/api/properties/${testPropertyId}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { is_published: true }
  });
  const publicList = await request('/api/properties?limit=50');
  assert(!publicList.data.properties.some(p => Number(p.id) === Number(testPropertyId)), 'internal test property leaked into public listing');
  const publicDetail = await request(`/api/properties/${testPropertyId}`);
  assert(publicDetail.status === 404, 'internal test property leaked into public detail API');
  const staffList = await request('/api/properties?limit=50&include_archived=1', { headers: { Cookie: mdCookie } });
  assert(staffList.data.properties.some(p => Number(p.id) === Number(testPropertyId)), 'staff could not see internal test property');
  db.prepare("INSERT OR IGNORE INTO client_properties (client_id, property_id, agreed_purchase_price, status) VALUES (?,?,?, 'Active')").run(adaId, testPropertyId, 1000);
  const namedClientView = await request(`/api/properties/${testPropertyId}`, { headers: { Cookie: clientCookie } });
  assert(namedClientView.status === 200, 'named test client could not view internal test property');

  const demoProperty = await createProperty(mdCookie, { ...baseProperty, title: 'Phase 19 Demo Property', is_demo: true });
  await request(`/api/properties/${demoProperty.data.id}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie },
    body: { plans: [{ plan_type: 'outright', total_price: 1000000, deposit: 0, installment: 1000000 }] }
  });
  await request(`/api/properties/${demoProperty.data.id}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { is_published: true }
  });
  const demoHidden = await request('/api/properties?limit=50');
  assert(!demoHidden.data.properties.some(p => Number(p.id) === Number(demoProperty.data.id)), 'demo property leaked into public listing with hide-demo ON');
  await request('/api/admin/app-settings', {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { hide_demo_properties: false }
  });
  const demoShown = await request('/api/properties?limit=50');
  assert(demoShown.data.properties.some(p => Number(p.id) === Number(demoProperty.data.id)), 'demo property was not shown after hide-demo switch OFF');
  await request('/api/admin/app-settings', {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { hide_demo_properties: true }
  });
  const convert = await request(`/api/properties/${demoProperty.data.id}/convert-to-real`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(convert.status === 200, 'convert demo property to real failed');
  const converted = db.prepare('SELECT is_demo, workflow_status FROM properties WHERE id=?').get(demoProperty.data.id);
  assert(Number(converted.is_demo) === 0 && converted.workflow_status === 'draft', 'converted property flags incorrect');

  db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, currency, method, status, verified_at, is_demo, is_internal_test, revenue_staff_id, revenue_pm_id, revenue_branch_id)
    VALUES (?, ?, 'TX-P19-TEST-EXCLUDE', 1000, 100000, 'NGN', 'Bank Transfer', 'verified', datetime('now'), 0, 1, ?, ?, ?)`)
    .run(adaId, testPropertyId, mkt1Id, bm1Id, ikeja);
  const revenueWithoutTest = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: mdCookie } });
  const revenueWithTest = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31&include_test=1', { headers: { Cookie: mdCookie } });
  assert(revenueWithTest.data.total_kobo - revenueWithoutTest.data.total_kobo === 100000, 'revenue test-data exclusion did not work');

  const archive = await request('/api/admin/archive-test-data', { method: 'POST', headers: { Cookie: mdCookie }, body: {} });
  assert(archive.status === 200 && archive.data.archived.properties >= 1, 'archive test data action failed');
  const archivedProperty = db.prepare('SELECT is_archived FROM properties WHERE id=?').get(testPropertyId);
  assert(Number(archivedProperty.is_archived) === 1, 'test property was not archived');
});

console.log('\n--- 3. Property media and document security ---');
let uploadedDocId;
await test('authorised branch manager can upload a private property document', async () => {
  const form = new FormData();
  form.append('file', new Blob([new TextEncoder().encode('%PDF-1.4\nPhase 8 secure document\n%%EOF')], { type: 'application/pdf' }), 'title.pdf');
  const res = await request(`/api/properties/${propPublished}/documents`, { method: 'POST', headers: { Cookie: bm1Cookie }, body: form });
  assert(res.status === 200 && res.data.document_id, `document upload expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  uploadedDocId = res.data.document_id;
  const doc = db.prepare('SELECT * FROM property_documents WHERE id=?').get(uploadedDocId);
  assert(doc && doc.r2_key.startsWith('property-documents/'), 'document must be stored under a private prefix');
  assert(r2.has(doc.r2_key), 'document object missing from R2');
});

await test('document access is staff-only, branch-scoped and never public', async () => {
  const detail = await request(`/api/properties/${propPublished}`, { headers: { Cookie: bm1Cookie } });
  assert(detail.data.documents.length === 1, 'authorised staff detail should list the document');
  const clientDetail = await request(`/api/properties/${propPublished}`, { headers: { Cookie: clientCookie } });
  assert(!clientDetail.data.documents || clientDetail.data.documents.length === 0, 'client must not see internal documents');
  const anonymous = await request(`/api/properties/${propPublished}/documents/${uploadedDocId}/download`);
  assert(anonymous.status === 401, 'anonymous document download expected 401');
  const client = await request(`/api/properties/${propPublished}/documents/${uploadedDocId}/download`, { headers: { Cookie: clientCookie } });
  assert(client.status === 403, 'client document download expected 403');
  const crossBranch = await request(`/api/properties/${propPublished}/documents/${uploadedDocId}/download`, { headers: { Cookie: bm2Cookie } });
  assert(crossBranch.status === 403, 'cross-branch document download expected 403');
  const staff = await request(`/api/properties/${propPublished}/documents/${uploadedDocId}/download`, { headers: { Cookie: bm1Cookie } });
  assert(staff.status === 200, 'authorised staff document download expected 200');
  assert(staff.headers.get('cache-control') === 'private, no-store', 'documents must not be cached publicly');
  assert(staff.headers.get('content-disposition').includes('attachment'), 'documents must download as attachments');
  const r2Key = db.prepare('SELECT r2_key FROM property_documents WHERE id=?').get(uploadedDocId).r2_key;
  const leak = await request(`/api/files/${encodeURIComponent(r2Key)}`);
  assert(leak.status === 404, 'private document leaked through the public file route');
});

await test('document upload rejects disguised file contents and cross-branch writers', async () => {
  const fake = new FormData();
  fake.append('file', new Blob([new TextEncoder().encode('not a pdf')], { type: 'application/pdf' }), 'fake.pdf');
  const fakeRes = await request(`/api/properties/${propPublished}/documents`, { method: 'POST', headers: { Cookie: bm1Cookie }, body: fake });
  assert(fakeRes.status === 400, 'disguised PDF expected 400');
  const cross = new FormData();
  cross.append('file', new Blob([new TextEncoder().encode('%PDF-1.4 cross')], { type: 'application/pdf' }), 'cross.pdf');
  const crossRes = await request(`/api/properties/${propPublished}/documents`, { method: 'POST', headers: { Cookie: bm2Cookie }, body: cross });
  assert(crossRes.status === 403, 'cross-branch document upload expected 403');
});

await test('property images verify magic bytes and gate unpublished images', async () => {
  const fake = new FormData();
  fake.append('file', new Blob([new TextEncoder().encode('plain text')], { type: 'image/jpeg' }), 'fake.jpg');
  const fakeRes = await request(`/api/properties/${propPublished}/images`, { method: 'POST', headers: { Cookie: bm1Cookie }, body: fake });
  assert(fakeRes.status === 400, 'disguised image expected 400');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'draft.jpg');
  const upload = await request(`/api/properties/${propDraft}/images`, { method: 'POST', headers: { Cookie: bm1Cookie }, body: form });
  assert(upload.status === 200, 'draft image upload expected 200');
  const key = upload.data.key;
  const anonymous = await request(`/api/files/${encodeURIComponent(key)}`);
  assert(anonymous.status === 404, 'unpublished image must not be public');
  const sameBranch = await request(`/api/files/${encodeURIComponent(key)}`, { headers: { Cookie: bm1Cookie } });
  assert(sameBranch.status === 200 && sameBranch.headers.get('cache-control') === 'private, no-store', 'same-branch draft image should be private');
  const crossBranch = await request(`/api/files/${encodeURIComponent(key)}`, { headers: { Cookie: bm2Cookie } });
  assert(crossBranch.status === 404, 'cross-branch draft image should be hidden');
  const draftPlan = await request(`/api/properties/${propDraft}/payment-plans`, {
    method: 'PUT', headers: { Cookie: bm1Cookie },
    body: { plans: [{ plan_type: 'outright', total_price: 15000000, deposit: 0, installment: 15000000 }] }
  });
  assert(draftPlan.status === 200, 'draft payment plan expected 200');
  const publish = await request(`/api/properties/${propDraft}`, { method: 'PUT', headers: { Cookie: bm1Cookie }, body: { is_published: true } });
  assert(publish.status === 200, 'draft publish expected 200');
  assert(publish.data.workflow_status === 'pending_approval', 'branch manager draft should await MD approval');
  const approveDraft = await request(`/api/properties/${propDraft}/approve`, { method: 'POST', headers: { Cookie: mdCookie }, body: {} });
  assert(approveDraft.status === 200, 'MD approval of draft expected 200');
  const publicImage = await request(`/api/files/${encodeURIComponent(key)}`);
  assert(publicImage.status === 200 && publicImage.headers.get('cache-control').includes('public'), 'published image should be publicly cacheable');
});

await test('private property document can be deleted by its branch manager', async () => {
  const key = db.prepare('SELECT r2_key FROM property_documents WHERE id=?').get(uploadedDocId).r2_key;
  const res = await request(`/api/properties/${propPublished}/documents/${uploadedDocId}`, { method: 'DELETE', headers: { Cookie: bm1Cookie } });
  assert(res.status === 200, 'document delete expected 200');
  assert(!r2.has(key), 'deleted document object remains in R2');
  assert(!db.prepare('SELECT id FROM property_documents WHERE id=?').get(uploadedDocId), 'document row remains in D1');
});

console.log('\n--- 4. Reports, RBAC and frontend integration ---');
await test('report marketer filter is applied to the sales dataset', async () => {
  const generated = await request('/api/reports', {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { report_type: 'sales', format: 'csv', marketer_id: mkt1Id, from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }
  });
  assert(generated.status === 200, `sales report expected 200, got ${generated.status}: ${JSON.stringify(generated.data)}`);
  const download = await request(`/api/reports/${generated.data.id}/download`, { headers: { Cookie: mdCookie } });
  const text = Buffer.from(download.data).toString('utf8');
  assert(text.includes('Phase 8 Client'), 'filtered report should include the selected marketer client');
  assert(!text.includes('Other Phase 8 Client'), 'filtered report leaked another marketer client');
  assert(text.includes('Marketer'), 'report filter label missing');
});

await test('role isolation remains intact for staff, finance and client APIs', async () => {
  const mktStaff = await request('/api/staff', { headers: { Cookie: mkt1Cookie } });
  assert(mktStaff.status === 403, 'marketer staff management expected 403');
  const finStaff = await request('/api/staff', { headers: { Cookie: finCookie } });
  assert(finStaff.status === 403, 'finance staff management expected 403');
  const bmCrossClient = await request(`/api/clients/${adaId}`, { headers: { Cookie: bm2Cookie } });
  assert(bmCrossClient.status === 403, 'cross-branch client access expected 403');
  const clientFinance = await request('/api/finance/overview', { headers: { Cookie: clientCookie } });
  assert(clientFinance.status === 403, 'client finance access expected 403');
  const clientOther = await request('/api/clients/1', { headers: { Cookie: clientCookie } });
  assert(clientOther.status === 403, 'client cross-record access expected 403');
  const teamLeadUsers = await request('/api/users?role=Marketer', { headers: { Cookie: tlCookie } });
  assert(teamLeadUsers.status === 200, 'team lead should get scoped marketer options');
  assert(teamLeadUsers.data.users.every(u => u.branch_id === ikeja), 'team lead user directory leaked another branch');
});

await test('frontend integration has no /api/api paths and public enquiries are wired', async () => {
  for (const file of ['assets/js/clients.js', 'assets/js/properties.js', 'assets/js/property-create.js', 'assets/js/client-register.js']) {
    const text = readFileSync(file, 'utf8');
    assert(!text.includes('fetchJson("/api/me")'), `${file} still calls /api/api/me`);
    assert(text.includes('fetchJson("/me")'), `${file} auth guard not fixed`);
  }
  const components = readFileSync('assets/js/components.js', 'utf8');
  assert(components.includes('href="client-login.html" class="btn btn-login"'), 'public client login link is wrong');
  const mainJs = readFileSync('assets/js/main.js', 'utf8');
  assert(mainJs.includes('/api/public/enquiries'), 'homepage contact form is not wired');
  const propertyJs = readFileSync('assets/js/property.js', 'utf8');
  assert(propertyJs.includes('/api/public/enquiries'), 'property enquiry form is not wired');
  const detailJs = readFileSync('assets/js/property-details.js', 'utf8');
  assert(detailJs.includes('/documents') && detailJs.includes('/images'), 'property media UI is missing');
  const clientDetailJs = readFileSync('assets/js/client-detail.js', 'utf8');
  assert(clientDetailJs.includes('/notes'), 'client note UI is not wired');
  const leadsJs = readFileSync('assets/js/leads.js', 'utf8');
  assert(leadsJs.includes('query().get("lead")'), 'lead deep link is not handled');
  const htmlFiles = readdirSync('.').filter(name => name.endsWith('.html'));
  for (const file of htmlFiles) {
    assert(readFileSync(file, 'utf8').includes('mobile-nav.js'), `${file} is missing shared mobile navigation`);
  }
});

await test('single global logo intro supports hype/classic, full/short replay and Back/Forward', async () => {
  const motionJs = readFileSync('assets/js/motion.js', 'utf8');
  const motionCss = readFileSync('assets/css/motion.css', 'utf8');
  const config = readFileSync('assets/js/intro-config.js', 'utf8');
  assert(!motionJs.includes('bliss_intro_played'), 'once-per-session intro logic must be removed');
  assert(config.includes('INTRO_STYLE: "hype"'), 'default intro style must be hype');
  assert(config.includes('"classic"') && motionJs.includes('INTRO_STYLE === "classic"'), 'classic switch missing');
  assert(config.includes('total: 3000') && config.includes('total: 1000'), 'full/short hype durations missing');
  assert(config.includes('fadeIn: 600') && config.includes('hold: 1500') && config.includes('fadeOut: 600'), 'classic full timings missing');
  assert(config.includes('failsafe: 3800') && config.includes('failsafe: 1800'), 'hype failsafe timings missing');
  assert(config.includes('LOGO_SRC: "assets/images/bliss-legacy-logo.png"'), 'actual site logo path missing');
  assert(motionJs.includes("addEventListener(\"pageshow\""), 'Back/Forward pageshow replay missing');
  assert(motionJs.includes("addEventListener(\"popstate\""), 'Back/Forward popstate replay missing');
  assert(motionJs.includes("event.key !== \"Escape\"") && motionJs.includes("event.key !== \"Enter\""), 'Escape/Enter skip missing');
  assert(motionJs.includes('activeRun') && motionJs.includes('runCounter'), 'single-run navigation lock missing');
  assert(motionJs.includes('markInternalNavigation') && motionJs.includes('consumeInternalMarker'), 'internal-navigation short/full distinction missing');
  assert(motionJs.includes('.pagination [data-page]') && !motionJs.includes('button, [data-page]'), 'generic data-page selectors would trigger the intro on every click');
  assert(motionJs.includes('has-logo-error'), 'logo failure fallback missing');
  assert(motionJs.includes('lowPower') && motionCss.includes('.bliss-intro.low-power'), 'low-power handling missing');
  assert(!motionCss.includes('bliss-view-enter'), 'separate page-transition system must be removed');
  assert(motionCss.includes('.bliss-intro') && motionCss.includes('has-logo-error'), 'intro visual/fallback styles missing');
  assert(motionCss.includes('.style-hype') && motionCss.includes('.style-classic'), 'both visual styles missing');
  assert(motionCss.includes('@media (prefers-reduced-motion: reduce)'), 'CSS reduced-motion fallback missing');
  for (const file of readdirSync('.').filter(name => name.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    assert(html.includes('assets/css/motion.css'), `${file} is missing motion.css`);
    assert(html.includes('assets/js/intro-config.js'), `${file} is missing intro-config.js`);
    assert(html.includes('assets/js/motion.js'), `${file} is missing motion.js`);
    assert(html.indexOf('intro-config.js') < html.indexOf('motion.js'), `${file} loads motion before intro config`);
  }
});

await test('PWA manifest, service worker and install flow are wired for iOS and Android', async () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  assert(manifest.name === 'Bliss Legacy Limited' && manifest.short_name === 'Bliss Legacy', 'PWA manifest branding incorrect');
  assert(manifest.start_url === '/' && manifest.scope === '/' && manifest.display === 'standalone', 'PWA start/scope/display incorrect');
  assert(manifest.icons.some(icon => icon.sizes === '192x192'), '192px PWA icon missing');
  assert(manifest.icons.some(icon => icon.sizes === '512x512'), '512px PWA icon missing');
  assert(manifest.icons.some(icon => icon.purpose === 'maskable'), 'maskable PWA icon missing');
  for (const icon of ['assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png']) {
    assert(readFileSync(icon).length > 1000, `${icon} missing or empty`);
  }
  const sw = readFileSync('sw.js', 'utf8');
  assert(sw.includes('/api/') && sw.includes('return;'), 'service worker must not cache API responses');
  assert(sw.includes('/offline'), 'offline fallback missing');
  assert(sw.includes('skipWaiting') && sw.includes('clients.claim'), 'service worker activation missing');
  const pwa = readFileSync('assets/js/pwa.js', 'utf8');
  assert(pwa.includes('navigator.serviceWorker.register("/sw.js"'), 'service worker registration missing');
  assert(pwa.includes('beforeinstallprompt'), 'Android install prompt handling missing');
  assert(pwa.includes('Add to Home Screen'), 'iOS install instructions missing');
  assert(pwa.includes('appinstalled'), 'installed-state handling missing');
  for (const file of readdirSync('.').filter(name => name.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    assert(html.includes('manifest.json'), `${file} is missing the PWA manifest`);
    assert(html.includes('apple-touch-icon'), `${file} is missing the Apple touch icon`);
    if (file !== 'offline.html') assert(html.includes('assets/js/pwa.js'), `${file} is missing the PWA install script`);
  }
  assert(readFileSync('offline.html', 'utf8').includes('You are offline'), 'offline page content missing');
});

await test('landing page exposes ten listings including land and demo labels', async () => {
  const props = readFileSync('assets/js/data/properties.js', 'utf8');
  const ids = [...props.matchAll(/id: "prop-(\d+)"/g)].map(m => m[1]);
  assert(ids.length === 10, `expected 10 static listings, found ${ids.length}`);
  assert((props.match(/category: "Land"/g) || []).length >= 3, 'expected at least three land listings');
  const main = readFileSync('assets/js/main.js', 'utf8');
  assert(main.includes('allProperties.slice(0, 10)'), 'landing merge is not capped at ten');
  assert(main.includes('isDemo ?'), 'demo listings are not labelled');
});

console.log('\n--- 5. Super Admin, staff notifications and chat ---');
await test('Super Admin is a real role with permission-guarded admin routes and audit access', async () => {
  const me = await request('/api/me', { headers: { Cookie: saCookie } });
  assert(me.status === 200 && me.data.role === 'Managing Director' && me.data.actual_role === 'Super Admin', 'Super Admin session mapping incorrect');
  const overview = await request('/api/admin/overview', { headers: { Cookie: saCookie } });
  assert(overview.status === 200 && overview.data.roles.some(r => r.name === 'Super Admin'), 'Super Admin overview missing role data');
  const denied = await request('/api/admin/overview', { headers: { Cookie: mkt1Cookie } });
  assert(denied.status === 403, 'Marketer must not access admin overview');
  const roles = await request('/api/admin/roles', { headers: { Cookie: saCookie } });
  assert(roles.status === 200, 'Super Admin role list expected 200');
  const superRole = roles.data.roles.find(r => r.name === 'Super Admin');
  assert(superRole && superRole.permissions.includes('admin.permissions'), 'Super Admin permissions seed missing');
  const teamLeadRole = roles.data.roles.find(r => r.name === 'Team Lead');
  const mdAttempt = await request(`/api/admin/roles/${teamLeadRole.id}/permissions`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { permission_names: ['clients.read'] }
  });
  assert(mdAttempt.status === 403, 'MD must not change role permissions');
  const saAttempt = await request(`/api/admin/roles/${teamLeadRole.id}/permissions`, {
    method: 'PUT', headers: { Cookie: saCookie }, body: { permission_names: ['clients.read', 'reports.read'] }
  });
  assert(saAttempt.status === 200, `Super Admin permission update expected 200, got ${saAttempt.status}: ${JSON.stringify(saAttempt.data)}`);
  const mapping = db.prepare(`
    SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?
  `).all(teamLeadRole.id).map(r => r.name).sort();
  assert(mapping.join(',') === 'clients.read,reports.read', 'Role permission mapping did not persist');
  const audit = await request('/api/admin/audit?action=admin.role.permissions&limit=10', { headers: { Cookie: saCookie } });
  assert(audit.status === 200 && audit.data.audit.length >= 1, 'Admin audit log missing permission event');
});

await test('staff notifications have read/unread state and chat rooms are persisted', async () => {
  const inserted = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, is_read)
    VALUES (?, 'payment.verified', 'Payment Verified', 'Test payment notification', 0)
  `).run(mkt1Id);
  const inbox = await request('/api/staff/notifications', { headers: { Cookie: mkt1Cookie } });
  assert(inbox.status === 200, 'Staff notification inbox expected 200');
  assert(inbox.data.notifications.some(n => n.id === Number(inserted.lastInsertRowid) && n.is_read === false), 'Unread staff notification missing');
  const read = await request(`/api/staff/notifications/${inserted.lastInsertRowid}/read`, {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {}
  });
  assert(read.status === 200, 'Staff notification read expected 200');
  assert(db.prepare('SELECT is_read FROM notifications WHERE id=?').get(inserted.lastInsertRowid).is_read === 1, 'Notification read state not persisted');
  const readAll = await request('/api/staff/notifications/read-all', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {}
  });
  assert(readAll.status === 200, 'Staff notification read-all expected 200');

  const rooms = await request('/api/chat/rooms', { headers: { Cookie: saCookie } });
  assert(rooms.status === 200 && rooms.data.rooms.some(r => r.kind === 'branch'), 'Branch chat rooms missing');
  const direct = await request('/api/chat/rooms', {
    method: 'POST', headers: { Cookie: saCookie }, body: { user_id: mkt1Id }
  });
  assert(direct.status === 200 && direct.data.room_id, 'Direct chat room creation failed');
  const messages = await request(`/api/chat/rooms/${direct.data.room_id}/messages`, { headers: { Cookie: saCookie } });
  assert(messages.status === 200 && Array.isArray(messages.data.messages), 'Chat message history failed');
  const outsider = await request(`/api/chat/rooms/${direct.data.room_id}/messages`, { headers: { Cookie: mkt3Cookie } });
  assert(outsider.status === 403, 'Non-member must not read a direct chat');
});

console.log('\n--- 6. Hierarchical revenue visibility ---');
await test('revenue scope is enforced by role, branch and team without cross-scope reads', async () => {
  const md = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: mdCookie } });
  const ha = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: haCookie } });
  const bm1 = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: bm1Cookie } });
  const bm2 = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: bm2Cookie } });
  const pm = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: pmCookie } });
  const tl = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: tlCookie } });
  const mkt1 = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: mkt1Cookie } });
  assert(md.status === 200 && ha.status === 200, 'MD/Head Accountant revenue APIs must return 200');
  assert(md.data.total_kobo === 1100000000 && ha.data.total_kobo === 1100000000, 'MD and Head Accountant must see national revenue');
  assert(bm1.data.total_kobo === 800000000, `BM Ikeja revenue expected 800m kobo, got ${bm1.data.total_kobo}`);
  assert(pm.data.total_kobo === 800000000, 'Project Manager must share branch revenue scope');
  assert(bm2.data.total_kobo === 300000000, 'BM Ajah revenue scope incorrect');
  assert(tl.data.total_kobo === 300000000, 'Team Lead must see team revenue only');
  assert(mkt1.data.total_kobo === 100000000, 'Marketer must see personally registered revenue only');
  assert(tl.data.level === 'team_lead', 'Team Lead should start at team level');
  assert(mkt1.data.level === 'staff', 'Staff should start at staff level');
  assert(md.data.reconciles === true && md.data.children_total_kobo === md.data.total_kobo, 'MD branch children must sum to national total');
  assert(bm1.data.reconciles === true && bm1.data.children_total_kobo === bm1.data.total_kobo, 'Branch children must sum to branch total');
  const branchA = md.data.children.find(c => c.name === 'Ikeja');
  const branchB = md.data.children.find(c => c.name === 'Ajah');
  assert(branchA && branchB && branchA.total_kobo === 800000000 && branchB.total_kobo === 300000000, 'National branch breakdown incorrect');
  assert(bm2.data.children.some(c => c.type === 'staff' && c.name === 'Phase 8 Ajah Marketer'), 'No-team-lead branch must drill directly to staff');
  assert(!bm2.data.children.some(c => c.type === 'team_lead'), 'No empty team-lead level should appear');
  const cross = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31&branch_id=' + ajah, { headers: { Cookie: bm1Cookie } });
  assert(cross.status === 403, 'BM must not request another branch');
  const crossStaff = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31&staff_id=' + mkt2Id, { headers: { Cookie: mkt1Cookie } });
  assert(crossStaff.status === 403, 'Staff must not request another staff scope');
  const payments = await request('/api/revenue/payments?from=2026-01-01&to=2099-12-31', { headers: { Cookie: bm1Cookie } });
  assert(payments.status === 200 && payments.data.payments.length === 3, 'Branch revenue payments list incorrect');
  assert(payments.data.payments.every(p => p.revenue_branch_id === ikeja), 'Branch payments leaked another branch');
});

await test('payment attribution survives reassignment and duplicate webhooks do not double-count', async () => {
  db.prepare("UPDATE client_assignments SET relationship_manager_id=? WHERE client_id=?").run(mkt2Id, adaId);
  db.prepare("UPDATE clients SET created_by=?, original_marketer_id=?, team_lead_id=NULL WHERE id=?").run(mkt2Id, mkt2Id, adaId);
  const oldStaff = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: mkt1Cookie } });
  const newStaff = await request('/api/revenue/overview?from=2026-01-01&to=2099-12-31', { headers: { Cookie: mkt2Cookie } });
  assert(oldStaff.data.total_kobo === 100000000, 'Reassignment must not move historical payment attribution');
  assert(newStaff.data.total_kobo === 200000000, 'Reassignment must not rewrite old payment totals');

  db.prepare("UPDATE provider_configs SET status='Active', webhook_secret='p8-webhook-secret' WHERE provider_key='wema_alat'").run();
  const pending = db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, created_at)
    VALUES (?, ?, 'TX-P8-WEBHOOK-DUP', 500000, 'NGN', 'Bank Transfer', 'pending', 50000000, 0, datetime('now'))`)
    .run(ajahClientId, propPublished);
  const payload = {
    event: 'payment.success',
    timestamp: new Date().toISOString(),
    data: { transaction_reference: 'TX-P8-WEBHOOK-DUP', amount: 500000, currency: 'NGN', status: 'success' }
  };
  const first = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p8-webhook-secret' }, body: payload
  });
  assert(first.status === 200 && first.data.status === 'verified', 'First webhook should verify payment');
  const second = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p8-webhook-secret' }, body: payload
  });
  assert(second.status === 200 && second.data.already_processed === true, 'Duplicate webhook must be idempotent');
  assert(db.prepare("SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?").get(Number(pending.lastInsertRowid)).c === 1, 'Duplicate webhook created an extra receipt');
  const stamped = db.prepare("SELECT revenue_staff_id, revenue_team_lead_id, revenue_pm_id, revenue_branch_id FROM payments WHERE transaction_ref='TX-P8-WEBHOOK-DUP'").get();
  assert(stamped.revenue_staff_id === mkt3Id && stamped.revenue_team_lead_id === null && stamped.revenue_pm_id === bm2Id && stamped.revenue_branch_id === ajah, 'Webhook attribution snapshot incorrect');
});

console.log('\n--- 7. Payment plans, defaulting, inspections, commissions and providers ---');

function insertPlanClient(ref, name, branch, marketerId, agreed) {
  return Number(db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
    assigned_branch_id, created_by, original_marketer_id, agreed_purchase_price, interested_property_id)
    VALUES (?, ?, ?, ?, 'Active Buyer', 'New Sale', ?, ?, ?, ?, ?)`)
    .run(ref, name, '08089' + String(Math.floor(Math.random() * 900000)).padStart(6, '0'),
      ref.toLowerCase() + '@example.com', branch, marketerId, marketerId, agreed, propPublished).lastInsertRowid);
}

async function createPlanForClient(clientId, planType, options = {}) {
  const start = options.start || new Date().toISOString().slice(0, 10);
  const response = await request('/api/installments', {
    method: 'POST', headers: { Cookie: mdCookie },
    body: {
      client_id: clientId, property_id: propPublished,
      total_amount: options.total || 500000,
      deposit_amount: options.deposit || 0,
      installment_amount: options.installment || 100000,
      plan_type: planType,
      start_date: start,
      next_due_date: start,
      grace_days: options.graceDays || 0,
      number_of_installments: options.count || null
    }
  });
  assert(response.status === 200, `${planType} plan creation expected 200, got ${response.status}: ${JSON.stringify(response.data)}`);
  return response.data.id;
}

function insertPlanPayment(clientId, ref, amountKobo, daysAgo = 0) {
  const stamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, verified_at, provider, provider_reference, created_at)
    VALUES (?, ?, ?, ?, 'NGN', 'Bank Transfer', 'verified', ?, 0, ?, 'wema_alat', ?, ?)`)
    .run(clientId, propPublished, ref, amountKobo / 100, amountKobo, stamp, ref, stamp).lastInsertRowid);
}

await test('defaulting is detected per plan type, respects grace and clears on catch-up', async () => {
  const dailyId = insertPlanClient('BLC-P12-DAILY', 'Phase 12 Daily Client', ikeja, mkt1Id, 5000);
  const graceId = insertPlanClient('BLC-P12-GRACE', 'Phase 12 Grace Client', ikeja, mkt1Id, 5000);
  const weeklyId = insertPlanClient('BLC-P12-WEEKLY', 'Phase 12 Weekly Client', ikeja, mkt1Id, 5000);
  const monthlyId = insertPlanClient('BLC-P12-MONTHLY', 'Phase 12 Monthly Client', ikeja, mkt1Id, 5000);
  const partId = insertPlanClient('BLC-P12-PART', 'Phase 12 Part Client', ikeja, mkt1Id, 5000);
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  await createPlanForClient(dailyId, 'daily', { start: daysAgo(3), total: 5000, installment: 1000 });
  await createPlanForClient(graceId, 'daily', { start: daysAgo(3), total: 5000, installment: 1000, graceDays: 3 });
  await createPlanForClient(weeklyId, 'weekly', { start: daysAgo(10), total: 5000, installment: 1000 });
  await createPlanForClient(monthlyId, 'monthly', { start: daysAgo(40), total: 5000, installment: 1000 });
  await createPlanForClient(partId, 'part_payment', { start: daysAgo(40), total: 5000, installment: 1000, count: 5 });

  const listed = await request('/api/defaulting-clients?limit=200', { headers: { Cookie: mdCookie } });
  assert(listed.status === 200, 'defaulting list expected 200');
  const byClient = new Map(listed.data.clients.map(row => [row.client_id, row]));
  for (const [clientId, label] of [[dailyId, 'daily'], [weeklyId, 'weekly'], [monthlyId, 'monthly'], [partId, 'part payment']]) {
    const row = byClient.get(clientId);
    assert(row, `${label} client missing from defaulting list`);
    assert(row.status === 'defaulting', `${label} client should be defaulting`);
    assert(row.days_overdue > 0 && row.amount_behind_kobo > 0, `${label} defaulting figures missing`);
  }
  assert(byClient.get(graceId).status === 'performing', 'grace period should suppress defaulting');
  assert(listed.data.summary.by_plan_type.daily.defaulting >= 1, 'daily defaulting summary missing');
  assert(listed.data.summary.by_plan_type.weekly.defaulting >= 1, 'weekly defaulting summary missing');
  assert(listed.data.summary.by_plan_type.monthly.defaulting >= 1, 'monthly defaulting summary missing');
  assert(listed.data.summary.by_plan_type.part_payment.defaulting >= 1, 'part-payment defaulting summary missing');

  insertPlanPayment(weeklyId, 'TX-P12-WEEKLY-CATCHUP', 500000, 0);
  const caughtUp = await request('/api/defaulting-clients?limit=200', { headers: { Cookie: mdCookie } });
  const weeklyRow = caughtUp.data.clients.find(row => row.client_id === weeklyId);
  assert(weeklyRow && weeklyRow.status === 'performing' && weeklyRow.amount_behind_kobo === 0, 'catch-up payment should clear defaulting');

  const scoped = await request('/api/defaulting-clients?limit=200', { headers: { Cookie: mktNoTeamCookie } });
  assert(scoped.status === 200 && scoped.data.clients.every(row => row.client_id !== dailyId), 'staff defaulting scope leaked another marketer client');
});

await test('commission applies to outright payments but caps easy-buy commissionable basis; versions protect history', async () => {
  const easyClientId = insertPlanClient('BLC-P12-EASY', 'Phase 12 Easy Buy Client', ikeja, mkt1Id, 500000);
  const outrightClientId = insertPlanClient('BLC-P12-OUTRIGHT', 'Phase 12 Outright Client', ikeja, mkt1Id, 500000);
  await createPlanForClient(easyClientId, 'weekly', { start: new Date().toISOString().slice(0, 10), total: 500000, installment: 250000, count: 2 });
  await createPlanForClient(outrightClientId, 'outright', { start: new Date().toISOString().slice(0, 10), total: 500000, installment: 500000, count: 1 });
  insertPlanPayment(easyClientId, 'TX-P12-EASY-1', 30000000, 1);
  insertPlanPayment(easyClientId, 'TX-P12-EASY-2', 20000000, 0);
  insertPlanPayment(outrightClientId, 'TX-P12-OUT-1', 30000000, 1);
  insertPlanPayment(outrightClientId, 'TX-P12-OUT-2', 20000000, 0);

  const plan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 12 Easy Buy Commission',
      calculation_basis: 'verified_collections',
      commissionable_mode: 'capped_amount',
      commissionable_cap_amount: 200000,
      approval_required: false,
      separation_of_duties: false,
      rules: [{ role_name: 'Marketer', rate_percent: 10 }]
    }
  });
  assert(plan.status === 200, `commission plan create expected 200, got ${plan.status}`);
  const planId = plan.data.id;

  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: planId }
  });
  assert(generated.status === 200, `commission generation expected 200, got ${generated.status}`);
  const easyEntries = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=? ORDER BY id").all(planId, easyClientId);
  const outrightEntries = db.prepare("SELECT * FROM commission_entries WHERE plan_id=? AND client_id=? ORDER BY id").all(planId, outrightClientId);
  assert(easyEntries.length === 1, `easy-buy cap should create one commission entry, got ${easyEntries.length}`);
  assert(easyEntries[0].qualifying_amount_kobo === 20000000, `easy-buy commissionable basis should be 200,000 NGN = 20,000,000 kobo, got ${easyEntries[0].qualifying_amount_kobo}`);
  assert(easyEntries[0].commission_kobo === 2000000, 'easy-buy commission should be 10% of 200,000 NGN');
  assert(outrightEntries.length === 2, 'outright plan should accrue on every payment');
  assert(outrightEntries.reduce((sum, row) => sum + Number(row.qualifying_amount_kobo), 0) === 50000000, 'outright commissionable basis should be 500,000 NGN');
  const oldEntryId = easyEntries[0].id;
  const oldCommission = easyEntries[0].commission_kobo;

  const detail = await request(`/api/commission-plans/${planId}`, { headers: { Cookie: mdCookie } });
  const rule = detail.data.plan.rules[0];
  const edited = await request(`/api/commission-plans/${planId}`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 12 Easy Buy Commission Updated',
      calculation_basis: 'verified_collections',
      commissionable_mode: 'percentage',
      commissionable_percent: 50,
      approval_required: false,
      separation_of_duties: false,
      rules: [{ id: rule.id, role_name: 'Marketer', rate_percent: 20, is_active: true }]
    }
  });
  assert(edited.status === 200 && edited.data.version_no === 2, 'plan edit should create version 2');
  const regenerated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: planId }
  });
  assert(regenerated.status === 200 && regenerated.data.created === 0, 're-generation must not rewrite past commission');
  const oldEntry = db.prepare("SELECT * FROM commission_entries WHERE id=?").get(oldEntryId);
  assert(oldEntry.commission_kobo === oldCommission && oldEntry.plan_version_no === 1, 'past commission changed when plan version changed');
  const versions = db.prepare("SELECT COUNT(*) AS c FROM commission_plan_versions WHERE plan_id=?").get(planId).c;
  assert(versions === 2, `expected two plan versions, got ${versions}`);
});

await test('staff and team leads see only their own commission amounts', async () => {
  const staff = await request('/api/commissions', { headers: { Cookie: mkt1Cookie } });
  const staffGenerate = await request('/api/commissions/generate', { method: 'POST', headers: { Cookie: mkt1Cookie }, body: {} });
  const lead = await request('/api/commissions', { headers: { Cookie: tlCookie } });
  const leadPlans = await request('/api/commission-plans', { headers: { Cookie: tlCookie } });
  assert(staff.status === 200 && Array.isArray(staff.data.entries), 'staff own commission list expected 200');
  assert(staff.generate !== 200 && staffGenerate.status === 403, 'staff must not generate commission');
  assert(lead.status === 200 && Array.isArray(lead.data.entries), 'team lead own commission list expected 200');
  assert(leadPlans.status === 403, 'team lead must not read commission plan rules');
  const keys = Object.keys(staff.data.entries[0] || {}).sort();
  assert(keys.join(',') === ['adjusted_kobo','client_name','client_reference','commission_ref','created_at','earned_kobo','expected_kobo','id','outstanding_kobo','paid_kobo','status'].sort().join(','), 'staff commission response leaked calculation fields');
});

await test('lead bulk import, inspection scheduling and conversion retain marketer attribution', async () => {
  const csv = [
    'full_name,phone_number,email_address,source,status,assigned_marketer_id',
    'Phase 12 Bulk One,08081230001,bulk1@example.com,November ad campaign,interested,' + mkt2Id,
    'Phase 12 Bulk Two,08081230002,bulk2@example.com,November ad campaign,new lead,' + mkt2Id
  ].join('\n');
  const bulk = await request('/api/leads/bulk', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { csv, source: 'November ad campaign' }
  });
  assert(bulk.status === 200 && bulk.data.created_count === 2, `bulk import expected 2 created, got ${bulk.status} ${JSON.stringify(bulk.data)}`);
  const imported = db.prepare("SELECT * FROM leads WHERE email_address='bulk1@example.com'").get();
  assert(imported && imported.source === 'November ad campaign' && imported.assigned_marketer_id === mkt2Id, 'bulk lead source/owner missing');

  const inspection = await request(`/api/leads/${imported.id}/inspection`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      inspection_date: new Date().toISOString().slice(0, 10), inspection_time: '11:30', property_id: propPublished
    }
  });
  assert(inspection.status === 200 && inspection.data.status === 'Inspection Scheduled', 'inspection scheduling failed');
  const summary = await request('/api/inspections/summary', { headers: { Cookie: mdCookie } });
  assert(summary.status === 200 && summary.data.today >= 1, 'today inspection count missing');
  assert(summary.data.by_marketer.some(row => row.marketer_id === mkt2Id && row.today_count >= 1), 'inspection count per marketer missing');

  const converted = await request(`/api/leads/${imported.id}/convert`, {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: { agreed_purchase_price: 400000 }
  });
  assert(converted.status === 200, `lead conversion expected 200, got ${converted.status}`);
  const client = db.prepare("SELECT * FROM clients WHERE id=?").get(converted.data.client_id);
  assert(client.created_by === mkt2Id && client.original_marketer_id === mkt2Id, 'conversion did not retain marketer attribution');
  const pending = db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P12-CONVERTED', 400000, 'NGN', 'Bank Transfer', 'pending', 40000000, 0, 'wema_alat', 'TX-P12-CONVERTED')`)
    .run(converted.data.client_id, propPublished);
  const verified = await request(`/api/finance/payments/${Number(pending.lastInsertRowid)}/verify`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(verified.status === 200, `converted client payment verify expected 200, got ${verified.status}`);
  const attributed = db.prepare("SELECT revenue_staff_id FROM payments WHERE id=?").get(Number(pending.lastInsertRowid));
  assert(attributed.revenue_staff_id === mkt2Id, 'revenue attribution did not follow converted lead marketer');
});

await test('duplicate webhook delivery is idempotent across multiple active providers', async () => {
  db.prepare("UPDATE provider_configs SET status='Active', webhook_secret='p8-webhook-secret' WHERE provider_key='wema_alat'").run();
  db.prepare("UPDATE provider_configs SET status='Active', webhook_secret='p8-paystack-secret', adapter_key='paystack', webhook_path='/api/webhooks/paystack' WHERE provider_key='paystack'").run();
  const paystackPending = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P12-PAYSTACK', 50000, 'NGN', 'Card', 'pending', 5000000, 0, 'paystack', 'TX-P12-PAYSTACK')`)
    .run(adaId, propPublished).lastInsertRowid);
  const wemaPending = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P12-WEMA', 60000, 'NGN', 'Bank Transfer', 'pending', 6000000, 0, 'wema_alat', 'TX-P12-WEMA')`)
    .run(adaId, propPublished).lastInsertRowid);

  const paystackPayload = {
    event: 'charge.success',
    data: { id: 'p12-paystack-event', reference: 'TX-P12-PAYSTACK', amount: 5000000, currency: 'NGN', status: 'success', paid_at: new Date().toISOString() }
  };
  const raw = JSON.stringify(paystackPayload);
  const sig = createHmac('sha512', 'p8-paystack-secret').update(raw).digest('hex');
  const payFirst = await request('/api/webhooks/paystack', {
    method: 'POST', headers: { 'x-paystack-signature': sig }, body: paystackPayload
  });
  assert(payFirst.status === 200 && payFirst.data.status === 'verified', `paystack webhook expected verified, got ${payFirst.status} ${JSON.stringify(payFirst.data)}`);
  const paySecond = await request('/api/webhooks/paystack', {
    method: 'POST', headers: { 'x-paystack-signature': sig }, body: paystackPayload
  });
  assert(paySecond.status === 200 && paySecond.data.already_processed === true, 'paystack duplicate must be idempotent');

  const wemaPayload = {
    id: 'p12-wema-event', event: 'payment.success', timestamp: new Date().toISOString(),
    data: { transaction_reference: 'TX-P12-WEMA', amount: 60000, currency: 'NGN', status: 'success' }
  };
  const wemaFirst = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p8-webhook-secret' }, body: wemaPayload
  });
  const wemaSecond = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p8-webhook-secret' }, body: wemaPayload
  });
  assert(wemaFirst.status === 200 && wemaFirst.data.status === 'verified', 'wema webhook should verify');
  assert(wemaSecond.status === 200 && wemaSecond.data.already_processed === true, 'wema duplicate must be idempotent');
  assert(db.prepare("SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?").get(paystackPending).c === 1, 'paystack duplicate created an extra receipt');
  assert(db.prepare("SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?").get(wemaPending).c === 1, 'wema duplicate created an extra receipt');
  assert(db.prepare("SELECT provider FROM payments WHERE id=?").get(paystackPending).provider === 'paystack', 'paystack provider not stored');
  assert(db.prepare("SELECT provider FROM payments WHERE id=?").get(wemaPending).provider === 'wema_alat', 'wema provider not stored');
});

console.log('\n--- 8. Property plans, customer care and SMS ---');

async function createPropertyPlanProperty(ref) {
  return Number(db.prepare(`INSERT INTO properties (reference,title,description,category_id,sale_price,state,city,address,branch_id,status,is_published,created_by)
    VALUES (?, ?, 'Plan catalogue property', ?, 20000000, 'Lagos', 'Ikeja', 'Plan Close', ?, 'Available', 1, ?)`)
    .run(ref, 'Phase 13 Plan Property', categoryId, ikeja, mdId).lastInsertRowid);
}

await test('properties expose only enabled plans and onboarding locks the chosen plan and schedule', async () => {
  const propertyId = await createPropertyPlanProperty('BLP-P13-PLAN');
  const plans = await request(`/api/properties/${propertyId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { plans: [
      { plan_type: 'outright', is_enabled: true, total_price: 20000000, deposit: 0, installment: 20000000, number_of_installments: 1 },
      { plan_type: 'weekly', is_enabled: true, total_price: 21000000, deposit: 1000000, installment: 1000000, number_of_installments: 20 },
      { plan_type: 'monthly', is_enabled: false, total_price: 22000000, deposit: 1000000, installment: 2000000, number_of_installments: 10 }
    ] }
  });
  assert(plans.status === 200, `property plans save expected 200, got ${plans.status}: ${JSON.stringify(plans.data)}`);
  const publicPlans = await request(`/api/properties/${propertyId}/payment-plans`, { headers: { Cookie: mkt1Cookie } });
  assert(publicPlans.status === 200 && publicPlans.data.plans.length === 2, 'only enabled plans should be offered');
  assert(!publicPlans.data.plans.some(plan => plan.plan_type === 'monthly'), 'disabled monthly plan leaked to onboarding');
  const disabledPlanId = db.prepare("SELECT id FROM property_payment_plans WHERE property_id=? AND plan_type='monthly'").get(propertyId).id;
  const weeklyPlanId = db.prepare("SELECT id FROM property_payment_plans WHERE property_id=? AND plan_type='weekly'").get(propertyId).id;

  const disabledAttempt = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      full_name: 'Phase 13 Disabled Plan', phone_number: '08081330001', interested_property_id: propertyId,
      property_plan_id: disabledPlanId, assigned_branch_id: ikeja
    }
  });
  assert(disabledAttempt.status === 400, 'a disabled property plan must not be selectable');

  const created = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      full_name: 'Phase 13 Weekly Plan Client', phone_number: '08081330002', interested_property_id: propertyId,
      property_plan_id: weeklyPlanId, assigned_branch_id: ikeja,
      plan_start_date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10)
    }
  });
  assert(created.status === 200, `plan onboarding expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(created.data.id);
  assert(client.property_payment_plan_id === weeklyPlanId && client.payment_plan_type === 'weekly', 'chosen plan not locked to client');
  assert(client.agreed_purchase_price === 21000000 && client.payment_plan_total_kobo === 2100000000, 'locked purchase total incorrect');
  const schedule = db.prepare('SELECT * FROM payment_schedules WHERE client_id=? AND status=\'active\' ORDER BY id DESC LIMIT 1').get(created.data.id);
  assert(schedule && schedule.plan_type === 'weekly' && schedule.total_kobo === 2100000000, 'plan did not drive the payment schedule');
  assert(db.prepare('SELECT COUNT(*) AS c FROM payment_schedule_items WHERE schedule_id=?').get(schedule.id).c > 0, 'expected schedule items were not generated');
  const defaulting = await request('/api/defaulting-clients?limit=200&q=Phase%2013%20Weekly', { headers: { Cookie: mdCookie } });
  assert(defaulting.status === 200 && defaulting.data.clients.some(row => row.client_id === created.data.id && row.plan_type === 'weekly'), 'plan choice did not drive defaulting detection');

  const edit = await request(`/api/properties/${propertyId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: mdCookie }, body: { plans: [
      { plan_type: 'weekly', is_enabled: true, total_price: 30000000, deposit: 1000000, installment: 1000000, number_of_installments: 20 }
    ] }
  });
  assert(edit.status === 200, 'property plan edit expected 200');
  const lockedClient = db.prepare('SELECT agreed_purchase_price, payment_plan_total_kobo FROM clients WHERE id=?').get(created.data.id);
  const lockedSchedule = db.prepare('SELECT total_kobo, locked_plan_json FROM payment_schedules WHERE id=?').get(schedule.id);
  assert(lockedClient.agreed_purchase_price === 21000000 && lockedClient.payment_plan_total_kobo === 2100000000, 'later property edit changed locked purchase price');
  assert(lockedSchedule.total_kobo === 2100000000 && lockedSchedule.locked_plan_json, 'later property edit changed locked schedule terms');

  insertPlanPayment(created.data.id, 'TX-P13-PLAN-COMMISSION', 30000000, 1);
  const commissionPlan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Phase 13 Easy Buy Plan Basis', calculation_basis: 'verified_collections',
      commissionable_mode: 'capped_amount', commissionable_cap_amount: 200000,
      approval_required: false, separation_of_duties: false,
      rules: [{ role_name: 'Marketer', rate_percent: 10 }]
    }
  });
  assert(commissionPlan.status === 200, 'commission plan create expected 200');
  const generated = await request('/api/commissions/generate', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { plan_id: commissionPlan.data.id, client_id: created.data.id }
  });
  assert(generated.status === 200, 'commission generation expected 200');
  const entry = db.prepare('SELECT * FROM commission_entries WHERE plan_id=? AND client_id=?').get(commissionPlan.data.id, created.data.id);
  assert(entry && entry.qualifying_amount_kobo === 20000000, 'plan choice did not drive the easy-buy commissionable basis');
});

await test('branch and national customer care scopes are enforced server-side', async () => {
  const branchList = await request('/api/customer-care/clients?limit=100', { headers: { Cookie: careBranchCookie } });
  const nationalList = await request('/api/customer-care/clients?limit=100', { headers: { Cookie: careNationalCookie } });
  assert(branchList.status === 200 && branchList.data.clients.every(row => row.assigned_branch_id === ikeja), 'branch care saw another branch');
  assert(nationalList.status === 200 && nationalList.data.clients.some(row => row.assigned_branch_id === ajah), 'national care did not see all branches');
  const cross = await request(`/api/customer-care/clients/${ajahClientId}`, { headers: { Cookie: careBranchCookie } });
  const allowed = await request(`/api/customer-care/clients/${ajahClientId}`, { headers: { Cookie: careNationalCookie } });
  assert(cross.status === 404, 'branch care must not read another branch client');
  assert(allowed.status === 200, 'national care should read any branch client');
  const clearance = await request(`/api/customer-care/clients/${adaId}/clearance`, {
    method: 'POST', headers: { Cookie: careBranchCookie }, body: { status: 'cleared', note: 'Identity and phone confirmed' }
  });
  assert(clearance.status === 200, 'care clearance expected 200');
  const call = await request(`/api/customer-care/clients/${adaId}/calls`, {
    method: 'POST', headers: { Cookie: careBranchCookie }, body: { call_type: 'call', note: 'Confirmed client details', outcome: 'Cleared' }
  });
  assert(call.status === 200, 'care call log expected 200');
  assert(db.prepare("SELECT care_status FROM client_care_records WHERE client_id=?").get(adaId).care_status === 'cleared', 'care status not persisted');
  assert(db.prepare('SELECT COUNT(*) AS c FROM client_care_calls WHERE client_id=?').get(adaId).c >= 1, 'care call not logged');
  const commission = await request('/api/commissions', { headers: { Cookie: careNationalCookie } });
  assert(commission.status === 403, 'customer care must never see commission data');
});

await test('SMS is sent once per confirmed payment, normalises phones, respects opt-out and skips unconfirmed payments', async () => {
  const configure = await request('/api/sms/settings', {
    method: 'PUT', headers: { Cookie: mdCookie }, body: {
      sms_enabled: true, sms_provider: 'mock', sms_sender_id: 'Bliss', sms_low_credit_threshold: 10
    }
  });
  assert(configure.status === 200, 'SMS settings expected 200');
  const overview = await request('/api/sms/overview', { headers: { Cookie: mdCookie } });
  assert(overview.status === 200 && overview.data.provider === 'mock', 'SMS overview expected 200 with configured provider');
  db.prepare("UPDATE provider_configs SET status='Active', webhook_secret='p13-sms-secret' WHERE provider_key='wema_alat'").run();
  const pending = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P13-SMS-1', 500000, 'NGN', 'Bank Transfer', 'pending', 50000000, 0, 'wema_alat', 'TX-P13-SMS-1')`)
    .run(adaId, propPublished).lastInsertRowid);
  const smsPayload = {
    id: 'p13-sms-event', event: 'payment.success', timestamp: new Date().toISOString(),
    data: { transaction_reference: 'TX-P13-SMS-1', amount: 500000, currency: 'NGN', status: 'success' }
  };
  const first = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p13-sms-secret' }, body: smsPayload
  });
  assert(first.status === 200 && first.data.status === 'verified', 'SMS payment webhook should verify');
  const second = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p13-sms-secret' }, body: smsPayload
  });
  assert(second.status === 200 && second.data.already_processed === true, 'duplicate webhook must be idempotent');
  const messages = db.prepare('SELECT * FROM sms_messages WHERE payment_id=?').all(pending);
  assert(messages.length === 1, `expected exactly one SMS per payment, got ${messages.length}`);
  assert(messages[0].template_key === 'payment_received' && messages[0].phone_e164.startsWith('+234'), 'payment SMS template or phone normalisation incorrect');
  let acked = false;
  await worker.queue({ messages: [{ body: { type: 'sms.send', sms_message_id: messages[0].id }, ack() { acked = true; } }] }, makeEnv());
  assert(acked, 'SMS queue message was not acknowledged');
  assert(db.prepare('SELECT status FROM sms_messages WHERE id=?').get(messages[0].id).status === 'delivered', 'mock provider should mark SMS delivered');

  const unconfirmed = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P13-SMS-UNCONFIRMED', 100000, 'NGN', 'Bank Transfer', 'pending', 10000000, 0, 'wema_alat', 'TX-P13-SMS-UNCONFIRMED')`)
    .run(adaId, propPublished).lastInsertRowid);
  await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'p13-sms-secret' },
    body: { id: 'p13-sms-failed-event', event: 'payment.failed', timestamp: new Date().toISOString(), data: { transaction_reference: 'TX-P13-SMS-UNCONFIRMED', amount: 100000, currency: 'NGN', status: 'failed' } }
  });
  assert(db.prepare('SELECT COUNT(*) AS c FROM sms_messages WHERE payment_id=?').get(unconfirmed).c === 0, 'unconfirmed/failed payment must not send SMS');

  const normalized = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: { full_name: 'Phase 13 Phone Client', phone_number: '0803 123 4567', assigned_branch_id: ikeja }
  });
  assert(normalized.status === 200, 'phone-normalisation client create expected 200');
  assert(db.prepare('SELECT phone_number FROM clients WHERE id=?').get(normalized.data.id).phone_number === '+2348031234567', 'phone was not normalised to +234');

  const optout = await request(`/api/clients/${normalized.data.id}/sms-optout`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { opted_out: true, reason: 'Prefers voice calls' }
  });
  assert(optout.status === 200, 'SMS opt-out expected 200');
  const optoutPayment = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference)
    VALUES (?, ?, 'TX-P13-SMS-OPTOUT', 200000, 'NGN', 'Bank Transfer', 'pending', 20000000, 0, 'wema_alat', 'TX-P13-SMS-OPTOUT')`)
    .run(normalized.data.id, propPublished).lastInsertRowid);
  const verified = await request(`/api/finance/payments/${optoutPayment}/verify`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(verified.status === 200, 'manual verify expected 200');
  const optoutMessages = db.prepare('SELECT status FROM sms_messages WHERE payment_id=?').all(optoutPayment);
  assert(optoutMessages.length === 1 && optoutMessages[0].status === 'opted_out', 'opt-out must be respected and recorded');
});

console.log('\n--- 9. Client onboarding OTP verification ---');
await test('staff onboarding sends an OTP and verifies the client exactly once', async () => {
  const created = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mkt1Cookie }, body: {
      full_name: 'Phase 14 OTP Client', phone_number: '08087770001',
      email_address: 'otp.phase14@example.com', assigned_branch_id: ikeja
    }
  });
  assert(created.status === 200, `OTP client create expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  assert(created.data.verification && created.data.verification.channel === 'sms', 'auto OTP should use SMS when email provider is not configured');
  const clientId = created.data.id;
  const otp = db.prepare("SELECT * FROM client_verification_otps WHERE client_id=? ORDER BY id DESC LIMIT 1").get(clientId);
  assert(otp && otp.channel === 'sms' && otp.delivery_status === 'sent', 'verification OTP row missing or not sent');
  const sms = db.prepare("SELECT body FROM sms_messages WHERE client_id=? AND template_key='client_verification_otp' ORDER BY id DESC LIMIT 1").get(clientId);
  const code = (sms && sms.body.match(/\b(\d{6})\b/) || [])[1];
  assert(code, 'verification code missing from queued SMS');
  const status = await request(`/api/clients/${clientId}/verification`, { headers: { Cookie: mdCookie } });
  assert(status.status === 200 && status.data.active_otp && status.data.verification_status === 'unverified', 'verification status/active OTP incorrect');
  const wrong = await request(`/api/clients/${clientId}/verification/verify`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { code: '000000' }
  });
  assert(wrong.status === 400, 'wrong OTP expected 400');
  const verified = await request(`/api/clients/${clientId}/verification/verify`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { code }
  });
  assert(verified.status === 200 && verified.data.verification_status === 'verified', `OTP verify expected 200 verified, got ${verified.status}: ${JSON.stringify(verified.data)}`);
  assert(db.prepare('SELECT verification_status FROM clients WHERE id=?').get(clientId).verification_status === 'verified', 'client not marked verified');
  const reuse = await request(`/api/clients/${clientId}/verification/verify`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { code }
  });
  assert(reuse.status === 404, 'consumed OTP must not be reusable');
  const emailOtp = await request(`/api/clients/${clientId}/verification/send`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { channel: 'email' },
    env: makeEnv({ EMAIL_PROVIDER: 'mock', ENVIRONMENT: 'test' })
  });
  assert(emailOtp.status === 200 && emailOtp.data.channel === 'email' && emailOtp.data.delivery_status === 'sent', 'email OTP send expected 200 sent');
});

await test('public signup sends an OTP and the client can verify their own account', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.77' }, body: {
      full_name: 'Phase 14 Public OTP Client', email: 'otp.public.phase14@example.com',
      phone_number: '08087770002', residential_address: '10 Signup Test Street', branch_id: ikeja,
      password: 'password123', terms_accepted: true
    }
  });
  assert(signup.status === 200, `signup expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
  const clientId = signup.data.client_id;
  const state = await request('/api/client/verification', { headers: { Cookie: cookie } });
  assert(state.status === 200 && state.data.verification_status === 'unverified', 'public signup client should start unverified');
  const otp = db.prepare("SELECT * FROM client_verification_otps WHERE client_id=? ORDER BY id DESC LIMIT 1").get(clientId);
  assert(otp && otp.channel === 'sms', 'public signup should auto-send SMS OTP');
  const sms = db.prepare("SELECT body FROM sms_messages WHERE client_id=? AND template_key='client_verification_otp' ORDER BY id DESC LIMIT 1").get(clientId);
  const code = (sms && sms.body.match(/\b(\d{6})\b/) || [])[1];
  assert(code, 'public signup OTP missing from SMS');
  const verified = await request('/api/client/verification/verify', {
    method: 'POST', headers: { Cookie: cookie }, body: { code }
  });
  assert(verified.status === 200 && verified.data.verification_status === 'verified', 'client self verification failed');
  const finalState = await request('/api/client/verification', { headers: { Cookie: cookie } });
  assert(finalState.data.verification_status === 'verified', 'public client verification state not persisted');
});

console.log('\n--- 10. ALATPay documented webhook, static wallet and test mode ---');
await test('ALATPay static wallet creation, signature validation, status verification and idempotency', async () => {
  const originalFetch = globalThis.fetch;
  const mockJson = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  let remoteStatus = 'completed';
  let remoteAmount = 100;
  let remoteAccount = '0412345678';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/alatpay-wallet/api/v1/staticaccount/validateAndCreate')) {
      return mockJson({ status: true, data: { accountNumber: '0412345678', accountName: 'BLISS LEGACY - TEST CLIENT', bankName: 'Wema Bank', id: 'sw-account-1' } });
    }
    if (url.includes('/alatpay-wallet/api/v1/staticaccount') && String(init.method || 'GET').toUpperCase() === 'POST') {
      return mockJson({ status: true, data: { id: 'sw-init-1', otpTrackingID: 'otp-track-1', message: 'An OTP has been sent to 08*******86' } });
    }
    if (url.includes('/alatpaytransaction/api/v1/transactions/')) {
      const tx = decodeURIComponent(url.split('/').pop());
      return mockJson({ status: true, data: {
        Id: tx, OrderId: tx === 'tx-dyn' ? 'order-dyn' : (tx === 'tx-static-1' ? 'order-static-1' : (tx === 'tx-unknown' ? 'order-unknown' : 'order-static-2')),
        Amount: remoteAmount, Currency: 'NGN', Status: remoteStatus,
        NgnVirtualBankAccountNumber: tx === 'tx-unknown' ? '9999999999' : remoteAccount
      } });
    }
    return originalFetch(input, init);
  };
  const alatEnv = makeEnv({
    PAYMENT_MODE: 'test',
    ALATPAY_TEST_SECRET_KEY: 'test-secret',
    ALATPAY_TEST_BUSINESS_ID: 'test-business',
    ALATPAY_TEST_WEBHOOK_SECRET: 'test-webhook',
    ALATPAY_TEST_BASE_URL: 'https://alatpay.test'
  });
  try {
    const initiate = await request(`/api/finance/clients/${adaId}/static-wallet/initiate`, {
      method: 'POST', headers: { Cookie: mdCookie }, body: { bvn: '2222222222' }, env: alatEnv
    });
    assert(initiate.status === 200 && initiate.data.status === 'otp_pending', `static wallet initiate expected otp_pending, got ${initiate.status}: ${JSON.stringify(initiate.data)}`);
    assert(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE metadata LIKE '%2222222222%'").get().c === 0, 'BVN leaked into audit logs');
    const validate = await request(`/api/finance/clients/${adaId}/static-wallet/validate`, {
      method: 'POST', headers: { Cookie: mdCookie }, body: { otp: '123456' }, env: alatEnv
    });
    assert(validate.status === 200 && validate.data.status === 'active' && validate.data.account_number === '0412345678', 'static wallet validate expected active account');
    assert(validate.data.account_name === 'Phase 8 Client / Bliss Legacy Limited', `unexpected static wallet account name: ${validate.data.account_name}`);
    const staffWallet = await request(`/api/finance/clients/${adaId}/static-wallet`, { headers: { Cookie: mdCookie }, env: alatEnv });
    assert(staffWallet.data.wallet && staffWallet.data.wallet.status === 'active', 'staff static wallet view missing');
    assert(staffWallet.data.wallet.account_name === 'Phase 8 Client / Bliss Legacy Limited', 'staff static wallet account name was not normalized');
    const clientWallet = await request('/api/client/virtual-account', { headers: { Cookie: clientCookie }, env: alatEnv });
    assert(clientWallet.data.is_active === true && clientWallet.data.is_static === true && clientWallet.data.account_number === '0412345678', 'client static wallet view missing');
    assert(clientWallet.data.account_name === 'Phase 8 Client / Bliss Legacy Limited', 'client static wallet account name was not normalized');

    const payload = {
      Value: { Data: {
        Id: 'tx-static-1', OrderId: 'order-static-1', Amount: 100, Currency: 'NGN', Status: 'completed',
        NgnVirtualBankAccountNumber: '0412345678', BusinessId: 'test-business'
      } }, StatusCode: 200
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', 'test-webhook').update(raw).digest('base64');
    const invalid = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': 'invalid' }, body: payload, env: alatEnv
    });
    assert(invalid.status === 401, 'invalid ALATPay signature expected 401');
    const before = db.prepare('SELECT COUNT(*) AS c FROM payments WHERE transaction_ref=?').get('order-static-1').c;
    assert(before === 0, 'invalid signature created a payment');
    const first = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': signature }, body: payload, env: alatEnv
    });
    assert(first.status === 200 && first.data.status === 'verified', `valid ALATPay webhook expected verified, got ${first.status}: ${JSON.stringify(first.data)}`);
    const replay = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': signature }, body: payload, env: alatEnv
    });
    assert(replay.data.already_processed === true, 'duplicate ALATPay webhook must be idempotent');
    const staticPayment = db.prepare('SELECT * FROM payments WHERE transaction_ref=?').get('order-static-1');
    assert(staticPayment && staticPayment.status === 'verified' && staticPayment.payment_mode === 'test', 'static wallet payment not credited in test mode');
    assert(staticPayment.provider_account_number === '0412345678', 'static wallet account not stored on payment');
    assert(db.prepare('SELECT COUNT(*) AS c FROM payments WHERE transaction_ref=?').get('order-static-1').c === 1, 'duplicate webhook created a second payment');
    assert(db.prepare('SELECT COUNT(*) AS c FROM sms_messages WHERE payment_id=?').get(staticPayment.id).c === 1, 'duplicate webhook created a second SMS');
    const expectedStaff = db.prepare('SELECT COALESCE(created_by, original_marketer_id) AS s FROM clients WHERE id=?').get(adaId).s;
    assert(staticPayment.revenue_staff_id === expectedStaff, 'static wallet payment attribution missing');

    const unknown = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': createHmac('sha256', 'test-webhook').update(JSON.stringify({
        Value: { Data: { Id: 'tx-unknown', OrderId: 'order-unknown', Amount: 100, Currency: 'NGN', Status: 'completed', NgnVirtualBankAccountNumber: '9999999999' } }
      })).digest('base64') }, body: { Value: { Data: { Id: 'tx-unknown', OrderId: 'order-unknown', Amount: 100, Currency: 'NGN', Status: 'completed', NgnVirtualBankAccountNumber: '9999999999' } } }, env: alatEnv
    });
    assert(unknown.status === 202 && unknown.data.matched === false, `unknown static account must be logged, not credited; got ${unknown.status} ${JSON.stringify(unknown.data)}`);

    remoteStatus = 'pending';
    remoteAmount = 50;
    const pendingPayload = { Value: { Data: { Id: 'tx-pending', OrderId: 'order-static-2', Amount: 50, Currency: 'NGN', Status: 'completed', NgnVirtualBankAccountNumber: '0412345678' } } };
    const pendingSig = createHmac('sha256', 'test-webhook').update(JSON.stringify(pendingPayload)).digest('base64');
    const pending = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': pendingSig }, body: pendingPayload, env: alatEnv
    });
    assert(pending.status === 202 && pending.data.status === 'pending', 'provider-pending transaction must not credit');
    remoteStatus = 'completed';
    const later = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': pendingSig }, body: pendingPayload, env: alatEnv
    });
    assert(later.status === 200 && later.data.status === 'verified', 'retried webhook after provider completion should credit');

    const dynPayment = db.prepare(`INSERT INTO payments
      (client_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference, payment_mode)
      VALUES (?, 'order-dyn', 100, 'NGN', 'ALATPay', 'pending', 10000, 0, 'alatpay', 'tx-dyn', 'test')`).run(adaId);
    remoteAmount = 200;
    const dynPayload = { Value: { Data: { Id: 'tx-dyn', OrderId: 'order-dyn', Amount: 200, Currency: 'NGN', Status: 'completed' } } };
    const dyn = await request('/api/webhooks/alatpay/test', {
      method: 'POST', headers: { 'x-signature': createHmac('sha256', 'test-webhook').update(JSON.stringify(dynPayload)).digest('base64') }, body: dynPayload, env: alatEnv
    });
    assert(dyn.status === 409, `dynamic amount mismatch expected 409, got ${dyn.status}`);
    assert(db.prepare('SELECT status FROM payments WHERE id=?').get(Number(dynPayment.lastInsertRowid)).status === 'pending', 'amount mismatch credited a payment');
    const liveRoute = await request('/api/webhooks/alatpay/live', {
      method: 'POST', headers: { 'x-signature': signature }, body: payload, env: alatEnv
    });
    assert(liveRoute.status === 404, 'live ALATPay webhook must not run while PAYMENT_MODE=test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('\n--- 11. Automatic commission generation and retry ---');
await test('verified webhook creates commission once, duplicate creates none, failure flags and retry resolves', async () => {
  const autoClient = insertPlanClient('BLC-AUTO-COMM', 'Audit Auto Commission Client', ikeja, mkt1Id, 500000);
  db.prepare('UPDATE clients SET team_lead_id=? WHERE id=?').run(tlId, autoClient);
  db.prepare('INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary) VALUES (?,?,?,?,?,1)')
    .run(autoClient, mkt1Id, ikeja, tlId, bm1Id);
  await createPlanForClient(autoClient, 'outright', { total: 500000, installment: 500000, count: 1 });
  const plan = await request('/api/commission-plans', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {
      name: 'Audit Auto Commission', calculation_basis: 'verified_collections',
      commissionable_mode: 'full', approval_required: false, separation_of_duties: false,
      rules: [
        { role_name: 'Marketer', rate_percent: 10 },
        { role_name: 'Team Lead', rate_percent: 2 },
        { role_name: 'Branch Manager', rate_percent: 1 }
      ]
    }
  });
  assert(plan.status === 200, 'automatic commission plan create failed');
  db.prepare("UPDATE provider_configs SET status='Active', webhook_secret='auto-comm-secret' WHERE provider_key='wema_alat'").run();
  const pending = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference, payment_mode)
    VALUES (?, ?, 'AUD-AUTO-WH-1', 100000, 'NGN', 'Bank Transfer', 'pending', 10000000, 0, 'wema_alat', 'AUD-AUTO-WH-1', 'test')`)
    .run(autoClient, propPublished).lastInsertRowid);
  const payload = {
    id: 'audit-auto-webhook-1', event: 'payment.success', timestamp: new Date().toISOString(),
    data: { transaction_reference: 'AUD-AUTO-WH-1', amount: 100000, currency: 'NGN', status: 'success' }
  };
  const first = await request('/api/webhooks/wema-alat', { method: 'POST', headers: { 'X-Webhook-Secret': 'auto-comm-secret' }, body: payload });
  assert(first.status === 200 && first.data.status === 'verified', 'auto-commission webhook should verify');
  const entries = db.prepare('SELECT * FROM commission_entries WHERE client_id=? AND payment_id=? AND plan_id=?').all(autoClient, pending, plan.data.id);
  assert(entries.length === 3, `expected 3 beneficiary commission entries for audit plan, got ${entries.length}`);
  assert(db.prepare('SELECT commission_state FROM payments WHERE id=?').get(pending).commission_state === 'generated', 'payment not marked commission generated');
  const replay = await request('/api/webhooks/wema-alat', { method: 'POST', headers: { 'X-Webhook-Secret': 'auto-comm-secret' }, body: payload });
  assert(replay.data.already_processed === true, 'duplicate auto webhook must be idempotent');
  assert(db.prepare('SELECT COUNT(*) AS c FROM commission_entries WHERE client_id=? AND payment_id=? AND plan_id=?').get(autoClient, pending, plan.data.id).c === 3, 'duplicate webhook created extra commission entries');

  const failClient = insertPlanClient('BLC-AUTO-FAIL', 'Audit Auto Fail Client', ikeja, mkt1Id, 500000);
  db.prepare('UPDATE clients SET team_lead_id=? WHERE id=?').run(tlId, failClient);
  db.prepare('INSERT INTO client_assignments (client_id, relationship_manager_id, branch_id, team_lead_id, assigned_by, is_primary) VALUES (?,?,?,?,?,1)')
    .run(failClient, mkt1Id, ikeja, tlId, bm1Id);
  await createPlanForClient(failClient, 'outright', { total: 500000, installment: 500000, count: 1 });
  const failPayment = Number(db.prepare(`INSERT INTO payments
    (client_id, property_id, transaction_ref, amount, currency, method, status, amount_kobo, is_demo, provider, provider_reference, payment_mode)
    VALUES (?, ?, 'AUD-AUTO-FAIL-1', 100000, 'NGN', 'Bank Transfer', 'pending', 10000000, 0, 'wema_alat', 'AUD-AUTO-FAIL-1', 'test')`)
    .run(failClient, propPublished).lastInsertRowid);
  db.exec("CREATE TRIGGER audit_fail_commission BEFORE INSERT ON commission_entries BEGIN SELECT RAISE(ABORT, 'forced commission failure'); END;");
  const verified = await request(`/api/finance/payments/${failPayment}/verify`, { method: 'POST', headers: { Cookie: mdCookie }, body: {} });
  assert(verified.status === 200, `payment must still verify when commission fails, got ${verified.status}`);
  const failedPayment = db.prepare('SELECT status, commission_state FROM payments WHERE id=?').get(failPayment);
  assert(failedPayment.status === 'verified', 'failed commission must not roll back payment');
  assert(failedPayment.commission_state === 'failed', 'failed commission was not flagged');
  const failure = db.prepare('SELECT * FROM commission_generation_failures WHERE payment_id=? AND resolved_at IS NULL').get(failPayment);
  assert(failure, 'commission failure row missing');
  db.exec('DROP TRIGGER audit_fail_commission;');
  db.prepare("UPDATE commission_generation_failures SET next_retry_at=datetime('now','-1 minute') WHERE payment_id=?").run(failPayment);
  await worker.scheduled({}, makeEnv(), { waitUntil() {} });
  const retried = db.prepare('SELECT commission_state FROM payments WHERE id=?').get(failPayment);
  assert(retried.commission_state === 'generated', 'retry did not mark commission generated');
  assert(db.prepare('SELECT resolved_at FROM commission_generation_failures WHERE payment_id=?').get(failPayment).resolved_at, 'retry did not resolve failure');
  assert(db.prepare('SELECT COUNT(*) AS c FROM commission_entries WHERE client_id=? AND plan_id=?').get(failClient, plan.data.id).c >= 3, 'retry created no commission entries');
});

console.log('\n--- 11. Test-account expiry and monthly marketer reactivation ---');
await test('expired test accounts cannot log in and are deactivated', async () => {
  const expiredId = upsertUser('expired.test.p8@bliss.com', 'Expired Test', 'Marketer', ikeja);
  db.prepare("UPDATE users SET is_test=1, test_expires_at='2020-01-01', is_active=1 WHERE id=?").run(expiredId);
  const clock = makeEnv({ TEST_NOW: '2026-02-15' });
  const res = await request('/api/login', { method: 'POST', body: { email: 'expired.test.p8@bliss.com', password: 'password123' }, env: clock });
  assert(res.status === 403, `expired test login expected 403, got ${res.status}`);
  assert(/expired after 14 days/i.test(res.data.error || ''), 'expiry message is unclear');
  assert(db.prepare('SELECT is_active FROM users WHERE id=?').get(expiredId).is_active === 0, 'expired test account stayed active');
  assert(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='test_account.expired' AND target_id=?").get(String(expiredId)).c > 0, 'expiry was not audited');

  const scheduledExpiredId = upsertUser('scheduled.expired.p8@bliss.com', 'Scheduled Expired', 'Marketer', ikeja);
  db.prepare("UPDATE users SET is_test=1, test_expires_at='2020-01-01', is_active=1 WHERE id=?").run(scheduledExpiredId);
  await worker.scheduled({}, clock, { waitUntil() {} });
  assert(db.prepare('SELECT is_active FROM users WHERE id=?').get(scheduledExpiredId).is_active === 0, 'scheduled job did not deactivate an expired test account');
  assert(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='test_account.expired' AND target_id=?").get(String(scheduledExpiredId)).c > 0, 'scheduled test expiry was not audited');
});

await test('lapsed marketer sees a clear message, BM sees pending list, reactivation is audited', async () => {
  const lapsedId = upsertUser('lapsed.marketer.p8@bliss.com', 'Lapsed Marketer', 'Marketer', ikeja);
  db.prepare("UPDATE users SET access_valid_until='2026-01-31', is_active=1, is_test=0 WHERE id=?").run(lapsedId);
  const clock = makeEnv({ TEST_NOW: '2026-02-15' });
  const blocked = await request('/api/login', { method: 'POST', body: { email: 'lapsed.marketer.p8@bliss.com', password: 'password123' }, env: clock });
  assert(blocked.status === 403, `lapsed marketer login expected 403, got ${blocked.status}`);
  assert(/monthly access has lapsed/i.test(blocked.data.error || '') && /contact your branch manager/i.test(blocked.data.error || ''), 'lapse message does not tell the marketer what to do');
  assert(db.prepare('SELECT access_lapsed_at FROM users WHERE id=?').get(lapsedId).access_lapsed_at, 'lapse was not recorded');
  const pending = await request('/api/staff/reactivation-pending', { headers: { Cookie: bm1Cookie }, env: clock });
  assert(pending.status === 200 && pending.data.pending.some(row => row.id === lapsedId), 'branch manager pending list missing lapsed marketer');
  const reactivated = await request(`/api/staff/${lapsedId}/reactivate`, { method: 'POST', headers: { Cookie: bm1Cookie }, body: {}, env: clock });
  assert(reactivated.status === 200 && reactivated.data.valid_until === '2026-02-28', 'reactivation did not extend to month end');
  const row = db.prepare('SELECT is_active, access_valid_until, reactivated_at, reactivated_by FROM users WHERE id=?').get(lapsedId);
  assert(row.is_active === 1 && row.reactivated_at && row.reactivated_by === bm1Id, 'reactivation record incomplete');
  assert(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='marketer.reactivated' AND actor_user_id=? AND target_id=?").get(bm1Id, String(lapsedId)).c > 0, 'reactivation not audited with actor');
  const allowed = await request('/api/login', { method: 'POST', body: { email: 'lapsed.marketer.p8@bliss.com', password: 'password123' }, env: clock });
  assert(allowed.status === 200, 'reactivated marketer cannot log in');
});

await test('per-role access setting off allows month-end login and scheduled job expires lapsed accounts', async () => {
  const clock = makeEnv({ TEST_NOW: '2026-02-15' });
  const setting = await request('/api/staff/access-settings', { method: 'PUT', headers: { Cookie: mdCookie }, body: { role_name: 'Marketer', enabled: false }, env: clock });
  assert(setting.status === 200 && setting.data.enabled === 0, 'could not disable monthly reactivation');
  const openId = upsertUser('open.marketer.p8@bliss.com', 'Open Marketer', 'Marketer', ikeja);
  db.prepare("UPDATE users SET access_valid_until='2026-01-31', is_active=1, is_test=0 WHERE id=?").run(openId);
  const allowed = await request('/api/login', { method: 'POST', body: { email: 'open.marketer.p8@bliss.com', password: 'password123' }, env: clock });
  assert(allowed.status === 200, 'setting off still blocked a lapsed marketer');
  await request('/api/staff/access-settings', { method: 'PUT', headers: { Cookie: mdCookie }, body: { role_name: 'Marketer', enabled: true }, env: clock });

  const scheduledId = upsertUser('scheduled.lapse.p8@bliss.com', 'Scheduled Lapse', 'Marketer', ikeja);
  db.prepare("UPDATE users SET access_valid_until='2026-02-01', is_active=1, is_test=0 WHERE id=?").run(scheduledId);
  await worker.scheduled({}, clock, { waitUntil() {} });
  assert(db.prepare('SELECT is_active FROM users WHERE id=?').get(scheduledId).is_active === 0, 'scheduled job did not deactivate lapsed marketer');
  assert(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='marketer.access_lapsed' AND target_id=?").get(String(scheduledId)).c > 0, 'scheduled lapse was not audited');
});

console.log('\n--- 12. Care date filter, lead ordering/colour logs and phone cleanup ---');
await test('customer care from/to date filter and clearance queue actually apply', async () => {
  const oldRef = 'BLC-P8-CARE-OLD';
  db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, assigned_branch_id,
    created_by, original_marketer_id, created_at) VALUES (?, 'Care Old Client', '08088000501', 'care.old.p8@example.com', 'Prospect', ?, ?, ?, '2020-01-15 09:00:00')`)
    .run(oldRef, ikeja, bm1Id, mkt1Id);
  const oldId = db.prepare('SELECT id FROM clients WHERE client_reference=?').get(oldRef).id;
  const inRange = await request('/api/customer-care/clients?from=2020-01-01&to=2020-01-31&limit=100', { headers: { Cookie: careBranchCookie } });
  assert(inRange.status === 200 && inRange.data.clients.some(row => row.id === oldId), 'date range did not include matching client');
  const afterRange = await request('/api/customer-care/clients?from=2021-01-01&limit=100', { headers: { Cookie: careBranchCookie } });
  assert(!afterRange.data.clients.some(row => row.id === oldId), 'from filter did not exclude older client');
  const beforeRange = await request('/api/customer-care/clients?to=2019-12-31&limit=100', { headers: { Cookie: careBranchCookie } });
  assert(!beforeRange.data.clients.some(row => row.id === oldId), 'to filter did not exclude newer client');

  const clearance = await request(`/api/customer-care/clients/${oldId}/clearance`, {
    method: 'POST', headers: { Cookie: careBranchCookie }, body: { status: 'cleared', note: 'Verified' }
  });
  assert(clearance.status === 200, 'care clearance failed');
  const cleared = await request('/api/customer-care/clients?status=cleared&limit=100', { headers: { Cookie: careBranchCookie } });
  const pending = await request('/api/customer-care/clients?status=pending_clearance&limit=100', { headers: { Cookie: careBranchCookie } });
  assert(cleared.data.clients.some(row => row.id === oldId), 'cleared queue omitted cleared client');
  assert(!pending.data.clients.some(row => row.id === oldId), 'pending queue included cleared client');
});

await test('lead contact history is newest-first for same-second entries and temperature changes are logged', async () => {
  const created = await request('/api/leads', {
    method: 'POST', headers: { Cookie: bm1Cookie }, body: {
      full_name: 'PHONE Audit Lead', phone_number: '08088000601', source: 'Audit',
      status: 'New Lead', lead_temperature: 'Hot', assigned_marketer_id: mkt1Id, branch_id: ikeja
    }
  });
  assert(created.status === 200, `lead create expected 200, got ${created.status}`);
  const leadId = created.data.id;
  const first = Number(db.prepare(`INSERT INTO lead_follow_ups (lead_id, staff_id, note, channel, outcome, contacted_at, created_at)
    VALUES (?, ?, 'First contact', 'call', 'Connected', '2026-02-15 10:00:00', '2026-02-15 10:00:00')`).run(leadId, mkt1Id).lastInsertRowid);
  const second = Number(db.prepare(`INSERT INTO lead_follow_ups (lead_id, staff_id, note, channel, outcome, contacted_at, created_at)
    VALUES (?, ?, 'Second contact', 'whatsapp', 'Interested', '2026-02-15 10:00:00', '2026-02-15 10:00:00')`).run(leadId, mkt1Id).lastInsertRowid);
  const detail = await request(`/api/leads/${leadId}`, { headers: { Cookie: bm1Cookie } });
  assert(detail.status === 200, 'lead detail expected 200');
  assert(detail.data.follow_ups[0].id === second && detail.data.follow_ups[1].id === first, 'same-second contact history is not newest-first');
  assert(detail.data.follow_ups.length === 2, 'contact count is wrong');
  const changed = await request(`/api/leads/${leadId}`, {
    method: 'PUT', headers: { Cookie: bm1Cookie }, body: { lead_temperature: 'Cold' }
  });
  assert(changed.status === 200, 'temperature change expected 200');
  const after = await request(`/api/leads/${leadId}`, { headers: { Cookie: bm1Cookie } });
  assert(after.data.lead.lead_temperature === 'Cold', 'temperature did not change');
  assert(after.data.temperature_history.length >= 1 && after.data.temperature_history[0].new_temperature === 'Cold', 'temperature change was not logged');
  const list = await request('/api/leads?limit=100', { headers: { Cookie: bm1Cookie } });
  assert(list.status === 200 && list.data.temperature_counts.Cold >= 1, 'lead list temperature counts missing');
});

await test('phone cleanup reports invalid/missing numbers and saves one scoped correction at a time', async () => {
  const badRef = 'BLC-P8-PHONE-BAD';
  const invalidRef = 'BLC-P8-PHONE-INVALID';
  db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, assigned_branch_id,
    created_by, original_marketer_id) VALUES (?, 'Phone Bad Format', '0803 111 2222', 'phone.bad.p8@example.com', 'Prospect', ?, ?, ?)`)
    .run(badRef, ikeja, mkt1Id, mkt1Id);
  db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, assigned_branch_id,
    created_by, original_marketer_id) VALUES (?, 'Phone Invalid', '12345', 'phone.invalid.p8@example.com', 'Prospect', ?, ?, ?)`)
    .run(invalidRef, ikeja, mkt1Id, mkt1Id);
  const badId = db.prepare('SELECT id FROM clients WHERE client_reference=?').get(badRef).id;
  const report = await request('/api/phone-cleanup', { headers: { Cookie: mkt1Cookie } });
  assert(report.status === 200, `phone cleanup expected 200, got ${report.status}`);
  const badRow = report.data.clients.find(row => row.client_id === badId);
  assert(badRow && badRow.reason === 'normalise_to_+234' && badRow.proposed_value === '+2348031112222', 'phone cleanup did not propose the +234 correction');
  assert(report.data.grouped.some(group => group.branch_name && group.marketers.some(m => m.clients.some(c => c.client_id === badId))), 'phone cleanup grouping missing');
  const storedBefore = db.prepare('SELECT phone_number FROM clients WHERE id=?').get(badId).phone_number;
  assert(storedBefore === '0803 111 2222', 'read-only report rewrote the stored number');
  const fixed = await request(`/api/clients/${badId}`, {
    method: 'PUT', headers: { Cookie: mkt1Cookie }, body: { phone_number: '+2348031112222' }
  });
  assert(fixed.status === 200, `marketer phone fix expected 200, got ${fixed.status}: ${JSON.stringify(fixed.data)}`);
  assert(db.prepare('SELECT phone_number FROM clients WHERE id=?').get(badId).phone_number === '+2348031112222', 'individual phone fix was not saved');
  const after = await request('/api/phone-cleanup', { headers: { Cookie: mkt1Cookie } });
  assert(!after.data.clients.some(row => row.client_id === badId), 'corrected client still appears in cleanup report');
  assert(after.data.clients.some(row => row.client_id === db.prepare('SELECT id FROM clients WHERE client_reference=?').get(invalidRef).id), 'invalid number disappeared from report');
  const wrongField = await request(`/api/clients/${badId}`, {
    method: 'PUT', headers: { Cookie: mkt1Cookie }, body: { full_name: 'Not allowed' }
  });
  assert(wrongField.status === 403, 'marketer must not edit non-phone client fields');
});

console.log('\n--- 13. ELPIS referral commission automation ---');
await test('referral commission applies two-stage and flat rules, caps at 35,000 and flags 8-month plans', async () => {
  const insertClient = (ref, name, phone, marketerId, planType, months) => Number(db.prepare(`
    INSERT INTO clients (client_reference, full_name, phone_number, email_address, status, sale_type,
      assigned_branch_id, created_by, original_marketer_id, agreed_purchase_price,
      payment_plan_type, payment_plan_duration_months)
    VALUES (?, ?, ?, ?, 'Active Buyer', 'New Sale', ?, ?, ?, 20000000, ?, ?)
  `).run(ref, name, phone, `${ref.toLowerCase()}@example.com`, ikeja, marketerId, marketerId, planType, months).lastInsertRowid);

  const insertVerifiedPayment = (clientId, ref, kobo, dayOffset) => Number(db.prepare(`
    INSERT INTO payments (client_id, transaction_ref, amount, amount_kobo, currency, method, status, verified_at, is_demo)
    VALUES (?, ?, ?, ?, 'NGN', 'Bank Transfer', 'verified', datetime('now', ?), 0)
  `).run(clientId, ref, kobo / 100, kobo, `-${dayOffset} days`).lastInsertRowid);

  const longClient = insertClient('BLC-P15-LONG', 'Referral Long Term', '08089001001', mkt1Id, 'monthly', 12);
  insertVerifiedPayment(longClient, 'P15-LONG-1', 3000000, 5);
  insertVerifiedPayment(longClient, 'P15-LONG-2', 3000000, 4);
  insertVerifiedPayment(longClient, 'P15-LONG-3', 4000000, 3);
  insertVerifiedPayment(longClient, 'P15-LONG-4', 2000000, 2);
  const longExtraPayment = insertVerifiedPayment(longClient, 'P15-LONG-5', 6000000, 1);

  const shortClient = insertClient('BLC-P15-SHORT', 'Referral Short Term', '08089001002', mkt2Id, 'monthly', 6);
  insertVerifiedPayment(shortClient, 'P15-SHORT-1', 10000000, 2);

  const outrightClient = insertClient('BLC-P15-OUTRIGHT', 'Referral Outright', '08089001003', mkt1Id, 'outright', 0);
  insertVerifiedPayment(outrightClient, 'P15-OUTRIGHT-1', 50000000, 2);

  const eightMonthClient = insertClient('BLC-P15-EIGHT', 'Referral Eight Month', '08089001004', mkt1Id, 'monthly', 8);
  insertVerifiedPayment(eightMonthClient, 'P15-EIGHT-1', 6000000, 2);

  const backfill = await request('/api/referral-commissions/backfill', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(backfill.status === 200, `referral backfill expected 200, got ${backfill.status}: ${JSON.stringify(backfill.data)}`);

  const longAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE client_id=?').get(longClient);
  assert(longAccount && longAccount.structure === 'two_stage', 'long-term referral account not classified as two-stage');
  assert(longAccount.stage1_commission_kobo === 2000000, `stage 1 should be 20,000 NGN = 2,000,000 kobo, got ${longAccount.stage1_commission_kobo}`);
  assert(longAccount.stage2_commission_kobo === 1500000, `stage 2 should be 15,000 NGN = 1,500,000 kobo, got ${longAccount.stage2_commission_kobo}`);
  assert(longAccount.total_commission_kobo === 3500000, `long-term cap should be 35,000 NGN = 3,500,000 kobo, got ${longAccount.total_commission_kobo}`);
  assert(longAccount.qualifying_paid_kobo === 12000000, 'long-term qualifying payments must stop at 120,000 NGN');
  assert(longAccount.total_paid_kobo === 18000000, 'long-term gross client payment should still be recorded');
  assert(longAccount.status === 'Earned', `long-term referral status expected Earned, got ${longAccount.status}`);

  const shortAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE client_id=?').get(shortClient);
  assert(shortAccount.structure === 'flat' && shortAccount.total_commission_kobo === 1000000, 'short-term referral commission should be 10% = 10,000 NGN');
  assert(shortAccount.plan_duration_months === 6, 'short-term plan duration not stored');

  const outrightAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE client_id=?').get(outrightClient);
  assert(outrightAccount.structure === 'flat' && outrightAccount.total_commission_kobo === 5000000, 'outright referral commission should be 10% = 50,000 NGN');

  const eightAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE client_id=?').get(eightMonthClient);
  assert(eightAccount.structure === 'configuration_required' && eightAccount.total_commission_kobo === 0, '8-month plan must be flagged without commission');
  assert(eightAccount.status === 'Configuration Required' && /8-month/i.test(eightAccount.flag_reason || ''), '8-month flag reason missing');

  const rules = await request('/api/referral-commissions/rules', { headers: { Cookie: mdCookie } });
  assert(rules.status === 200 && rules.data.rules.length === 4, 'referral commission rules endpoint missing seeded rules');
  const detail = await request(`/api/referral-commissions/${longAccount.id}`, { headers: { Cookie: mdCookie } });
  assert(detail.status === 200 && detail.data.account.client_id === longClient && detail.data.events.length >= 1, 'referral commission detail endpoint failed');
  const recalc = await request(`/api/referral-commissions/${longAccount.id}/recalculate`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(recalc.status === 200 && recalc.data.total_commission_kobo === 3500000, 'manual referral recalculation failed');

  const eventsBefore = db.prepare('SELECT COUNT(*) AS c FROM referral_commission_events WHERE client_id=?').get(longClient).c;
  const repeat = await request('/api/referral-commissions/backfill', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(repeat.status === 200, 'repeat referral backfill expected 200');
  const longAccountAgain = db.prepare('SELECT * FROM referral_commission_accounts WHERE client_id=?').get(longClient);
  assert(longAccountAgain.total_commission_kobo === 3500000, 'repeat backfill changed the long-term commission');
  const eventsAfter = db.prepare('SELECT COUNT(*) AS c FROM referral_commission_events WHERE client_id=?').get(longClient).c;
  assert(eventsAfter === eventsBefore, 'repeat backfill created duplicate commission events');

  const pay = await request(`/api/referral-commissions/${longAccount.id}/payments`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { amount: 10000, method: 'Bank Transfer' }
  });
  assert(pay.status === 200 && pay.data.status === 'Partially Paid', `partial referral payment expected Partially Paid, got ${pay.status}: ${JSON.stringify(pay.data)}`);
  const paidAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE id=?').get(longAccount.id);
  assert(paidAccount.paid_kobo === 1000000 && paidAccount.status === 'Partially Paid', 'partial referral payment totals incorrect');

  const overpay = await request(`/api/referral-commissions/${longAccount.id}/payments`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: { amount: 100000, method: 'Bank Transfer' }
  });
  assert(overpay.status === 400, 'referral commission overpayment should be rejected');

  const adjust = await request(`/api/referral-commissions/${longAccount.id}/adjustments`, {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { amount: -5000, adjustment_type: 'correction', reason: 'Phase 15 correction test' }
  });
  assert(adjust.status === 200 && adjust.data.adjusted_kobo === -500000, `referral adjustment expected -500,000 kobo, got ${JSON.stringify(adjust.data)}`);

  db.prepare("UPDATE payments SET status='reversed' WHERE id=?").run(longExtraPayment);
  const afterReversal = await request('/api/referral-commissions/backfill', {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(afterReversal.status === 200, 'reversal recalculation failed');
  const reversedAccount = db.prepare('SELECT * FROM referral_commission_accounts WHERE id=?').get(longAccount.id);
  assert(reversedAccount.total_paid_kobo === 12000000, 'reversed payment still counted in referral total');
  assert(reversedAccount.total_commission_kobo === 3500000, 'reversing the payment above the cap must not reduce the capped commission');

  const marketerView = await request('/api/referral-commissions', { headers: { Cookie: mkt1Cookie } });
  assert(marketerView.status === 200 && marketerView.data.entries.every(row => row.marketer_id === mkt1Id), 'marketer referral view leaked another marketer');
  const careView = await request('/api/referral-commissions', { headers: { Cookie: careNationalCookie } });
  assert(careView.status === 403, 'customer care must not see referral commissions');
  const configView = await request('/api/referral-commissions?status=Configuration%20Required', { headers: { Cookie: mdCookie } });
  assert(configView.status === 200 && configView.data.entries.some(row => row.client_id === eightMonthClient), 'configuration-required referral account missing from dashboard');
});

console.log('\n--- 13. Migration reproducibility and database integrity ---');
await test('all local migrations apply cleanly to a fresh SQLite database', async () => {
  const cleanPath = join(dirname(TEST_DB), 'phase8-clean-migrations.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(cleanPath + suffix, { force: true });
  const clean = new DatabaseSync(cleanPath);
  clean.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync('migrations').filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  assert(files.length === 22, `expected 22 migrations, found ${files.length}`);
  for (const file of files) {
    clean.exec(readFileSync(join('migrations', file), 'utf8'));
  }
  const tables = clean.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  assert(tables.length >= 43, `expected at least 43 tables, found ${tables.length}`);
  const integrity = clean.prepare('PRAGMA integrity_check').get();
  assert(Object.values(integrity)[0] === 'ok', 'clean migration database integrity check failed');
  const fk = clean.prepare('PRAGMA foreign_key_check').all();
  assert(fk.length === 0, 'clean migration database has foreign-key violations');
  clean.close();
});

await test('working test database remains structurally valid', async () => {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert(Object.values(integrity)[0] === 'ok', 'test database integrity check failed');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  assert(fk.length === 0, 'test database has foreign-key violations');
});

console.log('\n========================================================');
console.log(`   RESULT: ${passed} PASSED | ${failed} FAILED`);
if (failures.length) for (const f of failures) console.log(`   - ${f.name}: ${f.error}`);
console.log('========================================================\n');
process.exit(failed ? 1 : 0);
