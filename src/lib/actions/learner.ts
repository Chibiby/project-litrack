"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { learnerCreateSchema } from "@/lib/validators/learner.schema";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (obj[key] as string[]) ?? [];
      arr.push(String(v));
      obj[key] = arr;
    } else if (obj[k] !== undefined) {
      obj[k] = Array.isArray(obj[k]) ? [...(obj[k] as string[]), String(v)] : [obj[k] as string, String(v)];
    } else {
      obj[k] = v;
    }
  }
  return obj;
}

export async function createLearner(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };
  if (!user.schoolId) return { ok: false, error: "No school" };

  const raw = formToObj(formData);
  raw.isAralLearner = raw.isAralLearner === "on" || raw.isAralLearner === "true" || raw.isAralLearner === true;

  const parsed = learnerCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  // Verify grade belongs to teacher's school AND teacher is assigned to it
  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
      teachers: { some: { id: user.id } },
    },
  });
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  const fullName = [parsed.data.firstName, parsed.data.middleName, parsed.data.lastName].filter(Boolean).join(" ");

  const learner = await prisma.learner.create({
    data: {
      schoolId: user.schoolId,
      gradeLevelId: parsed.data.gradeLevelId,
      teacherId: user.id,
      firstName: parsed.data.firstName,
      middleName: parsed.data.middleName,
      lastName: parsed.data.lastName,
      fullName,
      age: parsed.data.age,
      gender: parsed.data.gender,
      englishReadingProfile: parsed.data.englishReadingProfile,
      englishFrustrationSubtypes: parsed.data.englishFrustrationSubtypes,
      filipinoReadingProfile: parsed.data.filipinoReadingProfile,
      filipinoFrustrationSubtypes: parsed.data.filipinoFrustrationSubtypes,
      governmentBenefits: parsed.data.governmentBenefits,
      parentEducation: parsed.data.parentEducation,
      isAralLearner: parsed.data.isAralLearner ?? false,
      aralEnrolledAt: parsed.data.isAralLearner ? new Date() : null,
    },
  });

  revalidatePath(`/teacher/grade/${parsed.data.gradeLevelId}`);
  return { ok: true, data: { id: learner.id } };
}

export async function toggleAralLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("TEACHER");
  const learnerId = String(formData.get("learnerId") ?? "");
  if (!learnerId) return { ok: false, error: "Missing id" };

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, teacherId: user.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  const becoming = !learner.isAralLearner;
  await prisma.learner.update({
    where: { id: learner.id },
    data: {
      isAralLearner: becoming,
      aralEnrolledAt: becoming ? new Date() : null,
    },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  return { ok: true };
}
