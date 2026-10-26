-- Streak milestones and the goal weight reached, recorded when get_streaks first sees them (F2). celebrated_at is for the celebration view (F3).
-- Additive and safe to apply before the code is deployed. achieved_at is the local day the milestone was reached.
CREATE TABLE achievements (
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('training_weeks', 'logging_days', 'logging_weeks', 'protein_days', 'goal_weight')),
  threshold     INTEGER NOT NULL,
  achieved_at   TEXT NOT NULL,
  celebrated_at INTEGER,
  PRIMARY KEY (user_id, kind, threshold)
);

-- The day the goal weight was set, so the weight-goal streak counts only trend days from then on.
-- Existing goal weights start from the day their goals row was last saved (UTC), the closest record there is.
ALTER TABLE goals ADD COLUMN goal_weight_since TEXT;
UPDATE goals SET goal_weight_since = date(updated_at / 1000, 'unixepoch') WHERE goal_weight_kg IS NOT NULL;
