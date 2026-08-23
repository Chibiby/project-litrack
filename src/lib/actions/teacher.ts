"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { teacherProfileSchema } from "@/lib/validators/profile.schema";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateTeacherCaches,
  revalidateSchoolDashboard,
  revalidateSchoolHeadTeachers,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { describeDbFailure } from "@/lib/db-errors";
import {
  setTeacherAdvisory,
  isAdvisorySectionConflict,
  SECTION_TAKEN_ERROR,
} from "@/lib/teachers/section-assignment";

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

/**
 * Save a teacher's profiling wizard submission — including the teacher's own
 * grade+section self-assignment, written through {@link setTeacherAdvisory}.
 *
 * One of exactly two writers of `User.advisorySectionId`. The other is
 * {@link setTeacherAdvisorySection}, where a School Head assigns or changes it
 * on the teacher's behalf. Both route through `setTeacherAdvisory` so the
 * legacy `TeacherSection` and `taughtGrades` mirrors can never diverge
 * depending on who did the assigning.
 */
export async function saveTeacherProfile(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");

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
    sectionId,
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
    yearsInService: parsed.data.yearsInService ?? null,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.teacherProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...profileData },
        update: { ...profileData },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { firstName, middleName, lastName, fullName, profileCompleted: true },
      });
      await setTeacherAdvisory(tx, {
        teacherId: user.id,
        sectionId: sectionId ?? null,
        schoolId: user.schoolId,
      });
    });
  } catch (err) {
    console.error("[saveTeacherProfile] failed:", err);
    if (isAdvisorySectionConflict(err)) {
      return { ok: false, error: SECTION_TAKEN_ERROR };
    }
    if (
      err instanceof Error &&
      err.message === "One or more sections are invalid or do not belong to this school"
    ) {
      return { ok: false, error: "Invalid section selected." };
    }
    // Never surface raw Prisma/Postgres text to the client — but do say which
    // kind of failure this was, because "try again" is the wrong advice for
    // half of them. A database behind the committed migrations rejects the
    // same write forever, and looping the teacher through retries hides that.
    return { ok: false, error: describeDbFailure(err, { action: "save your profile" }) };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_PROFILE_SAVE,
    resource: "TeacherProfile",
    resourceId: user.id,
    metadata: {
      schoolId: user.schoolId,
      userId: user.id,
      sectionId: sectionId ?? null,
      designation: parsed.data.designation,
    },
  });

  revalidatePath("/teacher/settings/profile");
  revalidateSchoolHeadTeachers(user.schoolId);
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  // Grade/section self-assignment changes the teacher's sidebar grade links,
  // not just their dashboard metrics — and the school-head dashboard counts
  // sectioned/advised teachers.
  revalidateTeacherCaches(user.id);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}

const setAdvisorySectionSchema = z.object({
  teacherId: z.string().uuid("Invalid teacher"),
  /** `""` clears the advisory — the client sends it for the "Unassigned" option. */
  sectionId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || z.string().uuid().safeParse(v).success, {
      message: "Invalid section",
    }),
});

/**
 * Assign, change, or clear a teacher's advisory section as the School Head.
 *
 * The counterpart to the teacher's own self-assignment in the profiling wizard.
 * Both exist because both situations are real: a teacher picks their section
 * during onboarding, and a School Head has to be able to correct it afterwards —
 * a mid-year section swap, a teacher who chose wrong, a section that was
 * soft-deleted out from under them.
 *
 * `User.advisorySectionId` is `@unique`, so a section has one adviser and taking
 * an occupied one is refused rather than granted. Refusing is the deliberate
 * choice: reassigning silently would strip the sitting adviser of the ability to
 * add learners to the only roster they can reach, without telling either of them.
 * So the error names the adviser and the School Head clears that teacher first,
 * which makes the loss explicit and puts it in the audit log as its own event.
 */
export async function setTeacherAdvisorySection(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = setAdvisorySectionSchema.safeParse({
    teacherId: formData.get("teacherId"),
    sectionId: formData.get("sectionId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { teacherId, sectionId } = parsed.data;

  const teacher = await prisma.user.findFirst({
    where: {
      id: teacherId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: { id: true, advisorySectionId: true },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  // Nothing to do — and worth returning early so a stray re-submit does not
  // write an audit row claiming a change that did not happen.
  if (teacher.advisorySectionId === sectionId) return { ok: true };

  if (sectionId) {
    // Resolve the section in THIS school and read its current adviser in the
    // same query, so the refusal below can name them. `setTeacherAdvisory`
    // would raise P2002 on its own, but a bare "that section is taken" leaves
    // the School Head with no idea whose advisory to clear.
    const section = await prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId, deletedAt: null },
      select: {
        name: true,
        gradeLevel: { select: { type: true } },
        adviser: { select: { id: true, fullName: true } },
      },
    });
    if (!section) return { ok: false, error: "Section not found" };

    if (section.adviser && section.adviser.id !== teacherId) {
      const gradeLabel =
        GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type;
      const adviserName = section.adviser.fullName || "another teacher";
      return {
        ok: false,
        error: `${gradeLabel} · ${section.name} is advised by ${adviserName}. Set them to Unassigned first, then assign this section here.`,
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await setTeacherAdvisory(tx, {
        teacherId: teacher.id,
        sectionId,
        schoolId: user.schoolId,
      });
    });
  } catch (err) {
    console.error("[setTeacherAdvisorySection] failed:", err);
    if (isAdvisorySectionConflict(err)) {
      // The check above passed, so someone claimed the section in between —
      // the teacher's own profiling wizard, or a second School Head tab. There
      // is no name to offer for a race, so the generic message is the honest one.
      return { ok: false, error: SECTION_TAKEN_ERROR };
    }
    if (
      err instanceof Error &&
      err.message === "One or more sections are invalid or do not belong to this school"
    ) {
      return { ok: false, error: "Invalid section selected." };
    }
    // Never surface raw Prisma/Postgres text to the client.
    return { ok: false, error: "Failed to update the advisory. Please try again." };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_SET_ADVISORY_SECTION,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      previousSectionId: teacher.advisorySectionId,
      sectionId,
    },
  });

  revalidateSchoolHeadTeachers(user.schoolId);
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  // The teacher sees their own advisory on their profile and in their sidebar
  // grade links, so a change made here has to reach their surfaces too.
  revalidatePath("/teacher/settings/profile");
  revalidateTeacherCaches(teacher.id);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}
