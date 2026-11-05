import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveLiveDb } from './test_db_paths.mjs';

const LIVE_DB = resolveLiveDb();
const TEMP_DB = join(dirname(LIVE_DB), 'wipe-security-test.sqlite');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ❌ ${name}\n     ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPython(args, extraEnv) {
  return spawnSync('python3', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

for (const suffix of ['', '-wal', '-shm']) rmSync(TEMP_DB + suffix, { force: true });
mkdirSync(dirname(TEMP_DB), { recursive: true });

console.log('\n========================================================');
console.log('   BLISS LEGACY — SEED / WIPE ENVIRONMENT SECURITY');
console.log('========================================================\n');

test('seed refuses a production environment', () => {
  const result = runPython(['seed_phase5.py'], { SEED_ENV: 'production' });
  assert(result.status !== 0, 'seed must exit non-zero for production');
  assert(/REFUSED/i.test(result.stderr + result.stdout), 'seed did not explain the refusal');
});

test('seed refuses a missing or ambiguous environment', () => {
  const blank = runPython(['seed_phase5.py'], { SEED_ENV: '' });
  assert(blank.status !== 0, 'seed must fail closed with no SEED_ENV');
  const mismatch = runPython(['seed_phase5.py'], { SEED_ENV: 'local', ENVIRONMENT: 'production' });
  assert(mismatch.status !== 0, 'seed must fail when ENVIRONMENT disagrees');
});

test('seed refuses staging without the exact staging database ID', () => {
  const result = runPython(['seed_phase6.py'], { SEED_ENV: 'staging', ENVIRONMENT: 'staging' });
  assert(result.status !== 0, 'seed must not accept an unverified staging target');
  const wrongId = runPython(['seed_staging.py', '--apply'], {
    SEED_ENV: 'staging', ENVIRONMENT: 'staging', STAGING_DB_ID: '00000000-0000-0000-0000-000000000000'
  });
  assert(wrongId.status !== 0 && /REFUSED/i.test(wrongId.stderr + wrongId.stdout), 'staging seed must refuse an unknown database ID');
});

test('wipe refuses a production environment', () => {
  copyFileSync(LIVE_DB, TEMP_DB);
  const result = runPython(['wipe_test_data.py', '--db', TEMP_DB, '--yes'], { SEED_ENV: 'production' });
  assert(result.status !== 0, 'wipe must refuse production');
  assert(/REFUSED/i.test(result.stderr + result.stdout), 'wipe did not explain the refusal');
});

test('wipe removes only test accounts and their seeded data', () => {
  copyFileSync(LIVE_DB, TEMP_DB);
  const db = new DatabaseSync(TEMP_DB);
  db.exec('PRAGMA foreign_keys = ON;');
  const roleId = db.prepare("SELECT id FROM roles WHERE name='Marketer'").get().id;
  db.prepare(`INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active, is_test)
    VALUES ('wipe.test@bliss.test', 'x', 'Wipe Test', ?, 1, 1, 1)`).run(roleId);
  const testUser = db.prepare("SELECT id FROM users WHERE email='wipe.test@bliss.test'").get().id;
  db.prepare(`INSERT INTO clients (client_reference, full_name, phone_number, created_by, original_marketer_id, is_deleted)
    VALUES ('TEST-WIPE-1', 'Wipe Client', '+2348000000001', ?, ?, 0)`).run(testUser, testUser);
  db.prepare(`INSERT INTO leads (lead_reference, full_name, phone_number, branch_id, created_by)
    VALUES ('TEST-WIPE-LEAD', 'Wipe Lead', '+2348000000002', 1, ?)`).run(testUser);
  const nonTestUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_test=0').get().c;
  const nonTestClients = db.prepare("SELECT COUNT(*) AS c FROM clients WHERE client_reference NOT LIKE 'TEST-%'").get().c;
  db.close();

  const result = runPython(['wipe_test_data.py', '--db', TEMP_DB, '--yes'], { SEED_ENV: 'local' });
  assert(result.status === 0, `wipe failed: ${result.stderr || result.stdout}`);

  const check = new DatabaseSync(TEMP_DB);
  assert(check.prepare("SELECT COUNT(*) AS c FROM users WHERE email='wipe.test@bliss.test'").get().c === 0, 'test user survived');
  assert(check.prepare("SELECT COUNT(*) AS c FROM clients WHERE client_reference='TEST-WIPE-1'").get().c === 0, 'test client survived');
  assert(check.prepare("SELECT COUNT(*) AS c FROM leads WHERE lead_reference='TEST-WIPE-LEAD'").get().c === 0, 'test lead survived');
  assert(check.prepare('SELECT COUNT(*) AS c FROM users WHERE is_test=0').get().c === nonTestUsers, 'wipe removed a non-test user');
  assert(check.prepare("SELECT COUNT(*) AS c FROM clients WHERE client_reference NOT LIKE 'TEST-%'").get().c === nonTestClients, 'wipe removed a non-test client');
  check.close();
});

for (const suffix of ['', '-wal', '-shm']) rmSync(TEMP_DB + suffix, { force: true });

console.log(`\n   RESULT: ${passed} PASSED | ${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
