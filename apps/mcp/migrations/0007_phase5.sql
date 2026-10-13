-- Phase 5: sleep, steps and water per day; ticks on the shopping list; where a recipe came from and how to cook it.

-- One row per person per day. Each column is set independently; NULL = not logged.
CREATE TABLE daily_metrics (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  sleep_h    REAL    CHECK (sleep_h IS NULL OR (sleep_h >= 0 AND sleep_h <= 24)),
  steps      INTEGER CHECK (steps IS NULL OR (steps >= 0 AND steps <= 200000)),
  water_ml   INTEGER CHECK (water_ml IS NULL OR (water_ml >= 0 AND water_ml <= 20000)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Items ticked off the grocery list of a week. item_key is the food id (or "name:<lowercase name>" for foods without one),
-- so ticks survive regenerating the list; an item that disappears from the plan simply stops being shown.
CREATE TABLE grocery_ticks (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  item_key   TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start, item_key)
);

ALTER TABLE recipes ADD COLUMN source_url TEXT;
ALTER TABLE recipes ADD COLUMN steps TEXT;   -- JSON string[] of method steps
