-- Sending a workout template or a recipe to a friend (B1). The recipient gets a copy when they accept: a snapshot, with no ongoing visibility.
-- Additive and safe to apply before the code is deployed.
CREATE TABLE item_transfers (
  id           TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('template', 'recipe')),
  name         TEXT NOT NULL,
  -- The item as it was when sent (JSON), cleaned of anything that points back to the sender. Deleted once accepted.
  snapshot     TEXT NOT NULL,
  -- 'declined' is hidden from the recipient but still counts against the sender's limits, and nothing tells the sender it was declined.
  status       TEXT NOT NULL CHECK (status IN ('pending', 'declined')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX item_transfers_recipient ON item_transfers (recipient_id, status);
CREATE INDEX item_transfers_sender ON item_transfers (sender_id);
-- The same item sent again while it waits is one transfer.
CREATE UNIQUE INDEX item_transfers_one_waiting ON item_transfers (sender_id, recipient_id, kind, lower(name)) WHERE status = 'pending';
