-- Challenges (B4): time-boxed, opt-in, consistency-based and rest-day friendly, among friends of the person who made it. Only a count per person is ever shown to the others
-- (days that counted, at most N a week); weights, calories and workouts never are. A cron closes them and emails each person who joined their result. Additive and safe to apply before the code is deployed.
CREATE TABLE challenges (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- training_days: days with a finished workout or session; protein_days: days with protein at or over the person's own protein goal; steps_days: days with at least `threshold` steps.
  metric     TEXT NOT NULL CHECK (metric IN ('training_days', 'protein_days', 'steps_days')),
  threshold  INTEGER,
  -- Rest-day friendly: only this many days a week count.
  per_week   INTEGER NOT NULL CHECK (per_week BETWEEN 1 AND 7),
  weeks      INTEGER NOT NULL CHECK (weeks BETWEEN 1 AND 8),
  start_day  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  closed_at  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX challenges_owner ON challenges (owner_id);

CREATE TABLE challenge_members (
  challenge_id TEXT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('invited', 'joined')),
  created_at   INTEGER NOT NULL,
  joined_at    INTEGER,
  -- Set when the challenge closes: the final score, the place (ties share one) and when the results email went out.
  score        INTEGER,
  rank         INTEGER,
  emailed_at   INTEGER,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX challenge_members_user ON challenge_members (user_id);
