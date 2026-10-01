/**
 * Reset EVERY live district admin's password to the name-based first-login
 * password `First.Last1234` (`districtAdminPassword`, src/lib/auth/credentials.ts).
 * Owner decision, taken knowing the password is guessable from the name: it
 * must be easy for older, busy users to remember and type. Each account is
 * forced to choose a new password at next sign-in (`mustChangePassword: true`).
 *
 * Usage (no npm script, matching create-district-admins):
 *   npx tsx scripts/reset-district-admin-passwords.ts           # dry run (default)
 *   npx tsx scripts/reset-district-admin-passwords.ts --apply   # write
 *
 * Dry run writes nothing and prints no password: it names the database and
 * Supabase hosts, then lists every live (deletedAt null) DISTRICT_ADMIN and
 * whether `mustChangePassword` is currently true.
 *
 * --apply, per user, in the same order as `issueRandomPassword` in
 * src/lib/actions/accounts.ts: first the Prisma `User` columns
 * (mustChangePassword true, passwordIsSchoolId false, vault columns null;
 * `isActive` is never touched; role re-checked on the write), then Supabase
 * `auth.admin.updateUserById` (password + app_metadata.role), then one
 * DISTRICT_ADMIN_PASSWORD_RESET
 * audit row with metadata { via: "reset_script" } and no credential. Users with
 * no authId are skipped and reported. Failures are reported and counted; the
 * exit code is non-zero if any user failed or was skipped.
 *
 * The CSV (name,username,password,districts,login_url) goes to the gitignored
 * `.credentials/`; only its path is printed. Hand each person their row, then
 * delete the file.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { UserRole } from "@prisma/client";
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { districtAdminPassword } from "../src/lib/auth/credentials";
import { AUDIT_ACTIONS } from "../src/lib/audit-actions";

const CONCURRENCY = 3;

function hostOf(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

function loginOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, "");
  return "https://arallitrack.com";
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const loaded = loadEnvFile();
  if (loaded.length > 0) console.log(`loaded .env.local (${loaded.length} keys, values not printed)`);

  const prisma = await connectScriptPrisma();

  try {
    console.log("");
    console.log(`Database: ${hostOf(process.env.DIRECT_URL ?? process.env.DATABASE_URL)}`);
    console.log(`Supabase: ${hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
    console.log("");

    const users = await prisma.user.findMany({
      where: { role: UserRole.DISTRICT_ADMIN, deletedAt: null },
      orderBy: { username: "asc" },
      select: {
        id: true,
        authId: true,
        username: true,
        firstName: true,
        lastName: true,
        fullName: true,
        mustChangePassword: true,
        districtAssignments: { select: { district: true } },
      },
    });

    console.log("  username                  full name                      mustChangePassword  authId");
    for (const u of users) {
      console.log(
        `  ${(u.username ?? "(none)").padEnd(25)} ${u.fullName.padEnd(30)} ${String(u.mustChangePassword).padEnd(19)} ${u.authId ? "yes" : "MISSING"}`
      );
    }
    console.log(`\n${users.length} live district admin(s).`);

    if (!apply) {
      console.log("\nDry run, nothing written. Re-run with --apply to reset every password above.");
      return;
    }
    if (users.length === 0) return;

    // Credentials-file safety check before any write.
    const repoRoot = path.resolve(__dirname, "..");
    const csvPath = path.resolve(repoRoot, ".credentials", `district-admin-resets-${timestampSuffix()}.csv`);
    const check = spawnSync("git", ["check-ignore", "-q", csvPath], { cwd: repoRoot });
    if (check.status !== 0) {
      throw new Error(
        `Refusing to write credentials: ${csvPath} is not gitignored (git check-ignore exit ${check.status}).`
      );
    }
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });

    const supabase = createSupabaseAdminClient();
    const rows: { name: string; username: string; password: string; districts: string[] }[] = [];
    const failures: { username: string; message: string }[] = [];
    const skipped: string[] = [];

    await inParallel(users, CONCURRENCY, async (u) => {
      const label = u.username ?? u.id;
      if (!u.authId) {
        skipped.push(label);
        console.error(`  SKIPPED ${label}: no authId`);
        return;
      }
      try {
        const password = districtAdminPassword(u);

        // Force the change first (harmless alone), then swap the password, so a
        // failure can never leave a guessable password with no forced change.
        // The role is re-checked on the write, not only on the read above.
        const flagged = await prisma.user.updateMany({
          where: { id: u.id, role: UserRole.DISTRICT_ADMIN, deletedAt: null },
          data: {
            mustChangePassword: true,
            passwordIsSchoolId: false,
            passwordVaultCipher: null,
            passwordVaultSetAt: null,
          },
        });
        if (flagged.count !== 1) throw new Error("user is no longer a live district admin");

        const { error } = await supabase.auth.admin.updateUserById(u.authId, {
          password,
          app_metadata: { role: "DISTRICT_ADMIN", schoolId: null },
        });
        if (error) throw new Error(`auth password update failed: ${error.message}`);

        await prisma.auditLog.create({
          data: {
            action: AUDIT_ACTIONS.DISTRICT_ADMIN_PASSWORD_RESET,
            resource: "User",
            resourceId: u.id,
            metadata: { via: "reset_script" },
          },
        });

        rows.push({
          name: u.fullName,
          username: u.username ?? "",
          password,
          districts: u.districtAssignments.map((a) => a.district),
        });
        console.log(`  reset ${label}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ username: label, message });
        console.error(`  FAILED ${label}: ${message}`);
      }
    });

    if (rows.length > 0) {
      const loginUrl = `${loginOrigin()}/admin/login`;
      const lines = rows.map((r) =>
        [csvField(r.name), r.username, csvField(r.password), csvField(r.districts.join("; ")), loginUrl].join(",")
      );
      fs.writeFileSync(csvPath, `${["name,username,password,districts,login_url", ...lines].join("\n")}\n`, {
        flag: "wx",
      });
      console.log(`\nCredentials written to ${csvPath}`);
    }

    console.log(`\nReset ${rows.length}, failed ${failures.length}, skipped ${skipped.length}.`);
    if (failures.length > 0 || skipped.length > 0) {
      console.error("Some accounts were not reset. Fix the cause and re-run; the reset is idempotent.");
      process.exitCode = 1;
      return;
    }
    console.log("Hand each person their row, then delete the file.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
