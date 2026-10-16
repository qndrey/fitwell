-- The person's bar and plates, for the plate calculator and warm-up ramps.
-- JSON: { barKg, platesKg }; '{}' = the standard gym (20 kg bar; 25, 20, 15, 10, 5, 2.5, 1.25 kg plates).
ALTER TABLE profiles ADD COLUMN gym TEXT NOT NULL DEFAULT '{}';
