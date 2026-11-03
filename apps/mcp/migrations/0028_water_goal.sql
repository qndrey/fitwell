-- A daily water goal in millilitres. NULL = no water goal. Additive and safe to apply before the code is deployed.
ALTER TABLE goals ADD COLUMN water_ml INTEGER;
