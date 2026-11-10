import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

function hasBusinessSchema(path) {
  try {
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'").get();
    db.close();
    return Boolean(row);
  } catch {
    return false;
  }
}

// Resolve the current Wrangler local D1 database instead of relying on a
// hard-coded miniflare hash. The hash changes when the production database_id
// is configured in wrangler.toml.
export function resolveLiveDb() {
  const fallback = join(D1_DIR, 'c6c9fe2e839a026d2bc28c3710008b8d91b43bb2bed7c7b18fa3ea4062dfb1a0.sqlite');
  if (!existsSync(D1_DIR)) return fallback;
  const candidates = readdirSync(D1_DIR)
    // Real Wrangler D1 files are named with a 64-character hash. Restricting
    // the search keeps manual debug copies out of the test database selection.
    .filter(name => /^[a-f0-9]{64}\.sqlite$/.test(name))
    .map(name => join(D1_DIR, name))
    .filter(hasBusinessSchema)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] || fallback;
}
