-- Super Admin school-account console: track when an account's live password is
-- the school's School ID, so the console can show a working sign-in credential
-- without ever storing a plaintext password.
--
-- Additive and non-destructive: one nullable-free boolean with a safe default.
--
-- Deliberately NOT backfilled. Existing School Head rows with
-- `mustChangePassword = true` are a mix of "password is still the School ID"
-- (created by `createSchool`) and "password is a random one-time credential"
-- (issued by `regenerateSchoolHeadCredential`), and nothing on the row tells
-- them apart. Defaulting every existing row to `false` makes the console say
-- "custom / unknown — reset to sign in", which is always true and always
-- recoverable in one click. A backfill would instead reveal a School ID that
-- may not work, and send an admin chasing a login that silently fails.
ALTER TABLE "User"
  ADD COLUMN "passwordIsSchoolId" BOOLEAN NOT NULL DEFAULT false;
