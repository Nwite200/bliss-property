-- Phase 30: Bliss Legacy digital human ecosystem.
-- Conversations, persona state, human handovers, event acknowledgement and
-- per-user voice preferences. All assistant data is scoped to the authenticated
-- user (or an anonymous visitor id) and never replaces existing authorisation.

PRAGMA foreign_keys = ON;

-- 1. One durable conversation per visitor/user. The conversation keeps the
--    current persona and the page context so a handover does not lose history.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  client_id INTEGER,
  visitor_id TEXT,
  current_persona TEXT NOT NULL DEFAULT 'adaora',
  page_path TEXT,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user
  ON assistant_conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_visitor
  ON assistant_conversations(visitor_id, updated_at);

-- 2. Full transcript. Persona key is stored per assistant turn so a persona
--    change never rewrites earlier messages.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  persona_key TEXT,
  content TEXT NOT NULL,
  intent TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation
  ON assistant_messages(conversation_id, id);

-- 3. Human staff handover. A handover is only "accepted" after an authorised
--    staff member explicitly accepts it; the assistant never claims success.
CREATE TABLE IF NOT EXISTS assistant_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handover_ref TEXT NOT NULL UNIQUE,
  conversation_id INTEGER,
  client_id INTEGER,
  requested_by_user_id INTEGER,
  department TEXT NOT NULL,
  branch_id INTEGER,
  assigned_user_id INTEGER,
  accepted_by_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  context_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  declined_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_handovers_status
  ON assistant_handovers(status, department, branch_id);
CREATE INDEX IF NOT EXISTS idx_assistant_handovers_assignee
  ON assistant_handovers(assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_assistant_handovers_conversation
  ON assistant_handovers(conversation_id, id);

-- 4. Event announcements already exist as notifications. This table only
--    records that a specific notification was announced by the digital human,
--    preventing repeated voice/toast announcements across devices.
CREATE TABLE IF NOT EXISTS assistant_event_acks (
  user_id INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  announced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Voice and persona preferences. Muting only affects the digital human and
--    never changes application behaviour or notification history.
CREATE TABLE IF NOT EXISTS assistant_preferences (
  user_id INTEGER PRIMARY KEY,
  muted INTEGER NOT NULL DEFAULT 0,
  voice_enabled INTEGER NOT NULL DEFAULT 1,
  speech_rate REAL NOT NULL DEFAULT 1,
  speech_pitch REAL NOT NULL DEFAULT 1,
  speech_volume REAL NOT NULL DEFAULT 1,
  preferred_persona TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. Staff availability for genuine human handover routing.
ALTER TABLE staff_profiles ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE staff_profiles ADD COLUMN availability_updated_at TEXT;

UPDATE staff_profiles
SET availability_status = 'available', availability_updated_at = datetime('now')
WHERE availability_status IS NULL OR availability_status = '';

CREATE INDEX IF NOT EXISTS idx_staff_availability
  ON staff_profiles(availability_status);

-- 7. Seed the assistant SMS templates used for human handover fallbacks. The
--    existing SMS adapter records delivery; it never pretends to have sent when
--    the provider is disabled.
INSERT OR IGNORE INTO sms_templates (template_key, name, body, language) VALUES
  ('assistant_handover_request', 'Digital assistant handover request',
   'Bliss Legacy: {client_name} is waiting for a human agent about {topic}. Handover {handover_ref}. Open your dashboard to accept.', 'en'),
  ('assistant_handover_accepted', 'Digital assistant handover accepted',
   'Bliss Legacy: {staff_name} has accepted your request and will continue the conversation. Reference {handover_ref}.', 'en'),
  ('assistant_callback_saved', 'Digital assistant callback saved',
   'Bliss Legacy: your callback request has been saved. Reference {handover_ref}. Our team will contact you.', 'en');
