-- Additive and nullable: existing users remain valid and report unavailable
-- presence until their own teacher session sends its first heartbeat.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastOnlineAt" TIMESTAMP(3);
