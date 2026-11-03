-- Sending a whole week's meal plan to a friend (B1): item_transfers.kind may now be 'meal_plan'. SQLite cannot change a CHECK, so the table is rebuilt with its rows and indexes.
-- Additive in effect and safe to apply before the code is deployed.
CREATE TABLE item_transfers_new (
  id           TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('template', 'recipe', 'meal_plan')),
  name         TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'declined')),
  created_at   INTEGER NOT NULL
);
INSERT INTO item_transfers_new (id, sender_id, recipient_id, kind, name, snapshot, status, created_at)
  SELECT id, sender_id, recipient_id, kind, name, snapshot, status, created_at FROM item_transfers;
DROP TABLE item_transfers;
ALTER TABLE item_transfers_new RENAME TO item_transfers;
CREATE INDEX item_transfers_recipient ON item_transfers (recipient_id, status);
CREATE INDEX item_transfers_sender ON item_transfers (sender_id);
CREATE UNIQUE INDEX item_transfers_one_waiting ON item_transfers (sender_id, recipient_id, kind, lower(name)) WHERE status = 'pending';
