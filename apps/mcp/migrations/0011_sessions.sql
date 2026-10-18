-- Whole-body sessions (Pilates, HIIT, CrossFit, Hyrox, functional, yoga) as their own workout type.
-- SQLite cannot change a CHECK constraint, so the table is rebuilt with the same columns, plus `session`:
-- JSON { category, activityRef, activityName, met, durationMin, kcalEstimated?, kcalOverride?, weightKgUsed?, notes? }.
CREATE TABLE workouts_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('strength', 'cardio', 'session')),
  name          TEXT,
  started_at    INTEGER,
  finished_at   INTEGER,
  exercises     TEXT,
  cardio        TEXT,
  template_id   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  cardio_blocks TEXT,
  session       TEXT
);
INSERT INTO workouts_new (id, user_id, day, type, name, started_at, finished_at, exercises, cardio, template_id, created_at, updated_at, cardio_blocks)
  SELECT id, user_id, day, type, name, started_at, finished_at, exercises, cardio, template_id, created_at, updated_at, cardio_blocks FROM workouts;
DROP TABLE workouts;
ALTER TABLE workouts_new RENAME TO workouts;
CREATE INDEX workouts_user_day ON workouts (user_id, day);
CREATE INDEX workouts_user_type_day ON workouts (user_id, type, day);
