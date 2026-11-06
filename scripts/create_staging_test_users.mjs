#!/usr/bin/env node
// Staging-only test accounts for the five dashboards.
// Usage: node scripts/create_staging_test_users.mjs --env staging
// Refuses production. Prints random passwords once; accounts expire in 14 days.
import { execFileSync } from 'node:child_process';
import { randomBytes, pbkdf2Sync } from 'node:crypto';

const args = process.argv.slice(2);
const envFlagIndex = args.findIndex(arg => arg === '--env' || arg === '-e');
const env = envFlagIndex >= 0 ? String(args[envFlagIndex + 1] || '').toLowerCase() : '';
const targetDb = 'bliss-legacy-staging-db';
if (!env || env !== 'staging') {
  console.error('Refusing to run: use exactly --env staging.');
  process.exit(1);
}
if (args.some(arg => /production/i.test(arg)) || /production/i.test(targetDb)) {
  console.error('Refusing to run against production.');
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${dk.toString('base64')}`;
}
function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(18);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `Tst!${out}`;
}
function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const accounts = [
  { role: 'Sub Admin', name: 'Staging Sub Admin', branch: 'Head Office' },
  { role: 'GSM', name: 'Staging GSM', branch: 'Head Office' },
  { role: 'Accountant', name: 'Staging Accountant', branch: 'Head Office' },
  { role: 'Managing Director', name: 'Staging Owner Test', branch: 'Head Office' },
  { role: 'Branch Manager', name: 'Staging Branch Manager', branch: 'Ikeja' },
  { role: 'Finance Officer', name: 'Staging Finance Officer', branch: 'Head Office' },
  { role: 'Head Accountant', name: 'Staging Head Accountant', branch: 'Head Office' },
  { role: 'Customer Care', name: 'Staging Customer Care', branch: 'Ikeja' },
  { role: 'Marketer', name: 'Staging Marketer', branch: 'Ikeja' },
  { role: 'Team Lead', name: 'Staging Team Lead', branch: 'Ikeja' }
];

const suffix = Date.now().toString(36);
const rows = [];
for (const account of accounts) {
  const email = `staging.${account.role.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${suffix}@staging.blisslegacy.local`;
  const password = randomPassword();
  const hash = hashPassword(password);
  rows.push({ ...account, email, password, hash });
}

const sql = rows.map(row => `
INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active, is_test, test_expires_at)
VALUES (
  ${sqlQuote(row.email)},
  ${sqlQuote(row.hash)},
  ${sqlQuote(row.name)},
  (SELECT id FROM roles WHERE name=${sqlQuote(row.role)}),
  (SELECT id FROM branches WHERE name=${sqlQuote(row.branch)}),
  1, 1, datetime('now','+14 days')
);`).join('\n');

try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', targetDb, '--remote', '--json', '--command', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
} catch (error) {
  console.error('Staging test-user creation failed.');
  if (error.stderr) console.error(String(error.stderr).slice(0, 1000));
  process.exit(1);
}

console.log('\nSTAGING TEST LOGINS — shown once; expire in 14 days\n');
console.log('Role'.padEnd(20), 'Email'.padEnd(65), 'Password');
console.log('-'.repeat(120));
for (const row of rows) {
  console.log(row.role.padEnd(20), row.email.padEnd(65), row.password);
}
console.log('\nThese accounts are is_test=1 and expire automatically. Production is untouched.');
