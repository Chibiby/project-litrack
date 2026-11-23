import { z } from "zod";
import { nonEmpty } from "./common";

/** Same cap as section transfers: the largest Learners page. */
const MAX_IDS = 100;
const MAX_NOTE = 300;

const ids = (label: string) =>
  z
    .array(nonEmpty(`Choose at least one ${label}`))
    .min(1, `Choose at least one ${label}`)
    .max(MAX_IDS, `Choose at most ${MAX_IDS} at a time`);

const note = (label: string) =>
  z
    .string()
    .trim()
    .max(MAX_NOTE, `${label} must be ${MAX_NOTE} characters or fewer`)
    .optional()
    .transform((value) => (value ? value : undefined));

export const schoolTransferKindSchema = z.enum(["LEARNER", "TEACHER", "ARAL_VOLUNTEER"]);

export const requestSchoolTransfersSchema = z.object({
  /** The sending school. */
  schoolId: nonEmpty("Choose the sending school"),
  toSchoolId: nonEmpty("Choose a school"),
  kind: schoolTransferKindSchema,
  ids: ids("person"),
  reason: note("The reason"),
});

export const cancelSchoolTransfersSchema = z.object({
  schoolId: nonEmpty("Choose the school"),
  ids: ids("transfer"),
});

export const declineSchoolTransfersSchema = cancelSchoolTransfersSchema.extend({
  note: note("The note"),
});

export const acceptSchoolTransfersSchema = cancelSchoolTransfersSchema.extend({
  placement: z
    .object({
      gradeLevelId: nonEmpty("Choose a grade"),
      sectionId: nonEmpty("Choose a section"),
    })
    .optional(),
});

export type RequestSchoolTransfersInput = z.input<typeof requestSchoolTransfersSchema>;
export type CancelSchoolTransfersInput = z.input<typeof cancelSchoolTransfersSchema>;
export type DeclineSchoolTransfersInput = z.input<typeof declineSchoolTransfersSchema>;
export type AcceptSchoolTransfersInput = z.input<typeof acceptSchoolTransfersSchema>;
