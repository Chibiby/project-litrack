"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { aralProfileSchema } from "@/lib/validators/aral.schema";

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
      obj[k] = v;
    }
  }
  return obj;
}

export async function saveAralProfile(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("TEACHER");
  const raw = formToObj(formData);
  const parsed = aralProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  // Verify learner is owned by this teacher and is ARAL
  const learner = await prisma.learner.findFirst({
    where: {
      id: parsed.data.learnerId,
      teacherId: user.id,
      isAralLearner: true,
      deletedAt: null,
    },
  });
  if (!learner) return { ok: false, error: "Learner not found or not ARAL" };

  const { learnerId, ...rest } = parsed.data;
  await prisma.aralProfile.upsert({
    where: { learnerId },
    create: { learnerId, ...rest },
    update: { ...rest },
  });

  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  return { ok: true };
}
