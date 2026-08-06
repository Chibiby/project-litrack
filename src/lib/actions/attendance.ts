"use server";



import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

import { requireSchoolUser } from "@/lib/auth/session";

import { assertSameSchool } from "@/lib/auth/tenant";

import { attendanceMarkSchema } from "@/lib/validators/attendance.schema";

import { getMonday } from "@/lib/utils";

import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";



type ActionResult = { ok: true } | { ok: false; error: string };



export async function markAttendance(formData: FormData): Promise<ActionResult> {

  const user = await requireSchoolUser("TEACHER");



  const parsed = attendanceMarkSchema.safeParse({

    learnerId: formData.get("learnerId"),

    date: formData.get("date"),

    status: formData.get("status"),

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

    return { ok: false, error: "Attendance tracking is only for ARAL learners" };

  }



  const date = new Date(parsed.data.date);

  date.setHours(0, 0, 0, 0);

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



  await writeAudit({

    userId: user.id,

    schoolId: user.schoolId,

    action: AUDIT_ACTIONS.ATTENDANCE_MARK,

    resource: "Attendance",

    resourceId: learner.id,

    metadata: {

      schoolId: user.schoolId,

      learnerId: learner.id,

      date: parsed.data.date,

      status: parsed.data.status,

    },

  });



  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);

  revalidatePath(

    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/attendance`

  );

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);

  return { ok: true };

}


