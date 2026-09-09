/**
 * Provision the named division admin accounts for /admin/login.
 *
 * Usage:
 *   npx tsx scripts/seed-division-admins.ts                  # dry run: report only
 *   npx tsx scripts/seed-division-admins.ts --commit         # create the missing ones
 *
 * Requires: DIRECT_URL or DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (read from .env.local if the shell has not
 * exported them).
 *
 * Why a script rather than the seed: `npm run db:seed` bootstraps exactly one
 * Super Admin from env vars and returns early once it exists, so it can never
 * add a second. This adds named accounts alongside whatever is already there.
 *
 * Why a script rather than a migration: the username lives in our Postgres but
 * the password lives in Supabase Auth, and only a service-role client can write
 * that half. SQL alone cannot create a working account.
 *
 * Dry run is the default. It reports exactly which accounts it would create and
 * which already exist, so nobody discovers what it did by finding it done.
 *
 * Idempotent: an account whose username is already taken is skipped, never
 * overwritten. Re-running after a partial failure creates only what is missing.
 * The existing `admin` account is never touched — it stays as the way in if a
 * password here is mistyped.
 */
import { UserRole } from "@prisma/client";
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

/**
 * The accounts to provision.
 *
 * Emails are synthetic — nothing receives mail at the synthetic domain — which
 * is what `isSyntheticEmail` reports so the security page offers credential
 * regeneration rather than an email reset that would go nowhere.
 */
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

const ADMINS = [
  { username: "john", password: "john1234", firstName: "John", lastName: "Admin" },
  { username: "brandan", password: "brandan1234", firstName: "Brandan", lastName: "Admin" },
  { username: "dante", password: "dante1234", firstName: "Dante", lastName: "Admin" },
] as const;

function emailFor(username: string): string {
  return `${username}@${DOMAIN}`;
}

async function main() {
  const commit = process.argv.includes("--commit");

  const loaded = loadEnvFile();
  if (loaded.length > 0) console.log(`loaded .env.local (${loaded.length} keys)`);

  const prisma = await connectScriptPrisma();

  try {
    const usernames = ADMINS.map((a) => a.username);
    const emails = ADMINS.map((a) => emailFor(a.username));

    // One query for both collision surfaces. A username taken by a teacher, or
    // an email already in Supabase, both mean "skip" — creating the auth user
    // first and failing on the unique index afterwards would leave an orphaned
    // Supabase account nobody can sign in with.
    const existing = await prisma.user.findMany({
      where: { OR: [{ username: { in: usernames } }, { email: { in: emails } }] },
      select: { id: true, username: true, email: true, role: true },
    });

    const taken = new Set<string>();
    for (const user of existing) {
      if (user.username) taken.add(user.username);
      taken.add(user.email.toLowerCase());
    }

    const todo = ADMINS.filter(
      (a) => !taken.has(a.username) && !taken.has(emailFor(a.username).toLowerCase())
    );

    console.log("");
    console.log("Division admin accounts");
    for (const admin of ADMINS) {
      const already = existing.find(
        (u) => u.username === admin.username || u.email.toLowerCase() === emailFor(admin.username)
      );
      console.log(
        already
          ? `  ${admin.username.padEnd(8)} exists already (${already.role}) — skipping`
          : `  ${admin.username.padEnd(8)} will be created as SUPER_ADMIN (${emailFor(admin.username)})`
      );
    }
    console.log("");

    if (todo.length === 0) {
      console.log("Nothing to create — every account is already present.");
      return;
    }

    if (!commit) {
      console.log(`Dry run. Re-run with --commit to create ${todo.length} account(s).`);
      return;
    }

    const supabase = createSupabaseAdminClient();

    for (const admin of todo) {
      const email = emailFor(admin.username);

      const { data: created, error } = await supabase.auth.admin.createUser({
        email,
        password: admin.password,
        email_confirm: true,
        user_metadata: { role: "SUPER_ADMIN" },
      });

      if (error) {
        // Supabase's minimum password length (6 by default) is the usual
        // rejection, and no retry fixes it — say where to change it rather than
        // leaving the raw message to be guessed at.
        const hint = /password/i.test(error.message)
          ? "\n  Supabase enforces a minimum password length (6 by default). Change it in\n  Supabase Dashboard -> Authentication -> Policies, or choose a longer password."
          : "";
        throw new Error(`Supabase rejected ${admin.username}: ${error.message}${hint}`);
      }

      const authId = created?.user?.id;
      if (!authId) throw new Error(`Supabase created no auth user for ${admin.username}`);

      await prisma.user.create({
        data: {
          authId,
          email,
          username: admin.username,
          role: UserRole.SUPER_ADMIN,
          firstName: admin.firstName,
          lastName: admin.lastName,
          fullName: `${admin.firstName} ${admin.lastName}`,
          isActive: true,
          profileCompleted: true,
        },
      });

      console.log(`✓ created ${admin.username} (${email})`);
    }

    console.log("");
    console.log(`Done. Sign in at /admin/login with the username and password.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
