-- Phase 14: client onboarding OTP verification.
PRAGMA foreign_keys = ON;

ALTER TABLE clients ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE clients ADD COLUMN verification_channel TEXT;
ALTER TABLE clients ADD COLUMN verification_sent_at TEXT;
ALTER TABLE clients ADD COLUMN verified_at TEXT;

-- Existing client records predate the verification flow and must not be
-- retroactively blocked.
UPDATE clients SET verification_status = 'verified', verified_at = COALESCE(created_at, datetime('now'))
WHERE verification_status = 'unverified';

CREATE INDEX IF NOT EXISTS idx_clients_verification ON clients(verification_status);

CREATE TABLE IF NOT EXISTS client_verification_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  channel TEXT NOT NULL, -- email | sms
  destination TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TEXT,
  last_sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed
  provider_message_id TEXT,
  error TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_client_otp_client ON client_verification_otps(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_otp_active ON client_verification_otps(client_id, consumed_at, expires_at);

INSERT OR IGNORE INTO sms_templates (template_key, name, body, language) VALUES
  ('client_verification_otp', 'Client verification code',
   'Your Bliss Legacy verification code is {code}. It expires in 10 minutes. Do not share it.', 'en');
