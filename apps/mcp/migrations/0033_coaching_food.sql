-- Coaching, part two (B7): food. Additive and safe to apply before the code is deployed.

-- A second, separate yes from the trainee: whether the coach sees their daily calorie and macro totals (never what they ate) against their goals.
ALTER TABLE coaching ADD COLUMN share_food INTEGER NOT NULL DEFAULT 0;

-- Calorie and macro targets a coach proposes. One waiting proposal per coaching (a new one replaces it). Nothing changes the trainee's goals
-- until they accept; accepting or declining deletes the row, and the coach is not told which.
CREATE TABLE coach_targets (
  coaching_id TEXT PRIMARY KEY REFERENCES coaching (id) ON DELETE CASCADE,
  kcal        REAL,
  protein_g   REAL,
  carbs_g     REAL,
  fat_g       REAL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
