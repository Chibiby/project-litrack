"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  readingLevelSchema,
  readingLevelMonthlyBulkSchema,
} from "@/lib/validators/reading-level.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { formatLocalDateKey } from "@/lib/date-keys";
import { revalidateLearnerScoped, revalidateTeacherDashboard } from "@/lib/cache/revalidate";
import {
  teacherCanAccessLearner,
  teacherLearnerScope,
} from "@/lib/teachers/scope";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export async function recordReadingLevel(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = readingLevelSchema.safeParse({
    learnerId: formData.get("learnerId"),
    weekStart: formData.get("weekStart"),
    englishProfile: formData.get("englishProfile"),
    filipinoProfile: formData.get("filipinoProfile"),
    wordRecognitionLevel: formData.get("wordRecognitionLevel"),
    readingComprehensionLevel: formData.get("readingComprehensionLevel"),
    writingLevel: formData.get("writingLevel"),
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }
  if (!learner.isAralLearner) {
    return { ok: false, error: "Reading-level tracking is only for ARAL learners" };
  }

  const weekStart = parsed.data.weekStart;

  await prisma.readingLevelRecord.upsert({
    where: {
      learnerId_weekStart: {
        learnerId: learner.id,
        weekStart,
      },
    },
    create: {
      learnerId: learner.id,
      weekStart,
      englishProfile: parsed.data.englishProfile,
      filipinoProfile: parsed.data.filipinoProfile,
      wordRecognitionLevel: parsed.data.wordRecognitionLevel,
      readingComprehensionLevel: parsed.data.readingComprehensionLevel,
      writingLevel: parsed.data.writingLevel ?? null,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      englishProfile: parsed.data.englishProfile,
      filipinoProfile: parsed.data.filipinoProfile,
      wordRecognitionLevel: parsed.data.wordRecognitionLevel,
      readingComprehensionLevel: parsed.data.readingComprehensionLevel,
      writingLevel: parsed.data.writingLevel ?? null,
      notes: parsed.data.notes,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.READING_LEVEL_RECORD,
    resource: "ReadingLevelRecord",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      weekStart: weekStart.toISOString().slice(0, 10),
    },
  });

  revalidatePath("/teacher/aral");
  revalidatePath(
    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/reading-level`
  );
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}/reading-level`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
  });
  return { ok: true };
}

/**
 * Upsert one month's reading levels for many ARAL learners.
 * Input: `{ monthStart, entries: [{ learnerId, englishProfile, filipinoProfile, wordRecognitionLevel, readingComprehensionLevel, writingLevel?, notes? }] }`
 * `monthStart` is coerced and normalized to the 1st of the month.
 *
 * The stored column is still `weekStart`. The ARAL reading level is assessed
 * monthly — the nav, the teacher dashboard task, and every dashboard aggregate
 * already treat it that way — so the row is keyed to the 1st of the month rather
 * than a Monday. That reuses the existing `@@unique([learnerId, weekStart])`,
 * which then reads as "one assessment per learner per month", and needs no
 * migration. Rows written by the earlier weekly grid stay exactly where they
 * are; `fetchAralReadingLevelForMonth` reads the whole month, so they still
 * prefill the grid and saving consolidates them onto the anchor.
 */
export async function bulkRecordMonthlyReadingLevel(
  input: unknown
): Promise<ActionResult<{ upserted: number }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = readingLevelMonthlyBulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const monthStart = parsed.data.monthStart;
  const learnerIds = [...new Set(parsed.data.entries.map((e) => e.learnerId))];

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      ...teacherLearnerScope(user.id),
      deletedAt: null,
      isAralLearner: true,
    },
    select: { id: true, gradeLevelId: true, teacherId: true, aralTeacherId: true },
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
      prisma.readingLevelRecord.upsert({
        where: {
          learnerId_weekStart: {
            learnerId: entry.learnerId,
            weekStart: monthStart,
          },
        },
        create: {
          learnerId: entry.learnerId,
          weekStart: monthStart,
          englishProfile: entry.englishProfile,
          filipinoProfile: entry.filipinoProfile,
          wordRecognitionLevel: entry.wordRecognitionLevel,
          readingComprehensionLevel: entry.readingComprehensionLevel,
          writingLevel: entry.writingLevel ?? null,
          notes: entry.notes ?? null,
          recordedById: user.id,
        },
        update: {
          englishProfile: entry.englishProfile,
          filipinoProfile: entry.filipinoProfile,
          wordRecognitionLevel: entry.wordRecognitionLevel,
          readingComprehensionLevel: entry.readingComprehensionLevel,
          // The grid posts full row state, so anything the teacher cleared has to
          // be written as null. `undefined` would tell Prisma to leave the column
          // alone, and a deleted remark would quietly come back on the next read.
          writingLevel: entry.writingLevel ?? null,
          notes: entry.notes ?? null,
          recordedById: user.id,
        },
      })
    )
  );

  const gradeIds = [...new Set(learners.map((l) => l.gradeLevelId))];
  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.READING_LEVEL_BULK_RECORD,
    resource: "ReadingLevelRecord",
    resourceId: gradeIds[0] ?? null,
    metadata: {
      schoolId: user.schoolId,
      monthStart: formatLocalDateKey(monthStart),
      upserted: parsed.data.entries.length,
      learnerIds,
      gradeLevelIds: gradeIds,
    },
  });

  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/aral/${gradeId}/reading-level`);
  }
  revalidatePath("/teacher/aral");
  for (const id of learnerIds) {
    const l = byId.get(id);
    if (!l) continue;
    revalidatePath(`/teacher/aral/${l.gradeLevelId}/learners/${id}/reading-level`);
    revalidatePath(`/teacher/grade/${l.gradeLevelId}/learners/${id}`);
  }
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });
  // The acting teacher may be the ARAL teacher while somebody else advises the
  // learner (or vice versa) — bust every affected teacher's metrics.
  for (const l of learners) {
    for (const id of [l.teacherId, l.aralTeacherId]) {
      if (id && id !== user.id) revalidateTeacherDashboard(id);
    }
  }

  return { ok: true, data: { upserted: parsed.data.entries.length } };
}
