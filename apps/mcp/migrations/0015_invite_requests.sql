-- People asking for an invitation through the form at /request-access. Only the owner sees them (manage_invites);
-- approving one invites the address and deletes the row, declining deletes it, and rows older than 30 days are pruned.
-- Additive. platform is the optional "I use Claude on" choice; ip only limits repeated requests.
CREATE TABLE invite_requests (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  platform   TEXT CHECK (platform IN ('desktop', 'web', 'iphone')),
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX invite_requests_ip ON invite_requests (ip, created_at);
