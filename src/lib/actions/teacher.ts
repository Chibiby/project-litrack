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
import {
  teacherProfileSchema,
  teacherProfileUpdateSchema,
  ARAL_VOLUNTEER_DESIGNATION,
} from "@/lib/validators/profile.schema";
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
import { advisoryCapFor } from "@/lib/teachers/advisory-limits";

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

  // Teacher once, then School Head only. Read before parsing so we can use the right schema.
  const existing = await prisma.teacherProfile.findFirst({
    where: { userId: user.id, user: { schoolId: user.schoolId } },
    select: { designation: true, advisoryMode: true },
  });
  const isFirstSave = existing === null;

  const raw = formToObj(formData);
  raw.hasReadingTraining = raw.hasReadingTraining === true || raw.hasReadingTraining === "true" || raw.hasReadingTraining === "on";
  raw.hasEnglishTraining = raw.hasEnglishTraining === true || raw.hasEnglishTraining === "true" || raw.hasEnglishTraining === "on";

  // First save requires section+grade (advisory constraints); later saves allow Settings-only changes.
  const schema = isFirstSave ? teacherProfileSchema : teacherProfileUpdateSchema;
  const parsed = schema.safeParse(raw);
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
    advisoryMode,
    additionalSectionIds,
    ...profileFields
  } = parsed.data;
  const firstName = formatPersonName(firstRaw);
  const lastName = formatPersonName(lastRaw);
  const middleName = formatOptionalPersonName(middleRaw) ?? null;
  const fullName = buildFullName(firstName, middleName, lastName);

  // Prisma skips `undefined` on update — normalize optionals to null so clears persist
  // (e.g. position when designation is Others). Leave contactEmail untouched (no longer collected).
  // On a later save, if the stored designation is null, keep the submitted one (don't write null).
  const profileData = {
    ...profileFields,
    designation: isFirstSave || existing.designation == null ? parsed.data.designation : existing.designation,
    advisoryMode: isFirstSave ? advisoryMode : existing.advisoryMode,
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
      // Only on first save: assign the sections the teacher declared. On later
      // saves, the School Head owns advisory assignment via setTeacherAdvisorySection.
      if (isFirstSave) {
        const volunteer = parsed.data.designation === ARAL_VOLUNTEER_DESIGNATION;
        const wanted =
          volunteer || advisoryMode === "FLOATING" || !sectionId
            ? []
            : [sectionId, ...(advisoryMode === "MULTI_GRADE" ? additionalSectionIds : [])];
        if (wanted.length === 0) {
          await setTeacherAdvisory(tx, { teacherId: user.id, schoolId: user.schoolId, change: { op: "clear" } });
        }
        for (const id of wanted) {
          await setTeacherAdvisory(tx, { teacherId: user.id, schoolId: user.schoolId, change: { op: "add", sectionId: id } });
        }
      }
    });
  } catch (err) {
    console.error("[saveTeacherProfile] failed:", err);
    if (err instanceof AdvisoryCapError) {
      return { ok: false, error: err.message };
    }
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
      advisoryMode: isFirstSave ? advisoryMode : existing.advisoryMode,
      additionalSectionIds: isFirstSave ? additionalSectionIds : [],
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

export type AdvisorySettingResult =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; error: "confirm_release"; releases: { id: string; label: string }[] };

const DESIGNATION_KINDS = ["Teacher", "Master Teacher", ARAL_VOLUNTEER_DESIGNATION, "__OTHER__"] as const;

const advisorySettingSchema = z
  .object({
    teacherId: z.string().uuid("Invalid teacher"),
    designationKind: z.enum(DESIGNATION_KINDS, {
      errorMap: () => ({ message: "Invalid designation" }),
    }),
    designationOther: z.string().trim().max(100, "Keep the designation under 100 characters").optional(),
    advisoryMode: z.enum(["DEFAULT", "FLOATING", "MULTI_GRADE"], {
      errorMap: () => ({ message: "Invalid advisory mode" }),
    }),
    confirmRelease: z.union([z.literal("true"), z.undefined(), z.null()]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.designationKind === "__OTHER__" && !(data.designationOther && data.designationOther.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designationOther"],
        message: "Enter the designation",
      });
    }
  });

/**
 * Set a teacher's designation and advisory mode as the School Head.
 *
 * Changing either can lower the number of sections the teacher is allowed to
 * advise (`advisoryCapFor`) below what they currently hold — dropping to
 * DEFAULT while advising three sections, say. Rather than releasing the
 * excess silently, the action stops and names exactly which sections would be
 * freed, and only releases them once the School Head calls back with
 * `confirmRelease: "true"`. The releases route through `setTeacherAdvisory`
 * so the legacy `TeacherSection` / `taughtGrades` mirrors never diverge from
 * who is dropped here.
 */
export async function setTeacherAdvisorySetting(formData: FormData): Promise<AdvisorySettingResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = advisorySettingSchema.safeParse({
    teacherId: formData.get("teacherId"),
    designationKind: formData.get("designationKind"),
    designationOther: formData.get("designationOther") ?? undefined,
    advisoryMode: formData.get("advisoryMode"),
    confirmRelease: formData.get("confirmRelease") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { teacherId, designationKind, designationOther, advisoryMode, confirmRelease } = parsed.data;
  const designation = designationKind === "__OTHER__" ? (designationOther as string) : designationKind;

  type TxOutcome =
    | { kind: "not-found" }
    | { kind: "no-profile" }
    | { kind: "needs-confirm"; releases: { id: string; label: string }[] }
    | { kind: "no-op" }
    | {
        kind: "done";
        teacherId: string;
        previousDesignation: string;
        previousMode: string;
        releasedSectionIds: string[];
      };

  let outcome: TxOutcome;
  try {
    outcome = (await prisma.$transaction(async (tx) => {
      // Reading and re-checking the cap inside the transaction narrows, but
      // does not close, a concurrent-add race under READ COMMITTED — closing
      // it needs a row lock here and in setTeacherAdvisory, which no
      // advisory write takes today.
      const teacher = await tx.user.findFirst({
        where: { id: teacherId, schoolId: user.schoolId, role: "TEACHER", deletedAt: null },
        select: {
          id: true,
          fullName: true,
          teacherProfile: { select: { designation: true, advisoryMode: true } },
          advisorySections: {
            where: { deletedAt: null },
            select: { id: true, name: true, gradeLevel: { select: { type: true } } },
            orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
          },
        },
      });
      if (!teacher) return { kind: "not-found" } as const;
      if (!teacher.teacherProfile) return { kind: "no-profile" } as const;

      const previousDesignation = teacher.teacherProfile.designation;
      const previousMode = teacher.teacherProfile.advisoryMode;

      const held = teacher.advisorySections;
      const cap = advisoryCapFor(designation, advisoryMode);
      const excess = held.slice(cap);

      if (excess.length > 0 && confirmRelease !== "true") {
        return {
          kind: "needs-confirm",
          releases: excess.map((s) => ({
            id: s.id,
            label: `${GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type} · ${s.name}`,
          })),
        } as const;
      }

      // Nothing changed and nothing is over cap — return early rather than
      // write an audit row claiming a change that did not happen.
      if (previousDesignation === designation && previousMode === advisoryMode && excess.length === 0) {
        return { kind: "no-op" } as const;
      }

      await tx.teacherProfile.update({
        where: { userId: teacher.id },
        data: { designation, advisoryMode },
      });
      for (const section of excess) {
        await setTeacherAdvisory(tx, {
          teacherId: teacher.id,
          schoolId: user.schoolId,
          change: { op: "remove", sectionId: section.id },
        });
      }

      return {
        kind: "done",
        teacherId: teacher.id,
        previousDesignation,
        previousMode,
        releasedSectionIds: excess.map((s) => s.id),
      } as const;
    })) as TxOutcome;
  } catch (err) {
    console.error("[setTeacherAdvisorySetting] failed:", err);
    return { ok: false, error: describeDbFailure(err, { action: "update this teacher's advisory setting" }) };
  }

  if (outcome.kind === "not-found") return { ok: false, error: "Teacher not found" };
  if (outcome.kind === "no-profile") {
    return { ok: false, error: "This teacher hasn't finished profiling yet." };
  }
  if (outcome.kind === "needs-confirm") {
    return { ok: false, error: "confirm_release", releases: outcome.releases };
  }
  if (outcome.kind === "no-op") return { ok: true };

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ADVISORY_SETTING_CHANGE,
    resource: "TeacherProfile",
    resourceId: outcome.teacherId,
    metadata: {
      schoolId: user.schoolId,
      teacherId: outcome.teacherId,
      previousDesignation: outcome.previousDesignation,
      designation,
      previousMode: outcome.previousMode,
      advisoryMode,
      releasedSectionIds: outcome.releasedSectionIds,
    },
  });

  revalidateSchoolHeadTeachers(user.schoolId);
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidatePath("/teacher/settings/profile");
  revalidateTeacherCaches(outcome.teacherId);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}
