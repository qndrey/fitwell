-- Kudos on a friend's finished workout, from the crew feed (B3). One per giver and workout. Only between friends who share workouts; ends with the friendship.
-- Additive and safe to apply before the code is deployed.
CREATE TABLE kudos (
  giver_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (giver_id, workout_id)
);
CREATE INDEX kudos_owner ON kudos (owner_id, workout_id);
