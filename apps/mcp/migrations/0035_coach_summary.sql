-- Coaching, part four (B7): an opt-in weekly email to a coach about their trainees. Same shape as the other digests (migration 0024, 0034):
-- its own switch per person, recorded in digest_log so it goes out once, with an unsubscribe link. The digest_log rebuild copies every row.
ALTER TABLE profiles ADD COLUMN digest_coach INTEGER NOT NULL DEFAULT 0;

CREATE TABLE digest_log_new (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('weekly', 'nudge', 'assigned', 'coach')),
  period  TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, period)
);
INSERT INTO digest_log_new (user_id, kind, period, sent_at) SELECT user_id, kind, period, sent_at FROM digest_log;
DROP TABLE digest_log;
ALTER TABLE digest_log_new RENAME TO digest_log;
