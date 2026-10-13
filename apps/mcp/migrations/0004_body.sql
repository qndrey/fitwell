-- Phase 3: body weight and measurements. One weigh-in and one measurement set per person per day.
-- Canonical units: kg and cm (percent for body fat). `values` is JSON keyed by the preset key from
-- @fitwell/core/data/measurements (waist, hips, chest, neck, arm-left, ..., body-fat).

CREATE TABLE weights (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  kg         REAL NOT NULL CHECK (kg > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE measurements (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  "values"   TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
