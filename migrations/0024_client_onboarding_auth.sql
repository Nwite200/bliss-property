-- Phase 24: phone-first client login, optional email/BVN, client password recovery
-- and admin-assisted resets. Additive only.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN phone_e164 TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
ALTER TABLE users ADD COLUMN phone_changed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164
  ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_password_reset_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  client_id INTEGER,
  phone_e164 TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  consumed_at TEXT,
  requested_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_reset_user
  ON client_password_reset_codes(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_reset_phone
  ON client_password_reset_codes(phone_e164, created_at);
CREATE INDEX IF NOT EXISTS idx_client_reset_active
  ON client_password_reset_codes(user_id, consumed_at, expires_at);

INSERT OR IGNORE INTO sms_templates (template_key, name, body, language) VALUES
  ('client_password_reset_code', 'Client password reset code',
   'Your Bliss Legacy password reset code is {code}. It expires in 10 minutes. Do not share it.', 'en'),
  ('client_password_reset_completed', 'Client password reset completed',
   'Your Bliss Legacy password was changed successfully. If you did not do this, contact customer care immediately.', 'en'),
  ('client_password_reset_notice', 'Client password reset notice',
   'Customer care reset your Bliss Legacy password on {date}. If you did not request this, contact customer care immediately.', 'en'),
  ('client_password_reset_temp', 'Client temporary password',
   'Your temporary Bliss Legacy password is {temp_password}. Sign in and change it immediately. If you did not request this, contact customer care.', 'en');
