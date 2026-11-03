-- Nicknames: a name people give each other instead of an email address. Unique across the system, ignoring case.
-- Additive and safe to apply before the code is deployed.
ALTER TABLE profiles ADD COLUMN nickname TEXT;
CREATE UNIQUE INDEX profiles_nickname ON profiles (lower(nickname)) WHERE nickname IS NOT NULL;

-- A friend request can be made by nickname: the request is stored against the member's email as usual, and this says it was asked that way,
-- so the person who asked is shown the nickname and never the email.
ALTER TABLE connections ADD COLUMN via_nickname INTEGER NOT NULL DEFAULT 0;

-- Each lookup of a nickname, so finding members by guessing nicknames is slowed (a few lookups an hour). Deleted as they age.
CREATE TABLE nickname_lookups (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at      INTEGER NOT NULL
);
CREATE INDEX nickname_lookups_user ON nickname_lookups (user_id, at);
