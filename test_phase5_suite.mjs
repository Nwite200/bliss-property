import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import worker from './src/index.js';
import { resolveLiveDb } from './test_db_paths.mjs';

// ---------------------------------------------------------------------------
// Test harness: copy the local D1 database, seed a deterministic dataset, then
// exercise the Worker directly (no browser, no frontend hiding).
// ---------------------------------------------------------------------------
const LIVE_DB = resolveLiveDb();
const TEST_DB = join(dirname(LIVE_DB), 'phase5-test.sqlite');

if (!existsSync(LIVE_DB)) {
  console.error(`Local D1 database not found at ${LIVE_DB}. Run: npm run db:migrate:local`);
  process.exit(1);
}
mkdirSync(dirname(TEST_DB), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(TEST_DB + suffix, { force: true });
}
// Flush the live WAL first so the copied schema/data is complete.
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
          const stmt = database.prepare(sql);
          return { results: stmt.all(...boundArgs) };
        },
        async first() {
          const stmt = database.prepare(sql);
          return stmt.get(...boundArgs) || null;
        },
        async run() {
          const stmt = database.prepare(sql);
          const info = stmt.run(...boundArgs);
          return {
            meta: {
              last_row_id: Number(info.lastInsertRowid),
              changes: Number(info.changes)
            }
          };
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
    db.prepare(`UPDATE clients SET full_name=?, phone_number=?, email_address=?, residential_address=?, state=?, city=?,
      next_of_kin=?, status=?, assigned_branch_id=?, created_by=?, original_marketer_id=?, team_lead_id=?,
      agreed_purchase_price=?, interested_property_id=?, user_id=?, is_deleted=0 WHERE id=?`).run(
      data.full_name, data.phone_number, data.email_address || null, data.address || null, data.state || null,
      data.city || null, data.next_of_kin || null, data.status || 'Active Buyer', data.branchId,
      data.createdBy, data.marketerId, data.teamLeadId || null, data.agreedPrice || 0,
      data.propertyId || null, data.userId || null, existing.id
    );
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, email_address,
    residential_address, state, city, next_of_kin, status, assigned_branch_id, created_by,
    original_marketer_id, team_lead_id, agreed_purchase_price, interested_property_id, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ref, data.full_name, data.phone_number, data.email_address || null, data.address || null,
    data.state || null, data.city || null, data.next_of_kin || null, data.status || 'Active Buyer',
    data.branchId, data.createdBy, data.marketerId, data.teamLeadId || null,
    data.agreedPrice || 0, data.propertyId || null, data.userId || null
  );
  return Number(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Deterministic seed
// ---------------------------------------------------------------------------
const mdId = upsertUser('md@bliss.com', 'Managing Director', 1, null);
const bmId = upsertUser('bm.ikeja@bliss.com', 'Ikeja Branch Manager', 2, 1);
const bm2Id = upsertUser('bm.ajah@bliss.com', 'Ajah Branch Manager', 2, 2);
const tlId = upsertUser('tl.ikeja@bliss.com', 'Ikeja Team Lead', 3, 1);
const mktId = upsertUser('mkt.ikeja@bliss.com', 'Ikeja Marketer', 4, 1);
const mkt2Id = upsertUser('mkt.ajah@bliss.com', 'Ajah Marketer', 4, 2);
const finId = upsertUser('finance@bliss.com', 'Head Finance Officer', 5, 1);
const adaUserId = upsertUser('ada@example.com', 'Ada Nwosu', 6, 1);
const musaUserId = upsertUser('musa@example.com', 'Musa Dike', 6, 1);
const demoUserId = upsertUser('demo@bliss.com', 'Demo Investor', 6, 1);
const noPlanUserId = upsertUser('noplan@example.com', 'No Plan Client', 6, 1);

const prop = db.prepare("SELECT id FROM properties WHERE reference='BLP-TEST-001'").get();
let propId;
if (prop) {
  propId = prop.id;
  db.prepare("UPDATE properties SET title='Luxury Ikeja Apartment', sale_price=888888888, city='Ikeja', state='Lagos', status='Reserved', is_published=1, branch_id=1 WHERE id=?").run(propId);
} else {
  const r = db.prepare(`INSERT INTO properties (reference, title, description, sale_price, state, city, address, branch_id, status, is_published, created_by)
    VALUES ('BLP-TEST-001','Luxury Ikeja Apartment','A test property for Phase 5 verification.',888888888,'Lagos','Ikeja','1 Test Close',1,'Reserved',1,?)`).run(mdId);
  propId = Number(r.lastInsertRowid);
}

const adaId = upsertClient('BLC-MW2ER37J', {
  full_name: 'Ada Nwosu', phone_number: '08011112222', email_address: 'ada@example.com',
  address: '14 Victoria Island, Lagos', state: 'Lagos', city: 'Ikeja',
  next_of_kin: 'Emeka Nwosu (Brother)', branchId: 1, createdBy: mktId, marketerId: mktId,
  teamLeadId: tlId, agreedPrice: 12000000, propertyId: propId, userId: adaUserId
});
const musaId = upsertClient('BLC-MW2F7LG0', {
  full_name: 'Musa Dike', phone_number: '08033334444', email_address: 'musa@example.com',
  address: '2 Abuja Road', state: 'FCT', city: 'Abuja', branchId: 1, createdBy: mktId,
  marketerId: mktId, teamLeadId: tlId, agreedPrice: 20000000, propertyId: propId, userId: musaUserId
});
const demoClientId = upsertClient('DEMO-CLIENT-001', {
  full_name: 'Demo Investor', phone_number: '08099998888', email_address: 'demo@bliss.com',
  address: 'Demo Street, Abuja', state: 'FCT', city: 'Abuja', branchId: 1, createdBy: mktId,
  marketerId: mktId, agreedPrice: 15000000, propertyId: propId, userId: demoUserId
});
const noPlanId = upsertClient('BLC-NOPLAN-001', {
  full_name: 'No Plan Client', phone_number: '08055556666', email_address: 'noplan@example.com',
  branchId: 1, createdBy: mktId, marketerId: mktId, agreedPrice: 5000000, propertyId: propId, userId: noPlanUserId
});
const crossBranchId = upsertClient('BLC-CROSS-001', {
  full_name: 'Cross Branch Client', phone_number: '08077778888', email_address: 'cross@example.com',
  branchId: 2, createdBy: mkt2Id, marketerId: mkt2Id, agreedPrice: 9000000, propertyId: propId
});

// Clean transactional state
for (const cid of [adaId, musaId, demoClientId, noPlanId, crossBranchId]) {
  db.prepare('DELETE FROM receipts WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM payments WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM payment_schedules WHERE client_id=?').run(cid);
  db.prepare('DELETE FROM notifications WHERE client_id=?').run(cid);
}
db.prepare('DELETE FROM sessions').run();
db.prepare('DELETE FROM password_reset_tokens').run();
db.prepare('DELETE FROM audit_logs').run();
db.prepare('DELETE FROM webhook_events').run();
db.prepare('DELETE FROM notification_dedupe').run();
db.prepare('DELETE FROM notification_deliveries').run();
db.prepare("UPDATE provider_configs SET status='Awaiting onboarding', environment='sandbox', webhook_secret=NULL WHERE provider_key='wema_alat'").run();

const adaPayment1 = Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, method, status, is_demo, verified_at, verified_by, created_at)
  VALUES (?, ?, 'TX-VERIFIED-ADA-01', 5000000, 500000000, 'Bank Transfer', 'verified', 0, datetime('now','-2 days'), ?, datetime('now','-2 days'))`).run(adaId, propId, finId).lastInsertRowid);
db.prepare(`INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, amount_kobo, remaining_balance_kobo, is_demo)
  VALUES (?, ?, 'RCP-BLISS-001', 5000000, 500000000, 700000000, 0)`).run(adaPayment1, adaId);
const adaPayment2 = Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, method, status, is_demo, created_at)
  VALUES (?, ?, 'TX-PENDING-ADA-02', 2000000, 200000000, 'Bank Transfer', 'pending', 0, datetime('now','-3 hours'))`).run(adaId, propId).lastInsertRowid);
const adaPayment3 = Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, method, status, is_demo, created_at)
  VALUES (?, ?, 'TX-FAILED-ADA-03', 1000000, 100000000, 'Bank Transfer', 'failed', 0, datetime('now','-1 days'))`).run(adaId, propId).lastInsertRowid);
const demoScheduleId = Number(db.prepare(`INSERT INTO payment_schedules (client_id, property_id, total_amount, total_kobo, deposit_amount, deposit_kobo, installment_amount, installment_kobo, frequency_days, next_due_date, status, created_by)
  VALUES (?, ?, 12000000, 1200000000, 3000000, 300000000, 1500000, 150000000, 30, date('now','+15 days'), 'active', ?)`).run(adaId, propId, finId).lastInsertRowid);
db.prepare(`INSERT INTO notifications (client_id, type, title, message, is_read, created_at)
  VALUES (?, 'payment.verified', 'Official Receipt Issued', 'Your payment of NGN 5,000,000 has been verified.', 0, datetime('now','-2 days'))`).run(adaId);

const demoPaymentId = Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, method, status, is_demo, verified_at, verified_by, created_at)
  VALUES (?, ?, 'TX-DEMO-SIM-01', 3000000, 300000000, 'Bank Transfer', 'verified', 1, datetime('now','-1 days'), ?, datetime('now','-1 days'))`).run(demoClientId, propId, finId).lastInsertRowid);
db.prepare(`INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, amount_kobo, remaining_balance_kobo, is_demo)
  VALUES (?, ?, 'DEMO-RCP-001', 3000000, 300000000, 1200000000, 1)`).run(demoPaymentId, demoClientId);

// ---------------------------------------------------------------------------
// Environment stubs: D1, R2, Assets, Queues
// ---------------------------------------------------------------------------
const r2 = new Map();
const queuedMessages = [];
const logoBytes = new Uint8Array(readFileSync('assets/images/bliss-legacy-logo.jpg'));

function makeEnv(overrides = {}) {
  return {
    DB: createD1Adapter(db),
    FILES: {
      async put(key, body, options = {}) {
        let bytes;
        if (body instanceof Uint8Array) {
          bytes = body;
        } else if (body && typeof body.arrayBuffer === "function") {
          bytes = new Uint8Array(await body.arrayBuffer());
        } else if (body && typeof body.getReader === "function") {
          const reader = body.getReader();
          const chunks = [];
          let total = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
          }
          bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        } else {
          bytes = new Uint8Array(body);
        }
        const httpMetadata = (options && options.httpMetadata) || {};
        r2.set(key, { bytes, httpMetadata });
        return {};
      },
      async get(key) {
        const item = r2.get(key);
        if (!item) return null;
        return {
          httpMetadata: item.httpMetadata,
          body: item.bytes,
          writeHttpMetadata(headers) {
            if (item.httpMetadata && item.httpMetadata.contentType) {
              headers.set("Content-Type", item.httpMetadata.contentType);
            }
          },
          async arrayBuffer() {
            return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength);
          }
        };
      },
      async delete(key) {
        r2.delete(key);
        return {};
      }
    },
    TASKS: {
      async send(msg) { queuedMessages.push(msg); return true; }
    },
    ASSETS: {
      async fetch(input) {
        const url = typeof input === 'string' ? input : (input.url || String(input));
        if (url.includes('bliss-legacy-logo')) {
          return new Response(logoBytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        }
        return new Response('Not found', { status: 404 });
      }
    },
    ENVIRONMENT: 'test',
    ...overrides
  };
}

const env = makeEnv();

async function request(path, options = {}) {
  const url = `http://localhost${path}`;
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers.set('Content-Type', 'application/json');
  }
  const req = new Request(url, { method: options.method || 'GET', headers, body });
  const res = await worker.fetch(req, options.env || env);
  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) data = await res.json();
  else data = new Uint8Array(await res.arrayBuffer());
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
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.error(`  ❌ ${name}\n     ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(email, password = 'password123', targetEnv = env) {
  const res = await request('/api/login', { method: 'POST', body: { email, password }, env: targetEnv });
  assert(res.status === 200, `login ${email} expected 200, got ${res.status}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

function insertPaymentRow(clientId, transactionRef, amountKobo, status = 'pending', options = {}) {
  const isDemo = options.isDemo ? 1 : 0;
  const verifiedAt = options.verifiedAt !== undefined
    ? options.verifiedAt
    : (status === 'verified' ? new Date().toISOString() : null);
  return Number(db.prepare(`
    INSERT INTO payments (client_id, property_id, transaction_ref, amount, currency, method, status,
      amount_kobo, is_demo, verified_at, verified_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clientId, options.propertyId === undefined ? propId : options.propertyId, transactionRef,
    amountKobo / 100, options.currency || 'NGN', options.method || 'Bank Transfer', status,
    amountKobo, isDemo, verifiedAt, options.verifiedBy || null,
    options.createdAt || new Date().toISOString()
  ).lastInsertRowid);
}

function insertReceiptRow(paymentId, clientId, receiptRef, amountKobo, remainingKobo, options = {}) {
  return Number(db.prepare(`
    INSERT INTO receipts (payment_id, client_id, receipt_ref, amount, currency, amount_kobo,
      remaining_balance_kobo, is_demo)
    VALUES (?, ?, ?, ?, 'NGN', ?, ?, ?)
  `).run(paymentId, clientId, receiptRef, amountKobo / 100, amountKobo, remainingKobo, options.isDemo ? 1 : 0).lastInsertRowid);
}

function webhookBody(id, transactionRef, amountNaira, extra = {}) {
  return {
    id,
    event: 'payment.success',
    timestamp: new Date().toISOString(),
    data: {
      transaction_reference: transactionRef,
      amount: amountNaira,
      currency: 'NGN',
      status: 'success',
      ...extra
    }
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
console.log('\n========================================================');
console.log('   BLISS LEGACY — PHASE 5 VERIFICATION SUITE');
console.log('========================================================\n');

const adaCookie = await login('ada@example.com');
const musaCookie = await login('musa@example.com');
const noPlanCookie = await login('noplan@example.com');
const financeCookie = await login('finance@bliss.com');
const mdCookie = await login('md@bliss.com');
const bmCookie = await login('bm.ikeja@bliss.com');
const bm2Cookie = await login('bm.ajah@bliss.com');
const tlCookie = await login('tl.ikeja@bliss.com');
const mktCookie = await login('mkt.ikeja@bliss.com');
const demoCookie = await login('demo@bliss.com');

console.log('--- 1. Client authentication & sessions ---');
await test('client can sign in with email, client reference and receives a hardened cookie', async () => {
  const res = await request('/api/login', { method: 'POST', body: { email: 'BLC-MW2ER37J', password: 'password123' } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.data.user.role === 'Client', 'role must be Client');
  const cookie = res.headers.get('set-cookie') || '';
  assert(cookie.includes('HttpOnly'), 'cookie must be HttpOnly');
  assert(cookie.includes('Secure'), 'cookie must be Secure');
  assert(cookie.includes('SameSite=Lax'), 'cookie must be SameSite=Lax');
});

await test('client login rejects invalid credentials and unknown accounts', async () => {
  const bad = await request('/api/login', { method: 'POST', body: { email: 'ada@example.com', password: 'wrongpassword' } });
  assert(bad.status === 401, `bad password expected 401, got ${bad.status}`);
  const unknown = await request('/api/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'password123' } });
  assert(unknown.status === 401, `unknown account expected 401, got ${unknown.status}`);
});

await test('expired sessions and logout invalidate access', async () => {
  const tempCookie = await login('musa@example.com');
  const sid = tempCookie.split('=')[1];
  db.prepare("UPDATE sessions SET expires_at=datetime('now','-1 hour') WHERE id=?").run(sid);
  const expired = await request('/api/me', { headers: { Cookie: tempCookie } });
  assert(expired.status === 401, `expired session expected 401, got ${expired.status}`);

  const cookie2 = await login('musa@example.com');
  const out = await request('/api/logout', { method: 'POST', headers: { Cookie: cookie2 } });
  assert(out.status === 200, 'logout should succeed');
  const after = await request('/api/me', { headers: { Cookie: cookie2 } });
  assert(after.status === 401, 'session must be invalid after logout');
});

console.log('\n--- 2. Client dashboard & integer-kobo calculations ---');
await test('dashboard shows contract price, verified total, outstanding balance and progress', async () => {
  const res = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const fin = res.data.financials;
  assert(res.data.client.client_reference === 'BLC-MW2ER37J', 'correct client reference');
  assert(res.data.client.full_name === 'Ada Nwosu', 'correct client name');
  assert(fin.agreed_price_ngn === 12000000, 'agreed price must be 12,000,000');
  assert(fin.total_verified_kobo === 500000000, 'verified kobo must be 500,000,000');
  assert(fin.outstanding_balance_kobo === 700000000, 'outstanding kobo must be 700,000,000');
  assert(fin.payment_percentage === 41.7, 'progress must be 41.7%');
  assert(fin.verified_payments_count === 1, 'only verified payments counted');
});

await test('dashboard uses the purchase record price, not the advertised property price', async () => {
  const res = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(res.data.property.agreed_purchase_price === 12000000, 'must not use the 888,888,888 advertised price');
  const propRes = await request('/api/client/property', { headers: { Cookie: adaCookie } });
  assert(propRes.data.property.agreed_purchase_price_kobo === 1200000000, 'My Property must use contract price');
  assert(propRes.data.property.purchase_reference === 'BLC-MW2ER37J', 'purchase reference present');
});

await test('client with no verified payment sees zero paid and full balance', async () => {
  const res = await request('/api/client/dashboard', { headers: { Cookie: musaCookie } });
  assert(res.data.financials.total_verified_ngn === 0, 'verified total must be zero');
  assert(res.data.financials.outstanding_balance_ngn === 20000000, 'outstanding must equal full price');
});

await test('next payment is shown only for an authorised active schedule', async () => {
  const ada = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(ada.data.next_payment.has_schedule === true, 'Ada must have a schedule');
  assert(ada.data.next_payment.installment_amount_kobo === 150000000, 'installment must be 1,500,000');
  assert(ada.data.next_payment.payment_reference === 'BLC-MW2ER37J', 'payment reference present');

  const none = await request('/api/client/dashboard', { headers: { Cookie: noPlanCookie } });
  assert(none.data.next_payment.has_schedule === false, 'no schedule must not be invented');
  assert(none.data.next_payment.message === 'Your next payment information will appear here once your payment schedule has been configured.', 'exact fallback message');
});

console.log('\n--- 3. Client isolation & authorisation ---');
await test('clients cannot read another client record or receipt', async () => {
  const musa = await request('/api/client/dashboard', { headers: { Cookie: musaCookie } });
  assert(musa.data.client.client_reference === 'BLC-MW2F7LG0', 'Musa sees only his own record');
  const receipts = await request('/api/client/receipts', { headers: { Cookie: musaCookie } });
  assert(receipts.data.receipts.length === 0, 'Musa must not see Ada receipts');

  const adaReceipts = await request('/api/client/receipts', { headers: { Cookie: adaCookie } });
  const adaReceiptId = adaReceipts.data.receipts[0].id;
  const steal = await request(`/api/client/receipts/${adaReceiptId}/download`, { headers: { Cookie: musaCookie } });
  assert(steal.status === 404, `cross-client receipt download must 404, got ${steal.status}`);
});

await test('clients are blocked from staff finance and client-management endpoints', async () => {
  for (const path of ['/api/finance/overview', '/api/finance/transactions', '/api/clients', '/api/installments']) {
    const res = await request(path, { headers: { Cookie: adaCookie } });
    assert(res.status === 403, `${path} must return 403 for clients, got ${res.status}`);
  }
});

console.log('\n--- 4. Client profile & tamper protection ---');
await test('client can update permitted profile fields and sensitive fields are audited', async () => {
  const res = await request('/api/client/profile', {
    method: 'PUT', headers: { Cookie: adaCookie },
    body: {
      residential_address: '25 Admiralty Way, Lekki Phase 1', city: 'Lekki', state: 'Lagos',
      next_of_kin: 'Dr. Obinna Nwosu (Brother)',
      agreed_purchase_price: 1000, assigned_branch_id: 99, original_marketer_id: 999
    }
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const row = db.prepare('SELECT agreed_purchase_price, assigned_branch_id, original_marketer_id, city FROM clients WHERE id=?').get(adaId);
  assert(row.agreed_purchase_price === 12000000, 'price unchanged');
  assert(row.assigned_branch_id === 1, 'branch unchanged');
  assert(row.original_marketer_id === mktId, 'marketer attribution unchanged');
  assert(row.city === 'Lekki', 'permitted field updated');
  const log = db.prepare("SELECT metadata FROM audit_logs WHERE action='client.profile.update' ORDER BY id DESC LIMIT 1").get();
  const meta = JSON.parse(log.metadata);
  assert(meta.before && meta.after, 'audit stores before/after values');
});

await test('profile rejects invalid and duplicate email addresses', async () => {
  const bad = await request('/api/client/profile', { method: 'PUT', headers: { Cookie: adaCookie }, body: { email_address: 'not-an-email' } });
  assert(bad.status === 400, `invalid email expected 400, got ${bad.status}`);
  const dup = await request('/api/client/profile', { method: 'PUT', headers: { Cookie: adaCookie }, body: { email_address: 'musa@example.com' } });
  assert(dup.status === 409, `duplicate email expected 409, got ${dup.status}`);
});

console.log('\n--- 5. Payment history & filtering ---');
await test('payment history distinguishes verified, pending and failed transactions', async () => {
  const res = await request('/api/client/payments', { headers: { Cookie: adaCookie } });
  assert(res.status === 200, 'expected 200');
  const statuses = res.data.payments.map(p => p.status).sort();
  assert(JSON.stringify(statuses) === JSON.stringify(['failed', 'pending', 'verified']), `unexpected statuses: ${statuses}`);
  assert(res.data.total_verified_kobo === 500000000, 'only verified counts towards total');
  const verified = res.data.payments.find(p => p.status === 'verified');
  assert(verified.receipt_available === true, 'verified payment has receipt');
  assert(verified.purchase_reference === 'BLP-TEST-001', 'purchase reference present');
});

await test('payment history supports status and date filters', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const byDate = await request(`/api/client/payments?date_from=${today}&date_to=${today}`, { headers: { Cookie: adaCookie } });
  assert(byDate.status === 200, 'date filter returns 200');
  assert(byDate.data.payments.every(p => (p.verified_at || p.created_at).slice(0, 10) === today), 'date filter is inclusive and accurate');
  const pending = await request('/api/client/payments?status=pending', { headers: { Cookie: adaCookie } });
  assert(pending.data.payments.length === 1 && pending.data.payments[0].status === 'pending', 'status filter works');
});

console.log('\n--- 6. Receipts & PDF generation ---');
let adaReceipt;
await test('receipts list exposes verification, balance and download URL', async () => {
  const res = await request('/api/client/receipts', { headers: { Cookie: adaCookie } });
  assert(res.status === 200, 'expected 200');
  adaReceipt = res.data.receipts[0];
  assert(adaReceipt.receipt_number === 'RCP-BLISS-001', 'receipt number correct');
  assert(adaReceipt.amount_kobo === 500000000, 'amount correct');
  assert(adaReceipt.remaining_balance_kobo === 700000000, 'remaining balance correct');
  assert(adaReceipt.verification_status === 'Verified', 'verification status correct');
  assert(adaReceipt.download_url.includes('/download'), 'download URL present');
});

await test('receipt PDF is generated, stored in R2 and contains the official logo', async () => {
  const res = await request(`/api/client/receipts/${adaReceipt.id}/download`, { headers: { Cookie: adaCookie } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((res.headers.get('content-type') || '').includes('application/pdf'), 'content-type is PDF');
  const text = pdfText(res.data);
  assert(text.startsWith('%PDF-1.4'), 'valid PDF header');
  assert(text.includes('OFFICIAL RECEIPT'), 'receipt title present');
  assert(text.includes('RCP-BLISS-001'), 'receipt number present');
  assert(text.includes('BLC-MW2ER37J'), 'client reference present');
  assert(text.includes('/DCTDecode'), 'official logo image embedded');
  const key = `receipts/BLC-MW2ER37J/RCP-BLISS-001.pdf`;
  assert(r2.has(key), 'PDF stored in R2');
  const dbKey = db.prepare('SELECT r2_key FROM receipts WHERE id=?').get(adaReceipt.id).r2_key;
  assert(dbKey === key, 'R2 key persisted on receipt row');
});

await test('demo receipts are excluded from the client portal and marked DEMO for staff', async () => {
  const demoReceipts = await request('/api/client/receipts', { headers: { Cookie: demoCookie } });
  assert(demoReceipts.data.receipts.length === 0, 'demo receipts never appear in the client portal');
  const demoReceipt = db.prepare("SELECT id FROM receipts WHERE receipt_ref='DEMO-RCP-001'").get();
  const staff = await request(`/api/finance/receipts/${demoReceipt.id}/download`, { headers: { Cookie: financeCookie } });
  assert(staff.status === 200, `staff demo receipt expected 200, got ${staff.status}`);
  const text = pdfText(staff.data);
  assert(text.includes('DEMO RECEIPT'), 'PDF is visibly marked DEMO');
  assert(text.includes('NOT A VALID FINANCIAL DOCUMENT'), 'PDF carries the demo disclaimer');
});

console.log('\n--- 7. ALAT by Wema Bank integration placeholder ---');
await test('virtual account is never fabricated and shows the exact pending message', async () => {
  const res = await request('/api/client/virtual-account', { headers: { Cookie: adaCookie } });
  assert(res.status === 200, 'expected 200');
  assert(res.data.is_active === false, 'must be inactive');
  assert(res.data.provider === 'ALATPay by Wema Bank', 'provider is ALATPay by Wema Bank');
  assert(['Awaiting credentials', 'Awaiting business ID'].includes(res.data.status), `status expected a pending ALATPay state, got ${res.data.status}`);
  assert(String(res.data.notice || '').includes('ALATPay'), 'notice must explain the pending ALATPay configuration');
  assert(!res.data.account_number, 'no fake account number');
});

await test('provider config hides secrets and requires authorised roles', async () => {
  const cfg = await request('/api/finance/provider-config', { headers: { Cookie: financeCookie } });
  assert(cfg.status === 200, 'finance can read config');
  assert(cfg.data.config.webhook_secret === undefined, 'webhook secret never returned');
  assert(cfg.data.config.has_webhook_secret === false, 'secret flag present');
  const marketer = await request('/api/finance/provider-config', { headers: { Cookie: mktCookie } });
  assert(marketer.status === 403, 'marketer cannot read provider config');
});

await test('only an Active provider with a genuine provider-issued account is shown', async () => {
  db.prepare("UPDATE provider_configs SET status='Active' WHERE provider_key='wema_alat'").run();
  const activeNoAccount = await request('/api/client/virtual-account', { headers: { Cookie: adaCookie } });
  assert(activeNoAccount.data.is_active === false, 'Active without an issued account stays pending');

  db.prepare(`INSERT OR REPLACE INTO virtual_accounts (client_id, provider, bank_name, account_name, account_number, account_status)
    VALUES (?, 'wema_alat', 'Wema Bank', 'Ada Nwosu / Bliss Legacy', '0123456789', 'active')`).run(adaId);
  const active = await request('/api/client/virtual-account', { headers: { Cookie: adaCookie } });
  assert(active.data.is_active === true, 'genuine provider account is shown');
  assert(active.data.account_number === '0123456789', 'account number returned');

  db.prepare("UPDATE provider_configs SET status='Awaiting onboarding' WHERE provider_key='wema_alat'").run();
  db.prepare('DELETE FROM virtual_accounts WHERE client_id=?').run(adaId);
});

console.log('\n--- 8. Finance dashboard, filtering & demo isolation ---');
await test('finance overview computes live collection KPIs from D1', async () => {
  const res = await request('/api/finance/overview', { headers: { Cookie: financeCookie } });
  assert(res.status === 200, 'expected 200');
  const s = res.data.summary;
  assert(s.total_verified_kobo === 500000000, 'live verified kobo total');
  assert(s.pending_ngn === 2000000, 'pending total');
  assert(s.failed_ngn === 1000000, 'failed total');
  assert(res.data.is_demo === false, 'live mode flag');
});

await test('demo mode is isolated from live financial reports', async () => {
  const res = await request('/api/finance/overview?demo=1', { headers: { Cookie: financeCookie } });
  assert(res.status === 200, 'demo overview expected 200');
  assert(res.data.is_demo === true, 'demo flag');
  assert(res.data.summary.total_verified_kobo === 300000000, 'demo verified total isolated');
});

await test('production rejects demo financial events unless explicitly enabled', async () => {
  const prodEnv = makeEnv({ ENVIRONMENT: 'production', DEMO_MODE_ENABLED: 'false' });
  const overview = await request('/api/finance/overview?demo=1', { headers: { Cookie: financeCookie }, env: prodEnv });
  assert(overview.status === 403, `production demo overview must 403, got ${overview.status}`);
  const payment = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie }, env: prodEnv,
    body: { client_id: adaId, amount: 1000, method: 'Bank Transfer', is_demo: true }
  });
  assert(payment.status === 403, `production demo payment must 403, got ${payment.status}`);
});

await test('transaction search filters by status, branch, property, marketer and date', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const res = await request(`/api/finance/transactions?status=verified&branch_id=1&property_id=${propId}&marketer_id=${mktId}&date_from=${from}&date_to=${today}`, { headers: { Cookie: financeCookie } });
  assert(res.status === 200, 'filtered query expected 200');
  assert(res.data.transactions.length === 1, `expected 1 filtered live transaction, got ${res.data.transactions.length}`);
  assert(res.data.transactions[0].transaction_ref === 'TX-VERIFIED-ADA-01', 'correct transaction returned');
  assert(res.data.transactions[0].marketer_name === 'Ikeja Marketer', 'marketer joined');
  assert(res.data.transactions[0].property_title === 'Luxury Ikeja Apartment', 'property joined');
});

console.log('\n--- 9. Payment verification, receipts & adjustments ---');
await test('Finance can verify a pending payment idempotently and a PDF receipt is created', async () => {
  const first = await request(`/api/finance/payments/${adaPayment2}/verify`, { method: 'POST', headers: { Cookie: financeCookie } });
  assert(first.status === 200, `verify expected 200, got ${first.status}`);
  assert(Boolean(first.data.receipt_ref), 'receipt reference returned');
  const second = await request(`/api/finance/payments/${adaPayment2}/verify`, { method: 'POST', headers: { Cookie: financeCookie } });
  assert(second.status === 200 && second.data.already_verified === true, 'idempotent verification');
  const count = db.prepare('SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?').get(adaPayment2).c;
  assert(count === 1, 'exactly one receipt per payment');
  const dash = await request('/api/client/dashboard', { headers: { Cookie: adaCookie } });
  assert(dash.data.financials.total_verified_ngn === 7000000, 'verified total updated');
  assert(dash.data.financials.outstanding_balance_ngn === 5000000, 'outstanding updated');
  assert(dash.data.recent_notifications.length >= 2, 'verification notification created');
});

await test('only pending payments can be verified; marketer is forbidden', async () => {
  const forbidden = await request(`/api/finance/payments/${adaPayment3}/verify`, { method: 'POST', headers: { Cookie: mktCookie } });
  assert(forbidden.status === 403, 'marketer verify must be 403');
  const failed = await request(`/api/finance/payments/${adaPayment3}/verify`, { method: 'POST', headers: { Cookie: financeCookie } });
  assert(failed.status === 409, `failed payment must 409, got ${failed.status}`);
});

await test('reversal creates an immutable adjustment and removes the amount from collections', async () => {
  const res = await request(`/api/finance/payments/${adaPayment2}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { adjustment_type: 'reversal', reason: 'Bank return: uncollected funds' }
  });
  assert(res.status === 200 && res.data.status === 'reversed', 'reversal applied');
  const adj = db.prepare('SELECT * FROM financial_adjustments WHERE payment_id=?').get(adaPayment2);
  assert(adj && adj.amount_kobo === 200000000, 'adjustment recorded in kobo');
  const overview = await request('/api/finance/overview', { headers: { Cookie: financeCookie } });
  assert(overview.data.summary.total_verified_kobo === 500000000, 'reversed amount leaves verified collections');
  const audit = db.prepare("SELECT * FROM audit_logs WHERE action='payment.adjustment' ORDER BY id DESC LIMIT 1").get();
  assert(JSON.parse(audit.metadata).reason.includes('Bank return'), 'audit justification retained');
  const again = await request(`/api/finance/payments/${adaPayment2}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie }, body: { adjustment_type: 'refund', reason: 'duplicate' }
  });
  assert(again.status === 409, 'cannot adjust an already reversed payment');
});

await test('duplicate transaction references are rejected with 409', async () => {
  const res = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: adaId, amount: 500000, method: 'Bank Transfer', transaction_ref: 'TX-VERIFIED-ADA-01' }
  });
  assert(res.status === 409, `expected 409, got ${res.status}`);
});

await test('unverified payments cannot be reversed or refunded', async () => {
  const res = await request(`/api/finance/payments/${adaPayment3}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie }, body: { adjustment_type: 'refund', reason: 'test' }
  });
  assert(res.status === 409, `expected 409, got ${res.status}`);
});

console.log('\n--- 10. ALAT webhook interfaces ---');
await test('webhooks are rejected until the provider is configured', async () => {
  const res = await request('/api/webhooks/wema-alat', {
    method: 'POST', body: { event: 'payment.success', data: { transaction_reference: 'TX-FAILED-ADA-03', amount: 1000000 } }
  });
  assert(res.status === 503, `unconfigured webhook expected 503, got ${res.status}`);
});

await test('webhook signature, amount match, verification and replay protection', async () => {
  const cfg = await request('/api/finance/provider-config', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { status: 'Configured', environment: 'sandbox', webhook_secret: 'test-secret' }
  });
  assert(cfg.status === 200, 'provider configured');

  const badSig = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'wrong' },
    body: { id: 'evt-1', event: 'payment.success', data: { transaction_reference: 'TX-FAILED-ADA-03', amount: 1000000 } }
  });
  assert(badSig.status === 401, `bad signature expected 401, got ${badSig.status}`);

  const unknown = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: { id: 'evt-unknown', event: 'payment.success', timestamp: new Date().toISOString(), data: { transaction_reference: 'TX-DOES-NOT-EXIST', amount: 1, currency: 'NGN' } }
  });
  assert(unknown.status === 202, `unknown transaction expected 202, got ${unknown.status}`);

  const mismatch = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: { id: 'evt-mismatch', event: 'payment.success', timestamp: new Date().toISOString(), data: { transaction_reference: 'TX-PENDING-ADA-02', amount: 999, currency: 'NGN' } }
  });
  assert(mismatch.status === 409, `amount mismatch expected 409, got ${mismatch.status}`);
  assert(db.prepare('SELECT status FROM payments WHERE id=?').get(adaPayment2).status === 'reversed', 'mismatch did not verify');

  // Re-use a fresh pending payment for a successful webhook
  const pendingId = Number(db.prepare(`INSERT INTO payments (client_id, property_id, transaction_ref, amount, amount_kobo, method, status, is_demo, created_at)
    VALUES (?, ?, 'TX-WEBHOOK-OK-01', 250000, 25000000, 'Virtual Account', 'pending', 0, datetime('now'))`).run(adaId, propId).lastInsertRowid);
  const ok = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: { id: 'evt-ok-1', event: 'payment.success', timestamp: new Date().toISOString(), data: { transaction_reference: 'TX-WEBHOOK-OK-01', amount: 250000, currency: 'NGN', status: 'success' } }
  });
  assert(ok.status === 200 && ok.data.status === 'verified', `webhook verify expected 200, got ${ok.status}`);
  assert(db.prepare('SELECT status FROM payments WHERE id=?').get(pendingId).status === 'verified', 'payment verified');
  assert(db.prepare('SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?').get(pendingId).c === 1, 'receipt created by webhook');

  const replay = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: { id: 'evt-ok-1', event: 'payment.success', timestamp: new Date().toISOString(), data: { transaction_reference: 'TX-WEBHOOK-OK-01', amount: 250000, currency: 'NGN', status: 'success' } }
  });
  assert(replay.data.already_processed === true, 'replayed event id is idempotent');
  assert(db.prepare('SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?').get(pendingId).c === 1, 'no duplicate receipt on replay');
  assert(db.prepare('SELECT COUNT(*) AS c FROM webhook_events').get().c === 3, 'webhook events recorded');
});

console.log('\n--- 11. Installment schedules ---');
let musaScheduleId;
await test('authorised staff create weekly/monthly/quarterly/custom schedules with history', async () => {
  const create = await request('/api/installments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: {
      client_id: musaId, property_id: propId, total_amount: 20000000, deposit_amount: 4000000,
      installment_amount: 2000000, frequency: 'monthly', next_due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      notes: 'Initial plan'
    }
  });
  assert(create.status === 200, `create expected 200, got ${create.status}`);
  musaScheduleId = create.data.id;
  const row = db.prepare('SELECT * FROM payment_schedules WHERE id=?').get(musaScheduleId);
  assert(row.total_kobo === 2000000000, 'total kobo stored');
  assert(row.frequency_days === 30, 'monthly mapped to 30 days');
  assert(row.status === 'active', 'active status');
  const history = db.prepare('SELECT COUNT(*) AS c FROM payment_schedule_history WHERE schedule_id=?').get(musaScheduleId).c;
  assert(history === 1, 'create history recorded');

  const weekly = await request('/api/installments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: noPlanId, total_amount: 5000000, installment_amount: 250000, frequency: 'weekly', next_due_date: '2030-01-01' }
  });
  assert(weekly.status === 200, 'weekly schedule created');
  const custom = await request('/api/installments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: crossBranchId, total_amount: 9000000, installment_amount: 300000, frequency_days: 14, next_due_date: '2030-01-01' }
  });
  assert(custom.status === 200, 'custom (14-day) schedule created');
  const bad = await request('/api/installments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: musaId, total_amount: 100000, deposit_amount: 200000, installment_amount: 1000, frequency: 'monthly', next_due_date: '2030-01-01' }
  });
  assert(bad.status === 400, 'deposit greater than total rejected');
});

await test('marketer cannot create or modify installment plans; BM is branch-scoped', async () => {
  const mkt = await request('/api/installments', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { client_id: musaId, total_amount: 20000000, installment_amount: 2000000, frequency: 'monthly', next_due_date: '2030-01-01' }
  });
  assert(mkt.status === 403, 'marketer create must 403');
  const otherBranch = await request(`/api/installments/${musaScheduleId}`, {
    method: 'PUT', headers: { Cookie: bm2Cookie }, body: { installment_amount: 100 }
  });
  assert(otherBranch.status === 403, 'cross-branch BM update must 403');
});

await test('staff can update and cancel a schedule with a full audit history', async () => {
  const update = await request(`/api/installments/${musaScheduleId}`, {
    method: 'PUT', headers: { Cookie: financeCookie },
    body: { installment_amount: 2500000, frequency_days: 21, reason: 'Client requested adjustment' }
  });
  assert(update.status === 200, `update expected 200, got ${update.status}`);
  const row = db.prepare('SELECT installment_kobo, frequency_days FROM payment_schedules WHERE id=?').get(musaScheduleId);
  assert(row.installment_kobo === 250000000 && row.frequency_days === 21, 'update persisted in kobo');
  const hist = await request(`/api/installments/${musaScheduleId}/history`, { headers: { Cookie: financeCookie } });
  assert(hist.data.history.length === 2, 'update history recorded');

  const cancel = await request(`/api/installments/${musaScheduleId}/cancel`, {
    method: 'POST', headers: { Cookie: financeCookie }, body: { reason: 'Restructured' }
  });
  assert(cancel.status === 200, 'cancel succeeded');
  const hist2 = await request(`/api/installments/${musaScheduleId}/history`, { headers: { Cookie: financeCookie } });
  assert(hist2.data.history.length === 3, 'cancel history recorded');
  assert(db.prepare('SELECT status FROM payment_schedules WHERE id=?').get(musaScheduleId).status === 'cancelled', 'cancelled status persisted');
});

await test('overdue installments are flagged without penalties', async () => {
  const overdue = await request('/api/installments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: noPlanId, total_amount: 5000000, installment_amount: 250000, frequency: 'monthly', next_due_date: '2020-01-01' }
  });
  assert(overdue.status === 200, 'overdue schedule created');
  const dash = await request('/api/client/dashboard', { headers: { Cookie: noPlanCookie } });
  assert(dash.data.next_payment.is_overdue === true, 'overdue flag exposed');
  assert(dash.data.next_payment.status === 'Overdue', 'overdue status shown');
  const row = db.prepare('SELECT notes FROM payment_schedules WHERE id=?').get(overdue.data.id);
  assert(row.notes === null, 'no penalty/interest silently applied');
});

console.log('\n--- 12. Notifications & queues ---');
await test('queue consumer records configurable email/WhatsApp delivery interfaces', async () => {
  const notification = db.prepare('SELECT id FROM notifications ORDER BY id DESC LIMIT 1').get();
  const before = db.prepare('SELECT COUNT(*) AS c FROM notification_deliveries').get().c;
  await worker.queue({ messages: [{ body: { notification_id: notification.id }, ack() {} }] }, env);
  const after = db.prepare('SELECT COUNT(*) AS c FROM notification_deliveries').get().c;
  assert(after >= before + 2, 'email and WhatsApp delivery rows recorded');
  const rows = db.prepare("SELECT DISTINCT channel FROM notification_deliveries WHERE notification_id=?").all(notification.id);
  assert(rows.some(r => r.channel === 'email') && rows.some(r => r.channel === 'whatsapp'), 'both channels represented');
});

await test('scheduled reminders create upcoming/overdue notifications once', async () => {
  const before = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type IN ('installment.upcoming','installment.overdue')").get().c;
  await worker.scheduled({}, env, { waitUntil(p) { return p; } });
  const after = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type IN ('installment.upcoming','installment.overdue')").get().c;
  assert(after > before, 'reminder notifications created');
  await worker.scheduled({}, env, { waitUntil(p) { return p; } });
  const after2 = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type IN ('installment.upcoming','installment.overdue')").get().c;
  assert(after2 === after, 'second run is deduplicated');
});

console.log('\n--- 13. Password reset & change ---');
await test('password reset tokens are single-use and invalidate existing sessions', async () => {
  const req = await request('/api/password-reset-request', { method: 'POST', body: { email: 'musa@example.com' } });
  assert(req.status === 200, 'reset request accepted');
  const tokenRow = db.prepare('SELECT token FROM password_reset_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(musaUserId);
  assert(Boolean(tokenRow), 'token stored server-side');
  const reset = await request('/api/password-reset', { method: 'POST', body: { token: tokenRow.token, password: 'newpassword123' } });
  assert(reset.status === 200, `reset expected 200, got ${reset.status}`);
  const oldSession = await request('/api/me', { headers: { Cookie: musaCookie } });
  assert(oldSession.status === 401, 'all sessions invalidated after reset');
  const reuse = await request('/api/password-reset', { method: 'POST', body: { token: tokenRow.token, password: 'anotherpass123' } });
  assert(reuse.status === 400, 'reset token is single-use');
  const newCookie = await login('musa@example.com', 'newpassword123');
  assert(Boolean(newCookie), 'login with new password works');

  const change = await request('/api/change-password', {
    method: 'POST', headers: { Cookie: newCookie },
    body: { current_password: 'newpassword123', new_password: 'password123' }
  });
  assert(change.status === 200, 'password changed back');
  const weak = await request('/api/change-password', {
    method: 'POST', headers: { Cookie: newCookie }, body: { current_password: 'password123', new_password: 'short' }
  });
  assert(weak.status === 400, 'weak password rejected');
});

console.log('\n--- 14. RBAC boundaries ---');
await test('branch manager sees only own-branch clients and transactions', async () => {
  const clients = await request('/api/clients?limit=100', { headers: { Cookie: bmCookie } });
  assert(clients.status === 200, 'BM clients 200');
  assert(clients.data.clients.every(c => c.assigned_branch_id === 1), 'only Ikeja clients');
  const ajah = await request('/api/clients?limit=100', { headers: { Cookie: bm2Cookie } });
  assert(ajah.data.clients.every(c => c.assigned_branch_id === 2), 'only Ajah clients');
  const txs = await request('/api/finance/transactions?limit=100', { headers: { Cookie: bm2Cookie } });
  assert(txs.data.transactions.every(t => t.branch_name === 'Ajah'), 'only Ajah transactions');
});

await test('team lead and marketer are scoped to their authorised clients', async () => {
  const tlTxs = await request('/api/finance/transactions?limit=100', { headers: { Cookie: tlCookie } });
  assert(tlTxs.status === 200, 'team lead can read scoped transactions');
  const mktTxs = await request('/api/finance/transactions?limit=100', { headers: { Cookie: mktCookie } });
  assert(mktTxs.status === 200, 'marketer can read scoped transactions');
  assert(mktTxs.data.transactions.every(t => t.client_reference !== 'BLC-CROSS-001'), 'marketer cannot see other branch client');
  const mktOverview = await request('/api/finance/overview', { headers: { Cookie: mktCookie } });
  assert(mktOverview.status === 403, 'marketer cannot access company overview');
});

console.log('\n--- 15. Phase 1–4 regression ---');
await test('health, public properties, branches and setup lock remain intact', async () => {
  const health = await request('/api/health');
  assert(health.status === 200 && health.data.ok === true, 'health OK');
  const props = await request('/api/properties');
  assert(props.status === 200 && props.data.properties.some(p => p.reference === 'BLP-TEST-001'), 'published properties visible');
  const branches = await request('/api/branches');
  assert(branches.status === 200 && branches.data.branches.length >= 6, 'branches seeded');
  const setup = await request('/api/setup', { method: 'POST', headers: { 'X-Setup-Secret': 'x' }, body: { email: 'x@x.com', password: 'password123', full_name: 'X' } });
  assert([403, 409].includes(setup.status), 'setup remains locked');
});

await test('staff RBAC on client creation and properties still enforced', async () => {
  const create = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { full_name: 'New Prospect', phone_number: '08012340000', email_address: 'prospect@example.com' }
  });
  assert(create.status === 200, `marketer client create expected 200, got ${create.status}`);
  const dup = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { full_name: 'New Prospect', phone_number: '08012340000' }
  });
  assert(dup.status === 409, 'duplicate phone rejected');
  const cross = await request('/api/clients', {
    method: 'POST', headers: { Cookie: bmCookie },
    body: { full_name: 'Cross Branch', phone_number: '08012340001', assigned_branch_id: 2 }
  });
  assert(cross.status === 403, 'BM cannot create cross-branch client');
});

// ---------------------------------------------------------------------------
// Final acceptance audit extensions: Phase 3/4 regressions, payment security,
// financial edge cases, receipts/R2 exposure, RBAC and configuration checks.
// ---------------------------------------------------------------------------
const auditUserId = upsertUser('audit@example.com', 'Audit Finance Client', 6, 1);
const auditClientId = upsertClient('BLC-AUDIT-001', {
  full_name: 'Audit Finance Client', phone_number: '08070001111', email_address: 'audit@example.com',
  address: '1 Audit Close, Ikeja', state: 'Lagos', city: 'Ikeja', branchId: 1, createdBy: mktId,
  marketerId: mktId, teamLeadId: tlId, agreedPrice: 10000000, propertyId: propId, userId: auditUserId
});
const auditCookie = await login('audit@example.com');

const finClientUserId = upsertUser('finclient@example.com', 'Finance Audit Client', 6, 1);
const finClientId = upsertClient('BLC-AUDIT-FIN-001', {
  full_name: 'Finance Audit Client', phone_number: '08070002222', email_address: 'finclient@example.com',
  address: '2 Audit Close, Ikeja', state: 'Lagos', city: 'Ikeja', branchId: 1, createdBy: mktId,
  marketerId: mktId, teamLeadId: tlId, agreedPrice: 10000000, propertyId: propId, userId: finClientUserId
});
const finClientCookie = await login('finclient@example.com');

const koboUserId = upsertUser('kobo@example.com', 'Kobo Audit Client', 6, 1);
const koboClientId = upsertClient('BLC-AUDIT-KOBO-001', {
  full_name: 'Kobo Audit Client', phone_number: '08070003333', email_address: 'kobo@example.com',
  address: '3 Audit Close, Ikeja', state: 'Lagos', city: 'Ikeja', branchId: 1, createdBy: mktId,
  marketerId: mktId, teamLeadId: tlId, agreedPrice: 10000000, propertyId: propId, userId: koboUserId
});
const koboCookie = await login('kobo@example.com');

console.log('\n--- 16. Phase 2/3 management regression ---');
await test('team and property-category creation remain branch-scoped and server-authorised', async () => {
  const marketerTeam = await request('/api/teams', {
    method: 'POST', headers: { Cookie: mktCookie }, body: { name: 'Audit Team', branch_id: 1 }
  });
  assert(marketerTeam.status === 403, `marketer team create expected 403, got ${marketerTeam.status}`);
  const crossTeam = await request('/api/teams', {
    method: 'POST', headers: { Cookie: bmCookie }, body: { name: 'Cross Team', branch_id: 2 }
  });
  assert(crossTeam.status === 403, `BM cross-branch team expected 403, got ${crossTeam.status}`);
  const ownTeam = await request('/api/teams', {
    method: 'POST', headers: { Cookie: bmCookie }, body: { name: 'Audit Ikeja Team', branch_id: 1 }
  });
  assert(ownTeam.status === 200, `BM own-branch team expected 200, got ${ownTeam.status}`);
  const bmCategory = await request('/api/property-categories', {
    method: 'POST', headers: { Cookie: bmCookie }, body: { name: 'Audit Forbidden Category' }
  });
  assert(bmCategory.status === 403, 'only MD can create property categories');
  const mdCategory = await request('/api/property-categories', {
    method: 'POST', headers: { Cookie: mdCookie }, body: { name: 'Audit Acceptance Category' }
  });
  assert(mdCategory.status === 200, `MD category create expected 200, got ${mdCategory.status}`);
});

console.log('\n--- 17. Phase 3 property management regression ---');
let auditPropId;
let auditImageId;
let auditImageKey;
await test('property CRUD is server-side RBAC protected and branch-scoped', async () => {
  const unauth = await request('/api/properties', { method: 'POST', body: { title: 'Unauth', sale_price: 1000 } });
  assert(unauth.status === 401, `unauth property create expected 401, got ${unauth.status}`);
  const marketer = await request('/api/properties', {
    method: 'POST', headers: { Cookie: mktCookie }, body: { title: 'Marketer Property', sale_price: 1000 }
  });
  assert(marketer.status === 403, `marketer property create expected 403, got ${marketer.status}`);
  const cross = await request('/api/properties', {
    method: 'POST', headers: { Cookie: bmCookie },
    body: { title: 'Cross Branch Property', sale_price: 1000, branch_name: 'Ajah' }
  });
  assert(cross.status === 403, `BM cross-branch create expected 403, got ${cross.status}`);
  const created = await request('/api/properties', {
    method: 'POST', headers: { Cookie: bmCookie },
    body: {
      title: 'Audit Phase 3 Property', description: 'Phase 3 regression fixture', sale_price: 25000000,
      state: 'Lagos', city: 'Ikeja', address: '1 Audit Close'
    }
  });
  assert(created.status === 200, `BM own-branch create expected 200, got ${created.status}: ${JSON.stringify(created.data)}`);
  auditPropId = created.data.id;
  const auditPlan = await request(`/api/properties/${auditPropId}/payment-plans`, {
    method: 'PUT', headers: { Cookie: bmCookie },
    body: { plans: [{ plan_type: 'outright', total_price: 25000000, deposit: 0, installment: 25000000 }] }
  });
  assert(auditPlan.status === 200, 'phase 3 property plan setup failed');
  const publishAudit = await request(`/api/properties/${auditPropId}`, {
    method: 'PUT', headers: { Cookie: bmCookie }, body: { is_published: true }
  });
  assert(publishAudit.status === 200, 'phase 3 property submit for approval failed');
  const approveAudit = await request(`/api/properties/${auditPropId}/approve`, {
    method: 'POST', headers: { Cookie: mdCookie }, body: {}
  });
  assert(approveAudit.status === 200, 'phase 3 property MD approval failed');
  const row = db.prepare('SELECT branch_id, status FROM properties WHERE id=?').get(auditPropId);
  assert(row.branch_id === 1 && row.status === 'Available', 'branch and initial status are correct');
  const publicDetail = await request(`/api/properties/${auditPropId}`);
  assert(publicDetail.status === 200 && publicDetail.data.property.reference.startsWith('BLP-'), 'published property is public');

  const hidden = await request('/api/properties', {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { title: 'Unpublished Audit Property', sale_price: 1000, is_published: false, branch_id: 1 }
  });
  assert(hidden.status === 200, 'MD can create an unpublished property');
  const hiddenDetail = await request(`/api/properties/${hidden.data.id}`);
  assert(hiddenDetail.status === 404, 'anonymous users cannot read unpublished property details');
  const publicList = await request('/api/properties?limit=50');
  assert(!publicList.data.properties.some(p => p.id === hidden.data.id), 'unpublished property is absent from public list');
});

await test('own-branch property updates, status history, image upload and public image serving work', async () => {
  const crossUpdate = await request(`/api/properties/${auditPropId}`, {
    method: 'PUT', headers: { Cookie: bm2Cookie }, body: { title: 'Hijacked' }
  });
  assert(crossUpdate.status === 403, `cross-branch update expected 403, got ${crossUpdate.status}`);
  const update = await request(`/api/properties/${auditPropId}`, {
    method: 'PUT', headers: { Cookie: bmCookie },
    body: { title: 'Audit Phase 3 Updated', sale_price: 26000000 }
  });
  assert(update.status === 200, `own-branch update expected 200, got ${update.status}`);
  const status = await request(`/api/properties/${auditPropId}/status`, {
    method: 'POST', headers: { Cookie: bmCookie }, body: { status: 'Reserved' }
  });
  assert(status.status === 200, 'status change succeeded');
  const history = await request(`/api/properties/${auditPropId}/status-history`, { headers: { Cookie: bmCookie } });
  assert(history.status === 200, 'status history readable');
  assert(history.data.history.some(h => h.new_status === 'Reserved'), 'status history records the change');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'audit.jpg');
  form.append('is_main', '1');
  const upload = await request(`/api/properties/${auditPropId}/images`, {
    method: 'POST', headers: { Cookie: bmCookie }, body: form
  });
  assert(upload.status === 200, `image upload expected 200, got ${upload.status}: ${JSON.stringify(upload.data)}`);
  auditImageId = upload.data.image_id;
  auditImageKey = upload.data.key;
  const image = await request(`/api/files/${encodeURIComponent(auditImageKey)}`);
  assert(image.status === 200, `public property image expected 200, got ${image.status}`);
  assert((image.headers.get('content-type') || '').includes('image/jpeg'), 'image content type preserved');

  const badForm = new FormData();
  badForm.append('file', new Blob(['not an image'], { type: 'text/plain' }), 'bad.txt');
  const badUpload = await request(`/api/properties/${auditPropId}/images`, {
    method: 'POST', headers: { Cookie: bmCookie }, body: badForm
  });
  assert(badUpload.status === 400, 'non-image upload rejected');

  const deleted = await request(`/api/properties/${auditPropId}/images/${auditImageId}`, {
    method: 'DELETE', headers: { Cookie: bmCookie }
  });
  assert(deleted.status === 200, 'image delete succeeded');
  const afterDelete = await request(`/api/files/${encodeURIComponent(auditImageKey)}`);
  assert(afterDelete.status === 404, 'deleted image is no longer publicly served');
});

console.log('\n--- 18. Phase 4 client management regression ---');
let phase4ClientId;
await test('client registration enforces role/branch rules and immutable acquisition attribution', async () => {
  const financeCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { full_name: 'Finance Created Client', phone_number: '08099990001' }
  });
  assert(financeCreate.status === 403, `finance client create expected 403, got ${financeCreate.status}`);
  const crossCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { full_name: 'Cross Branch Prospect', phone_number: '08099990002', assigned_branch_id: 2 }
  });
  assert(crossCreate.status === 403, `marketer cross-branch create expected 403, got ${crossCreate.status}`);
  const priceCreate = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { full_name: 'Price Attempt', phone_number: '08099990006', agreed_purchase_price: 7500000 }
  });
  assert(priceCreate.status === 403, `marketer contract-price create expected 403, got ${priceCreate.status}`);
  const created = await request('/api/clients', {
    method: 'POST', headers: { Cookie: mktCookie },
    body: {
      full_name: 'Phase 4 Audit Client', phone_number: '08099990003', email_address: 'phase4@example.com',
      status: 'Prospect'
    }
  });
  assert(created.status === 200, `marketer own-branch create expected 200, got ${created.status}`);
  phase4ClientId = created.data.id;
  const row = db.prepare('SELECT assigned_branch_id, original_marketer_id, created_by FROM clients WHERE id=?').get(phase4ClientId);
  assert(row.assigned_branch_id === 1, 'marketer registration inherits own branch');
  assert(row.original_marketer_id === mktId && row.created_by === mktId, 'original acquisition attribution preserved');
  assert(db.prepare('SELECT agreed_purchase_price FROM clients WHERE id=?').get(phase4ClientId).agreed_purchase_price === null, 'marketer registration must not set a contract price');
  const bmCross = await request('/api/clients', {
    method: 'POST', headers: { Cookie: bm2Cookie },
    body: { full_name: 'BM Cross Client', phone_number: '08099990004', assigned_branch_id: 1 }
  });
  assert(bmCross.status === 403, 'BM cannot register a cross-branch client');
  const bmOwn = await request('/api/clients', {
    method: 'POST', headers: { Cookie: bm2Cookie },
    body: { full_name: 'BM Own Client', phone_number: '08099990005', assigned_branch_id: 2 }
  });
  assert(bmOwn.status === 200, 'BM can register own-branch client');
});

await test('client details, protected updates, status history and notes are server-scoped', async () => {
  const own = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: mktCookie } });
  assert(own.status === 200 && own.data.client.id === phase4ClientId, 'marketer reads own client');
  const cross = await request(`/api/clients/${crossBranchId}`, { headers: { Cookie: mktCookie } });
  assert(cross.status === 403, `marketer cross-client read expected 403, got ${cross.status}`);
  const financeRead = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: financeCookie } });
  assert(financeRead.status === 200, 'finance has read-only client access');
  const priceByMarketer = await request(`/api/clients/${phase4ClientId}`, {
    method: 'PUT', headers: { Cookie: mktCookie }, body: { agreed_purchase_price: 1 }
  });
  assert(priceByMarketer.status === 403, 'marketer cannot change contract price');
  const update = await request(`/api/clients/${phase4ClientId}`, {
    method: 'PUT', headers: { Cookie: bmCookie }, body: { agreed_purchase_price: 7600000, city: 'Ikeja' }
  });
  assert(update.status === 200, `BM own-branch update expected 200, got ${update.status}`);
  const row = db.prepare('SELECT agreed_purchase_price, city FROM clients WHERE id=?').get(phase4ClientId);
  assert(row.agreed_purchase_price === 7600000 && row.city === 'Ikeja', 'BM update persisted');
  const status = await request(`/api/clients/${phase4ClientId}/status`, {
    method: 'POST', headers: { Cookie: mktCookie }, body: { status: 'Interested' }
  });
  assert(status.status === 200, 'authorised status change succeeded');
  const note = await request(`/api/clients/${phase4ClientId}/notes`, {
    method: 'POST', headers: { Cookie: mktCookie }, body: { note: 'Acceptance audit note' }
  });
  assert(note.status === 200, 'authorised note creation succeeded');
  const detail = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: bmCookie } });
  assert(detail.data.status_history.some(h => h.new_status === 'Interested'), 'status history retained');
  assert(detail.data.notes.some(n => n.note === 'Acceptance audit note'), 'note retained');
  const clientStaffAccess = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: auditCookie } });
  assert(clientStaffAccess.status === 403, 'client cannot use staff client-detail endpoint');
});

await test('assignment and reassignment preserve history and remain server-authorised', async () => {
  const forbidden = await request(`/api/clients/${phase4ClientId}/assign`, {
    method: 'POST', headers: { Cookie: mktCookie },
    body: { relationship_manager_id: mktId, branch_id: 1 }
  });
  assert(forbidden.status === 403, 'marketer cannot assign a client');
  const assigned = await request(`/api/clients/${phase4ClientId}/assign`, {
    method: 'POST', headers: { Cookie: bmCookie },
    body: { relationship_manager_id: mktId, branch_id: 1, reason: 'Initial assignment' }
  });
  assert(assigned.status === 200, `BM assignment expected 200, got ${assigned.status}: ${JSON.stringify(assigned.data)}`);
  const reassigned = await request(`/api/clients/${phase4ClientId}/reassign`, {
    method: 'POST', headers: { Cookie: mdCookie },
    body: { relationship_manager_id: mkt2Id, branch_id: 2, reason: 'Portfolio move' }
  });
  assert(reassigned.status === 200, `MD reassignment expected 200, got ${reassigned.status}: ${JSON.stringify(reassigned.data)}`);
  const history = await request(`/api/clients/${phase4ClientId}/assignment-history`, { headers: { Cookie: mdCookie } });
  assert(history.status === 200 && history.data.history.length === 2, 'both assignment events retained');
  const row = db.prepare('SELECT assigned_branch_id, original_marketer_id FROM clients WHERE id=?').get(phase4ClientId);
  assert(row.assigned_branch_id === 2, 'client moved to new branch');
  assert(row.original_marketer_id === mktId, 'original marketer remains immutable');
  const oldBm = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: bmCookie } });
  assert(oldBm.status === 403, 'old branch manager loses access');
  const newBm = await request(`/api/clients/${phase4ClientId}`, { headers: { Cookie: bm2Cookie } });
  assert(newBm.status === 200, 'new branch manager gains access');
});

console.log('\n--- 19. Payment security audit ---');
db.prepare("UPDATE provider_configs SET status='Configured', environment='sandbox', webhook_secret='test-secret' WHERE provider_key='wema_alat'").run();

await test('non-NGN payments and live payments for demo clients are rejected', async () => {
  const usd = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: auditClientId, amount: 1000, currency: 'USD', method: 'Bank Transfer' }
  });
  assert(usd.status === 400, `USD payment expected 400, got ${usd.status}`);
  const demoLive = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: demoClientId, amount: 1000, method: 'Bank Transfer' }
  });
  assert(demoLive.status === 400, `live payment for demo client expected 400, got ${demoLive.status}`);
  const rounded = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { client_id: auditClientId, amount: 100.005, currency: 'NGN', method: 'Bank Transfer', transaction_ref: 'TX-AUDIT-ROUND-001' }
  });
  assert(rounded.status === 200, `NGN payment expected 200, got ${rounded.status}`);
  const row = db.prepare('SELECT amount_kobo, currency FROM payments WHERE transaction_ref=?').get('TX-AUDIT-ROUND-001');
  assert(row && row.currency === 'NGN', 'payment stored as NGN');
  assert(row.amount_kobo === 10001, `100.005 NGN must round to 10001 kobo, got ${row && row.amount_kobo}`);
});

await test('webhook rejects missing/expired timestamps and non-success statuses', async () => {
  const pendingId = insertPaymentRow(auditClientId, 'TX-AUDIT-WH-TIME-001', 1000000, 'pending');
  const expired = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: {
      id: 'evt-audit-expired', event: 'payment.success',
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      data: { transaction_reference: 'TX-AUDIT-WH-TIME-001', amount: 10000, currency: 'NGN', status: 'success' }
    }
  });
  assert(expired.status === 409, `expired webhook expected 409, got ${expired.status}`);
  assert(db.prepare('SELECT status FROM payments WHERE id=?').get(pendingId).status === 'pending', 'expired event did not verify payment');
  assert(db.prepare("SELECT result FROM webhook_events WHERE event_id='evt-audit-expired'").get().result === 'expired', 'expired result recorded');

  const missing = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: {
      id: 'evt-audit-no-time', event: 'payment.success',
      data: { transaction_reference: 'TX-AUDIT-WH-TIME-001', amount: 10000, currency: 'NGN', status: 'success' }
    }
  });
  assert(missing.status === 400, `missing timestamp expected 400, got ${missing.status}`);

  const future = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: {
      id: 'evt-audit-future', event: 'payment.success',
      timestamp: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      data: { transaction_reference: 'TX-AUDIT-WH-TIME-001', amount: 10000, currency: 'NGN', status: 'success' }
    }
  });
  assert(future.status === 409, `future timestamp expected 409, got ${future.status}`);

  const unsuccessful = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: {
      id: 'evt-audit-unsuccessful', event: 'payment.success', timestamp: new Date().toISOString(),
      data: { transaction_reference: 'TX-AUDIT-WH-TIME-001', amount: 10000, currency: 'NGN', status: 'unsuccessful' }
    }
  });
  assert(unsuccessful.status === 202, `unsuccessful status must be ignored, got ${unsuccessful.status}`);
  assert(db.prepare('SELECT status FROM payments WHERE id=?').get(pendingId).status === 'pending', 'unsuccessful event did not verify payment');
});

await test('webhook rejects wrong currency and repeated deliveries cannot duplicate payments', async () => {
  const pendingId = insertPaymentRow(auditClientId, 'TX-AUDIT-WH-CUR-001', 500000, 'pending');
  const wrongCurrency = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: {
      id: 'evt-audit-currency', event: 'payment.success', timestamp: new Date().toISOString(),
      data: { transaction_reference: 'TX-AUDIT-WH-CUR-001', amount: 5000, currency: 'USD', status: 'success' }
    }
  });
  assert(wrongCurrency.status === 409, `USD webhook expected 409, got ${wrongCurrency.status}`);
  assert(db.prepare('SELECT status FROM payments WHERE id=?').get(pendingId).status === 'pending', 'currency mismatch did not verify payment');

  const first = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: webhookBody('evt-audit-dup-1', 'TX-AUDIT-WH-CUR-001', 5000)
  });
  assert(first.status === 200 && first.data.status === 'verified', `valid webhook expected 200 verified, got ${first.status}`);
  const second = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: webhookBody('evt-audit-dup-2', 'TX-AUDIT-WH-CUR-001', 5000)
  });
  assert(second.status === 200 && second.data.already_processed === true, 'second delivery is idempotent');
  assert(db.prepare('SELECT COUNT(*) AS c FROM payments WHERE transaction_ref=?').get('TX-AUDIT-WH-CUR-001').c === 1, 'no duplicate payment row');
  assert(db.prepare('SELECT COUNT(*) AS c FROM receipts WHERE payment_id=?').get(pendingId).c === 1, 'no duplicate receipt');
});

await test('webhook verification cannot run without a configured secret', async () => {
  db.prepare("UPDATE provider_configs SET status='Configured', webhook_secret=NULL WHERE provider_key='wema_alat'").run();
  const res = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'anything' },
    body: webhookBody('evt-audit-no-secret', 'TX-AUDIT-WH-CUR-001', 5000)
  });
  assert(res.status === 503, `missing secret expected 503, got ${res.status}`);
  db.prepare("UPDATE provider_configs SET webhook_secret='test-secret' WHERE provider_key='wema_alat'").run();
});

await test('production rejects demo verification, adjustment, receipts and webhooks', async () => {
  const prodEnv = makeEnv({ ENVIRONMENT: 'production', DEMO_MODE_ENABLED: 'false' });
  const verify = await request(`/api/finance/payments/${demoPaymentId}/verify`, {
    method: 'POST', headers: { Cookie: financeCookie }, env: prodEnv
  });
  assert(verify.status === 403, `production demo verify expected 403, got ${verify.status}`);
  const adjust = await request(`/api/finance/payments/${demoPaymentId}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie }, env: prodEnv,
    body: { adjustment_type: 'reversal', reason: 'production demo audit' }
  });
  assert(adjust.status === 403, `production demo adjust expected 403, got ${adjust.status}`);
  const demoReceiptId = db.prepare("SELECT id FROM receipts WHERE receipt_ref='DEMO-RCP-001'").get().id;
  const receipt = await request(`/api/finance/receipts/${demoReceiptId}/download`, {
    headers: { Cookie: financeCookie }, env: prodEnv
  });
  assert(receipt.status === 403, `production demo receipt expected 403, got ${receipt.status}`);
  const webhook = await request('/api/webhooks/wema-alat', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' }, env: prodEnv,
    body: webhookBody('evt-audit-demo-prod', 'TX-DEMO-SIM-01', 3000000)
  });
  assert(webhook.status === 403, `production demo webhook expected 403, got ${webhook.status}`);
});

console.log('\n--- 20. Financial calculation audit ---');
const finPay1 = insertPaymentRow(finClientId, 'TX-AUDIT-FIN-001', 400000000, 'verified');
insertReceiptRow(finPay1, finClientId, 'RCP-AUDIT-FIN-001', 400000000, 600000000);
const finPay2 = insertPaymentRow(finClientId, 'TX-AUDIT-FIN-002', 200000000, 'verified');
insertReceiptRow(finPay2, finClientId, 'RCP-AUDIT-FIN-002', 200000000, 400000000);

await test('refunds and reversals preserve original history and update verified balances', async () => {
  const before = await request('/api/client/dashboard', { headers: { Cookie: finClientCookie } });
  assert(before.data.financials.total_verified_kobo === 600000000, 'verified total is 6,000,000');
  assert(before.data.financials.outstanding_balance_kobo === 400000000, 'outstanding is 4,000,000');
  assert(before.data.financials.payment_percentage === 60, 'progress is 60%');

  const refund = await request(`/api/finance/payments/${finPay1}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { adjustment_type: 'refund', reason: 'Client refund approved' }
  });
  assert(refund.status === 200 && refund.data.status === 'refunded', 'refund applied');
  const reversal = await request(`/api/finance/payments/${finPay2}/adjust`, {
    method: 'POST', headers: { Cookie: financeCookie },
    body: { adjustment_type: 'reversal', reason: 'Bank return' }
  });
  assert(reversal.status === 200 && reversal.data.status === 'reversed', 'reversal applied');

  const after = await request('/api/client/dashboard', { headers: { Cookie: finClientCookie } });
  assert(after.data.financials.total_verified_kobo === 0, 'refunded/reversed amounts leave verified total');
  assert(after.data.financials.outstanding_balance_kobo === 1000000000, 'outstanding returns to full contract price');
  assert(after.data.financials.payment_percentage === 0, 'progress returns to zero');
  const rows = db.prepare('SELECT id, amount_kobo, status, verified_at FROM payments WHERE id IN (?,?) ORDER BY id').all(finPay1, finPay2);
  assert(rows.length === 2 && rows[0].amount_kobo === 400000000 && rows[1].amount_kobo === 200000000, 'original transaction amounts preserved');
  assert(rows.every(r => r.verified_at), 'original verification timestamps preserved');
  assert(rows[0].status === 'refunded' && rows[1].status === 'reversed', 'adjustment statuses persisted');
  const adjustments = db.prepare('SELECT adjustment_type, amount_kobo FROM financial_adjustments WHERE payment_id IN (?,?) ORDER BY id').all(finPay1, finPay2);
  assert(adjustments.length === 2, 'both immutable adjustments recorded');
  assert(db.prepare('SELECT COUNT(*) AS c FROM receipts WHERE client_id=?').get(finClientId).c === 2, 'receipts are retained as history');
  const receipts = await request('/api/client/receipts', { headers: { Cookie: finClientCookie } });
  assert(receipts.data.receipts.length === 2, 'client can still see historical receipts');
  const download = await request(`/api/client/receipts/${receipts.data.receipts[0].id}/download`, { headers: { Cookie: finClientCookie } });
  assert(download.status === 200, 'historical receipt remains downloadable');
});

await test('verified-only totals, progress, overpayment and rounding use integer kobo', async () => {
  const pendingId = insertPaymentRow(koboClientId, 'TX-AUDIT-KOBO-PENDING', 200000000, 'pending');
  const pendingDash = await request('/api/client/dashboard', { headers: { Cookie: koboCookie } });
  assert(pendingDash.data.financials.total_verified_kobo === 0, 'pending payment does not affect balance');
  assert(pendingDash.data.financials.outstanding_balance_kobo === 1000000000, 'pending payment leaves full outstanding');

  const verifiedId = insertPaymentRow(koboClientId, 'TX-AUDIT-KOBO-950', 950000000, 'verified');
  insertReceiptRow(verifiedId, koboClientId, 'RCP-AUDIT-KOBO-950', 950000000, 50000000);
  const partial = await request('/api/client/dashboard', { headers: { Cookie: koboCookie } });
  assert(partial.data.financials.total_verified_kobo === 950000000, 'verified total is 9,500,000');
  assert(partial.data.financials.outstanding_balance_kobo === 50000000, 'outstanding is 500,000');
  assert(partial.data.financials.payment_percentage === 95, 'progress is 95%');

  const overpayId = insertPaymentRow(koboClientId, 'TX-AUDIT-KOBO-OVER', 100000000, 'verified');
  insertReceiptRow(overpayId, koboClientId, 'RCP-AUDIT-KOBO-OVER', 100000000, 0);
  const over = await request('/api/client/dashboard', { headers: { Cookie: koboCookie } });
  assert(over.data.financials.total_verified_kobo === 1050000000, 'overpayment is included in verified total');
  assert(over.data.financials.outstanding_balance_kobo === 0, 'overpayment never produces a negative balance');
  assert(over.data.financials.payment_percentage === 100, 'overpayment caps progress at 100%');
  for (const id of [verifiedId, overpayId]) {
    const amountKobo = db.prepare('SELECT amount_kobo FROM payments WHERE id=?').get(id).amount_kobo;
    assert(Number.isInteger(amountKobo), 'stored kobo values are integers');
  }
  const history = await request('/api/client/payments', { headers: { Cookie: koboCookie } });
  assert(history.data.total_verified_kobo === 1050000000, 'payment history total matches dashboard');
});

await test('contract price remains authoritative and demo/live outstanding ledgers stay isolated', async () => {
  const dash = await request('/api/client/dashboard', { headers: { Cookie: koboCookie } });
  assert(dash.data.financials.agreed_price_kobo === 1000000000, 'contract price is 10,000,000');
  assert(dash.data.property.agreed_purchase_price === 10000000, 'advertised 888,888,888 price is not used');
  assert(dash.data.financials.agreed_price_kobo !== 88888888800, 'advertised property value never replaces contract price');

  const live = await request('/api/finance/overview', { headers: { Cookie: financeCookie } });
  const demo = await request('/api/finance/overview?demo=1', { headers: { Cookie: financeCookie } });
  assert(demo.data.summary.outstanding_client_balances_kobo === 1200000000, `demo outstanding should be 12,000,000, got ${demo.data.summary.outstanding_client_balances_kobo}`);
  const agreed = db.prepare("SELECT COALESCE(SUM(agreed_purchase_price),0) AS s FROM clients WHERE is_deleted=0 AND client_reference NOT LIKE 'DEMO-%'").get().s;
  const verified = db.prepare("SELECT COALESCE(SUM(p.amount_kobo),0) AS s FROM payments p WHERE p.status='verified' AND p.is_demo=0").get().s;
  const expectedLiveOutstanding = Math.max(0, Math.round(agreed * 100) - verified);
  assert(live.data.summary.outstanding_client_balances_kobo === expectedLiveOutstanding, 'live outstanding excludes demo contract totals');
});

console.log('\n--- 21. Receipts, R2 and demo labelling audit ---');
await test('receipts cannot be generated or retrieved for unverified payments', async () => {
  const pendingId = insertPaymentRow(auditClientId, 'TX-AUDIT-UNVERIFIED-001', 100000, 'pending');
  const receiptId = insertReceiptRow(pendingId, auditClientId, 'RCP-AUDIT-UNVERIFIED-001', 100000, 0);
  const list = await request('/api/client/receipts', { headers: { Cookie: auditCookie } });
  assert(!list.data.receipts.some(r => r.id === receiptId), 'unverified receipt is absent from client list');
  const clientDownload = await request(`/api/client/receipts/${receiptId}/download`, { headers: { Cookie: auditCookie } });
  assert(clientDownload.status === 404, `unverified client receipt expected 404, got ${clientDownload.status}`);
  const staffDownload = await request(`/api/finance/receipts/${receiptId}/download`, { headers: { Cookie: financeCookie } });
  assert(staffDownload.status === 404, `unverified staff receipt expected 404, got ${staffDownload.status}`);
  assert(!r2.has('receipts/BLC-AUDIT-001/RCP-AUDIT-UNVERIFIED-001.pdf'), 'no PDF was generated for unverified payment');
});

await test('private receipt R2 keys are never exposed by the public file route', async () => {
  const adaKey = db.prepare("SELECT r2_key FROM receipts WHERE receipt_ref='RCP-BLISS-001'").get().r2_key;
  assert(Boolean(adaKey), 'live receipt has an R2 key');
  const leaked = await request(`/api/files/${encodeURIComponent(adaKey)}`);
  assert(leaked.status === 404, `live receipt public access expected 404, got ${leaked.status}`);
  const demoKey = db.prepare("SELECT r2_key FROM receipts WHERE receipt_ref='DEMO-RCP-001'").get().r2_key;
  assert(Boolean(demoKey), 'demo receipt has an R2 key');
  const demoLeaked = await request(`/api/files/${encodeURIComponent(demoKey)}`);
  assert(demoLeaked.status === 404, `demo receipt public access expected 404, got ${demoLeaked.status}`);
});

await test('staff receipt downloads are branch-scoped', async () => {
  const crossPaymentId = insertPaymentRow(crossBranchId, 'TX-CROSS-RCP-001', 100000000, 'verified');
  const crossReceiptId = insertReceiptRow(crossPaymentId, crossBranchId, 'RCP-CROSS-001', 100000000, 800000000);
  const wrongBranch = await request(`/api/finance/receipts/${crossReceiptId}/download`, { headers: { Cookie: bmCookie } });
  assert(wrongBranch.status === 403, `cross-branch receipt expected 403, got ${wrongBranch.status}`);
  const rightBranch = await request(`/api/finance/receipts/${crossReceiptId}/download`, { headers: { Cookie: bm2Cookie } });
  assert(rightBranch.status === 200, `own-branch receipt expected 200, got ${rightBranch.status}`);
  const text = pdfText(rightBranch.data);
  assert(text.startsWith('%PDF-1.4') && text.includes('RCP-CROSS-001'), 'own-branch receipt PDF is valid');
});

console.log('\n--- 22. Configuration, secrets and RBAC audit ---');
await test('sensitive API endpoints reject unauthenticated requests', async () => {
  const checks = [
    ['/api/me', 'GET'], ['/api/clients', 'GET'], ['/api/users', 'GET'], ['/api/teams', 'GET'],
    ['/api/client/dashboard', 'GET'], ['/api/client/receipts', 'GET'], ['/api/finance/overview', 'GET'],
    ['/api/finance/transactions', 'GET'], ['/api/finance/provider-config', 'GET'],
    ['/api/installments', 'GET'], ['/api/clients/1', 'GET'], ['/api/properties/1/status-history', 'GET']
  ];
  for (const [path, method] of checks) {
    const res = await request(path, { method });
    assert([401, 403].includes(res.status), `${method} ${path} must require auth, got ${res.status}`);
  }
  const reconciliation = await request('/api/finance/reconciliation', {
    method: 'POST', body: { transactions: [] }
  });
  assert([401, 403].includes(reconciliation.status), 'reconciliation must require auth');
});

await test('cross-site Origin headers are rejected on state-changing endpoints', async () => {
  const profile = await request('/api/client/profile', {
    method: 'PUT', headers: { Cookie: adaCookie, Origin: 'https://evil.example' }, body: { city: 'Evil' }
  });
  assert(profile.status === 403, `cross-site profile update expected 403, got ${profile.status}`);
  const payment = await request('/api/finance/payments', {
    method: 'POST', headers: { Cookie: financeCookie, Origin: 'https://evil.example' },
    body: { client_id: auditClientId, amount: 1000, method: 'Bank Transfer' }
  });
  assert(payment.status === 403, `cross-site payment creation expected 403, got ${payment.status}`);
});

await test('provider secrets stay hidden and Branch Managers see only own-branch webhook events', async () => {
  db.prepare(`INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, transaction_ref, payload, result, processed_at)
    VALUES ('wema_alat', 'evt-audit-bm-live', 'payment.success', 'TX-VERIFIED-ADA-01', '{}', 'verified', datetime('now'))`).run();
  db.prepare(`INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, transaction_ref, payload, result, processed_at)
    VALUES ('wema_alat', 'evt-audit-bm-cross', 'payment.success', 'TX-CROSS-WEBHOOK-001', '{}', 'verified', datetime('now'))`).run();
  const cfg = await request('/api/finance/provider-config', { headers: { Cookie: bmCookie } });
  assert(cfg.status === 200, 'BM can read provider config');
  assert(cfg.data.config.config_json === null, 'BM does not receive provider config_json');
  assert(!JSON.stringify(cfg.data).includes('test-secret'), 'webhook secret never returned');
  const refs = cfg.data.webhook_events.map(e => e.transaction_ref);
  assert(refs.includes('TX-VERIFIED-ADA-01'), 'BM sees own-branch webhook event');
  assert(!refs.includes('TX-CROSS-WEBHOOK-001'), 'BM does not see cross-branch webhook event');
});

await test('frontend assets contain no provider secrets and required bindings/ignore rules remain intact', async () => {
  const wrangler = readFileSync('wrangler.toml', 'utf8');
  for (const token of ['binding = "DB"', 'binding = "FILES"', 'binding = "CACHE"', 'binding = "TASKS"', 'binding = "ASSETS"', '[[queues.consumers]]', 'crons = ["0 6 * * *"]']) {
    assert(wrangler.includes(token), `wrangler.toml missing ${token}`);
  }
  const gitignore = readFileSync('.gitignore', 'utf8');
  assert(gitignore.includes('.dev.vars'), '.gitignore must exclude .dev.vars');
  const assetsIgnore = readFileSync('.assetsignore', 'utf8');
  for (const token of ['.dev.vars', 'src', 'migrations', 'seed_phase5.py', 'test_phase5_suite.mjs', 'wrangler.toml']) {
    assert(assetsIgnore.includes(token), `.assetsignore must exclude ${token}`);
  }
  const frontendFiles = [
    ...readdirSync('assets/js').filter(f => f.endsWith('.js')).map(f => `assets/js/${f}`),
    ...readdirSync('.').filter(f => f.endsWith('.html'))
  ];
  const dangerous = [
    /\bsk_live_[A-Za-z0-9]+/, /\bsk_test_[A-Za-z0-9]+/, /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /password123/, /test-secret/
  ];
  for (const file of frontendFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of dangerous) {
      assert(!pattern.test(text), `${file} contains a forbidden credential pattern: ${pattern}`);
    }
  }
});

console.log('\n========================================================');
console.log(`   RESULT: ${passed} PASSED | ${failed} FAILED`);
if (failures.length) {
  for (const f of failures) console.log(`   - ${f.name}: ${f.error}`);
}
console.log('========================================================\n');

db.close();
process.exit(failed ? 1 : 0);
