import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
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

const mdId = upsertUser('md.p8@bliss.com', 'Phase 8 MD', 'Managing Director', null);
const bm1Id = upsertUser('bm.ikeja.p8@bliss.com', 'Phase 8 Ikeja BM', 'Branch Manager', ikeja);
const bm2Id = upsertUser('bm.ajah.p8@bliss.com', 'Phase 8 Ajah BM', 'Branch Manager', ajah);
const tlId = upsertUser('tl.ikeja.p8@bliss.com', 'Phase 8 Ikeja TL', 'Team Lead', ikeja);
const mkt1Id = upsertUser('mkt1.p8@bliss.com', 'Phase 8 Marketer One', 'Marketer', ikeja);
const mkt2Id = upsertUser('mkt2.p8@bliss.com', 'Phase 8 Marketer Two', 'Marketer', ikeja);
const mkt3Id = upsertUser('mkt3.p8@bliss.com', 'Phase 8 Ajah Marketer', 'Marketer', ajah);
const finId = upsertUser('fin.p8@bliss.com', 'Phase 8 Finance', 'Finance Officer', headOffice);
const clientUserId = upsertUser('client.p8@example.com', 'Phase 8 Client', 'Client', ikeja);
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
db.prepare("INSERT INTO team_members (team_id, user_id) SELECT id, ? FROM teams WHERE 0").run(tlId);

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
const finCookie = await login('fin.p8@bliss.com');
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
    body: { full_name: 'Rate Limited Signup', email: 'ratelimit.p8@example.com', phone_number: '08088000222', password: 'password123' }
  });
  assert(res.status === 429, `rate limited signup expected 429, got ${res.status}`);
});

await test('client onboarding stores alternate phone, next of kin and valid staff referral attribution', async () => {
  const signup = await request('/api/signup', {
    method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.55' },
    body: {
      full_name: 'Referred Client', email: 'referred.p8@example.com', phone_number: '08088000331',
      alternate_phone: '08088000332', next_of_kin_name: 'Next Kin', next_of_kin_phone: '08088000333',
      next_of_kin_relationship: 'Sibling', next_of_kin_address: '3 Next of Kin Street',
      referral_code: 'BL-P8-MD', password: 'password123'
    }
  });
  assert(signup.status === 200, `referred signup expected 200, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  const client = db.prepare('SELECT * FROM clients WHERE client_reference=?').get(signup.data.client_reference);
  assert(client, 'referred client record missing');
  assert(client.alternate_phone === '08088000332', 'alternate phone not stored');
  assert(client.next_of_kin_name === 'Next Kin' && client.next_of_kin_phone === '08088000333', 'next-of-kin details not stored');
  assert(client.next_of_kin_relationship === 'Sibling' && client.next_of_kin_address === '3 Next of Kin Street', 'next-of-kin relationship/address missing');
  assert(client.referral_code_used === 'BL-P8-MD' && client.referred_by_staff_id === mdId, 'staff referral attribution missing');
  assert(client.assigned_branch_id === headOffice, 'MD referral should fall back to Head Office branch');
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
      referral_code: 'DOES-NOT-EXIST', password: 'password123'
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
  const publish = await request(`/api/properties/${propDraft}`, { method: 'PUT', headers: { Cookie: bm1Cookie }, body: { is_published: true } });
  assert(publish.status === 200, 'draft publish expected 200');
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

console.log('\n--- 5. Migration reproducibility and database integrity ---');
await test('all local migrations apply cleanly to a fresh SQLite database', async () => {
  const cleanPath = join(dirname(TEST_DB), 'phase8-clean-migrations.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(cleanPath + suffix, { force: true });
  const clean = new DatabaseSync(cleanPath);
  clean.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync('migrations').filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  assert(files.length === 10, `expected 10 migrations, found ${files.length}`);
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
