"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { attendanceMarkSchema } from "@/lib/validators/attendance.schema";
import { getMonday } from "@/lib/utils";
import { parseLocalDateYmd } from "@/lib/date-local";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function markAttendance(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("TEACHER");

  const parsed = attendanceMarkSchema.safeParse({
    learnerId: formData.get("learnerId"),
    date: formData.get("date"),
    status: formData.get("status"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.learnerId, teacherId: user.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  // Local calendar date → Date at local midnight for @db.Date storage (see date-local.ts).
  const date = parseLocalDateYmd(parsed.data.date);
  const weekStart = getMonday(date);

  await prisma.attendance.upsert({
    where: { learnerId_date: { learnerId: learner.id, date } },
    create: {
      learnerId: learner.id,
      date,
      weekStart,
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
  });

  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  return { ok: true };
}
