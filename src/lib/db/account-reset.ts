import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEACHER_EMAIL_DOMAIN } from "@/lib/auth/synthetic-email";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { releaseTeacherAdvisory } from "@/lib/teachers/release-advisory";

/**
 * Bulk account operations for the database console.
 *
 * Both run against Supabase Auth as well as Postgres, and Supabase has no
 * transaction to join. So both are written to be *resumable* rather than
 * atomic: each account is independent, a failure on one is recorded and the
 * rest continue, and re-running finishes the job. The alternative — abort the
 * whole batch on the first failure — leaves the two systems disagreeing with no
 * way to tell how far it got.
 */

/** Supabase admin calls are network-bound; a few at a time beats one at a time. */
const CONCURRENCY = 5;

export type BulkResult = {
  processed: number;
  failed: { id: string; label: string; reason: string }[];
};

async function inBatches<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(worker));
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/**
 * Put every school's School Head password back to that school's School ID.
 *
 * Same operation the per-row Reset performs in the school-accounts console,
 * applied to every school at once, and it sets `passwordIsSchoolId` for the
 * same reason: it is the only way the console can show a working credential
 * without anyone storing a plaintext password.
 *
 * `mustChangePassword` is cleared, not set — after a bulk reset every head
 * should be able to sign straight in, and the first-login prompt is optional.
 *
 * With `schoolId` given, only that school's head is reset.
 */
export async function resetAllSchoolHeadPasswords(schoolId?: string | null): Promise<BulkResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const heads = await prisma.user.findMany({
    where: {
      role: "SCHOOL_HEAD",
      deletedAt: null,
      school: { deletedAt: null },
      ...(schoolId ? { schoolId } : {}),
    },
    select: {
      id: true,
      authId: true,
      fullName: true,
      school: { select: { id: true, name: true, schoolIdCode: true } },
    },
  });

  const failed: BulkResult["failed"] = [];
  let processed = 0;

  await inBatches(heads, async (head) => {
    const label = head.school?.name ?? head.fullName ?? head.id;
    if (!head.school) {
      failed.push({ id: head.id, label, reason: "No school attached" });
      return;
    }
    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(head.authId, {
        password: defaultSchoolHeadPassword(head.school.schoolIdCode),
        app_metadata: { role: "SCHOOL_HEAD", schoolId: head.school.id },
      });
      if (error) throw new Error(error.message);

      await prisma.user.update({
        where: { id: head.id },
        data: {
          passwordIsSchoolId: true,
          mustChangePassword: false,
          isActive: true,
          // The sealed copy described a password that no longer signs anyone
          // in. `passwordIsSchoolId` is what the console reads now.
          passwordVaultCipher: null,
          passwordVaultSetAt: null,
        },
      });
      processed += 1;
    } catch (err) {
      failed.push({ id: head.id, label, reason: reasonOf(err) });
    }
  });

  return { processed, failed };
}

/**
 * Frees the address for re-registration while keeping the person's name on history.
 * `originalTeacherEmail` recognises this shape and shows no address for it.
 */
function tombstoneEmail(userId: string): string {
  return `removed+${userId}@${TEACHER_EMAIL_DOMAIN}`;
}

/**
 * Remove every teacher account.
 *
 * Soft delete, not `DELETE`. Six tables point at `User` with a *required*
 * foreign key — `Attendance.recordedById`, `AttendanceDayMeta`,
 * `ReadingLevelRecord`, `TermGrade`, `Announcement.authorId`,
 * `Report.createdById` — all of which restrict on delete. A hard delete would
 * therefore either fail outright or, if the records were cleared first, destroy
 * the learner history those teachers recorded. Removing accounts must not be a
 * back door into deleting learner data.
 *
 * What removal actually means here, and it is complete from every angle a user
 * can see: the Supabase auth user is deleted so the password stops working,
 * `deletedAt` is set so `getCurrentUser` signs out anyone still holding a
 * session and every list filters the row out, and the login email is
 * tombstoned so the same teacher can register again from scratch. The Prisma
 * row survives only to keep "who recorded this" answerable.
 *
 * With `schoolId` given, only that school's teachers are removed.
 */
export async function removeAllTeacherAccounts(schoolId?: string | null): Promise<BulkResult> {
  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER", deletedAt: null, ...(schoolId ? { schoolId } : {}) },
    select: TEACHER_REMOVAL_FIELDS,
  });
  return removeTeacherRows(teachers);
}

/**
 * Remove a named set of teachers from one school.
 *
 * `schoolId` is part of the query rather than something the caller is trusted
 * to have checked. The admin school page does check it, and returns a generic
 * "Not found" when an id belongs elsewhere; this is the second lock, so a bug
 * up there cannot turn into a cross-tenant deletion down here.
 */
export async function removeTeacherAccountsByIds(
  schoolId: string,
  ids: string[]
): Promise<BulkResult> {
  if (ids.length === 0) return { processed: 0, failed: [] };

  const teachers = await prisma.user.findMany({
    where: { id: { in: ids }, schoolId, role: "TEACHER", deletedAt: null },
    select: TEACHER_REMOVAL_FIELDS,
  });
  return removeTeacherRows(teachers);
}

/** Everything `removeTeacherRows` needs, and nothing else. */
const TEACHER_REMOVAL_FIELDS = {
  id: true,
  authId: true,
  fullName: true,
  email: true,
  schoolId: true,
} as const;

type TeacherRow = {
  id: string;
  authId: string;
  fullName: string;
  email: string;
  schoolId: string | null;
};

/**
 * The removal itself, over whichever teachers the caller selected.
 *
 * Split out so "every teacher" and "these four teachers" cannot drift apart:
 * the tombstoning, the Supabase deletion and the advisory release all have to
 * happen together, and a second copy of this loop would eventually forget one
 * of them.
 */
async function removeTeacherRows(teachers: TeacherRow[]): Promise<BulkResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const failed: BulkResult["failed"] = [];
  let processed = 0;

  await inBatches(teachers, async (teacher) => {
    const label = teacher.fullName || teacher.email;
    try {
      // Best effort: an auth user already gone (manually deleted, or a previous
      // run that failed after this step) must not block the Prisma side, or the
      // account stays visible in the app forever.
      const { error } = await supabaseAdmin.auth.admin.deleteUser(teacher.authId);
      if (error && !/not.?found/i.test(error.message)) throw new Error(error.message);

      await prisma.$transaction(async (tx) => {
        // Same release the School Head's Remove performs: sections back to
        // Unassigned, learners adviser-less. Scoped to the teacher's own school —
        // the bulk path can span every school, so there is no single caller
        // school to use. A teacher attached to none advises nothing to release.
        if (teacher.schoolId) {
          await releaseTeacherAdvisory(tx, {
            teacherId: teacher.id,
            schoolId: teacher.schoolId,
          });
        }
        await tx.user.update({
          where: { id: teacher.id },
          data: {
            deletedAt: new Date(),
            isActive: false,
            email: tombstoneEmail(teacher.id),
            // `@unique` on User — a stale pointer would keep the section
            // adviser-less *and* unassignable to anyone new.
            advisorySectionId: null,
            mustChangePassword: false,
            passwordIsSchoolId: false,
            passwordVaultCipher: null,
            passwordVaultSetAt: null,
          },
        });
      });
      processed += 1;
    } catch (err) {
      failed.push({ id: teacher.id, label, reason: reasonOf(err) });
    }
  });

  return { processed, failed };
}

/** Headline numbers for the console, before anything is clicked. */
export async function accountCounts(): Promise<{ schoolHeads: number; teachers: number }> {
  const [schoolHeads, teachers] = await Promise.all([
    prisma.user.count({ where: { role: "SCHOOL_HEAD", deletedAt: null } }),
    prisma.user.count({ where: { role: "TEACHER", deletedAt: null } }),
  ]);
  return { schoolHeads, teachers };
}

/**
 * The same two numbers per school, so the console can relabel its buttons the
 * moment a school is picked without a round trip.
 *
 * One `groupBy` rather than a count per school: at 300-odd schools the second
 * shape is 600 queries on a page that already reads every table's row count.
 * Schools with neither a head nor a teacher still belong in the list — they are
 * exactly the ones an admin is most likely to be clearing — so the counts are
 * merged onto the school list rather than derived from it.
 */
export async function accountCountsBySchool(): Promise<
  { id: string; name: string; schoolHeads: number; teachers: number }[]
> {
  const [schools, grouped] = await Promise.all([
    prisma.school.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.groupBy({
      by: ["schoolId", "role"],
      where: { deletedAt: null, role: { in: ["SCHOOL_HEAD", "TEACHER"] }, schoolId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const tally = new Map<string, { schoolHeads: number; teachers: number }>();
  for (const row of grouped) {
    if (!row.schoolId) continue;
    const entry = tally.get(row.schoolId) ?? { schoolHeads: 0, teachers: 0 };
    if (row.role === "SCHOOL_HEAD") entry.schoolHeads = row._count._all;
    else entry.teachers = row._count._all;
    tally.set(row.schoolId, entry);
  }

  return schools.map((school) => ({
    id: school.id,
    name: school.name,
    schoolHeads: tally.get(school.id)?.schoolHeads ?? 0,
    teachers: tally.get(school.id)?.teachers ?? 0,
  }));
}
