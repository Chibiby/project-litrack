"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  readingLevelSchema,
  readingLevelBulkSchema,
} from "@/lib/validators/reading-level.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

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
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      englishProfile: parsed.data.englishProfile,
      filipinoProfile: parsed.data.filipinoProfile,
      wordRecognitionLevel: parsed.data.wordRecognitionLevel,
      readingComprehensionLevel: parsed.data.readingComprehensionLevel,
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

  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath("/teacher/aral");
  revalidatePath(
    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/reading-level`
  );
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}/reading-level`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
  return { ok: true };
}

/**
 * Upsert weekly reading levels for many ARAL learners.
 * Input: `{ weekStart, entries: [{ learnerId, englishProfile, filipinoProfile, wordRecognitionLevel, readingComprehensionLevel, notes? }] }`
 * `weekStart` is coerced/normalized to Monday.
 */
export async function bulkRecordWeeklyReadingLevel(
  input: unknown
): Promise<ActionResult<{ upserted: number }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = readingLevelBulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const weekStart = parsed.data.weekStart;
  const learnerIds = [...new Set(parsed.data.entries.map((e) => e.learnerId))];

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      teacherId: user.id,
      deletedAt: null,
      isAralLearner: true,
    },
    select: { id: true, gradeLevelId: true },
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
            weekStart,
          },
        },
        create: {
          learnerId: entry.learnerId,
          weekStart,
          englishProfile: entry.englishProfile,
          filipinoProfile: entry.filipinoProfile,
          wordRecognitionLevel: entry.wordRecognitionLevel,
          readingComprehensionLevel: entry.readingComprehensionLevel,
          notes: entry.notes,
          recordedById: user.id,
        },
        update: {
          englishProfile: entry.englishProfile,
          filipinoProfile: entry.filipinoProfile,
          wordRecognitionLevel: entry.wordRecognitionLevel,
          readingComprehensionLevel: entry.readingComprehensionLevel,
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
    action: AUDIT_ACTIONS.READING_LEVEL_BULK_RECORD,
    resource: "ReadingLevelRecord",
    resourceId: gradeIds[0] ?? null,
    metadata: {
      schoolId: user.schoolId,
      weekStart: weekStart.toISOString().slice(0, 10),
      upserted: parsed.data.entries.length,
      learnerIds,
      gradeLevelIds: gradeIds,
    },
  });

  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/aral/${gradeId}`);
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

  return { ok: true, data: { upserted: parsed.data.entries.length } };
}
