-- The short written review of a week or month (Training notes and Nutrition notes), as Claude wrote it when it opened the review.
-- Additive. start_day is the review's first day (a Monday; for a month, its first Monday), so a note belongs to one period only.
-- A pair (note + next line) is NULL when Claude gave none for it: the review then shows the automatic summary for that card.
CREATE TABLE review_notes (
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period         TEXT NOT NULL CHECK (period IN ('week', 'month')),
  start_day      TEXT NOT NULL,
  training_note  TEXT,
  training_next  TEXT,
  nutrition_note TEXT,
  nutrition_next TEXT,
  written_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, period, start_day)
);
