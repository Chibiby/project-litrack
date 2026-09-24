/**
 * Provision the 14 named district admin accounts and their district
 * assignments (docs/specs/district-admin.md section 7).
 *
 * Usage:
 *   npx tsx scripts/create-district-admins.ts            # dry run (default)
 *   npx tsx scripts/create-district-admins.ts --commit   # write
 *
 * Follows `scripts/seed-division-admins.ts` and `scripts/create-e2e-admin.ts`:
 * env through `scripts/lib/script-db.ts`, auth users through
 * `createSupabaseAdminClient`. Reusing a half-created auth user (a previous
 * run that died between the Supabase write and the database write) copies
 * `scripts/import-schools.ts`'s `listUsers` scan + `updateUserById`.
 *
 * Dry run is the default and writes nothing — not a User row, not a
 * DistrictAdminAssignment row, not an AuditLog row, not the credentials CSV.
 * It prints the database host and the Supabase host (production's database is
 * the Hyperdrive origin, not the one in `.env.local`), then the full plan.
 *
 * Idempotent: after a full success, a re-run prints "exists" for all 14 and
 * writes nothing. After a partial failure, a re-run creates only what is
 * missing (I4/I5, docs/specs/district-admin.md section 6).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { UserRole } from "@prisma/client";
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { generateReadableCredential } from "../src/lib/auth/credentials";
import { AUDIT_ACTIONS } from "../src/lib/audit-actions";
import {
  planDistrictAdmins,
  type DistrictAdminRosterEntry,
  type ExistingDistrictAdminUser,
} from "./lib/district-admin-plan";

const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";
/** Supabase's admin API is rate-sensitive; the roster is small (14), so this stays low. */
const CONCURRENCY = 3;

/**
 * The roster, copied exactly from the operator brief. Usernames are
 * lower-case `first.last`, spelled per spec section 7 (note "Glenda Elem" and
 * "Pacita Ramos", flagged there as open questions, Q11).
 */
const ROSTER: Omit<DistrictAdminRosterEntry, "email">[] = [
  { username: "ferdinand.simon", firstName: "Ferdinand", lastName: "Simon", districts: ["Alabel 1", "Alabel 2"] },
  { username: "glenda.elem", firstName: "Glenda", lastName: "Elem", districts: ["Alabel 3", "Alabel 4"] },
  { username: "noli.cabaylo", firstName: "Noli", lastName: "Cabaylo", districts: ["Malungon 1", "Malungon 3"] },
  { username: "fernie.cabanalan", firstName: "Fernie", lastName: "Cabanalan", districts: ["Malungon 2", "Malungon 4"] },
  { username: "pacita.ramos", firstName: "Pacita", lastName: "Ramos", districts: ["Kiamba 1", "Kiamba 3"] },
  { username: "teresita.macabacyao", firstName: "Teresita", lastName: "Macabacyao", districts: ["Kiamba 2"] },
  { username: "glenn.castillas", firstName: "Glenn", lastName: "Castillas", districts: ["Malapatan 1", "Malapatan 2"] },
  { username: "susana.sumagka", firstName: "Susana", lastName: "Sumagka", districts: ["Malapatan 3"] },
  { username: "felix.barrenan", firstName: "Felix", lastName: "Barrenan", districts: ["Glan 1", "Glan 4"] },
  { username: "pinky.tanap", firstName: "Pinky", lastName: "Tanap", districts: ["Glan 3"] },
  { username: "roy.tribunalo", firstName: "Roy", lastName: "Tribunalo", districts: ["Glan 2"] },
  { username: "taya.saling", firstName: "Taya", lastName: "Saling", districts: ["Maasim 1", "Maasim 2", "Maasim 3"] },
  { username: "argelio.arago", firstName: "Argelio", lastName: "Arago", districts: ["Maitum 2"] },
  { username: "eriel.napila", firstName: "Eriel", lastName: "Napila", districts: ["Maitum 1"] },
];

function emailFor(username: string): string {
  return `${username}@${DOMAIN}`;
}

/** The roster with each entry's synthetic email attached, for the planner (MEDIUM-1). */
const ROSTER_WITH_EMAIL: DistrictAdminRosterEntry[] = ROSTER.map((r) => ({
  ...r,
  email: emailFor(r.username),
}));

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

function heading(text: string): void {
  console.log(`\n${"=".repeat(70)}\n${text}\n${"=".repeat(70)}`);
}

async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");

  const loaded = loadEnvFile();
  if (loaded.length > 0) console.log(`loaded .env.local (${loaded.length} keys, values not printed)`);

  const prisma = await connectScriptPrisma();

  try {
    console.log("");
    console.log(`Database: ${hostOf(process.env.DIRECT_URL ?? process.env.DATABASE_URL)}`);
    console.log(`Supabase: ${hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
    console.log("");

    // ---- Step 2: the migration that adds the enum value must already be applied.
    const enumCheck = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'UserRole' AND e.enumlabel = 'DISTRICT_ADMIN'
      ) AS exists
    `;
    if (!enumCheck[0]?.exists) {
      console.error("apply migrations first");
      process.exitCode = 1;
      return;
    }

    // ---- Step 3: knownDistricts.
    const districtRows = await prisma.school.findMany({
      where: { deletedAt: null, isDemo: false, district: { not: null } },
      select: { district: true },
      distinct: ["district"],
    });
    const knownDistricts = districtRows
      .map((r) => r.district)
      .filter((d): d is string => typeof d === "string" && d.length > 0);

    // ---- Step 4: existing users by username or email.
    const rosterUsernames = ROSTER.map((r) => r.username);
    const rosterEmails = ROSTER.map((r) => emailFor(r.username));
    const existingRows = await prisma.user.findMany({
      where: { OR: [{ username: { in: rosterUsernames } }, { email: { in: rosterEmails } }] },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        districtAssignments: { select: { district: true } },
      },
    });
    const existingUsers: ExistingDistrictAdminUser[] = existingRows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      districts: u.districtAssignments.map((a) => a.district),
    }));

    const plan = planDistrictAdmins(ROSTER_WITH_EMAIL, existingUsers, knownDistricts);

    // ---- Step 5: report.
    heading("PLAN");
    console.log("  username              action     districts                          add");
    for (const entry of ROSTER) {
      const isBadCount = plan.badCounts.some((b) => b.username === entry.username);
      const isUnknown = plan.unknownDistricts.some((u) => u.username === entry.username);
      const conflict = plan.conflicts.find((c) => c.username === entry.username);
      const skipped = plan.skip.find((s) => s.username === entry.username);
      const toCreate = plan.create.find((c) => c.username === entry.username);

      const action = isBadCount
        ? "bad-count"
        : isUnknown
          ? "unknown"
          : conflict
            ? "conflict"
            : skipped
              ? "exists"
              : toCreate
                ? "create"
                : "?";

      const toAdd = plan.addAssignments.filter((a) => a.username === entry.username).map((a) => a.district);
      const addLabel = toCreate ? "(all, at creation)" : toAdd.length > 0 ? toAdd.join(", ") : "-";

      console.log(
        `  ${entry.username.padEnd(21)} ${action.padEnd(10)} ${entry.districts.join(", ").padEnd(34)} ${addLabel}`
      );
    }

    if (plan.extraAssignments.length > 0) {
      console.log("\nExtra assignments already on an existing admin (reported only, never removed — spec Q14):");
      for (const e of plan.extraAssignments) console.log(`  ${e.username}: ${e.district}`);
    }

    if (plan.badCounts.length > 0) {
      console.log("\nBad district counts (need 1-3):");
      for (const b of plan.badCounts) console.log(`  ${b.username}: ${b.count}`);
    }

    if (plan.unknownDistricts.length > 0) {
      console.log("\nUnknown districts (not a live, non-demo School.district value):");
      for (const u of plan.unknownDistricts) console.log(`  ${u.username}: "${u.district}"`);
      console.log("\nKnown districts:");
      for (const d of knownDistricts) console.log(`  ${d}`);
    }

    if (plan.conflicts.length > 0) {
      console.log("\nConflicts (username already held by another role — never repurposed):");
      for (const c of plan.conflicts) console.log(`  ${c.username}: existing role ${c.existingRole}`);
    }

    if (plan.badCounts.length > 0 || plan.unknownDistricts.length > 0) {
      console.error("\nRefusing to continue. Fix the roster or the district data above before running again.");
      process.exitCode = 1;
      return;
    }

    if (plan.conflicts.length > 0) {
      console.error("\nRefusing to continue. An existing account is never repurposed.");
      process.exitCode = 1;
      return;
    }

    if (plan.create.length === 0 && plan.addAssignments.length === 0) {
      console.log("\nNothing to create — every account and assignment is already present.");
      return;
    }

    if (!commit) {
      console.log(
        `\nDry run. Re-run with --commit to create ${plan.create.length} account(s) and add ${plan.addAssignments.length} assignment(s).`
      );
      return;
    }

    // ---- Step 6: commit.
    const supabase = createSupabaseAdminClient();
    const loginUrl = `${loginOrigin()}/admin/login`;

    // Credentials-file safety check, run before any write (Supabase auth user,
    // Postgres row, or audit log) rather than after accounts already exist
    // (LOW-3): if the CSV cannot be written safely, abort here so a re-run
    // finds nothing half-created.
    const repoRoot = path.resolve(__dirname, "..");
    const csvPath = path.resolve(repoRoot, ".credentials", `district-admins-${timestampSuffix()}.csv`);
    if (plan.create.length > 0) {
      const check = spawnSync("git", ["check-ignore", "-q", csvPath], { cwd: repoRoot });
      if (check.status !== 0) {
        throw new Error(
          `Refusing to write credentials: ${csvPath} is not gitignored (git check-ignore exit ${check.status}). ` +
            "Add .credentials/ to .gitignore before running --commit again."
        );
      }
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    }

    const knownAuth = new Map<string, string>();
    if (plan.create.length > 0) {
      for (let page = 1; ; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`listUsers failed: ${error.message}`);
        for (const u of data.users) {
          if (u.email) knownAuth.set(u.email.toLowerCase(), u.id);
        }
        if (data.users.length < 1000) break;
      }
    }

    heading("CREATE");
    const createdRows: { name: string; username: string; password: string; districts: readonly string[] }[] = [];
    const createFailures: { username: string; message: string }[] = [];

    await inParallel(plan.create, CONCURRENCY, async (item) => {
      const email = emailFor(item.username);
      const password = generateReadableCredential();
      try {
        // Resumable: reuse an auth identity left behind by a half-finished run.
        // Only when it is actually half-created — no Prisma `User` row points
        // at it yet (MEDIUM-1). An auth id already claimed by a real user
        // (another person who happens to hold this email under a different
        // or null username) must never have its password or role rewritten.
        let authId = knownAuth.get(email.toLowerCase());
        if (authId) {
          const owner = await prisma.user.findUnique({ where: { authId }, select: { id: true } });
          if (owner) {
            throw new Error(
              `email ${email} is registered in Supabase Auth but the matching auth id already belongs to an existing user (id ${owner.id}) — refusing to overwrite their password/role`
            );
          }
          const { error } = await supabase.auth.admin.updateUserById(authId, {
            password,
            app_metadata: { role: "DISTRICT_ADMIN" },
          });
          if (error) throw new Error(`password reset failed: ${error.message}`);
        } else {
          const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: { role: "DISTRICT_ADMIN" },
            user_metadata: { role: "DISTRICT_ADMIN" },
          });
          if (error || !data.user) throw new Error(error?.message ?? "auth user creation returned no user");
          authId = data.user.id;
        }

        const fullName = `${item.firstName} ${item.lastName}`;
        const user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              authId: authId!,
              email,
              username: item.username,
              role: UserRole.DISTRICT_ADMIN,
              schoolId: null,
              firstName: item.firstName,
              lastName: item.lastName,
              fullName,
              isActive: true,
              mustChangePassword: true,
              profileCompleted: true,
            },
          });
          await tx.districtAdminAssignment.createMany({
            data: item.districts.map((district) => ({ userId: created.id, district })),
            skipDuplicates: true,
          });
          return created;
        });

        await prisma.auditLog.create({
          data: {
            action: AUDIT_ACTIONS.DISTRICT_ADMIN_CREATE,
            resource: "User",
            resourceId: user.id,
            metadata: { username: item.username, districts: item.districts },
          },
        });

        createdRows.push({ name: fullName, username: item.username, password, districts: item.districts });
        console.log(`  created ${item.username}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        createFailures.push({ username: item.username, message });
        console.error(`  FAILED ${item.username}: ${message}`);
      }
    });

    if (plan.addAssignments.length > 0) {
      heading("ADD ASSIGNMENTS");
      const byUser = new Map<string, { username: string; districts: string[] }>();
      for (const a of plan.addAssignments) {
        if (!a.userId) continue;
        const bucket = byUser.get(a.userId) ?? { username: a.username, districts: [] };
        bucket.districts.push(a.district);
        byUser.set(a.userId, bucket);
      }
      for (const [userId, bucket] of byUser) {
        await prisma.districtAdminAssignment.createMany({
          data: bucket.districts.map((district) => ({ userId, district })),
          skipDuplicates: true,
        });
        for (const district of bucket.districts) {
          await prisma.auditLog.create({
            data: {
              action: AUDIT_ACTIONS.DISTRICT_ASSIGNMENT_ADD,
              resource: "DistrictAdminAssignment",
              resourceId: userId,
              metadata: { username: bucket.username, district },
            },
          });
        }
        console.log(`  ${bucket.username}: added ${bucket.districts.length} assignment(s)`);
      }
    }

    // ---- Step 7: credentials CSV.
    if (createdRows.length > 0) {
      heading("CREDENTIALS");
      const header = "name,username,password,districts,login_url";
      const lines = createdRows.map((r) =>
        [
          csvField(r.name),
          r.username,
          r.password,
          csvField(r.districts.join("; ")),
          loginUrl,
        ].join(",")
      );
      fs.writeFileSync(csvPath, `${[header, ...lines].join("\n")}\n`, { flag: "wx" });

      console.log(`Credentials written to ${csvPath}`);
      console.log(`Accounts listed: ${createdRows.map((r) => r.username).join(", ")}`);
    }

    if (createFailures.length > 0) {
      console.error(`\n${createFailures.length} account(s) failed. Re-run to retry only what is missing.`);
      process.exitCode = 1;
      return;
    }

    console.log("\nHand each person their row, then delete the file.");
    console.log("Lost passwords: Super Admin → User Accounts → Issue password.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
