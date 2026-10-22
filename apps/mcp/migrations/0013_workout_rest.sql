-- A running rest between sets, so the player can pick it up again after a reload or on another device. Additive: all NULL = no rest.
-- rest_until is epoch ms stamped by the server; rest_total_ms is the length it was started with (for the progress bar);
-- rest_ex is the uid of the exercise whose card holds the rest (its next open set is what comes next).
ALTER TABLE workouts ADD COLUMN rest_until INTEGER;
ALTER TABLE workouts ADD COLUMN rest_total_ms INTEGER;
ALTER TABLE workouts ADD COLUMN rest_ex TEXT;
