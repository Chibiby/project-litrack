/**
 * Remove teacher accounts that have no usable password in Supabase Auth
 * (OTP / Google-era accounts). Does NOT migrate them.
 *
 * Usage:
 *   npx tsx scripts/cleanup-passwordless-teachers.ts           # dry-run (default)
 *   npx tsx scripts/cleanup-passwordless-teachers.ts --dry-run
 *   npx tsx scripts/cleanup-passwordless-teachers.ts --execute
 *
 * Requires: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Detection:
 *   1) Prefer SQL join to auth.users where encrypted_password IS NULL/empty
 *   2) Fallback: Admin getUserById + identities (all non-email / google-only)
 *
 * Companion SQL (Supabase SQL editor):
 *   scripts/sql/list-passwordless-teachers.sql
 */
import { PrismaClient, UserRole } from "@prisma/client";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const prisma = new PrismaClient();

type CliMode = "dry-run" | "execute";

type TeacherRow = {
  id: string;
  authId: string;
  email: string;
  role: UserRole;
  schoolId: string | null;
  deletedAt: Date | null;
  approvalStatus: string | null;
  isActive: boolean;
};

type PasswordlessRow = TeacherRow & {
  detection: "auth.users.encrypted_password" | "admin.identities";
};

function parseArgs(argv: string[]): CliMode {
  const hasExecute = argv.includes("--execute");
  const hasDryRun = argv.includes("--dry-run");
  if (hasExecute && hasDryRun) {
    throw new Error("Pass either --dry-run or --execute, not both");
  }
  return hasExecute ? "execute" : "dry-run";
}

function requireEnv() {
  const missing = [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

/** Never delete these roles — even if somehow present in a query result. */
function assertSafeTeacher(user: { role: UserRole; email: string }) {
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.SCHOOL_HEAD) {
    throw new Error(`Refusing to delete protected role ${user.role}: ${user.email}`);
  }
  if (user.role !== UserRole.TEACHER) {
    throw new Error(`Refusing to delete non-teacher role ${user.role}: ${user.email}`);
  }
}

/**
 * Most reliable: encrypted_password on auth.users (same Postgres as Prisma).
 * Falls back if auth schema is not reachable from DATABASE_URL.
 */
async function listPasswordlessViaSql(): Promise<PasswordlessRow[] | null> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        authId: string;
        email: string;
        role: UserRole;
        schoolId: string | null;
        deletedAt: Date | null;
        approvalStatus: string | null;
        isActive: boolean;
      }>
    >`
      SELECT
        u.id,
        u."authId",
        u.email,
        u.role,
        u."schoolId",
        u."deletedAt",
        u."approvalStatus",
        u."isActive"
      FROM "User" u
      INNER JOIN auth.users au ON au.id = u."authId"::uuid
      WHERE u.role = 'TEACHER'::"UserRole"
        AND (au.encrypted_password IS NULL OR au.encrypted_password = '')
      ORDER BY u."deletedAt" NULLS FIRST, u.email ASC
    `;

    return rows.map((r) => ({
      ...r,
      detection: "auth.users.encrypted_password" as const,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[cleanup] SQL auth.users join failed; falling back to Admin API identities.\n",
      `  ${msg}\n`,
      "  Tip: run scripts/sql/list-passwordless-teachers.sql in the Supabase SQL editor for ground truth."
    );
    return null;
  }
}

type IdentityLike = { provider?: string | null };

function isPasswordlessFromIdentities(identities: IdentityLike[] | null | undefined): boolean {
  const list = identities ?? [];
  if (list.length === 0) {
    // No linked identity — treat as unusable/passwordless for cleanup.
    return true;
  }
  // Google-only / OAuth-only (no email/password provider).
  return list.every((i) => (i.provider ?? "").toLowerCase() !== "email");
}

async function listPasswordlessViaAdminApi(): Promise<PasswordlessRow[]> {
  const admin = createSupabaseAdminClient();
  const teachers = await prisma.user.findMany({
    where: { role: UserRole.TEACHER },
    select: {
      id: true,
      authId: true,
      email: true,
      role: true,
      schoolId: true,
      deletedAt: true,
      approvalStatus: true,
      isActive: true,
    },
    orderBy: [{ deletedAt: "asc" }, { email: "asc" }],
  });

  // Prefer non-deleted first (null sorts before dates in Prisma asc for nullable? — re-sort)
  teachers.sort((a, b) => {
    if (a.deletedAt === null && b.deletedAt !== null) return -1;
    if (a.deletedAt !== null && b.deletedAt === null) return 1;
    return a.email.localeCompare(b.email);
  });

  const out: PasswordlessRow[] = [];
  let unknownEmailIdentity = 0;

  for (const t of teachers) {
    assertSafeTeacher(t);
    const { data, error } = await admin.auth.admin.getUserById(t.authId);
    if (error || !data.user) {
      console.warn(`[cleanup] skip ${t.email}: auth user lookup failed (${error?.message ?? "not found"})`);
      continue;
    }

    const identities = data.user.identities ?? [];
    if (isPasswordlessFromIdentities(identities)) {
      out.push({ ...t, detection: "admin.identities" });
      continue;
    }

    // Email identity present but Admin API does not expose encrypted_password.
    // Without SQL we cannot tell OTP-only from password accounts — skip (safe).
    unknownEmailIdentity += 1;
  }

  if (unknownEmailIdentity > 0) {
    console.warn(
      `[cleanup] ${unknownEmailIdentity} teacher(s) have an email identity; ` +
        "password presence could not be verified via Admin API and were left alone. " +
        "Use scripts/sql/list-passwordless-teachers.sql or fix DATABASE_URL access to auth.users."
    );
  }

  return out;
}

async function blockingRelationSummary(userId: string): Promise<string | null> {
  const [learners, announcements, attendance, readingLevels] = await Promise.all([
    prisma.learner.count({ where: { teacherId: userId } }),
    prisma.announcement.count({ where: { authorId: userId } }),
    prisma.attendance.count({ where: { recordedById: userId } }),
    prisma.readingLevelRecord.count({ where: { recordedById: userId } }),
  ]);

  const parts: string[] = [];
  if (learners) parts.push(`${learners} learner(s)`);
  if (announcements) parts.push(`${announcements} announcement(s)`);
  if (attendance) parts.push(`${attendance} attendance row(s)`);
  if (readingLevels) parts.push(`${readingLevels} reading-level row(s)`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Hard-delete matching clearRejectedTeacher: auth.deleteUser then prisma.user.delete.
 * Clears safe optional FKs / M2M first; skips if required FKs would block.
 */
async function deleteTeacher(teacher: PasswordlessRow): Promise<"deleted" | "skipped"> {
  assertSafeTeacher(teacher);

  const blocking = await blockingRelationSummary(teacher.id);
  if (blocking) {
    console.warn(`[cleanup] SKIP ${teacher.email} — has related data: ${blocking}`);
    return "skipped";
  }

  // Optional FK — safe to null (Enrollment.teacherId).
  await prisma.enrollment.updateMany({
    where: { teacherId: teacher.id },
    data: { teacherId: null },
  });

  // M2M TeacherGrades
  await prisma.user.update({
    where: { id: teacher.id },
    data: { taughtGrades: { set: [] } },
  });

  const admin = createSupabaseAdminClient();
  const { error: authErr } = await admin.auth.admin.deleteUser(teacher.authId);
  if (authErr) {
    // Already removed in Auth is OK — still try Prisma cleanup.
    const msg = authErr.message?.toLowerCase() ?? "";
    if (!msg.includes("not found") && !msg.includes("user not found")) {
      throw new Error(`Auth delete failed for ${teacher.email}: ${authErr.message}`);
    }
    console.warn(`[cleanup] auth user already gone for ${teacher.email}; continuing Prisma delete`);
  }

  await prisma.user.delete({ where: { id: teacher.id } });
  return "deleted";
}

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  requireEnv();

  console.log(`\n=== cleanup-passwordless-teachers (${mode}) ===\n`);

  let targets = await listPasswordlessViaSql();
  if (targets === null) {
    targets = await listPasswordlessViaAdminApi();
  }

  // Final safety filter
  targets = targets.filter((t) => {
    if (t.role !== UserRole.TEACHER) {
      console.warn(`[cleanup] filtered non-teacher ${t.email} (${t.role})`);
      return false;
    }
    return true;
  });

  const active = targets.filter((t) => t.deletedAt === null);
  const softDeleted = targets.filter((t) => t.deletedAt !== null);

  console.log(`Teachers scanned as passwordless: ${targets.length}`);
  console.log(`  non-deleted: ${active.length}`);
  console.log(`  soft-deleted: ${softDeleted.length}`);
  if (targets[0]) {
    console.log(`  detection method: ${targets[0].detection}`);
  }
  console.log("");

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const t of targets) {
    const soft = t.deletedAt ? " [soft-deleted]" : "";
    console.log(
      `  - ${t.email}  id=${t.id}  authId=${t.authId}  schoolId=${t.schoolId ?? "null"}` +
        `  active=${t.isActive}  approval=${t.approvalStatus ?? "null"}${soft}`
    );
  }
  console.log("");

  if (mode === "dry-run") {
    console.log("Dry-run only. Re-run with --execute to delete Auth + Prisma User rows.");
    console.log("Protected roles SUPER_ADMIN / SCHOOL_HEAD are never deleted.\n");
    return;
  }

  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    try {
      const result = await deleteTeacher(t);
      if (result === "deleted") {
        deleted += 1;
        console.log(`[cleanup] DELETED ${t.email}`);
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cleanup] FAILED ${t.email}: ${msg}`);
    }
  }

  console.log("\n=== summary ===");
  console.log(`  deleted: ${deleted}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  failed:  ${failed}`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
