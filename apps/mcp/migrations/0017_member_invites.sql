-- Members inviting friends (invite_friend). Additive and safe to apply before the code is deployed.
-- users.invited_by: the member who invited this person (NULL for people the owner added or approved from the request form).
-- When the inviter's account is deleted their unused invitations are removed; friends who joined stay and invited_by is cleared.
ALTER TABLE users ADD COLUMN invited_by TEXT REFERENCES users (id) ON DELETE SET NULL;

-- One row per invitation a member sent, to enforce the limit of 3 in 30 days. It never holds an address and a row
-- is deleted once it is 30 days old. Cancelling or losing an invitation does not delete its row, so it still counts.
CREATE TABLE member_invites (
  id         TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_invites_inviter ON member_invites (inviter_id, created_at);
