-- Fresh v0.4 D1 schema. Intentionally no demo INSERTs.
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  developer TEXT NOT NULL DEFAULT 'Horanov Labs',
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Інше',
  icon TEXT NOT NULL DEFAULT 'H',
  accent TEXT NOT NULL DEFAULT '#F56B2A',
  apk_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_updated ON apps(featured DESC, updated_at DESC);
