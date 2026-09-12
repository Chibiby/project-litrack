/**
 * Retire the generic seeded `admin` Super Admin login now that the three named
 * division admins (`john`, `dante`, `brandan`) are provisioned.
 *
 * Usage:
 *   npx tsx scripts/retire-super-admin.ts                    # dry run: report only
 *   npx tsx scripts/retire-super-admin.ts --commit           # retire the account
 *   npx tsx scripts/retire-super-admin.ts --username=admin2 --commit
 *
 * Requires: DIRECT_URL or DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (read from .env.local if the shell has not
 * exported them).
 *
 * Why a script rather than a migration: the username and `deletedAt` live in
 * our Postgres, but the password lives in Supabase Auth, and only a
 * service-role client can revoke that half. SQL alone cannot sign an account
 * out or stop its password from working.
 *
 * Dry run is the default. It reports exactly which account it would retire,
 * and which named admins it verified as the replacement, before anything is
 * written.
 *
 * Idempotent: if the target is already retired (`deletedAt` set), there is
 * nothing to do and the script says so rather than touching it again.
 */
import { UserRole } from "@prisma/client";
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { AUDIT_ACTIONS } from "../src/lib/audit-actions";

/** The three replacement logins this script exists to make safe to retire the fallback for. */
const REQUIRED_ADMINS = ["john", "dante", "brandan"] as const;

const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

/**
 * Frees the address for re-registration while keeping the person's name on
 * history, the same tombstoning `removeTeacherRows` in `src/lib/db/account-reset.ts`
 * performs for teachers.
 */
function tombstoneEmail(userId: string): string {
  return `retired+${userId}@${DOMAIN}`;
}

function parseArgs(argv: string[]): { username: string; commit: boolean } {
  const flag = argv.find((a) => a.startsWith("--username="));
  const username = (flag ? flag.slice("--username=".length) : "admin").trim().toLowerCase();
  return { username, commit: argv.includes("--commit") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username) throw new Error("--username cannot be empty");

  // Retiring one of the replacement logins by accident would defeat the whole
  // point of this script — never let the override target them.
  if ((REQUIRED_ADMINS as readonly string[]).includes(args.username)) {
    throw new Error(
      `--username=${args.username} is one of the required replacement admins (${REQUIRED_ADMINS.join(", ")}) and cannot be retired by this script.`
    );
  }

  const loaded = loadEnvFile();
  if (loaded.length > 0) console.log(`loaded .env.local (${loaded.length} keys)`);

  const prisma = await connectScriptPrisma();

  try {
    const target = await prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, username: args.username, deletedAt: null },
      select: { id: true, authId: true, email: true, username: true, role: true, isActive: true },
    });

    const requiredAdmins = await prisma.user.findMany({
      where: {
        role: UserRole.SUPER_ADMIN,
        username: { in: [...REQUIRED_ADMINS] },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, username: true },
    });
    const foundUsernames = new Set(requiredAdmins.map((a) => a.username));
    const missing = REQUIRED_ADMINS.filter((u) => !foundUsernames.has(u));

    console.log("");
    console.log("Replacement Super Admins");
    for (const username of REQUIRED_ADMINS) {
      console.log(
        foundUsernames.has(username)
          ? `  ${username.padEnd(8)} present and active`
          : `  ${username.padEnd(8)} MISSING or inactive`
      );
    }
    console.log("");

    if (missing.length > 0) {
      console.error(
        `Refusing to retire "${args.username}": missing replacement admin(s): ${missing.join(", ")}.`
      );
      console.error("Run scripts/seed-division-admins.ts first. No changes made.");
      process.exit(1);
    }

    if (!target) {
      console.log(`No SUPER_ADMIN with username "${args.username}" (or already retired). Nothing to do.`);
      return;
    }

    if (!target.isActive) {
      console.log(`"${args.username}" is already inactive. Nothing to do.`);
      return;
    }

    // Independently of the named-admin check above: count every live Super
    // Admin excluding the target, so an override that happens to collide with
    // one of the required three (impossible today given the guard above, but
    // this check does not rely on that guard holding forever) still can never
    // leave the app with zero working /admin logins.
    const otherLiveAdmins = await prisma.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        deletedAt: null,
        isActive: true,
        id: { not: target.id },
      },
    });
    if (otherLiveAdmins === 0) {
      console.error(`Refusing to retire "${args.username}": it is the only live Super Admin. No changes made.`);
      process.exit(1);
    }

    console.log("Account to retire");
    console.log(`  id:       ${target.id}`);
    console.log(`  username: ${target.username}`);
    console.log(`  email:    ${target.email}`);
    console.log(`  role:     ${target.role}`);
    console.log("");

    if (!args.commit) {
      console.log("Dry run. Re-run with --commit to retire 1 account.");
      return;
    }

    const supabase = createSupabaseAdminClient();

    // Supabase first, Prisma second. If the Supabase call fails, nothing here
    // has touched Postgres yet, so the account is left exactly as it was —
    // still a working login, not a half-retired one. If it succeeds but the
    // Prisma update below then fails, the account is already unable to sign
    // in (its auth user and password are gone) even though the row still
    // reads `isActive: true`; that is fail-safe rather than fail-open, and
    // re-running this script finishes the job (the "not found" from Supabase
    // on the retry is tolerated, same as the teacher bulk-removal path in
    // src/lib/db/account-reset.ts).
    const { error } = await supabase.auth.admin.deleteUser(target.authId);
    if (error && !/not.?found/i.test(error.message)) {
      throw new Error(`Supabase refused to delete the auth user: ${error.message}`);
    }

    await prisma.user.update({
      where: { id: target.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        email: tombstoneEmail(target.id),
        mustChangePassword: false,
        passwordIsSchoolId: false,
        passwordVaultCipher: null,
        passwordVaultSetAt: null,
      },
    });

    // Written directly with this script's own Prisma client rather than
    // `writeAudit` from `src/lib/audit.ts`: that helper writes through the app's
    // `@/lib/prisma` singleton, whose connection URL is resolved at module
    // evaluation time — before `loadEnvFile()` above has had a chance to
    // populate `process.env` — so on a shell that has not exported the database
    // URL itself, that singleton would have no URL and the insert would fail.
    // `writeAudit` also swallows that failure (logs only, never throws), so the
    // retirement would report success with its audit trail silently missing.
    // Retiring a Super Admin with no audit row is not an acceptable outcome, so
    // this insert uses the already-connected `prisma` client and throws (which
    // `main()`'s catch turns into a non-zero exit) if it does not land.
    await prisma.auditLog.create({
      data: {
        userId: null,
        schoolId: null,
        action: AUDIT_ACTIONS.SUPER_ADMIN_RETIRE,
        resource: "User",
        resourceId: target.id,
        metadata: {
          verifiedReplacementAdminIds: requiredAdmins.map((a) => a.id),
        },
      },
    });

    console.log(`Retired "${args.username}" (${target.id}).`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Unknown error");
  process.exit(1);
});
