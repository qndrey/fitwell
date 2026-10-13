-- One-time upload links for importing a Fitwell backup (the web app's backup file).
-- The link carries a random token (stored only as a SHA-256 hash), is bound to one person, expires, and is
-- used up when the import is finished. `report` accumulates what was imported, per kind of record.
CREATE TABLE import_links (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  finished_at INTEGER,
  rows_seen   INTEGER NOT NULL DEFAULT 0,
  report      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX import_links_user ON import_links (user_id);
