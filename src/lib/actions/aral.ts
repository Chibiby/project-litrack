"use server";



import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

import { requireSchoolUser } from "@/lib/auth/session";

import { assertSameSchool } from "@/lib/auth/tenant";

import { aralProfileSchema } from "@/lib/validators/aral.schema";

import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

import { teacherCanAccessLearner } from "@/lib/teachers/scope";



type ActionResult = { ok: true } | { ok: false; error: string };



function formToObj(formData: FormData): Record<string, unknown> {

  const obj: Record<string, unknown> = {};

  for (const [k, v] of formData.entries()) {

    if (k.endsWith("[]")) {

      const key = k.slice(0, -2);

      const arr = (obj[key] as string[]) ?? [];

      arr.push(String(v));

      obj[key] = arr;

    } else if (obj[k] !== undefined) {

      obj[k] = Array.isArray(obj[k])

        ? [...(obj[k] as string[]), String(v)]

        : [obj[k] as string, String(v)];

    } else {

      obj[k] = v;

    }

  }

  return obj;

}



export async function saveAralProfile(formData: FormData): Promise<ActionResult> {

  const user = await requireSchoolUser("TEACHER");

  const raw = formToObj(formData);

  const parsed = aralProfileSchema.safeParse(raw);

  if (!parsed.success) {

    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  }



  const learner = await prisma.learner.findFirst({

    where: {

      id: parsed.data.learnerId,

      deletedAt: null,

    },

  });

  if (!learner) return { ok: false, error: "Learner not found or not ARAL" };



  try {

    assertSameSchool(user.schoolId, learner.schoolId);

  } catch {

    return { ok: false, error: "Not found" };

  }

  if (!teacherCanAccessLearner(learner, user.id)) {

    return { ok: false, error: "Not found" };

  }

  if (!learner.isAralLearner) return { ok: false, error: "Learner not found or not ARAL" };



  const { learnerId, ...rest } = parsed.data;

  await prisma.aralProfile.upsert({

    where: { learnerId },

    create: { learnerId, ...rest },

    update: { ...rest },

  });



  await writeAudit({

    userId: user.id,

    schoolId: user.schoolId,

    action: AUDIT_ACTIONS.ARAL_PROFILE_SAVE,

    resource: "AralProfile",

    resourceId: learnerId,

    metadata: { schoolId: user.schoolId, learnerId },

  });



  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath("/teacher/aral");
  revalidatePath("/teacher/learners");

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);

  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
  });

  return { ok: true };

}


