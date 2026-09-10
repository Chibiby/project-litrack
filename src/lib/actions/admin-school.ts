"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { AUDIT_ACTIONS, writeAuditMany } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { removeTeacherAccountsByIds } from "@/lib/db/account-reset";
import {
  revalidateLearnerScoped,
  revalidateSchoolDashboard,
  revalidateSchoolTeachers,
  revalidateSchoolsList,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";

/**
 * Per-row removals from the Super Admin school page.
 *
 * These exist because the equivalent actions elsewhere are School-scoped:
 * `deleteLearners` guards with `requireSchoolUser("TEACHER")`, which a Super
 * Admin — whose `schoolId` is null — cannot satisfy. Rather than loosen that
 * guard and weaken the teacher path, the admin path is its own module with its
 * own guard.
 *
 * Both actions take the school id explicitly and verify that *every* submitted
 * row belongs to it, refusing the whole batch with a generic "Not found" if any
 * does not. Generic on purpose: a batch that reported which ids were foreign
 * would confirm those rows exist in some other school, which is the leak
 * `assertSameSchool` exists to prevent.
 *
 * Removal is a soft delete, matching every other delete in the app. The rows
 * stay so "who recorded this" keeps answering, and stop appearing anywhere a
 * user looks. To take a school's records out of the database for good, use
 * "Clear operational data" scoped to that school on `/admin/database`.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Bulk removal is deliberate work, not something to hammer. */
const REMOVE_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

/** One page of learners is 50, so a select-all submits at most that many. */
const MAX_IDS = 200;

const removalSchema = z.object({
  schoolId: z.string().uuid("That school could not be identified."),
  ids: z
    .array(z.string().uuid())
    .min(1, "Select at least one row.")
    .max(MAX_IDS, "Too many rows at once."),
});

function parseRemoval(formData: FormData, idField: string) {
  return removalSchema.safeParse({
    schoolId: formData.get("schoolId"),
    ids: Array.from(new Set(formData.getAll(idField).map(String))),
  });
}

/** The school exists and is not itself removed, or the refusal to propagate. */
async function liveSchool(schoolId: string): Promise<{ id: string; name: string } | null> {
  return prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
}

/**
 * Remove teachers from one school.
 *
 * Same removal the Danger zone's "Remove teachers" performs, down to the same
 * helper: Supabase auth user deleted so the password stops working, `deletedAt`
 * set so any live session is signed out, login email tombstoned so the person
 * can register again. Applied to a chosen few rather than to everyone.
 */
export async function removeSchoolTeachers(
  formData: FormData
): Promise<ActionResult<{ removed: number; failed: number }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = parseRemoval(formData, "teacherIds");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { schoolId, ids } = parsed.data;

  const rate = await checkRateLimit(`admin:remove-teachers:${admin.id}`, REMOVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await liveSchool(schoolId);
  if (!school) return { ok: false, error: "That school no longer exists." };

  const teachers = await prisma.user.findMany({
    where: { id: { in: ids }, role: "TEACHER", deletedAt: null },
    select: { id: true, schoolId: true },
  });
  if (teachers.length !== ids.length || teachers.some((t) => t.schoolId !== schoolId)) {
    return { ok: false, error: "Not found" };
  }

  const result = await removeTeacherAccountsByIds(schoolId, ids);

  await writeAuditMany(
    teachers.map((teacher) => ({
      userId: admin.id,
      schoolId,
      action: AUDIT_ACTIONS.TEACHER_REMOVE,
      resource: "User",
      resourceId: teacher.id,
      metadata: { schoolId, via: "admin-school-page" },
    }))
  );

  revalidateSchoolTeachers(schoolId);
  revalidateSchoolDashboard(schoolId);
  revalidateSchoolsList();
  for (const teacher of teachers) revalidateTeacherCaches(teacher.id);
  revalidatePath(`/admin/schools/${schoolId}`);

  return { ok: true, data: { removed: result.processed, failed: result.failed.length } };
}

/**
 * Remove learners from one school.
 *
 * Mirrors `deleteLearners` in the teacher path — soft delete plus archiving the
 * active enrollment, in one transaction, so a removed learner does not keep a
 * live seat in the school year they were removed from.
 */
export async function removeSchoolLearners(
  formData: FormData
): Promise<ActionResult<{ removed: number }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = parseRemoval(formData, "learnerIds");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { schoolId, ids } = parsed.data;

  const rate = await checkRateLimit(`admin:remove-learners:${admin.id}`, REMOVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await liveSchool(schoolId);
  if (!school) return { ok: false, error: "That school no longer exists." };

  const learners = await prisma.learner.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      schoolId: true,
      teacherId: true,
      aralTeacherId: true,
      isAralLearner: true,
    },
  });
  if (learners.length !== ids.length || learners.some((l) => l.schoolId !== schoolId)) {
    return { ok: false, error: "Not found" };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.learner.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });
    await tx.enrollment.updateMany({
      where: { learnerId: { in: ids }, status: "ACTIVE" },
      data: { status: "ARCHIVED", endedAt: now },
    });
  });

  await writeAuditMany(
    learners.map((learner) => ({
      userId: admin.id,
      schoolId,
      action: AUDIT_ACTIONS.LEARNER_DELETE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: { schoolId, learnerId: learner.id, via: "admin-school-page" },
    }))
  );

  for (const learner of learners) {
    revalidateLearnerScoped({
      schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
      teacherShell: learner.isAralLearner,
    });
  }
  revalidateSchoolsList();
  revalidatePath(`/admin/schools/${schoolId}`);

  return { ok: true, data: { removed: learners.length } };
}
