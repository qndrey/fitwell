-- Coaching, part three (B7): whole programs, and an opt-in email reminder for assigned workouts. Additive except the digest_log rebuild below
-- (SQLite cannot change a CHECK in place): it copies every row, so apply it like the others, before or after the code.

-- A program a coach assigned: a snapshot of their active program with each day's workout inside, so the trainee gets nothing else of the coach's.
-- It waits (program_id and dismissed_at empty) until the trainee accepts, which saves the workouts as their own and starts the program for them;
-- program_id is then theirs, kept so the coach can see how many of its sessions are done (counted from the sessions of that program).
CREATE TABLE assigned_programs (
  id           TEXT PRIMARY KEY,
  coaching_id  TEXT NOT NULL REFERENCES coaching (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  weeks        INTEGER NOT NULL,
  deload_weeks TEXT NOT NULL DEFAULT '[]',
  days         TEXT NOT NULL,
  note         TEXT,
  program_id   TEXT,
  dismissed_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX assigned_programs_coaching ON assigned_programs (coaching_id, created_at);

-- An email on the morning an assigned workout is due, only for people who ask (update_profile email_digests assignment_reminder), with an unsubscribe link.
ALTER TABLE profiles ADD COLUMN digest_assigned INTEGER NOT NULL DEFAULT 0;

CREATE TABLE digest_log_new (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('weekly', 'nudge', 'assigned')),
  period  TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, period)
);
INSERT INTO digest_log_new (user_id, kind, period, sent_at) SELECT user_id, kind, period, sent_at FROM digest_log;
DROP TABLE digest_log;
ALTER TABLE digest_log_new RENAME TO digest_log;
