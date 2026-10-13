-- The emailed link only counts in the browser that started the sign-in (login-phishing protection):
-- that browser gets a random secret cookie at the email step; its SHA-256 is kept here.
ALTER TABLE login_requests ADD COLUMN browser_hash TEXT NOT NULL DEFAULT '';
