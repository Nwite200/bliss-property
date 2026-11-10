-- Phase 31: HeadTTS/Kokoro voice profiles, routing preferences and consent.
-- Audio is never stored in D1; only configuration and approved profile metadata.

PRAGMA foreign_keys = ON;

ALTER TABLE assistant_preferences ADD COLUMN voice_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE assistant_preferences ADD COLUMN browser_voice_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assistant_preferences ADD COLUMN server_voice_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assistant_preferences ADD COLUMN voice_consent_at TEXT;
ALTER TABLE assistant_preferences ADD COLUMN language_mode TEXT NOT NULL DEFAULT 'auto';

-- Approved persona-to-voice assignments. The service can fall back to the
-- code defaults if a row is missing, but this is the authoritative approval
-- record for each persona.
CREATE TABLE IF NOT EXISTS assistant_voice_profiles (
  persona_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'headtts',
  voice_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en-us',
  speed REAL NOT NULL DEFAULT 1,
  is_approved INTEGER NOT NULL DEFAULT 1,
  approved_by INTEGER,
  approved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO assistant_voice_profiles
  (persona_key, provider, voice_id, language, speed, is_approved)
VALUES
  ('adaora',   'headtts', 'af_heart',   'en-us', 0.98, 1),
  ('solomon',  'headtts', 'am_fenrir',  'en-us', 0.97, 1),
  ('chiamaka', 'headtts', 'af_bella',   'en-us', 1.00, 1),
  ('emeka',    'headtts', 'am_michael', 'en-us', 0.96, 1),
  ('amara',    'headtts', 'af_nicole',  'en-us', 0.98, 1),
  ('david',    'headtts', 'am_puck',    'en-us', 1.01, 1),
  ('ngozi',    'headtts', 'bf_emma',    'en-us', 0.97, 1),
  ('daniel',   'headtts', 'bm_george',  'en-us', 0.95, 1),
  ('ifeoma',   'headtts', 'af_aoede',   'en-us', 0.97, 1);

-- Existing users keep the safe defaults. Values are validated server-side.
UPDATE assistant_preferences
SET voice_mode = COALESCE(NULLIF(voice_mode, ''), 'auto'),
    browser_voice_enabled = COALESCE(browser_voice_enabled, 1),
    server_voice_enabled = COALESCE(server_voice_enabled, 1)
WHERE 1=1;
