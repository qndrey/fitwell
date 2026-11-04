-- Programs (A4): a block of weeks of saved workouts with scheduled deload weeks, so "start today's workout" knows it is Week 3, Day B. Additive and safe to apply before the code is deployed.
CREATE TABLE programs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  weeks        INTEGER NOT NULL CHECK (weeks BETWEEN 2 AND 16),
  -- The week numbers that are deloads (JSON array), and the days of a week in order (JSON array of { label, templateId }).
  deload_weeks TEXT NOT NULL DEFAULT '[]',
  days         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  ended_at     INTEGER
);
-- One active program per person.
CREATE UNIQUE INDEX programs_one_active ON programs (user_id) WHERE status = 'active';

-- The workout started for each step of a program (step 0 is Week 1, Day 1). A deload session is not what the next weights are built from.
CREATE TABLE program_sessions (
  program_id TEXT NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  step       INTEGER NOT NULL,
  workout_id TEXT NOT NULL,
  deload     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (program_id, step)
);
CREATE INDEX program_sessions_workout ON program_sessions (workout_id);
