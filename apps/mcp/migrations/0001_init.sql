-- Phase 1: people, sign-in, profile, goals, food log, custom foods, Open Food Facts cache.
-- Conventions (as in @fitwell/core/schema): text UUID ids, times in ms since epoch, days as 'YYYY-MM-DD'
-- in the person's own time zone, canonical units (kg, cm, grams, kcal). Every personal row carries
-- user_id and is only read through UserData (src/data/userData.ts), which always filters by it.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  -- invited: may sign in; active: has signed in at least once
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  created_at    INTEGER NOT NULL,
  consented_at  INTEGER,
  last_login_at INTEGER
);

-- One email sign-in attempt. Codes and link tokens are stored only as SHA-256 hashes.
CREATE TABLE login_requests (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE,
  user_id       TEXT,                 -- NULL when the address is not invited (nothing is sent)
  code_hash     TEXT NOT NULL,
  link_hash     TEXT NOT NULL,
  ip            TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  verified_at   INTEGER,              -- link clicked (any browser) or code entered
  completed_at  INTEGER               -- authorization finished; the request can't be used again
);
CREATE INDEX login_requests_email ON login_requests (email, created_at);
CREATE INDEX login_requests_ip ON login_requests (ip, created_at);

CREATE TABLE profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  time_zone      TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  units          TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  sex            TEXT CHECK (sex IN ('female', 'male')),
  birth_year     INTEGER,
  height_cm      REAL,
  weight_kg      REAL,               -- latest known; weigh-ins get their own table in phase 3
  activity_level TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  equipment      TEXT NOT NULL DEFAULT '[]',   -- JSON array of free-exercise-db equipment names
  diet           TEXT NOT NULL DEFAULT '{}',   -- JSON: { preferences: string[], allergies: string[], dislikes: string[] }
  updated_at     INTEGER NOT NULL
);

CREATE TABLE goals (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  kcal              REAL,
  protein_g         REAL,
  carbs_g           REAL,
  fat_g             REAL,
  workouts_per_week INTEGER,
  goal_weight_kg    REAL,
  updated_at        INTEGER NOT NULL
);

-- A logged food keeps its own name and nutrition (a snapshot), so totals never change if a source changes.
CREATE TABLE food_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  slot        TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  food_ref    TEXT,                  -- 'frida:123', 'off:<barcode>', 'custom:<id>'; NULL for an estimate
  food_name   TEXT NOT NULL,
  brand       TEXT,
  grams       REAL NOT NULL CHECK (grams > 0),
  kcal        REAL NOT NULL,
  protein     REAL NOT NULL,
  carbs       REAL NOT NULL,
  fat         REAL NOT NULL,
  estimated   INTEGER NOT NULL DEFAULT 0,   -- 1 = values estimated by Claude, not from a database
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX food_entries_user_day ON food_entries (user_id, day);

CREATE TABLE custom_foods (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  brand       TEXT,
  kcal        REAL NOT NULL,         -- per 100 g
  protein     REAL NOT NULL,
  carbs       REAL NOT NULL,
  fat         REAL NOT NULL,
  portions    TEXT NOT NULL DEFAULT '[]',   -- JSON [{ label, grams }]
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX custom_foods_user ON custom_foods (user_id, name);

-- Shared, not personal: Open Food Facts answers by search text or barcode.
CREATE TABLE off_cache (
  key         TEXT PRIMARY KEY,      -- 'q:<normalised text>' or 'b:<barcode>'
  fetched_at  INTEGER NOT NULL,
  candidates  TEXT NOT NULL          -- JSON Candidate[]
);
