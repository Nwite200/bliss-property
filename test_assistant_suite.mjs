import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import worker from './src/index.js';
import { resolveLiveDb } from './test_db_paths.mjs';

// ---------------------------------------------------------------------------
// Digital human / multi-property suite. It exercises the Worker directly with
// a copied D1 database, real sessions and scoped records. No frontend hiding.
// ---------------------------------------------------------------------------
const LIVE_DB = resolveLiveDb();
const TEST_DB = join(dirname(LIVE_DB), 'assistant-test.sqlite');
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
// The preferred local database may predate migration 0030.
const hasAssistantTables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_conversations'"
).get();
if (!hasAssistantTables) {
  db.exec(readFileSync('migrations/0030_digital_humans.sql', 'utf8'));
}

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
  return `pbkdf2$100000$${salt.toString('base64')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64')}`;
}

function roleId(name) {
  const row = db.prepare('SELECT id FROM roles WHERE name=?').get(name);
  if (!row) throw new Error(`Missing role ${name}`);
  return row.id;
}

function createUser(email, fullName, roleName, branchId = 1) {
  db.prepare('DELETE FROM users WHERE email=?').run(email);
  const id = Number(db.prepare(`
    INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(email, hashPw('password123'), fullName, roleId(roleName), branchId).lastInsertRowid);
  const sid = randomUUID();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now','+8 hours'))").run(sid, id);
  return { id, email, cookie: `bliss_session=${sid}` };
}

// ---------------------------------------------------------------------------
// Deterministic data
// ---------------------------------------------------------------------------
db.exec(`
  DELETE FROM assistant_messages;
  DELETE FROM assistant_handovers;
  DELETE FROM assistant_conversations;
  DELETE FROM assistant_event_acks;
  DELETE FROM assistant_preferences;
  DELETE FROM clients WHERE client_reference IN ('BLC-DH-001','BLC-DH-002');
  DELETE FROM properties WHERE reference IN ('BL-DH-P1','BL-DH-P2','BL-DH-P3');
`);

const md = createUser('dh.md@bliss.com', 'Digital Human MD', 'Managing Director', null);
const bm1 = createUser('dh.bm1@bliss.com', 'Digital Human BM One', 'Branch Manager', 1);
const bm2 = createUser('dh.bm2@bliss.com', 'Digital Human BM Two', 'Branch Manager', 2);
const mkt1 = createUser('dh.mkt1@bliss.com', 'Digital Human Marketer One', 'Marketer', 1);
const mkt2 = createUser('dh.mkt2@bliss.com', 'Digital Human Marketer Two', 'Marketer', 2);
const fin = createUser('dh.fin@bliss.com', 'Digital Human Finance', 'Finance Officer', 1);
const care = createUser('dh.care@bliss.com', 'Digital Human Care', 'Customer Care', 1);
const teamLead = createUser('dh.lead@bliss.com', 'Digital Human Team Lead', 'Team Lead', 1);
const otherLead = createUser('dh.lead2@bliss.com', 'Other Digital Team Lead', 'Team Lead', 1);
const clientUser = createUser('dh.client@bliss.com', 'Digital Human Client', 'Client', 1);
const otherClientUser = createUser('dh.other@bliss.com', 'Other Digital Client', 'Client', 1);

db.prepare('DELETE FROM clients WHERE user_id IN (?,?)').run(clientUser.id, otherClientUser.id);
const clientId = Number(db.prepare(`
  INSERT INTO clients (client_reference, full_name, phone_number, email_address, residential_address, state, city,
    status, assigned_branch_id, original_marketer_id, created_by, user_id, agreed_purchase_price, verification_status, kyc_status)
  VALUES ('BLC-DH-001','Digital Human Client','08012340001','dh.client@bliss.com','1 Test Road','Lagos','Ikeja',
    'Active Buyer',1,?,?,?,0,'pending','pending')
`).run(mkt1.id, mkt1.id, clientUser.id).lastInsertRowid);
const otherClientId = Number(db.prepare(`
  INSERT INTO clients (client_reference, full_name, phone_number, email_address, residential_address, state, city,
    status, assigned_branch_id, original_marketer_id, created_by, user_id, agreed_purchase_price)
  VALUES ('BLC-DH-002','Other Digital Client','08012340002','dh.other@bliss.com','2 Test Road','Lagos','Ikeja',
    'Active Buyer',1,?,?,?,0)
`).run(mkt1.id, mkt1.id, otherClientUser.id).lastInsertRowid);

const prop1 = Number(db.prepare(`
  INSERT INTO properties (reference,title,description,sale_price,state,city,address,branch_id,status,is_published,
    is_archived,is_internal_test,is_demo,workflow_status,created_by)
  VALUES ('BL-DH-P1','Digital Human Test Duplex','A real published test listing',50000000,'Lagos','Ikeja','3 Test Road',
    1,'Available',1,0,0,0,'published',?)
`).run(md.id).lastInsertRowid);
const prop2 = Number(db.prepare(`
  INSERT INTO properties (reference,title,description,sale_price,state,city,address,branch_id,status,is_published,
    is_archived,is_internal_test,is_demo,workflow_status,created_by)
  VALUES ('BL-DH-P2','Digital Human Test Apartment','A second real published listing',25000000,'Lagos','Lekki','4 Test Road',
    1,'Available',1,0,0,0,'published',?)
`).run(md.id).lastInsertRowid);
const internalProp = Number(db.prepare(`
  INSERT INTO properties (reference,title,description,sale_price,state,city,address,branch_id,status,is_published,
    is_archived,is_internal_test,is_demo,workflow_status,created_by)
  VALUES ('BL-DH-P3','Internal Only Test Property','Must never appear in public search',30000000,'Lagos','Ikeja','5 Test Road',
    1,'Available',1,0,1,0,'published',?)
`).run(md.id).lastInsertRowid);
db.prepare('DELETE FROM property_payment_plans WHERE property_id IN (?,?,?)').run(prop1, prop2, internalProp);
const planId = Number(db.prepare(`
  INSERT INTO property_payment_plans (property_id,plan_type,total_price_kobo,deposit_kobo,installment_kobo,
    duration_months,number_of_installments,is_enabled,created_by)
  VALUES (?, 'monthly', 5000000000, 1000000000, 500000000, 10, 8, 1, ?)
`).run(prop1, md.id).lastInsertRowid);

db.prepare("DELETE FROM leads WHERE lead_reference IN ('LD-DH-001','LD-DH-002')").run();
db.prepare(`
  INSERT INTO leads (lead_reference,full_name,phone_number,email_address,status,branch_id,assigned_marketer_id,
    team_lead_id,created_by,created_at)
  VALUES ('LD-DH-001','Authorised Digital Lead','08099990001','lead1@example.com','New Lead',1,?,NULL,?,datetime('now'))
`).run(mkt1.id, mkt1.id);
db.prepare(`
  INSERT INTO leads (lead_reference,full_name,phone_number,email_address,status,branch_id,assigned_marketer_id,
    team_lead_id,created_by,created_at)
  VALUES ('LD-DH-002','Other Branch Lead','08099990002','lead2@example.com','New Lead',2,?,NULL,?,datetime('now'))
`).run(mkt2.id, mkt2.id);

db.prepare("DELETE FROM payments WHERE transaction_ref IN ('TX-DH-B1','TX-DH-B2')").run();
db.prepare(`
  INSERT INTO payments (client_id,property_id,transaction_ref,amount,currency,method,status,amount_kobo,
    is_demo,verified_at,verified_by,created_at,revenue_branch_id)
  VALUES (?,?,'TX-DH-B1',1000000,'NGN','Bank Transfer','verified',100000000,0,datetime('now'),?,datetime('now'),1)
`).run(clientId, prop1, fin.id);
db.prepare(`
  INSERT INTO payments (client_id,property_id,transaction_ref,amount,currency,method,status,amount_kobo,
    is_demo,verified_at,verified_by,created_at,revenue_branch_id)
  VALUES (?,?,'TX-DH-B2',2000000,'NGN','Bank Transfer','verified',200000000,0,datetime('now'),?,datetime('now'),2)
`).run(otherClientId, prop2, fin.id);

db.prepare("DELETE FROM notifications WHERE title IN ('Digital payment verified','Other client private update')").run();
db.prepare(`
  INSERT INTO notifications (client_id,type,title,message,is_read,created_at)
  VALUES (?,'payment.verified','Digital payment verified','NGN 1,000,000 was verified.',0,datetime('now'))
`).run(clientId);
db.prepare(`
  INSERT INTO notifications (client_id,type,title,message,is_read,created_at)
  VALUES (?,'payment.verified','Other client private update','This must never reach the first client.',0,datetime('now'))
`).run(otherClientId);

db.prepare("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE name='Digital Human Team')").run();
db.prepare("DELETE FROM teams WHERE name='Digital Human Team'").run();
const teamId = Number(db.prepare(`
  INSERT INTO teams (name, branch_id, team_lead_user_id, is_active)
  VALUES ('Digital Human Team', 1, ?, 1)
`).run(teamLead.id).lastInsertRowid);

const env = {
  DB: createD1Adapter(db),
  ENVIRONMENT: 'test',
  TASKS: { async send() { return true; } },
  ASSETS: { async fetch() { return new Response('Not found', { status: 404 }); } }
};

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
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name, error: error.message });
    console.error(`  ❌ ${name}\n     ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assistant(cookie, message, extra = {}) {
  const res = await request('/api/assistant/message', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: { message, page: extra.page || '/index.html', ...extra }
  });
  assert(res.status === 200, `assistant ${JSON.stringify(message)} expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data;
}

console.log('\n========================================================');
console.log('   BLISS LEGACY — DIGITAL HUMAN & MULTI-PROPERTY SUITE');
console.log('========================================================');

await test('anonymous bootstrap exposes nine personas and Adaora with no private data', async () => {
  const res = await request('/api/assistant/bootstrap?page=/index.html');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.data.authenticated === false, 'anonymous bootstrap must not be authenticated');
  assert(res.data.personas.length === 9, `expected 9 personas, got ${res.data.personas.length}`);
  assert(res.data.persona.key === 'adaora', 'anonymous default persona must be Adaora');
  assert(!res.data.messages.length, 'anonymous bootstrap must not return another conversation');
});

await test('anonymous property search returns only published, non-internal listings', async () => {
  const data = await assistant(null, 'Find a property in Lagos', { page: '/index.html', visitor_id: 'visitor-test-1' });
  assert(data.persona.key === 'solomon', `expected Solomon, got ${data.persona.key}`);
  assert(data.reply.includes('found') || data.reply.includes('did not find'), 'expected an honest property reply');
  assert(data.cards.some(card => card.title === 'Digital Human Test Duplex'), 'expected the published duplex');
  assert(!data.cards.some(card => card.title.includes('Internal Only')), 'internal property must never appear');
});

await test('client dashboard starts with Amara and the specified greeting', async () => {
  const res = await request('/api/assistant/bootstrap?page=/client-dashboard.html', { headers: { Cookie: clientUser.cookie } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.data.authenticated === true, 'client bootstrap should be authenticated');
  assert(res.data.persona.key === 'amara', `expected Amara, got ${res.data.persona.key}`);
  assert(/Welcome back to Bliss Legacy Limited/.test(res.data.greeting), 'client greeting missing');
});

await test('client portfolio conversation is scoped to the signed-in client', async () => {
  const data = await assistant(clientUser.cookie, 'Show my properties', { page: '/client-dashboard.html' });
  assert(data.persona.key === 'amara', 'client portfolio should use Amara');
  assert(!data.reply.includes('Other Digital Client'), 'portfolio reply leaked another client');
  assert(/portfolio|property/i.test(data.reply), 'portfolio reply was not useful');
});

await test('client password reset guidance is phone-first and needs no email', async () => {
  const data = await assistant(clientUser.cookie, 'I forgot my password and I do not have email', { page: '/forgot-password.html' });
  assert(/SMS|phone/i.test(data.reply), 'phone/SMS reset guidance missing');
  assert(/no email|without one|email is optional|does not require/i.test(data.reply), 'must explicitly say email is not required');
});

await test('registration guidance explains that email is optional', async () => {
  const data = await assistant(null, 'How do I register?', { page: '/signup.html' });
  assert(/Email is optional/i.test(data.reply), 'registration reply should state email is optional');
  assert(data.cards.some(card => /signup\.html/.test(card.href || '')), 'registration card missing');
});

await test('form awareness lists missing fields and never echoes secret values', async () => {
  const data = await assistant(clientUser.cookie, 'Check my form', {
    page: '/signup.html',
    form_context: {
      page: '/signup.html',
      fields: [
        { name: 'full_name', label: 'Full name', required: true, filled: false, valid: true },
        { name: 'phone_number', label: 'Phone number', required: true, filled: true, valid: true },
        { name: 'password', label: 'Password', required: true, filled: false, valid: true }
      ]
    }
  });
  assert(/Full name/i.test(data.reply), 'missing full name was not reported');
  assert(!/Password/i.test(data.reply), 'password field must never be repeated');
});

await test('onboarding status is read from the real client workflow fields', async () => {
  const data = await assistant(clientUser.cookie, 'What is my onboarding status?', { page: '/client-dashboard.html' });
  assert(/status/i.test(data.reply), 'status reply missing');
  assert(/pending|verified/i.test(data.reply), 'verification/kyc state missing');
  assert(/not assuming|real workflow|reading/i.test(data.reply), 'should not claim approval from submission');
});

await test('Adaora transfers to Solomon, then Emeka, then back to Adaora without losing context', async () => {
  const first = await assistant(clientUser.cookie, 'Find a property for me', { page: '/client-dashboard.html' });
  assert(first.persona.key === 'solomon', `expected Solomon, got ${first.persona.key}`);
  const ref = first.conversation_ref;
  const second = await assistant(clientUser.cookie, 'I want to rent instead', { page: '/client-dashboard.html' });
  assert(second.persona.key === 'emeka', `expected Emeka, got ${second.persona.key}`);
  assert(second.conversation_ref === ref, 'conversation reference changed during persona transfer');
  const third = await assistant(clientUser.cookie, 'Talk to Adaora', { page: '/client-dashboard.html' });
  assert(third.persona.key === 'adaora', `expected Adaora, got ${third.persona.key}`);
  assert(third.conversation_ref === ref, 'conversation reference changed again');
  const boot = await request('/api/assistant/bootstrap?page=/client-dashboard.html', { headers: { Cookie: clientUser.cookie } });
  assert(boot.data.conversation_ref === ref, 'bootstrap did not restore the conversation');
  assert(boot.data.messages.length >= 3, 'bootstrap did not return conversation history');
});

await test('client can add a published property using a published plan price', async () => {
  const res = await request('/api/client/properties', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie },
    body: { property_id: prop1, plan_id: planId, start_date: '2026-01-05' }
  });
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert(res.data.ok === true, 'add property did not succeed');
  assert(Number(res.data.property.agreed_purchase_price_kobo) === 5000000000, 'price must come from the published plan');
  const allocation = db.prepare('SELECT * FROM client_properties WHERE client_id=? AND property_id=?').get(clientId, prop1);
  assert(allocation && Number(allocation.agreed_purchase_price) === 50000000, 'allocation was not persisted');
  const schedule = db.prepare("SELECT * FROM payment_schedules WHERE client_id=? AND property_id=? AND status='active'").get(clientId, prop1);
  assert(schedule, 'payment schedule was not created');
});

await test('client cannot set or override the contract price during self-service', async () => {
  const res = await request('/api/client/properties', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie },
    body: { property_id: prop2, plan_id: null, agreed_purchase_price: 1, sale_price: 1 }
  });
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  const allocation = db.prepare('SELECT * FROM client_properties WHERE client_id=? AND property_id=?').get(clientId, prop2);
  assert(allocation && Number(allocation.agreed_purchase_price) === 25000000, 'client was able to override the published price');
});

await test('duplicate self-service allocation is rejected', async () => {
  const res = await request('/api/client/properties', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie },
    body: { property_id: prop1, plan_id: planId }
  });
  assert(res.status === 409, `expected 409, got ${res.status}`);
});

await test('internal/demo property cannot be self-added', async () => {
  const res = await request('/api/client/properties', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie },
    body: { property_id: internalProp }
  });
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test('unauthenticated and marketer self-service allocation are rejected', async () => {
  const anon = await request('/api/client/properties', { method: 'POST', body: { property_id: prop1 } });
  assert(anon.status === 403 || anon.status === 401, `anonymous expected 403/401, got ${anon.status}`);
  const staff = await request('/api/client/properties', {
    method: 'POST',
    headers: { Cookie: mkt1.cookie },
    body: { property_id: prop1 }
  });
  assert(staff.status === 403, `marketer expected 403, got ${staff.status}`);
});

await test('cross-client property payment account is not exposed', async () => {
  const allocation = db.prepare('SELECT id FROM client_properties WHERE client_id=? AND property_id=?').get(clientId, prop1);
  const res = await request(`/api/client/properties/${allocation.id}/payment-account`, {
    method: 'POST',
    headers: { Cookie: otherClientUser.cookie },
    body: { amount: 100 }
  });
  assert(res.status === 404, `expected 404 for another client's allocation, got ${res.status}`);
});

await test('marketer sees only assigned leads and cannot access finance intelligence', async () => {
  const leads = await assistant(mkt1.cookie, 'Show my assigned leads', { page: '/dashboard.html' });
  assert(leads.persona.key === 'david', 'lead intelligence should use David');
  assert(leads.cards.some(card => card.title === 'Authorised Digital Lead'), 'assigned lead missing');
  assert(!leads.cards.some(card => card.title === 'Other Branch Lead'), 'another marketer lead leaked');
  const finance = await assistant(mkt1.cookie, 'Show today verified payments', { page: '/dashboard.html' });
  assert(/restricted|authorised finance/i.test(finance.reply), 'marketer should be denied finance records');
});

await test('branch manager finance summary stays inside the branch', async () => {
  const own = await assistant(bm1.cookie, "Show today's verified payments", { page: '/finance-dashboard.html' });
  assert(/NGN|₦/.test(own.reply), 'branch finance reply missing amount');
  assert(!/2,000,000/.test(own.reply), 'branch one reply leaked branch two amount');
  const other = await assistant(bm2.cookie, "Show today's verified payments", { page: '/finance-dashboard.html' });
  assert(!/1,000,000/.test(other.reply), 'branch two reply leaked branch one amount');
});

await test('finance officer sees both branches while a client cannot access finance intelligence', async () => {
  const finance = await assistant(fin.cookie, "Show today's verified payments", { page: '/finance-dashboard.html' });
  assert(/3,000,000/.test(finance.reply) || /3000000/.test(finance.reply), `finance total should include both branches: ${finance.reply}`);
  const client = await assistant(clientUser.cookie, 'Show company finance summary', { page: '/client-dashboard.html' });
  assert(!/3,000,000/.test(client.reply), 'client received company finance totals');
});

await test('MD management intelligence is allowed and branch-scoped for branch managers', async () => {
  const mdSummary = await assistant(md.cookie, 'Company performance summary', { page: '/dashboard.html' });
  assert(mdSummary.persona.key === 'ifeoma', 'management overview should use Ifeoma');
  assert(/client\(s\)/i.test(mdSummary.reply), 'MD summary missing client count');
  const bmSummary = await assistant(bm1.cookie, 'Branch performance summary', { page: '/dashboard.html' });
  assert(/branch/i.test(bmSummary.reply), 'branch summary missing branch label');
});

await test('human handover requires explicit confirmation and stays pending', async () => {
  const prompt = await assistant(clientUser.cookie, 'I want to talk to a human', { page: '/client-dashboard.html' });
  assert(prompt.action && prompt.action.type === 'confirm_handover', 'handover confirmation action missing');
  assert(!/accepted|connected|joined/i.test(prompt.reply), 'must not claim a human joined before acceptance');
  assert(db.prepare('SELECT COUNT(*) c FROM assistant_handovers').get().c === 0, 'handover row created without confirmation');
  const confirmed = await assistant(clientUser.cookie, 'Yes, request a human handover', {
    page: '/client-dashboard.html', confirm_handover: true
  });
  assert(confirmed.handover && confirmed.handover.status === 'pending', 'confirmed handover should be pending');
  assert(confirmed.handover.assigned_name, 'handover should match an available staff member');
  assert(/not connected|not yet|as soon as they accept|will tell you/i.test(confirmed.reply), 'reply must be honest about pending state');
});

await test('assigned customer care can accept a handover and the client sees it', async () => {
  const handover = db.prepare('SELECT * FROM assistant_handovers ORDER BY id DESC LIMIT 1').get();
  const inbox = await request('/api/assistant/handovers', { headers: { Cookie: care.cookie } });
  assert(inbox.status === 200 && inbox.data.handovers.some(h => h.id === handover.id), 'care staff did not see the handover');
  const accepted = await request(`/api/assistant/handovers/${handover.id}/accept`, {
    method: 'POST', headers: { Cookie: care.cookie }, body: {}
  });
  assert(accepted.status === 200 && accepted.data.handover.status === 'accepted', 'handover was not accepted');
  const status = await request('/api/assistant/handover-status', { headers: { Cookie: clientUser.cookie } });
  assert(status.data.handover && status.data.handover.status === 'accepted', 'client does not see accepted status');
  const note = db.prepare("SELECT * FROM notifications WHERE client_id=? AND type='assistant.handover.accepted' ORDER BY id DESC LIMIT 1").get(clientId);
  assert(note, 'client handover acceptance notification missing');
});

await test('staff availability is honoured by handover routing', async () => {
  const busy = await request('/api/assistant/availability', {
    method: 'POST', headers: { Cookie: care.cookie }, body: { status: 'busy' }
  });
  assert(busy.status === 200 && busy.data.status === 'busy', 'availability update failed');
  const boot = await request('/api/assistant/bootstrap?page=/customer-care.html', { headers: { Cookie: care.cookie } });
  assert(boot.data.staff_availability === 'busy', 'bootstrap did not return busy availability');
  const confirmed = await assistant(clientUser.cookie, 'Yes, request a human handover', {
    page: '/client-dashboard.html', confirm_handover: true
  });
  assert(confirmed.handover, 'handover was not created');
  assert(!confirmed.handover.assigned_name, 'a busy specialist was still assigned');
  assert(confirmed.handover.status === 'unassigned', 'busy routing should leave the request unassigned');
  await request('/api/assistant/availability', {
    method: 'POST', headers: { Cookie: care.cookie }, body: { status: 'available' }
  });
});

await test('unrelated client cannot read a handover transcript', async () => {
  const handover = db.prepare('SELECT id FROM assistant_handovers ORDER BY id DESC LIMIT 1').get();
  const res = await request(`/api/assistant/handovers/${handover.id}`, { headers: { Cookie: otherClientUser.cookie } });
  assert(res.status === 403, `expected 403 for unrelated client, got ${res.status}`);
});

await test('client events include own payment notification but never another client notification', async () => {
  const res = await request('/api/assistant/events', { headers: { Cookie: clientUser.cookie } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.data.events.some(event => event.title === 'Digital payment verified'), 'own payment event missing');
  assert(!res.data.events.some(event => event.title === 'Other client private update'), 'another client event leaked');
});

await test('event acknowledgement prevents duplicate announcements', async () => {
  const first = await request('/api/assistant/events', { headers: { Cookie: clientUser.cookie } });
  const keys = first.data.events.map(event => event.key);
  const ack = await request('/api/assistant/events/ack', {
    method: 'POST', headers: { Cookie: clientUser.cookie }, body: { keys }
  });
  assert(ack.status === 200 && ack.data.ok, 'event ack failed');
  const second = await request('/api/assistant/events', { headers: { Cookie: clientUser.cookie } });
  assert(!second.data.events.some(event => keys.includes(event.key)), 'acked event was returned again');
});

await test('assistant conversation and preferences persist for the signed-in user', async () => {
  const prefs = await request('/api/assistant/preferences', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie },
    body: { voice_enabled: false, muted: true, rate: 1.2, pitch: 0.9, preferred_persona: 'solomon' }
  });
  assert(prefs.status === 200 && prefs.data.preferences.muted === true, 'preferences were not saved');
  const boot = await request('/api/assistant/bootstrap?page=/client-dashboard.html', { headers: { Cookie: clientUser.cookie } });
  assert(boot.data.preferences.muted === true, 'muted preference did not persist');
  assert(boot.data.preferences.rate === 1.2, 'speech rate preference did not persist');
  assert(boot.data.messages.length > 0, 'conversation history did not persist');
});

await test('temporary-password clients cannot read portfolio data through the assistant', async () => {
  db.prepare('UPDATE users SET must_reset_password=1 WHERE id=?').run(clientUser.id);
  const boot = await request('/api/assistant/bootstrap?page=/client-dashboard.html', { headers: { Cookie: clientUser.cookie } });
  assert(boot.status === 200 && boot.data.password_change_required === true, 'bootstrap must expose the password gate');
  assert(!boot.data.messages.length, 'gated bootstrap must not restore private conversation history');
  const message = await request('/api/assistant/message', {
    method: 'POST', headers: { Cookie: clientUser.cookie }, body: { message: 'Show my properties' }
  });
  assert(message.status === 200 && /temporary password/i.test(message.data.reply), 'gated assistant reply missing');
  assert(!/₦|portfolio value|verified payment/i.test(message.data.reply), 'gated reply leaked portfolio data');
  const events = await request('/api/assistant/events', { headers: { Cookie: clientUser.cookie } });
  assert(events.status === 200 && events.data.events.length === 0, 'gated client received events');
  db.prepare('UPDATE users SET must_reset_password=0 WHERE id=?').run(clientUser.id);
});

await test('team lead can add an existing marketer in the branch to their team', async () => {
  const available = await request(`/api/teams/${teamId}/available-members`, { headers: { Cookie: teamLead.cookie } });
  assert(available.status === 200, `expected 200, got ${available.status}`);
  assert(available.data.available.some(row => row.id === mkt1.id), 'eligible branch marketer not listed');
  assert(!available.data.available.some(row => row.id === mkt2.id), 'cross-branch marketer was listed');
  const added = await request(`/api/teams/${teamId}/members`, {
    method: 'POST', headers: { Cookie: teamLead.cookie }, body: { user_ids: [mkt1.id] }
  });
  assert(added.status === 200 && added.data.added.includes(mkt1.id), `add failed: ${JSON.stringify(added.data)}`);
  assert(db.prepare('SELECT 1 AS ok FROM team_members WHERE team_id=? AND user_id=?').get(teamId, mkt1.id), 'team membership not persisted');
  const note = db.prepare("SELECT * FROM notifications WHERE user_id=? AND type='team.member.added' ORDER BY id DESC LIMIT 1").get(mkt1.id);
  assert(note, 'added marketer was not notified');
});

await test('team lead cannot add staff from another branch or a non-marketer', async () => {
  const cross = await request(`/api/teams/${teamId}/members`, {
    method: 'POST', headers: { Cookie: teamLead.cookie }, body: { user_ids: [mkt2.id] }
  });
  assert(cross.status === 400, `cross-branch add should be 400, got ${cross.status}`);
  const careAdd = await request(`/api/teams/${teamId}/members`, {
    method: 'POST', headers: { Cookie: teamLead.cookie }, body: { user_ids: [care.id] }
  });
  assert(careAdd.status === 400, `non-marketer add should be 400, got ${careAdd.status}`);
});

await test('a different team lead cannot add staff to a team they do not lead', async () => {
  const res = await request(`/api/teams/${teamId}/members`, {
    method: 'POST', headers: { Cookie: otherLead.cookie }, body: { user_ids: [mkt1.id] }
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await test('team lead can remove a member but not the team lead', async () => {
  const removeSelf = await request(`/api/teams/${teamId}/members/${teamLead.id}`, {
    method: 'DELETE', headers: { Cookie: teamLead.cookie }
  });
  assert(removeSelf.status === 400, `removing the lead should be 400, got ${removeSelf.status}`);
  const remove = await request(`/api/teams/${teamId}/members/${mkt1.id}`, {
    method: 'DELETE', headers: { Cookie: teamLead.cookie }
  });
  assert(remove.status === 200, `expected 200, got ${remove.status}`);
  assert(!db.prepare('SELECT 1 AS ok FROM team_members WHERE team_id=? AND user_id=?').get(teamId, mkt1.id), 'membership was not removed');
});

await test('premium voice is optional and falls back to the browser cleanly', async () => {
  const boot = await request('/api/assistant/bootstrap?page=/index.html');
  assert(boot.data.tts && boot.data.tts.enabled === false, 'test environment should not have a premium voice key');
  const speech = await request('/api/assistant/speech', {
    method: 'POST', headers: { Cookie: clientUser.cookie },
    body: { text: 'Welcome to Bliss Legacy Limited.', persona_key: 'adaora' }
  });
  assert(speech.status === 503, `expected 503 without a provider key, got ${speech.status}`);
  assert(speech.data.fallback === 'browser', 'missing browser fallback signal');
});

await test('security headers block framing, sniffing and unsafe cross-origin loading', async () => {
  const res = await request('/api/health');
  const csp = res.headers.get('content-security-policy') || '';
  assert(/frame-ancestors 'none'/.test(csp), 'CSP frame-ancestors missing');
  assert(/object-src 'none'/.test(csp), 'CSP object-src missing');
  assert(!/unsafe-eval/.test(csp), 'CSP must not allow unsafe-eval');
  assert(res.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options missing');
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  assert(res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'referrer policy missing');
  assert(/microphone=\(self\)/.test(res.headers.get('permissions-policy') || ''), 'microphone permission policy missing');
  assert(res.headers.get('cache-control') === 'no-store', 'API cache-control should be no-store');
});

await test('malformed cookies do not cause a 500', async () => {
  const res = await request('/api/me', { headers: { Cookie: 'bliss_session=%E0%A4%A' } });
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

await test('public-signup XSS sinks are escaped and production assets run through the security wrapper', async () => {
  const fs = await import('node:fs');
  const clients = fs.readFileSync('assets/js/clients.js', 'utf8');
  assert(/function esc\(/.test(clients), 'clients.js escaping helper missing');
  assert(!/<td>\$\{c\.full_name\}<\/td>/.test(clients), 'clients.js still renders full_name unescaped');
  const finance = fs.readFileSync('finance-dashboard.html', 'utf8');
  assert(/\$\{esc\(s\.client_name\)\}/.test(finance), 'finance dashboard client name is not escaped');
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  const prodAssets = wrangler.slice(wrangler.indexOf('[env.production.assets]'));
  assert(/run_worker_first\s*=\s*true/.test(prodAssets), 'production assets must run through the Worker for security headers');
});

await test('unknown requests fall back honestly instead of inventing data', async () => {
  const data = await assistant(md.cookie, 'What is the exact profit for next Tuesday?', { page: '/dashboard.html' });
  assert(/will not guess|not invent|cannot|authorised/i.test(data.reply), 'fallback should not fabricate an answer');
  assert(!/NGN|₦/.test(data.reply), 'fallback should not invent money');
});

await test('cross-site assistant messages are rejected', async () => {
  const res = await request('/api/assistant/message', {
    method: 'POST',
    headers: { Cookie: clientUser.cookie, Origin: 'https://evil.example', Host: 'localhost' },
    body: { message: 'Show my properties' }
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await test('marketplace search does not fabricate a property when nothing matches', async () => {
  const data = await assistant(null, 'Find a property under 1 naira in Mars', { page: '/properties.html', visitor_id: 'visitor-test-2' });
  assert(/did not find|not find|no published/i.test(data.reply), 'empty search should be stated honestly');
  assert(!data.cards.length, 'empty search must not return invented cards');
});

await test('every persona has a supplied portrait asset', async () => {
  const fs = await import('node:fs');
  const boot = await request('/api/assistant/bootstrap?page=/index.html');
  assert(boot.data.personas.length === 9, 'expected nine personas');
  for (const persona of boot.data.personas) {
    assert(persona.image && persona.image.endsWith('.jpg'), `${persona.key} is missing an image path`);
    const file = '.' + persona.image;
    assert(fs.existsSync(file), `${persona.key} portrait missing at ${file}`);
    const stat = fs.statSync(file);
    assert(stat.size > 5000, `${persona.key} portrait is too small to be a real portrait`);
  }
});

await test('assistant HTML assets are present and the global loader is injected once per page', async () => {
  const fs = await import('node:fs');
  assert(fs.existsSync('assets/js/digital-human.js'), 'digital-human.js missing');
  assert(fs.existsSync('assets/css/digital-human.css'), 'digital-human.css missing');
  const pages = fs.readdirSync('.').filter(name => name.endsWith('.html'));
  assert(pages.length >= 20, 'expected the full page set');
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const count = (html.match(/assets\/js\/digital-human\.js/g) || []).length;
    assert(count === 1, `${page} should include the digital human exactly once (found ${count})`);
  }
});

console.log('\n========================================================');
console.log(`   RESULT: ${passed} PASSED | ${failed} FAILED`);
console.log('========================================================');
if (failed) {
  for (const failure of failures) console.error(` - ${failure.name}: ${failure.error}`);
  process.exit(1);
}
