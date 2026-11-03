-- Injuries and limitations (A11): what the person told Claude and agreed to save, so it is not asked again in every chat. Health data (GDPR Art. 9): only the person's own tools read it,
-- it is in their export and deleted with the account, and it is never shared with friends or shown on a card. Additive and safe to apply before the code is deployed.
CREATE TABLE injuries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  area       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  avoid      TEXT NOT NULL DEFAULT '',
  since      TEXT,
  until      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX injuries_user ON injuries (user_id);
