import { z } from "zod";
import { nonEmpty } from "./common";

export const ENROLLMENT_STATUS = [
  "ACTIVE",
  "COMPLETED",
  "TRANSFERRED",
  "ARCHIVED",
] as const;

export type EnrollmentStatusValue = (typeof ENROLLMENT_STATUS)[number];

/** Empty / whitespace-only → undefined (form optional section). */
const optionalSectionId = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

/** SCHOOL_HEAD same-school transfer (grade / section / teacher). */
export const transferLearnerSchema = z.object({
  learnerId: nonEmpty("Learner required"),
  targetGradeLevelId: nonEmpty("Target grade level required"),
  targetSectionId: optionalSectionId,
  targetTeacherId: nonEmpty("Target teacher required"),
});

export type TransferLearnerInput = z.infer<typeof transferLearnerSchema>;

/** SUPER_ADMIN cross-school transfer. */
export const transferLearnerCrossSchoolSchema = z.object({
  learnerId: nonEmpty("Learner required"),
  targetSchoolId: nonEmpty("Target school required"),
  targetGradeLevelId: nonEmpty("Target grade level required"),
  targetSectionId: optionalSectionId,
  targetTeacherId: nonEmpty("Target teacher required"),
});

export type TransferLearnerCrossSchoolInput = z.infer<
  typeof transferLearnerCrossSchoolSchema
>;
