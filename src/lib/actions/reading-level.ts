"use server";



import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

import { requireSchoolUser } from "@/lib/auth/session";

import { assertSameSchool } from "@/lib/auth/tenant";

import { readingLevelSchema } from "@/lib/validators/reading-level.schema";

import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

import { revalidateLearnerScoped } from "@/lib/cache/revalidate";



type ActionResult = { ok: true } | { ok: false; error: string };



export async function recordReadingLevel(formData: FormData): Promise<ActionResult> {

  const user = await requireSchoolUser("TEACHER");



  const parsed = readingLevelSchema.safeParse({

    learnerId: formData.get("learnerId"),

    monthYear: formData.get("monthYear"),

    englishProfile: formData.get("englishProfile"),

    filipinoProfile: formData.get("filipinoProfile"),

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



  await prisma.readingLevelRecord.upsert({

    where: {

      learnerId_monthYear: {

        learnerId: learner.id,

        monthYear: parsed.data.monthYear,

      },

    },

    create: {

      learnerId: learner.id,

      monthYear: parsed.data.monthYear,

      englishProfile: parsed.data.englishProfile,

      filipinoProfile: parsed.data.filipinoProfile,

      notes: parsed.data.notes,

      recordedById: user.id,

    },

    update: {

      englishProfile: parsed.data.englishProfile,

      filipinoProfile: parsed.data.filipinoProfile,

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

      monthYear: parsed.data.monthYear,

    },

  });



  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);

  revalidatePath(

    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/reading-level`

  );

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);

  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });

  return { ok: true };

}


