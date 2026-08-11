"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  attendanceMarkSchema,
  attendanceBulkSchema,
} from "@/lib/validators/attendance.schema";
import { getMonday } from "@/lib/utils";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function normalizeDate(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function markAttendance(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = attendanceMarkSchema.safeParse({
    learnerId: formData.get("learnerId"),
    date: formData.get("date"),
    status: formData.get("status"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.learnerId, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (learner.teacherId !== user.id) return { ok: false, error: "Not found" };
  if (!learner.isAralLearner) {
    return { ok: false, error: "Attendance tracking is only for ARAL learners" };
  }

  const date = normalizeDate(parsed.data.date);
  const weekStart = getMonday(date);

  await prisma.attendance.upsert({
    where: { learnerId_date: { learnerId: learner.id, date } },
    create: {
      learnerId: learner.id,
      date,
      weekStart,
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_MARK,
    resource: "Attendance",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      date: parsed.data.date,
      status: parsed.data.status,
    },
  });

  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath("/teacher/aral");
  revalidatePath(
    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/attendance`
  );
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}/attendance`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
  return { ok: true };
}

/**
 * Upsert attendance for many ARAL learners on a single date.
 * Input: `{ date, entries: [{ learnerId, status, notes? }] }`
 */
export async function bulkMarkAttendance(
  input: unknown
): Promise<ActionResult<{ upserted: number }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = attendanceBulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const date = normalizeDate(parsed.data.date);
  const weekStart = getMonday(date);
  const learnerIds = [...new Set(parsed.data.entries.map((e) => e.learnerId))];

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      teacherId: user.id,
      deletedAt: null,
      isAralLearner: true,
    },
    select: { id: true, gradeLevelId: true, teacherId: true, schoolId: true },
  });

  if (learners.length !== learnerIds.length) {
    return {
      ok: false,
      error: "One or more learners were not found or are not ARAL learners",
    };
  }

  const byId = new Map(learners.map((l) => [l.id, l]));

  await prisma.$transaction(
    parsed.data.entries.map((entry) =>
      prisma.attendance.upsert({
        where: { learnerId_date: { learnerId: entry.learnerId, date } },
        create: {
          learnerId: entry.learnerId,
          date,
          weekStart,
          status: entry.status,
          notes: entry.notes,
          recordedById: user.id,
        },
        update: {
          status: entry.status,
          notes: entry.notes,
          recordedById: user.id,
        },
      })
    )
  );

  const gradeIds = [...new Set(learners.map((l) => l.gradeLevelId))];
  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_BULK_MARK,
    resource: "Attendance",
    resourceId: gradeIds[0] ?? null,
    metadata: {
      schoolId: user.schoolId,
      date: date.toISOString().slice(0, 10),
      upserted: parsed.data.entries.length,
      learnerIds,
      gradeLevelIds: gradeIds,
    },
  });

  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/aral/${gradeId}`);
    revalidatePath(`/teacher/aral/${gradeId}/attendance`);
  }
  revalidatePath("/teacher/aral");
  for (const id of learnerIds) {
    const l = byId.get(id);
    if (!l) continue;
    revalidatePath(`/teacher/aral/${l.gradeLevelId}/learners/${id}/attendance`);
    revalidatePath(`/teacher/grade/${l.gradeLevelId}/learners/${id}`);
  }
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });

  return { ok: true, data: { upserted: parsed.data.entries.length } };
}

/**
 * Mark or clear a grade-level holiday for a single attendance date.
 * Input: `{ gradeId, date, isHoliday }`
 */
export async function setAttendanceDayHoliday(
  input: unknown
): Promise<ActionResult<{ isHoliday: boolean }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = z
    .object({
      gradeId: z.string().min(1),
      date: z.coerce.date(),
      isHoliday: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeId,
      deletedAt: null,
      schoolId: user.schoolId,
      teachers: { some: { id: user.id } },
    },
    select: { id: true, schoolId: true },
  });
  if (!grade) return { ok: false, error: "Grade not found" };

  const date = normalizeDate(parsed.data.date);

  await prisma.attendanceDayMeta.upsert({
    where: { gradeLevelId_date: { gradeLevelId: grade.id, date } },
    create: {
      gradeLevelId: grade.id,
      date,
      isHoliday: parsed.data.isHoliday,
      recordedById: user.id,
    },
    update: {
      isHoliday: parsed.data.isHoliday,
      recordedById: user.id,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_DAY_HOLIDAY,
    resource: "AttendanceDayMeta",
    resourceId: grade.id,
    metadata: {
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      date: date.toISOString().slice(0, 10),
      isHoliday: parsed.data.isHoliday,
    },
  });

  revalidatePath(`/teacher/aral/${grade.id}`);
  revalidatePath(`/teacher/aral/${grade.id}/attendance`);
  revalidatePath("/teacher/aral");

  return { ok: true, data: { isHoliday: parsed.data.isHoliday } };
}
