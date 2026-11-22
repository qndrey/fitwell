-- Coach and trainee (B7): a member offers to coach a friend, the friend agrees once, and the coach can then assign saved workouts.
-- Additive and safe to apply before the code is deployed. Only between accepted friends; the friendship ending ends the coaching (code, and every query checks it).

-- One row per coach and trainee. 'pending' until the trainee answers. share_results is the trainee's own choice, made when accepting:
-- whether the coach sees how the assigned workouts went (sets, effort and notes of those workouts only, never anything else they log).
CREATE TABLE coaching (
  id            TEXT PRIMARY KEY,
  coach_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trainee_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  share_results INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  responded_at  INTEGER,
  CHECK (coach_id != trainee_id),
  UNIQUE (coach_id, trainee_id)
);
CREATE INDEX coaching_trainee ON coaching (trainee_id, status);

-- A workout a coach assigned: a snapshot of one of the coach's templates (cleaned like a sent template), an optional day and a note.
-- workout_id is set when the trainee starts it; whether it is done is read from that workout, so nothing here is copied from their log.
CREATE TABLE assignments (
  id           TEXT PRIMARY KEY,
  coaching_id  TEXT NOT NULL REFERENCES coaching (id) ON DELETE CASCADE,
  coach_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trainee_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  due_on       TEXT,
  note         TEXT,
  workout_id   TEXT,
  dismissed_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX assignments_trainee ON assignments (trainee_id, dismissed_at);
CREATE INDEX assignments_coaching ON assignments (coaching_id, created_at);
