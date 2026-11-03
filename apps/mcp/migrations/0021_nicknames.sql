-- Nicknames: a name people give each other instead of an email address. Unique across the system, ignoring case.
-- Safe to apply before the code is deployed: the old code only ever writes the columns that are kept.
ALTER TABLE profiles ADD COLUMN nickname TEXT;
CREATE UNIQUE INDEX profiles_nickname ON profiles (lower(nickname)) WHERE nickname IS NOT NULL;

-- A friend request can be made by nickname: the request is stored against the member's email as usual, and via_nickname says it was asked
-- that way, so the person who asked is shown the nickname and never the email. A request by nickname and one by email to the same person
-- are separate rows (the unique key includes via_nickname), so that asking one way after the other never looks different from a fresh
-- request: otherwise a guessed email could be tested against a nickname. The table is rebuilt for the new key; its rows are copied.
CREATE TABLE connections_new (
  id              TEXT PRIMARY KEY,
  requester_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_email TEXT NOT NULL,
  addressee_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at      INTEGER NOT NULL,
  responded_at    INTEGER,
  via_nickname    INTEGER NOT NULL DEFAULT 0,
  CHECK (status = 'pending' OR addressee_id IS NOT NULL),
  CHECK (addressee_id IS NULL OR requester_id != addressee_id),
  UNIQUE (requester_id, addressee_email, via_nickname)
);
INSERT INTO connections_new (id, requester_id, addressee_email, addressee_id, status, created_at, responded_at, via_nickname)
  SELECT id, requester_id, addressee_email, addressee_id, status, created_at, responded_at, 0 FROM connections;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
CREATE UNIQUE INDEX connections_one_friendship ON connections (min(requester_id, addressee_id), max(requester_id, addressee_id)) WHERE status = 'accepted';
CREATE INDEX connections_addressee_email ON connections (addressee_email);
CREATE INDEX connections_addressee_id ON connections (addressee_id);

-- Each lookup of a nickname, so finding members by guessing nicknames is slowed (a few lookups an hour). Deleted as they age.
CREATE TABLE nickname_lookups (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at      INTEGER NOT NULL
);
CREATE INDEX nickname_lookups_user ON nickname_lookups (user_id, at);
