-- Phase 4: recipes and weekly meal plans.
-- `items` are JSON snapshots: each ingredient keeps its name, food group and nutrition as they were when the recipe or
-- plan was saved, so editing a recipe later never changes a plan the person has already shopped for.

CREATE TABLE recipes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL COLLATE NOCASE,   -- "Chicken and rice" and "chicken AND rice" are the same recipe
  servings   REAL NOT NULL CHECK (servings > 0),
  items      TEXT NOT NULL,          -- JSON RecipeItem[]
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

-- One plan per person per week (week_start is a Monday); saving a week again replaces it.
CREATE TABLE meal_plans (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  items      TEXT NOT NULL,          -- JSON PlannedItem[]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, week_start)
);
