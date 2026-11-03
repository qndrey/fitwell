-- Email digests (E1): opt-in, one weekly summary and one gentle nudge after a few days without a log. Off for everyone until they ask Claude.
-- Additive and safe to apply before the code is deployed.
ALTER TABLE profiles ADD COLUMN digest_weekly INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN digest_nudge INTEGER NOT NULL DEFAULT 0;
-- A random secret for the unsubscribe link in each email, made when a digest is first turned on. Only its holder can switch the emails off from the link.
ALTER TABLE profiles ADD COLUMN digest_token TEXT;

-- What was sent, so one digest goes out once however often the cron runs: (kind, period) is the week (weekly) or the last day a log was made (nudge).
CREATE TABLE digest_log (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('weekly', 'nudge')),
  period  TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, period)
);
