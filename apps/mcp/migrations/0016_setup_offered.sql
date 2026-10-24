-- When get_profile first offered the guided setup to a new account (nothing saved yet), so it is offered only once.
-- Additive and safe to apply before the code is deployed. NULL = not offered (or the account already had data).
ALTER TABLE users ADD COLUMN setup_offered_at INTEGER;
