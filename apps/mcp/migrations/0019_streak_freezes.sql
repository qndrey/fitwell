-- Weeks the person froze (a planned rest week, a holiday, being unwell): a frozen week below the target keeps a weekly streak going.
-- Additive and safe to apply before the code is deployed. week_start is the Monday of the week, as a local day.
CREATE TABLE streak_freezes (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start)
);
