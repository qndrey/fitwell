-- Friends (B foundation): who is connected to whom, and what each person lets a friend see. Nothing is shared by default.
-- Additive and safe to apply before the code is deployed.

-- One row per pair that has asked or agreed to connect. A declined or removed connection is deleted, not kept.
CREATE TABLE connections (
  id           TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (requester_id != addressee_id),
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX connections_addressee ON connections (addressee_id);

-- What `owner` lets `viewer` see: one row per category. Only between accepted connections, and gone when the connection is.
-- workouts: finished workouts and records. consistency: streaks and whether they trained, no numbers. templates: templates and recipes.
-- body: weight and body measurements, only ever to a friend chosen explicitly and never in a feed.
CREATE TABLE shares (
  owner_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('workouts', 'consistency', 'templates', 'body')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, viewer_id, category)
);
CREATE INDEX shares_viewer ON shares (viewer_id);

-- Consent records: every grant and every withdrawal, in order, so what a person agreed to and when can be shown. Append-only.
CREATE TABLE share_consents (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category  TEXT NOT NULL,
  action    TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  at        INTEGER NOT NULL
);
CREATE INDEX share_consents_owner ON share_consents (owner_id);
