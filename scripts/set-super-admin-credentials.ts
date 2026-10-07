/**
 * Set the Super Admin's sign-in credentials for /admin/login.
 *
 * Usage:
 *   npx tsx scripts/set-super-admin-credentials.ts                              # dry run: report only
 *   npx tsx scripts/set-super-admin-credentials.ts --username admin --commit
 *   npx tsx scripts/set-super-admin-credentials.ts --username admin --password admin --commit
 *   npx tsx scripts/set-super-admin-credentials.ts --email you@example.com --commit
 *
 * Requires: DIRECT_URL or DATABASE_URL (read from .env.local if the shell has
 * not exported it).
 *
 * Why a script and not a migration: the username lives in `User`, but the
 * password hash and the sign-in email live in the Better Auth tables
 * (`AuthUser`/`AuthAccount`), and a hash cannot be produced by SQL alone. This
 * puts both behind one command.
 *
 * Dry run is the default, and it prints what it *would* change, so you can
 * confirm which account it picked before anything is written.
 */
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { updateIdentity } from "./lib/script-identity";
import { BCRYPT_MAX_PASSWORD_BYTES } from "../src/lib/auth/password-hash";

type Args = {
  username: string;
  password: string | null;
  email: string | null;
  commit: boolean;
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  };

  return {
    username: (read("--username") ?? "admin").trim().toLowerCase(),
    password: read("--password"),
    email: read("--email")?.trim().toLowerCase() ?? null,
    commit: argv.includes("--commit"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username) throw new Error("--username cannot be empty");

  const loaded = loadEnvFile();
  if (loaded.length > 0) console.log(`loaded .env.local (${loaded.length} keys)`);

  const prisma = await connectScriptPrisma();

  try {
    // Oldest active Super Admin — the same row the backfill migration targets,
    // so the script and the migration can never disagree about which account
    // "the" Super Admin is.
    const admins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
      select: { id: true, authId: true, email: true, username: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    if (admins.length === 0) {
      throw new Error("No active Super Admin found. Run `npm run db:seed` first.");
    }
    if (admins.length > 1) {
      console.log(`note: ${admins.length} active Super Admins; targeting the oldest.`);
    }

    const target = admins[0];
    console.log("");
    console.log("Target Super Admin");
    console.log(`  id:       ${target.id}`);
    console.log(`  email:    ${target.email}`);
    console.log(`  username: ${target.username ?? "(none)"}`);
    console.log("");

    const changes: string[] = [];
    if (target.username !== args.username) {
      changes.push(`username: ${target.username ?? "(none)"} -> ${args.username}`);
    }
    if (args.email && args.email !== target.email) {
      changes.push(`email: ${target.email} -> ${args.email}`);
    }
    if (args.password) changes.push("password: (set to the value passed on the command line)");

    if (changes.length === 0) {
      console.log("Nothing to change — credentials already match.");
      return;
    }

    console.log("Planned changes");
    for (const change of changes) console.log(`  - ${change}`);
    console.log("");

    if (!args.commit) {
      console.log("Dry run. Re-run with --commit to apply.");
      return;
    }

    // A handle already taken by another account would fail the unique index
    // mid-way, after the auth side had already been written. Check first so
    // the two stores cannot drift apart.
    const clash = await prisma.user.findFirst({
      where: { username: args.username, id: { not: target.id } },
      select: { id: true },
    });
    if (clash) {
      throw new Error(`username "${args.username}" is already taken by user ${clash.id}`);
    }

    if (args.password || args.email) {
      // bcrypt reads only the first 72 bytes; refuse rather than silently truncate.
      if (args.password && Buffer.byteLength(args.password) > BCRYPT_MAX_PASSWORD_BYTES) {
        throw new Error(`password is longer than ${BCRYPT_MAX_PASSWORD_BYTES} bytes`);
      }
      await updateIdentity(prisma, target.authId, {
        ...(args.password ? { password: args.password } : {}),
        ...(args.email ? { email: args.email } : {}),
        role: "SUPER_ADMIN",
      });
    }

    await prisma.user.update({
      where: { id: target.id },
      data: {
        username: args.username,
        ...(args.email ? { email: args.email } : {}),
      },
    });

    console.log("Done. Sign in at /admin/login with:");
    console.log(`  Username: ${args.username}`);
    console.log(`  Password: ${args.password ? "(the one you just set)" : "(unchanged)"}`);
    console.log(`  Password recovery mails: ${args.email ?? target.email}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
