"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { teacherProfileSchema } from "@/lib/validators/profile.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateTeacherDashboard } from "@/lib/cache/revalidate";

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
      obj[k] = Array.isArray(obj[k]) ? [...(obj[k] as string[]), String(v)] : [obj[k] as string, String(v)];
    } else {
      obj[k] = v === "on" ? true : v;
    }
  }
  return obj;
}

export async function saveTeacherProfile(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("TEACHER");

  const raw = formToObj(formData);
  raw.hasReadingTraining = raw.hasReadingTraining === true || raw.hasReadingTraining === "true" || raw.hasReadingTraining === "on";
  raw.hasEnglishTraining = raw.hasEnglishTraining === true || raw.hasEnglishTraining === "true" || raw.hasEnglishTraining === "on";

  const parsed = teacherProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const {
    firstName,
    lastName,
    middleName: middleRaw,
    contactEmail: _contactEmail,
    ...profileFields
  } = parsed.data;
  const middleName = middleRaw?.trim() ? middleRaw.trim() : null;
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  // Prisma skips `undefined` on update — normalize optionals to null so clears persist
  // (e.g. position when designation is Others). Leave contactEmail untouched (no longer collected).
  const profileData = {
    ...profileFields,
    contactNumber: parsed.data.contactNumber ?? null,
    specializationOther: parsed.data.specializationOther ?? null,
    currentGradeAssignment: parsed.data.currentGradeAssignment ?? null,
    position: parsed.data.position ?? null,
  };

  await prisma.$transaction([
    prisma.teacherProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...profileData },
      update: { ...profileData },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { firstName, middleName, lastName, fullName, profileCompleted: true },
    }),
  ]);

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_PROFILE_SAVE,
    resource: "TeacherProfile",
    resourceId: user.id,
    metadata: { schoolId: user.schoolId, userId: user.id },
  });

  revalidatePath("/teacher");
  revalidatePath("/teacher/settings/profile");
  revalidateTeacherDashboard(user.id);
  return { ok: true };
}
