-- Restaurant and other estimates carry a range (D4): the entry stores the middle of the range in kcal (so every total keeps working) and the range itself,
-- so the person is told "about 650 kcal, between 500 and 800" and not a made-up exact number. NULL = no range (an exact value or a single-number estimate).
-- Additive and safe to apply before the code is deployed.
ALTER TABLE food_entries ADD COLUMN kcal_low REAL;
ALTER TABLE food_entries ADD COLUMN kcal_high REAL;
