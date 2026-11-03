-- Households (B2): people who cook together share one meal plan and one set of grocery ticks, with a portion each. Goals, allergies, dislikes, the food log and what
-- was eaten stay each person's own: nobody in a household can read another's. Members are friends (an accepted connection is needed to invite). Additive and safe to apply
-- before the code is deployed.
CREATE TABLE households (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- One household per person (UNIQUE user_id). portion scales the shared plan for this person: 1 is the amounts as planned, 0.5 half of them.
CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  portion      REAL NOT NULL DEFAULT 1 CHECK (portion >= 0.25 AND portion <= 3),
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id)
);

-- An invitation to a friend, until they answer. Answered ones are deleted.
CREATE TABLE household_invites (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  inviter_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invitee_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  UNIQUE (household_id, invitee_id)
);
CREATE INDEX household_invites_invitee ON household_invites (invitee_id);

-- The shared plan of a week: the items for one standard portion (JSON, as meal_plans.items but with nothing eaten: that is each person's own).
CREATE TABLE household_plans (
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  week_start   TEXT NOT NULL,
  items        TEXT NOT NULL,
  saved_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (household_id, week_start)
);

-- The shared grocery list's ticks: one set for the household.
CREATE TABLE household_ticks (
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  week_start   TEXT NOT NULL,
  item_key     TEXT NOT NULL,
  checked_at   INTEGER NOT NULL,
  PRIMARY KEY (household_id, week_start, item_key)
);

-- A person's own copy of a week can follow the household's plan: it is rebuilt (scaled to their portion, keeping what they ate) when the household plan or their portion changes,
-- and stops following the moment they change it themselves.
ALTER TABLE meal_plans ADD COLUMN household_id TEXT;
ALTER TABLE meal_plans ADD COLUMN household_synced_at INTEGER;
ALTER TABLE meal_plans ADD COLUMN household_portion REAL;
