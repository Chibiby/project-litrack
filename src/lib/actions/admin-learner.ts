"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { learnerUpdateSchema } from "@/lib/validators/learner.schema";
import {
  applyLearnerProfileUpdate,
  learnerFormToObject,
} from "@/lib/learners/apply-update";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { action } from "@/lib/errors/action";
import { resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { assertSchoolYearOpen } from "@/lib/school-year/gate";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * A Division or Developer Admin correcting a learner's profile from the
 * division learner directory.
 *
 * The same fields and the same reading-policy rules as the teacher's
 * `updateLearner` (both go through `applyLearnerProfileUpdate`); only the
 * guard differs. Super Admin is division-wide, so there is no school scope —
 * just the soft-delete filter. Placement (grade/section) is not editable here,
 * matching the teacher path: moving a learner is the School Head's transfer
 * flow, which keeps the active Enrollment row in step.
 *
 * No audit row: `LEARNER_UPDATE` is not a security record
 * (`SECURITY_AUDIT_ACTIONS`), so `writeAudit` would drop it anyway.
 */
export const updateLearnerAsAdmin = action(
  "updateLearnerAsAdmin",
  async (formData: FormData): Promise<ActionResult> => {
    await requireUser("SUPER_ADMIN");
    const parsed = parseInput(learnerUpdateSchema, learnerFormToObject(formData));

    const learner = await prisma.learner.findFirst({
      where: { id: parsed.id, deletedAt: null },
      include: { gradeLevel: { select: { type: true } } },
    });
    if (!learner) throw resourceNotFound("Learner");
    // Outside the Division Admin's active duration every school record is read-only.
    await assertSchoolYearOpen(learner.schoolId);

    const refused = await applyLearnerProfileUpdate(learner, parsed);
    if (refused) return { ok: false, error: refused };

    revalidatePath(ADMIN_ROUTES.learners);
    revalidatePath(`${ADMIN_ROUTES.learners}/${learner.id}`);
    revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
    revalidatePath("/teacher/learners");
    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
    });
    return { ok: true };
  },
  { verb: "save the learner" }
);
