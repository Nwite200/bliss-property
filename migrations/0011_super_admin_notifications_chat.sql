-- Phase 10: Super Admin, permission-guarded admin routes, staff notifications and chat
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO roles (name) VALUES ('Super Admin');

-- Admin permission catalogue.
INSERT OR IGNORE INTO permissions (name) VALUES
  ('admin.roles'),('admin.permissions'),('admin.audit'),('admin.system'),('chat.manage');

-- Keep Managing Director as company-wide business administrator and add the
-- new controls. Super Admin receives every permission.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name='Managing Director';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name='Super Admin';

-- Chat rooms: one branch room per branch + optional direct rooms.
CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'branch', -- 'branch' | 'direct'
  branch_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);

-- Branch rooms are available to every active staff member in that branch.
INSERT INTO chat_rooms (name, kind, branch_id)
SELECT b.name || ' Branch Chat', 'branch', b.id
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM chat_rooms r WHERE r.kind='branch' AND r.branch_id=b.id
);
