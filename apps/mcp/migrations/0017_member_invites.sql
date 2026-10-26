-- Members inviting friends (invite_friend). Additive and safe to apply before the code is deployed.
-- users.invited_by: the member who invited this person (NULL for people the owner added or approved from the request form).
-- When the inviter's account is deleted their unused invitations are removed; friends who joined stay and invited_by is cleared.
ALTER TABLE users ADD COLUMN invited_by TEXT REFERENCES users (id) ON DELETE SET NULL;

-- One row per invitation a member sent, to enforce the limit of 3 in 30 days and to give the inviter their list. A row is
-- deleted once it is 30 days old. It holds the address the inviter typed, also when that address already had an account, so
-- the inviter's list cannot reveal who already uses Fitwell. Cancelling an invitation, the owner removing it, or the
-- address's person deleting their account clears the address (NULL) but keeps the row, so it still counts.
CREATE TABLE member_invites (
  id         TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  email      TEXT COLLATE NOCASE
);
CREATE INDEX member_invites_inviter ON member_invites (inviter_id, created_at);
CREATE INDEX member_invites_email ON member_invites (email);
