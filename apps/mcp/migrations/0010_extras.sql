-- Fibre, sugars, saturated and trans fat, salt: JSON { fiber, sugar, addedSugar, satFat, transFat, salt } in grams
-- (per 100 g on a custom food, for the logged amount on an entry). A missing key = not known; NULL = nothing known.
ALTER TABLE custom_foods ADD COLUMN extras TEXT;
ALTER TABLE food_entries ADD COLUMN extras TEXT;
-- Daily targets and limits for some of them (a minimum for fibre, maximums for the others).
ALTER TABLE goals ADD COLUMN fiber_g REAL;
ALTER TABLE goals ADD COLUMN sat_fat_g REAL;
ALTER TABLE goals ADD COLUMN added_sugar_g REAL;
