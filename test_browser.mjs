import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
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
const PORT = Number(process.env.BROWSER_TEST_PORT || 8790);
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

async function waitForServer(url, timeoutMs = 45000) {
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(700);
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
const marketerId = upsert('browser.marketer@bliss.test', 'Browser Marketer', marketerRole, ikeja);
const teamLeadRole = roleId('Team Lead');
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
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

let browser;
try {
  if (!(await waitForServer(BASE))) {
    throw new Error('wrangler dev did not start: ' + serverLog.slice(-800));
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

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
} catch (error) {
  failed++;
  console.error('  ❌ browser harness\n     ' + error.message);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 800));
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
      cleanup.prepare(`DELETE FROM staff_profiles WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM team_members WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM notifications WHERE user_id IN (${marks})`).run(...ids);
      cleanup.prepare(`DELETE FROM password_reset_tokens WHERE user_id IN (${marks})`).run(...ids);
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
