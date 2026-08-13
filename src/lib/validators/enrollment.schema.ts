import { z } from "zod";
import { nonEmpty } from "./common";

export const ENROLLMENT_STATUS = [
  "ACTIVE",
  "COMPLETED",
  "TRANSFERRED",
  "ARCHIVED",
] as const;

export type EnrollmentStatusValue = (typeof ENROLLMENT_STATUS)[number];

/** Explicit "No section" clear sentinel from transfer forms. */
export const SECTION_CLEAR = "__none__";

/**
 * Explicit "move to Floating" grade sentinel from transfer forms.
 *
 * Floating means no grade and no section. The per-school FLOATING `GradeLevel`
 * row that backs it is created on demand and never offered in Grade Levels, so
 * the form has no id to send — it sends this instead and the action resolves it.
 */
export const GRADE_FLOATING = "__floating__";

/**
 * Transfer section field:
 * - omitted / empty → undefined (preserve previous when same-grade)
 * - `__none__` → clear sentinel
 * - otherwise section id string
 */
const optionalTransferSectionId = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    if (!trimmed) return undefined;
    if (trimmed === SECTION_CLEAR) return SECTION_CLEAR;
    return trimmed;
  });

/**
 * Transfer teacher field.
 *
 * Optional rather than required because the FLOATING grade has no adviser: a
 * floating learner is precisely one with no grade and no section, so there is no
 * teacher to name. The action still rejects a missing teacher for every real
 * grade — only it knows the target grade's type.
 */
const optionalTransferTeacherId = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed ? trimmed : undefined;
  });

/** SCHOOL_HEAD same-school transfer (grade / section / teacher). */
export const transferLearnerSchema = z.object({
  learnerId: nonEmpty("Learner required"),
  targetGradeLevelId: nonEmpty("Target grade level required"),
  targetSectionId: optionalTransferSectionId,
  targetTeacherId: optionalTransferTeacherId,
});

export type TransferLearnerInput = z.infer<typeof transferLearnerSchema>;

/** SUPER_ADMIN cross-school transfer. */
export const transferLearnerCrossSchoolSchema = z.object({
  learnerId: nonEmpty("Learner required"),
  targetSchoolId: nonEmpty("Target school required"),
  targetGradeLevelId: nonEmpty("Target grade level required"),
  targetSectionId: optionalTransferSectionId,
  targetTeacherId: nonEmpty("Target teacher required"),
});

export type TransferLearnerCrossSchoolInput = z.infer<
  typeof transferLearnerCrossSchoolSchema
>;
