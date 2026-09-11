-- Recoverable School Head passwords for the Super Admin console.
--
-- Additive and nullable: every existing row keeps NULL, which the console reads
-- as "set before LITRACK could record it — reset to sign in". No backfill is
-- possible and none is attempted; bcrypt hashes in Supabase Auth cannot be
-- reversed. Only passwords typed after this ships get sealed.
ALTER TABLE "User" ADD COLUMN "passwordVaultCipher" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordVaultSetAt" TIMESTAMP(3);
