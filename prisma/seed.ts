/**
 * Seed script: bootstraps a Super Admin account.
 * Run with: npm run db:seed
 *
 * Requires the following env vars:
 *  - DATABASE_URL (and DIRECT_URL for migrations, not used here)
 *  - SEED_SUPER_ADMIN_EMAIL
 *  - SEED_SUPER_ADMIN_PASSWORD
 *
 * Optional:
 *  - SEED_SUPER_ADMIN_USERNAME (defaults to "admin") — the handle typed at
 *    /admin/login. The email above stays the account's identity and is what
 *    password recovery mails; the username is only a lookup handle.
 *
 * Identity lives in the Better Auth tables (AuthUser + a credential
 * AuthAccount) on the same database, built with the shared row builder and
 * bcrypt hasher so the shape matches the app and the ops scripts.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, UserRole } from "@prisma/client";
import { buildIdentityRows, normalizeIdentityEmail } from "../src/lib/auth/identity-rows";
import { hashPassword } from "../src/lib/auth/password-hash";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const username = (process.env.SEED_SUPER_ADMIN_USERNAME || "admin").trim().toLowerCase();

  if (!email || !password) {
    throw new Error(
      "Missing required env vars. See .env.example: SEED_SUPER_ADMIN_EMAIL, SEED_SUPER_ADMIN_PASSWORD"
    );
  }

  // Check if super admin user already exists in app DB
  const existing = await prisma.user.findFirst({
    where: { email, role: UserRole.SUPER_ADMIN },
  });
  if (existing) {
    // A deployment seeded before usernames existed has a NULL handle, which
    // leaves no way to sign in at /admin/login. Fill it in rather than bailing
    // out — that is the whole reason this branch does more than log.
    if (!existing.username) {
      await prisma.user.update({ where: { id: existing.id }, data: { username } });
      console.log(`✓ Super admin already exists: ${email}`);
      console.log(`  Username backfilled: ${username}`);
    } else {
      console.log(`✓ Super admin already exists: ${email} (username: ${existing.username})`);
    }
    return;
  }

  // Reuse an identity left by an earlier partial run, otherwise mint a new id.
  const priorIdentity = await prisma.authUser.findUnique({
    where: { email: normalizeIdentityEmail(email) },
  });
  const authId = priorIdentity?.id ?? randomUUID();

  const { user, account } = buildIdentityRows({
    authId,
    email,
    role: "SUPER_ADMIN",
    passwordHash: await hashPassword(password),
  });

  await prisma.$transaction(async (tx) => {
    await tx.authUser.upsert({
      where: { id: user.id },
      create: user,
      update: { email: user.email, role: user.role, emailVerified: true, banned: false },
    });
    await tx.authAccount.upsert({
      where: { id: account.id },
      create: account,
      update: { password: account.password },
    });
    await tx.user.create({
      data: {
        authId,
        email,
        username,
        role: UserRole.SUPER_ADMIN,
        // The bootstrap admin needs Developer Controls to set everything else up.
        adminTier: "DEVELOPER",
        firstName: "Super",
        lastName: "Admin",
        fullName: "Super Admin",
        isActive: true,
        profileCompleted: true,
      },
    });
  });

  console.log(`✓ Super admin created: ${email}`);
  console.log(`  Login at: /admin/login`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: (the one you set in SEED_SUPER_ADMIN_PASSWORD)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
