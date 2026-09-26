"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { aralProfileSchema } from "@/lib/validators/aral.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { teacherIsAralTutorFor } from "@/lib/teachers/scope";
import { action } from "@/lib/errors/action";
import { resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";

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

/**
 * Authorization: `requireSchoolUser("TEACHER")`. Tenancy: `assertSameSchool`
 * against the learner's `schoolId`, then `teacherIsAralTutorFor` — the
 * designated ARAL tutor, not merely the adviser, because the ARAL profile is
 * the programme's own intake record for this learner.
 */
export const saveAralProfile = action(
  "saveAralProfile",
  async (formData: FormData): Promise<{ ok: true }> => {
    const user = await requireSchoolUser("TEACHER");
    const raw = formToObj(formData);
    const parsed = parseInput(aralProfileSchema, raw);

    const learner = await prisma.learner.findFirst({
      where: {
        id: parsed.learnerId,
        deletedAt: null,
      },
    });
    if (!learner) throw resourceNotFound("Learner");

    assertSameSchool(user.schoolId, learner.schoolId, "Learner");
    if (!teacherIsAralTutorFor(learner, user.id)) {
      throw resourceNotFound("Learner");
    }
    if (!learner.isAralLearner) throw resourceNotFound("Learner");

    const { learnerId, ...rest } = parsed;
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

    revalidatePath("/teacher/aral");
    revalidatePath("/teacher/aral/profiling");
    revalidatePath("/teacher");
    revalidatePath("/teacher/learners");
    revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
    });

    return { ok: true };
  },
  { verb: "save the ARAL profile" }
);
