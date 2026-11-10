-- Phase 33: WebAuthn passkey credentials and one-time challenges.
-- No biometric data is ever stored; only public-key credential metadata.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  credential_name TEXT NOT NULL DEFAULT 'This device',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user
  ON passkey_credentials(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_last_used
  ON passkey_credentials(user_id, last_used_at);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expiry
  ON passkey_challenges(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_user
  ON passkey_challenges(user_id, type, created_at);
