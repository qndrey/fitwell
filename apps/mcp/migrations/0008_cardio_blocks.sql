-- Cardio inside a strength workout (a warm-up or a finisher), on the workout and on templates.
-- JSON arrays; NULL = none. The existing `cardio` column still holds the one session of a cardio-only workout.
ALTER TABLE workouts ADD COLUMN cardio_blocks TEXT;
ALTER TABLE workout_templates ADD COLUMN cardio_blocks TEXT;
