-- Phase 2: workouts (strength and cardio) and saved templates.
-- `exercises` is JSON in the web app's shape (@fitwell/core/schema WorkoutExercise[]), so data can move between
-- the two; the server adds plan fields that the web backup format ignores (targetReps on sets, restSec on exercises).

CREATE TABLE workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('strength', 'cardio')),
  name         TEXT,
  started_at   INTEGER,
  finished_at  INTEGER,
  exercises    TEXT,                 -- strength: JSON WorkoutExercise[]
  cardio       TEXT,                 -- cardio: JSON CardioDetails
  template_id  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX workouts_user_day ON workouts (user_id, day);
CREATE INDEX workouts_user_type_day ON workouts (user_id, type, day);

CREATE TABLE workout_templates (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  exercises    TEXT NOT NULL,        -- JSON TemplateExercise[]: { id, sets, reps, weightKg?, restSec }
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE (user_id, name)
);
