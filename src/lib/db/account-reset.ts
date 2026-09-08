import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TEACHER_EMAIL_DOMAIN } from "@/lib/auth/synthetic-email";

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
 */
export async function resetAllSchoolHeadPasswords(): Promise<BulkResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const heads = await prisma.user.findMany({
    where: { role: "SCHOOL_HEAD", deletedAt: null, school: { deletedAt: null } },
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
        password: head.school.schoolIdCode,
        app_metadata: { role: "SCHOOL_HEAD", schoolId: head.school.id },
      });
      if (error) throw new Error(error.message);

      await prisma.user.update({
        where: { id: head.id },
        data: { passwordIsSchoolId: true, mustChangePassword: false, isActive: true },
      });
      processed += 1;
    } catch (err) {
      failed.push({ id: head.id, label, reason: reasonOf(err) });
    }
  });

  return { processed, failed };
}

/** Frees the address for re-registration while keeping the person's name on history. */
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
 */
export async function removeAllTeacherAccounts(): Promise<BulkResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER", deletedAt: null },
    select: { id: true, authId: true, fullName: true, email: true },
  });

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

      await prisma.user.update({
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
        },
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
