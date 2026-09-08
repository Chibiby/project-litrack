-- Super Admin signs in by username instead of email.
--
-- Supabase Auth still authenticates on an email address, so the username is a
-- lookup handle only: `loginAdmin` resolves username -> User row -> `email`,
-- then hands that address to `signInWithPassword`. `email` therefore stays the
-- account's identity, and the forgot-password flow is untouched — it still
-- mails whatever address the row carries.
--
-- Additive and non-destructive: one nullable column plus a unique index.
-- Nullable because School Heads (school + password) and teachers
-- (school + email + password) do not sign in by handle and have none. In
-- Postgres a UNIQUE index treats NULLs as distinct, so every existing row
-- keeps a NULL username without colliding.
ALTER TABLE "User" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Backfill the initial handle onto exactly one Super Admin.
--
-- Scoped by subquery rather than a bare `WHERE role = 'SUPER_ADMIN'`: a plain
-- UPDATE would try to write 'admin' onto every Super Admin row and violate the
-- unique index the statement above just created, failing the whole migration on
-- any deployment that has more than one. Oldest active account wins;
-- any others keep a NULL username and can be given their own handle later.
UPDATE "User"
SET "username" = 'admin'
WHERE "id" = (
  SELECT "id"
  FROM "User"
  WHERE "role" = 'SUPER_ADMIN'
    AND "isActive" = true
    AND "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
);
