import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { resolveLiveDb } from './test_db_paths.mjs';

function resolveDevDb() {
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'bliss-legacy-staging-db', '--local',
    '--command', 'CREATE TABLE IF NOT EXISTS _browser_probe (id INTEGER)'], { stdio: 'ignore' });
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sqlite'))) {
    try {
      const candidate = new DatabaseSync(join(dir, name));
      const found = candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_browser_probe'").get();
      candidate.close();
      if (found) return join(dir, name);
    } catch (error) {}
  }
  return resolveLiveDb();
}
const LIVE_DB = resolveDevDb();
async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}
const PORT = Number(process.env.BROWSER_TEST_PORT || await findFreePort());
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PASSWORD = randomBytes(18).toString('base64url');
let passed = 0;
let failed = 0;

function hashPw(password) {
  const salt = randomBytes(16);
  const dk = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✅ ${name}`); })
    .catch(error => { failed++; console.error(`  ❌ ${name}\n     ${error.message}`); });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url + '/api/health');
      if (res.ok) return true;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function goto(page, url) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(1500);
    }
  }
  throw last;
}

async function login(page, email) {
  await goto(page, BASE + '/login.html');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('#submitBtn');
  await page.waitForURL(url => !url.pathname.endsWith('/login.html'), { timeout: 20000 });
}

if (!existsSync(CHROME)) {
  console.log('Chrome not found; skipping browser-level test.');
  process.exit(0);
}

console.log('\n========================================================');
console.log('   BLISS LEGACY — BROWSER DRILL-DOWN / COLOUR / CHAT');
console.log('========================================================\n');

const db = new DatabaseSync(LIVE_DB);
db.exec('PRAGMA foreign_keys = ON;');
const roleId = name => db.prepare('SELECT id FROM roles WHERE name=?').get(name).id;
const branchId = name => db.prepare('SELECT id FROM branches WHERE name=?').get(name).id;
const ikeja = branchId('Ikeja');
const mdRole = roleId('Managing Director');
const marketerRole = roleId('Marketer');

function upsert(email, name, role, branch) {
  db.prepare(`INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active, is_test, test_expires_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now','+14 days'))
    ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, full_name=excluded.full_name,
      role_id=excluded.role_id, branch_id=excluded.branch_id, is_active=1, is_test=1,
      test_expires_at=excluded.test_expires_at`)
    .run(email, hashPw(PASSWORD), name, role, branch);
  return db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
}
const mdId = upsert('browser.md@bliss.test', 'Browser MD', mdRole, ikeja);
const subAdminRole = roleId('Sub Admin');
upsert('browser.subadmin@bliss.test', 'Browser Sub Admin', subAdminRole, ikeja);
const marketerId = upsert('browser.marketer@bliss.test', 'Browser Marketer', marketerRole, ikeja);
const passkeyUserId = upsert('browser.passkey@bliss.test', 'Browser Passkey', marketerRole, ikeja);
upsert('browser.passkey.other@bliss.test', 'Browser Passkey Other', marketerRole, ikeja);
const browserTeamLeadId = upsert('browser.lead@bliss.test', 'Browser Team Lead', roleId('Team Lead'), ikeja);
const teamLeadRole = roleId('Team Lead');
db.prepare("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE name='Browser Test Team')").run();
db.prepare("DELETE FROM teams WHERE name='Browser Test Team'").run();
const browserTeamId = Number(db.prepare("INSERT INTO teams (name, branch_id, team_lead_user_id, is_active) VALUES ('Browser Test Team', ?, ?, 1)")
  .run(ikeja, browserTeamLeadId).lastInsertRowid);
const teamLead = db.prepare("SELECT id FROM users WHERE email='tl.ikeja@bliss.com'").get()
  || { id: upsert('tl.ikeja@bliss.com', 'Ikeja Team Lead', teamLeadRole, ikeja) };
const existingMarketer = db.prepare("SELECT id FROM users WHERE email='mkt.ikeja@bliss.com'").get();
const property = db.prepare('SELECT id FROM properties ORDER BY id LIMIT 1').get();

for (const [ref, temp] of [['TEST-BROWSER-HOT', 'Hot'], ['TEST-BROWSER-WARM', 'Warm'], ['TEST-BROWSER-COLD', 'Cold']]) {
  db.prepare(`INSERT INTO leads (lead_reference, full_name, phone_number, source, status, lead_temperature,
    temperature_updated_at, assigned_marketer_id, team_lead_id, branch_id, created_by, is_demo)
    VALUES (?, ?, ?, 'Browser test', 'Contacted', ?, datetime('now'), ?, ?, ?, ?, 0)
    ON CONFLICT(lead_reference) DO UPDATE SET lead_temperature=excluded.lead_temperature, branch_id=excluded.branch_id`)
    .run(ref, `Browser ${temp} Lead`, '08088' + Math.floor(100000 + Math.random() * 899999), temp,
      marketerId, teamLead ? teamLead.id : null, ikeja, mdId);
}
db.close();

const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});
let serverLog = '';
let shuttingDown = false;
server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
server.on('exit', (code, signal) => {
  if (!shuttingDown && code) console.error(`\n  ⚠ wrangler dev exited early (${code}/${signal}):\n${serverLog.slice(-1500)}\n`);
});

let browser;
try {
  if (!(await waitForServer(BASE))) {
    throw new Error('wrangler dev did not start: ' + serverLog.slice(-800));
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const contextD = await browser.newContext();
  const contextE = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const pageD = await contextD.newPage();
  const pageE = await contextE.newPage();
  let passkeyContext;
  let passkeyPage;
  let passkeyCdp;
  let passkeyAuthenticatorId;
  let passkeyCapturedLogin = null;

  await test('drill-down breadcrumbs show National > Branch > Team Lead and can drill back up', async () => {
    await login(pageA, 'browser.md@bliss.test');
    await goto(pageA, `${BASE}/revenue.html?branch_id=${ikeja}&team_lead_id=${teamLead.id}`);
    await pageA.waitForFunction(() => {
      const node = document.getElementById('revBreadcrumbs');
      return node && node.textContent.trim().length > 0;
    }, { timeout: 20000 });
    const crumbs = await pageA.locator('#revBreadcrumbs').innerText();
    assert(/National/i.test(crumbs), `breadcrumb missing National: ${crumbs}`);
    assert(/Ikeja/i.test(crumbs), `breadcrumb missing branch: ${crumbs}`);
    assert(/Ikeja Team Lead/i.test(crumbs), `breadcrumb missing team lead: ${crumbs}`);
    await pageA.locator('#revBreadcrumbs button').first().click();
    await pageA.waitForFunction(() => {
      const node = document.getElementById('revBreadcrumbs');
      return node && /National/i.test(node.textContent) && !/Ikeja/i.test(node.textContent);
    }, { timeout: 15000 });
    const after = await pageA.locator('#revBreadcrumbs').innerText();
    assert(!/Ikeja/i.test(after), `breadcrumb did not drill back to National: ${after}`);
  });

  await test('hot, warm and cold lead badges use distinct documented colours', async () => {
    await goto(pageA, BASE + '/leads.html');
    await pageA.waitForFunction(() => document.querySelectorAll('#leadBody .badge').length > 0, { timeout: 20000 });
    const colours = await pageA.evaluate(() => {
      const result = {};
      for (const badge of document.querySelectorAll('#leadBody .badge')) {
        const text = badge.textContent.trim();
        if (['Hot', 'Warm', 'Cold'].includes(text) && !result[text]) {
          result[text] = { className: badge.className, colour: getComputedStyle(badge).backgroundColor };
        }
      }
      return result;
    });
    assert(colours.Hot && colours.Warm && colours.Cold, `missing temperature badges: ${JSON.stringify(colours)}`);
    assert(colours.Hot.className.includes('badge-red'), 'hot badge is not red');
    assert(colours.Warm.className.includes('badge-amber'), 'warm badge is not amber');
    assert(colours.Cold.className.includes('badge-gray'), 'cold badge is not grey');
    const set = new Set([colours.Hot.colour, colours.Warm.colour, colours.Cold.colour]);
    assert(set.size === 3, `temperature colours are not distinct: ${JSON.stringify(colours)}`);
  });

  await test('one chat message is delivered over WebSocket between two users', async () => {
    const room = await pageA.evaluate(async ({ targetId }) => {
      const res = await fetch('/api/chat/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetId })
      });
      const data = await res.json();
      return { status: res.status, id: data.room_id || data.id || (data.room && data.room.id), error: data.error };
    }, { targetId: marketerId });
    assert(room.status === 200 && room.id, `chat room create failed: ${JSON.stringify(room)}`);
    await login(pageB, 'browser.marketer@bliss.test');
    await goto(pageA, BASE + '/staff-chat.html');
    await goto(pageB, BASE + '/staff-chat.html');
    for (const page of [pageA, pageB]) {
      await page.waitForSelector(`#chatRoomList [data-room="${room.id}"]`, { timeout: 20000 });
      await page.click(`#chatRoomList [data-room="${room.id}"]`);
      await page.waitForFunction(() => {
        const status = document.getElementById('chatStatus');
        return status && /connected/i.test(status.textContent);
      }, { timeout: 20000 });
    }
    const message = 'Browser WebSocket audit message ' + Date.now();
    await pageA.fill('#chatInput', message);
    await pageA.click('#chatSendBtn');
    await pageB.waitForFunction(expected => {
      return Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble')).some(node => node.textContent === expected);
    }, message, { timeout: 15000 });
  });
  await test('the public site shows Adaora and answers a typed question without voice', async () => {
    await goto(pageC, BASE + '/index.html');
    await pageC.waitForSelector('#dhLauncher', { timeout: 20000 });
    await pageC.waitForFunction(() => /Adaora/i.test(document.getElementById('dhLauncher')?.getAttribute('aria-label') || ''), { timeout: 20000 });
    const label = await pageC.getAttribute('#dhLauncher', 'aria-label');
    assert(/assistant/i.test(label || ''), `launcher label missing: ${label}`);
    const initialLabel = label || '';
    assert(/Adaora/i.test(initialLabel), `launcher label should name Adaora: ${initialLabel}`);
    await pageC.click('#dhLauncher');
    await pageC.waitForFunction(() => document.querySelector('.dh-root')?.classList.contains('is-open'), { timeout: 10000 });
    await pageC.waitForFunction(() => document.getElementById('dhName')?.textContent.trim() === 'Adaora', { timeout: 20000 });
    const name = await pageC.evaluate(() => document.getElementById('dhName')?.textContent.trim() || '');
    assert(name === 'Adaora', `expected Adaora, got ${name}`);
    const avatarSrc = await pageC.evaluate(() => document.querySelector('#dhAvatar img')?.getAttribute('src') || '');
    assert(/personas\/adaora\.jpg/.test(avatarSrc), `Adaora portrait missing: ${avatarSrc}`);
    const greeting = await pageC.locator('#dhThread .dh-msg-assistant .dh-bubble').first().innerText();
    assert(/Bliss Legacy/i.test(greeting), `greeting missing: ${greeting}`);
    await pageC.fill('#dhInput', 'Tell me about Bliss Legacy Limited');
    await pageC.click('#dhSend');
    await pageC.waitForFunction(() => {
      const bubbles = Array.from(document.querySelectorAll('#dhThread .dh-msg-assistant .dh-bubble'));
      return bubbles.some(node => /Bliss Legacy/i.test(node.textContent || ''));
    }, { timeout: 20000 });
    const reply = await pageC.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('#dhThread .dh-msg-assistant .dh-bubble'));
      const found = bubbles.filter(node => /Bliss Legacy/i.test(node.textContent || '')).pop();
      return found ? found.textContent : '';
    });
    assert(/Bliss Legacy/i.test(reply), `assistant reply missing: ${reply}`);
    await pageC.click('#dhMute');
    const pressed = await pageC.getAttribute('#dhMute', 'aria-pressed');
    assert(pressed === 'false', `mute did not switch to text-only: ${pressed}`);
  });

  await test('a dashboard starts with the role specialist and transforms persona in the browser', async () => {
    await goto(pageA, BASE + '/dashboard.html');
    await pageA.waitForSelector('#dhLauncher', { timeout: 20000 });
    await pageA.click('#dhLauncher');
    await pageA.waitForFunction(() => document.querySelector('.dh-root')?.classList.contains('is-open'), { timeout: 10000 });
    await pageA.waitForFunction(() => document.getElementById('dhName')?.textContent.trim() === 'Ifeoma', { timeout: 20000 });
    const initial = await pageA.evaluate(() => document.getElementById('dhName')?.textContent.trim() || '');
    assert(initial === 'Ifeoma', `MD dashboard expected Ifeoma, got ${initial}`);
    await pageA.fill('#dhInput', 'Find a property');
    await pageA.click('#dhSend');
    await pageA.waitForFunction(() => {
      const node = document.getElementById('dhName');
      return node && node.textContent.trim() === 'Solomon';
    }, { timeout: 20000 });
    await pageA.waitForFunction(() => {
      const img = document.querySelector('#dhAvatar img');
      return img && /personas\/solomon\.jpg/.test(img.getAttribute('src') || '');
    }, { timeout: 10000 });
    const reply = await pageA.locator('#dhThread .dh-msg-assistant .dh-bubble').last().innerText();
    assert(/Solomon|property/i.test(reply), `persona handover reply missing: ${reply}`);
  });

  await test('a team lead can add an active branch marketer to their team from the dashboard', async () => {
    await login(pageD, 'browser.lead@bliss.test');
    await goto(pageD, BASE + '/dashboard.html');
    await pageD.waitForSelector('#addTeamMemberBtn', { state: 'visible', timeout: 20000 });
    await pageD.click('#addTeamMemberBtn');
    await pageD.waitForSelector('#addTeamMemberModal.open', { timeout: 10000 });
    const checkbox = `#availableTeamMembers input[value="${marketerId}"]`;
    await pageD.waitForSelector(checkbox, { timeout: 20000 });
    await pageD.check(checkbox);
    await pageD.click('#saveTeamMembersBtn');
    await pageD.waitForFunction(expected => {
      const body = document.getElementById('teamMembersBody');
      return body && body.textContent.includes(expected);
    }, 'Browser Marketer', { timeout: 20000 });
  });

  await test('a user can register a passkey after password login and manage it', async () => {
    passkeyContext = await browser.newContext();
    passkeyPage = await passkeyContext.newPage();
    passkeyCdp = await passkeyContext.newCDPSession(passkeyPage);
    await passkeyCdp.send('WebAuthn.enable', { enableUI: false });
    const authenticator = await passkeyCdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    });
    passkeyAuthenticatorId = authenticator.authenticatorId;

    await goto(passkeyPage, BASE + '/login.html');
    await passkeyPage.fill('#email', 'browser.passkey@bliss.test');
    await passkeyPage.fill('#password', PASSWORD);
    await passkeyPage.click('#submitBtn');
    await passkeyPage.waitForSelector('#blissPasskeyModal.open', { timeout: 25000 });
    const suggested = await passkeyPage.inputValue('#blissPasskeyName');
    assert(suggested && suggested.length > 0, 'the enrollment prompt must suggest a generic device name');
    await passkeyPage.fill('#blissPasskeyName', 'Test laptop');
    await passkeyPage.click('#blissPasskeyEnable');
    await passkeyPage.waitForURL(url => url.pathname === '/dashboard', { timeout: 25000 });

    await goto(passkeyPage, BASE + '/security.html');
    await passkeyPage.waitForSelector('#passkeyList .pk-device', { timeout: 20000 });
    const listText = await passkeyPage.locator('#passkeyList').innerText();
    assert(/Test laptop/.test(listText), `registered passkey missing from device list: ${listText}`);

    const live = new DatabaseSync(LIVE_DB);
    const stored = live.prepare('SELECT * FROM passkey_credentials WHERE user_id=?').get(passkeyUserId);
    const columns = live.prepare('PRAGMA table_info(passkey_credentials)').all().map(row => row.name);
    live.close();
    assert(stored && stored.credential_name === 'Test laptop', 'passkey was not stored in D1');
    assert(stored.public_key && stored.credential_id, 'public key credential metadata was not stored');
    assert(!columns.some(name => /private|biometric|fingerprint|face|pin/i.test(name)), 'passkey table must not contain biometric or private-key fields');

    await passkeyPage.click('[data-passkey-action="rename"]');
    await passkeyPage.waitForSelector('#renamePasskeyModal.open', { timeout: 10000 });
    await passkeyPage.fill('#renamePasskeyName', 'Work laptop');
    await passkeyPage.click('#savePasskeyNameBtn');
    await passkeyPage.waitForFunction(() => /Work laptop/.test(document.getElementById('passkeyList')?.textContent || ''), { timeout: 10000 });
    await goto(passkeyPage, BASE + '/security.html');
    await passkeyPage.waitForSelector('#passkeyList .pk-device', { timeout: 20000 });
    assert(/Work laptop/.test(await passkeyPage.locator('#passkeyList').innerText()), 'renamed passkey did not survive a reload');
  });

  await test('passkey sign-in creates a normal session, preserves role and rejects replay', async () => {
    const reset = new DatabaseSync(LIVE_DB);
    reset.prepare("DELETE FROM audit_logs WHERE action='passkey.login.ip_failure'").run();
    reset.close();
    await passkeyPage.evaluate(async () => { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); });
    await goto(passkeyPage, BASE + '/login.html');
    await passkeyPage.route('**/api/passkey/login/verify', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      passkeyCapturedLogin = body;
      await route.continue();
    });
    await passkeyPage.click('#passkeyLoginBtn');
    try {
      await passkeyPage.waitForURL(url => url.pathname === '/dashboard', { timeout: 25000 });
    } catch (error) {
      const state = await passkeyPage.evaluate(() => ({
        url: location.href,
        message: document.getElementById('msg')?.textContent || '',
        button: document.getElementById('passkeyLoginBtn')?.outerHTML || '',
        hasLibrary: Boolean(window.BlissPasskeys),
        supported: window.BlissPasskeys ? window.BlissPasskeys.supported() : false,
        readyState: document.readyState
      }));
      throw new Error(`passkey login did not navigate: ${JSON.stringify(state)}`);
    }
    await passkeyPage.unroute('**/api/passkey/login/verify');
    assert(passkeyCapturedLogin && passkeyCapturedLogin.challenge_id && passkeyCapturedLogin.response?.id, 'passkey verification request was not observed');
    const me = await passkeyPage.evaluate(() => fetch('/api/me').then(response => response.json()));
    assert(me.role === 'Marketer', `passkey login changed the role: ${me.role}`);

    await passkeyPage.evaluate(async () => { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); });
    await goto(passkeyPage, BASE + '/login.html');
    const replay = await passkeyPage.evaluate(async payload => {
      const response = await fetch('/api/passkey/login/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    }, passkeyCapturedLogin);
    assert(replay.status === 401, `replayed passkey assertion expected 401, got ${replay.status}`);
    assert(!/abc/i.test(String(replay.data.error || '')), 'passkey errors must stay generic');
  });

  await test('tampered, expired, wrong-origin, wrong-RP and cross-user passkey assertions are rejected', async () => {
    await goto(passkeyPage, BASE + '/login.html');
    const live = new DatabaseSync(LIVE_DB);
    live.exec('PRAGMA foreign_keys = ON;');
    // Earlier runs may have left failure counters in the shared local audit log.
    live.prepare("DELETE FROM audit_logs WHERE action='passkey.login.ip_failure'").run();

    async function rejectedAttempt(routeHandler) {
      await passkeyPage.unroute('**/api/passkey/login/verify').catch(() => {});
      await passkeyPage.route('**/api/passkey/login/verify', routeHandler);
      await passkeyPage.click('#passkeyLoginBtn');
      await passkeyPage.waitForFunction(() => {
        const message = document.getElementById('msg')?.textContent || '';
        return /failed|cancelled|expired|not verified|too many/i.test(message);
      }, { timeout: 25000 });
      const message = await passkeyPage.textContent('#msg');
      await passkeyPage.unroute('**/api/passkey/login/verify');
      await passkeyPage.waitForFunction(() => !document.getElementById('passkeyLoginBtn')?.disabled, { timeout: 10000 });
      return message;
    }

    const tampered = await rejectedAttempt(async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      const signature = String(body.response?.response?.signature || '');
      body.response.response.signature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
      await route.continue({ postData: JSON.stringify(body) });
    });
    assert(/failed/i.test(tampered), `tampered signature was not rejected: ${tampered}`);

    const expired = await rejectedAttempt(async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      live.prepare("UPDATE passkey_challenges SET expires_at=datetime('now','-1 minute') WHERE id=?").run(body.challenge_id);
      await route.continue();
    });
    assert(/failed/i.test(expired), `expired challenge was not rejected: ${expired}`);

    const wrongOrigin = await rejectedAttempt(async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      live.prepare("UPDATE passkey_challenges SET origin='https://evil.example' WHERE id=?").run(body.challenge_id);
      await route.continue();
    });
    assert(/failed/i.test(wrongOrigin), `wrong origin was not rejected: ${wrongOrigin}`);

    const wrongRp = await rejectedAttempt(async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      live.prepare("UPDATE passkey_challenges SET rp_id='evil.example' WHERE id=?").run(body.challenge_id);
      await route.continue();
    });
    assert(/failed/i.test(wrongRp), `wrong RP ID was not rejected: ${wrongRp}`);

    const unknown = await passkeyPage.evaluate(async () => {
      const start = await fetch('/api/passkey/login/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }).then(response => response.json());
      const response = await fetch('/api/passkey/login/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: start.challenge_id,
          response: {
            id: 'unknown-credential', rawId: 'unknown-credential', type: 'public-key',
            clientExtensionResults: {}, response: { clientDataJSON: 'AA', authenticatorData: 'AA', signature: 'AA' }
          }
        })
      });
      return response.status;
    });
    assert(unknown === 401, `unknown credential expected 401, got ${unknown}`);

    const crossUser = await passkeyPage.evaluate(async ({ email, response }) => {
      const start = await fetch('/api/passkey/login/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email })
      }).then(result => result.json());
      const verified = await fetch('/api/passkey/login/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: start.challenge_id, response })
      });
      return verified.status;
    }, { email: 'browser.passkey.other@bliss.test', response: passkeyCapturedLogin.response });
    assert(crossUser === 401, `cross-user passkey assertion expected 401, got ${crossUser}`);
    live.close();
  });

  await test('multiple passkeys can be added and removed, with password recovery intact', async () => {
    await goto(passkeyPage, BASE + '/login.html');
    await passkeyPage.evaluate(() => sessionStorage.setItem('bliss_passkey_prompt_skipped', '1'));
    await passkeyPage.fill('#email', 'browser.passkey@bliss.test');
    await passkeyPage.fill('#password', PASSWORD);
    await passkeyPage.click('#submitBtn');
    await passkeyPage.waitForURL(url => url.pathname === '/dashboard', { timeout: 25000 });

    await passkeyCdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: passkeyAuthenticatorId });
    const secondAuthenticator = await passkeyCdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    });
    passkeyAuthenticatorId = secondAuthenticator.authenticatorId;

    await goto(passkeyPage, BASE + '/security.html');
    await passkeyPage.waitForSelector('#passkeyList .pk-device', { timeout: 20000 });
    await passkeyPage.click('#addPasskeyBtn');
    await passkeyPage.waitForSelector('#blissPasskeyModal.open', { timeout: 20000 });
    await passkeyPage.fill('#blissPasskeyName', 'Tablet');
    await passkeyPage.click('#blissPasskeyEnable');
    await passkeyPage.waitForFunction(() => document.querySelectorAll('#passkeyList .pk-device').length === 2, { timeout: 25000 });

    const live = new DatabaseSync(LIVE_DB);
    let count = live.prepare('SELECT COUNT(*) AS c FROM passkey_credentials WHERE user_id=?').get(passkeyUserId).c;
    live.close();
    assert(Number(count) === 2, `expected two passkeys, found ${count}`);

    await passkeyPage.locator('[data-passkey-action="remove"]').first().click();
    await passkeyPage.waitForSelector('#removePasskeyModal.open', { timeout: 10000 });
    await passkeyPage.fill('#removePasskeyPassword', 'not-the-password');
    await passkeyPage.click('#confirmRemovePasskeyBtn');
    await passkeyPage.waitForFunction(() => /password/i.test(document.getElementById('removePasskeyStatus')?.textContent || ''), { timeout: 10000 });
    const stillTwo = new DatabaseSync(LIVE_DB);
    count = stillTwo.prepare('SELECT COUNT(*) AS c FROM passkey_credentials WHERE user_id=?').get(passkeyUserId).c;
    stillTwo.close();
    assert(Number(count) === 2, 'passkey must not be removed without the current password');

    await passkeyPage.fill('#removePasskeyPassword', PASSWORD);
    await passkeyPage.click('#confirmRemovePasskeyBtn');
    await passkeyPage.waitForFunction(() => document.querySelectorAll('#passkeyList .pk-device').length === 1, { timeout: 20000 });

    await passkeyPage.locator('[data-passkey-action="remove"]').first().click();
    await passkeyPage.waitForSelector('#removePasskeyModal.open', { timeout: 10000 });
    await passkeyPage.fill('#removePasskeyPassword', PASSWORD);
    await passkeyPage.click('#confirmRemovePasskeyBtn');
    await passkeyPage.waitForFunction(() => /No passkeys yet/.test(document.getElementById('passkeyList')?.textContent || ''), { timeout: 20000 });

    await passkeyPage.evaluate(async () => { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); });
    await goto(passkeyPage, BASE + '/login.html');
    await passkeyPage.evaluate(() => sessionStorage.setItem('bliss_passkey_prompt_skipped', '1'));
    await passkeyPage.fill('#email', 'browser.passkey@bliss.test');
    await passkeyPage.fill('#password', PASSWORD);
    await passkeyPage.click('#submitBtn');
    await passkeyPage.waitForURL(url => url.pathname === '/dashboard', { timeout: 25000 });
    const me = await passkeyPage.evaluate(() => fetch('/api/me').then(response => response.json()));
    assert(me.role === 'Marketer', 'password recovery login must preserve the user role');
  });

  await test('Sub Admin sees a clean operations page with no internal matrix', async () => {
    await login(pageE, 'browser.subadmin@bliss.test');
    await goto(pageE, BASE + '/sub-admin-dashboard.html');
    await pageE.waitForFunction(() => document.querySelectorAll('#opsKpis .kpi').length > 0, { timeout: 20000 });
    const body = await pageE.locator('body').innerText();
    assert(!/endpoint/i.test(body), 'Sub Admin page exposed API endpoints');
    assert(!/\bpermission\b/i.test(body), 'Sub Admin page exposed permission keys');
    assert(!/read-only/i.test(body), 'Sub Admin page exposed read-only badges');
    assert(/Operations &\s*Approvals/i.test(body), 'Operations & Approvals title missing');
    const nav = await pageE.locator('#sidebar').innerText();
    assert(/Overview/i.test(nav), 'sidebar Overview group missing');
    assert(/Approvals/i.test(nav), 'sidebar Approvals group missing');
    assert(/Clients &\s*Properties/i.test(nav), 'sidebar Clients & Properties group missing');
    assert(/Finance/i.test(nav) && /Reports/i.test(nav), 'sidebar Finance/Reports groups missing');
    assert(!/Referral Commissions/i.test(nav), 'duplicate referral commission nav item still present');
    assert((await pageE.locator('a[href="property-create.html"]').count()) > 0, 'Sub Admin cannot see Add property');
    assert((await pageE.locator('a[href="properties.html"]').count()) > 0, 'Sub Admin cannot see Manage properties');
    const matrixStatus = await pageE.evaluate(async () => {
      const response = await fetch('/api/financial-approvals', { credentials: 'include' });
      return response.status;
    });
    assert(matrixStatus === 403, `Sub Admin approval matrix API returned ${matrixStatus}`);
  });

  await test('logging out removes dashboard power from the assistant', async () => {
    await pageA.evaluate(async () => {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    });
    await pageA.waitForFunction(() => /signed out/i.test(document.getElementById('dhThread')?.textContent || ''), { timeout: 10000 });
    const name = await pageA.evaluate(() => document.getElementById('dhName')?.textContent.trim() || '');
    assert(name === 'Adaora', `assistant should return to Adaora after logout, got ${name}`);
    const text = await pageA.evaluate(() => document.getElementById('dhThread')?.textContent || '');
    assert(/dashboard access/i.test(text), 'assistant logout notice missing');
  });

} catch (error) {
  failed++;
  console.error('  ❌ browser harness\n     ' + error.message);
} finally {
  shuttingDown = true;
  if (browser) await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { try { server.kill('SIGTERM'); } catch (e) {} }
  await new Promise(resolve => setTimeout(resolve, 1200));
  try { execFileSync('pkill', ['-f', `wrangler dev --port ${PORT}`], { stdio: 'ignore' }); } catch (error) {}
  try {
    const cleanup = new DatabaseSync(LIVE_DB);
    cleanup.exec('PRAGMA foreign_keys = ON;');
    const ids = cleanup.prepare("SELECT id FROM users WHERE email LIKE 'browser.%@bliss.test'").all().map(row => row.id);
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      cleanup.prepare(`DELETE FROM chat_messages WHERE sender_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM chat_room_members WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE created_by IN (${marks}))`).run(...ids);
      cleanup.prepare(`DELETE FROM chat_rooms WHERE created_by IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM lead_follow_ups WHERE staff_id IN (${marks}) OR lead_id IN (SELECT id FROM leads WHERE lead_reference LIKE 'TEST-BROWSER-%')`).run(...ids);
      cleanup.prepare(`DELETE FROM lead_temperature_history WHERE changed_by IN (${marks}) OR lead_id IN (SELECT id FROM leads WHERE lead_reference LIKE 'TEST-BROWSER-%')`).run(...ids);
      cleanup.prepare(`DELETE FROM leads WHERE lead_reference LIKE 'TEST-BROWSER-%'`).run();
      cleanup.prepare(`DELETE FROM sessions WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM team_members WHERE user_id IN (${marks}) OR team_id IN (SELECT id FROM teams WHERE name='Browser Test Team')`).run(...ids);
      cleanup.prepare("DELETE FROM teams WHERE name='Browser Test Team'").run();
      cleanup.prepare(`DELETE FROM staff_profiles WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM team_members WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM notifications WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM password_reset_tokens WHERE user_id IN (${marks})`).run(...ids);
      try {
        cleanup.prepare(`DELETE FROM passkey_credentials WHERE user_id IN (${marks})`).run(...ids);
        cleanup.prepare(`DELETE FROM passkey_challenges WHERE user_id IN (${marks}) OR (user_id IS NULL AND created_at >= datetime('now','-1 day'))`).run(...ids);
      } catch (error) { /* passkey migration may not be present in an older local database */ }
      cleanup.prepare(`UPDATE audit_logs SET actor_user_id=NULL WHERE actor_user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`UPDATE users SET manager_id=NULL, reactivated_by=NULL WHERE manager_id IN (${marks}) OR reactivated_by IN (${marks})`).run(...ids, ...ids);
      cleanup.prepare(`DELETE FROM users WHERE id IN (${marks})`).run(...ids);
    }
    cleanup.exec('DROP TABLE IF EXISTS _browser_probe;');
    cleanup.close();
  } catch (error) { console.error('  ⚠ browser cleanup:', error.message); }
}

console.log(`\n   RESULT: ${passed} PASSED | ${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
