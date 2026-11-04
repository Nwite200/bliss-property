-- Phase 3: property management & inventory
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS property_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category_id INTEGER,
  property_type TEXT,
  sale_price INTEGER NOT NULL DEFAULT 0,
  promotional_price INTEGER,
  currency TEXT NOT NULL DEFAULT 'NGN',
  state TEXT,
  city TEXT,
  address TEXT,
  branch_id INTEGER,
  land_size TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  toilets INTEGER,
  parking_spaces INTEGER,
  features TEXT,
  status TEXT NOT NULL DEFAULT 'Available',
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES property_categories(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS property_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  is_main INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS property_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS property_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_properties_branch ON properties(branch_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_published ON properties(is_published);
CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id);

-- Seed categories
INSERT OR IGNORE INTO property_categories (name) VALUES
  ('Land and Plots'),('Residential Properties'),('Commercial Properties'),
  ('Estates and Developments'),('Apartments'),('Houses'),('Office Spaces'),('Other Properties');
