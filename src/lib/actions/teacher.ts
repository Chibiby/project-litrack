"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  formatPersonName,
  formatOptionalPersonName,
  buildFullName,
} from "@/lib/names";
import { requireSchoolUser } from "@/lib/auth/session";
import { teacherProfileSchema } from "@/lib/validators/profile.schema";
import { ethnicityColumns } from "@/lib/validators/ethnicity";
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
  AdvisoryCapError,
  SectionTakenError,
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
  // §5. Coerced the same way, and only when present: the field is new, so a form
  // that does not send it must fall through to the schema's `false` default
  // rather than be read as a declaration.
  if (raw.noAdvisorySection !== undefined) {
    raw.noAdvisorySection =
      raw.noAdvisorySection === true ||
      raw.noAdvisorySection === "true" ||
      raw.noAdvisorySection === "on";
  }

  const parsed = teacherProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const {
    firstName: firstRaw,
    lastName: lastRaw,
    middleName: middleRaw,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Intentionally destructuring contactEmail to exclude it from profileFields
    contactEmail: _contactEmail,
    sectionId,
    // §5. A declared choice, never stored: floating IS zero live advisory
    // sections. Pulled out of `profileFields` so it cannot reach
    // `TeacherProfile`, which has no column for it and must not grow one — a
    // stored flag could disagree with the sections themselves.
    noAdvisorySection,
    ...profileFields
  } = parsed.data;
  const firstName = formatPersonName(firstRaw);
  const lastName = formatPersonName(lastRaw);
  const middleName = formatOptionalPersonName(middleRaw) ?? null;
  const fullName = buildFullName(firstName, middleName, lastName);

  // Prisma skips `undefined` on update — normalize optionals to null so clears persist
  // (e.g. position when designation is Others). Leave contactEmail untouched (no longer collected).
  const profileData = {
    ...profileFields,
    contactNumber: parsed.data.contactNumber ?? null,
    specializationOther: parsed.data.specializationOther ?? null,
    currentGradeAssignment: parsed.data.currentGradeAssignment ?? null,
    position: parsed.data.position ?? null,
    yearsInService: parsed.data.yearsInService ?? null,
    // Same reason: an ethnicity removed in Settings has to be written as null,
    // and each free-text line has to be cleared when its slot is not Others.
    ...ethnicityColumns(parsed.data),
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
      // Profiling still assigns ONE section: it is the teacher stating their own
      // classroom during onboarding, not a School Head building a load. A second
      // or third is added from the teachers table. Expressed as add/clear rather
      // than the old replace, so finishing a profile cannot silently drop an
      // advisory a School Head assigned while the teacher was still onboarding.
      // Declaring "no advisory section" CLEARS, rather than leaving whatever was
      // there: a teacher who says they advise nothing and still shows as
      // advising Grade 3 has been contradicted by the app. Submitting no section
      // without declaring it — an ARAL Volunteer, or a re-save of a profile that
      // never had one — also clears, which is what the old code did.
      await setTeacherAdvisory(tx, {
        teacherId: user.id,
        schoolId: user.schoolId,
        change:
          sectionId && !noAdvisorySection
            ? { op: "add", sectionId }
            : { op: "clear" },
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
  /**
   * `""` clears every advisory — what the "Unassigned" option still sends.
   * With a section named, `op` decides whether it joins the set or leaves it.
   */
  sectionId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || z.string().uuid().safeParse(v).success, {
      message: "Invalid section",
    }),
  /**
   * The operation, because a teacher may now hold three sections and "assign"
   * no longer means "replace". Defaults to `add` so an older client — a tab
   * left open across the deploy — still assigns rather than silently clearing.
   */
  op: z.enum(["add", "remove"]).default("add"),
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
 * A section has one adviser — `Section.adviserId` is one column on one row — and
 * taking an occupied one is refused rather than granted. Refusing is the
 * deliberate choice: reassigning silently would strip the sitting adviser of a
 * roster they can reach, without telling either of them. So the error names the
 * adviser and the School Head removes it from that teacher first, which makes
 * the loss explicit and puts it in the audit log as its own event.
 *
 * A teacher may hold up to `MAX_ADVISORY_SECTIONS` of them. The cap is checked
 * inside the transaction rather than here, so two School Heads adding at once
 * cannot both pass a check and land a fourth between them.
 */
export async function setTeacherAdvisorySection(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = setAdvisorySectionSchema.safeParse({
    teacherId: formData.get("teacherId"),
    sectionId: formData.get("sectionId"),
    op: formData.get("op") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { teacherId, sectionId, op } = parsed.data;

  const teacher = await prisma.user.findFirst({
    where: {
      id: teacherId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: {
      id: true,
      advisorySections: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  const held = teacher.advisorySections.map((s) => s.id);

  // Nothing to do — and worth returning early so a stray re-submit does not
  // write an audit row claiming a change that did not happen. Three shapes of
  // no-op now: clearing nothing, adding one they already hold, removing one
  // they do not.
  if (!sectionId && held.length === 0) return { ok: true };
  if (sectionId && op === "add" && held.includes(sectionId)) return { ok: true };
  if (sectionId && op === "remove" && !held.includes(sectionId)) return { ok: true };

  if (sectionId && op === "add") {
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
        error: `${gradeLabel} · ${section.name} is advised by ${adviserName}. Remove it from them first, then add it here.`,
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await setTeacherAdvisory(tx, {
        teacherId: teacher.id,
        schoolId: user.schoolId,
        change: sectionId
          ? op === "add"
            ? { op: "add", sectionId }
            : { op: "remove", sectionId }
          : { op: "clear" },
      });
    });
  } catch (err) {
    console.error("[setTeacherAdvisorySection] failed:", err);
    // The cap is checked inside the transaction, against the rows as they are
    // there, so this is the only place it can be reported from.
    if (err instanceof AdvisoryCapError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof SectionTakenError || isAdvisorySectionConflict(err)) {
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
      // The whole set before the change, not one pointer: with three possible
      // advisories, "what did they hold before" is the only way to read an
      // add or a remove back out of the log.
      previousSectionIds: held,
      op: sectionId ? op : "clear",
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
