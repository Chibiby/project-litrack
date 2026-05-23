"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { readingLevelSchema } from "@/lib/validators/reading-level.schema";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function recordReadingLevel(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("TEACHER");

  const parsed = readingLevelSchema.safeParse({
    learnerId: formData.get("learnerId"),
    monthYear: formData.get("monthYear"),
    englishProfile: formData.get("englishProfile"),
    filipinoProfile: formData.get("filipinoProfile"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.learnerId, teacherId: user.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  await prisma.readingLevelRecord.upsert({
    where: { learnerId_monthYear: { learnerId: learner.id, monthYear: parsed.data.monthYear } },
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

  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  return { ok: true };
}
