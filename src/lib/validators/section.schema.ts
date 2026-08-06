import { z } from "zod";
import { nonEmpty } from "./common";

export const createSectionSchema = z.object({
  gradeLevelId: nonEmpty("Grade level required"),
  name: nonEmpty("Section name required").max(100),
});

export const updateSectionSchema = z.object({
  sectionId: nonEmpty("Section required"),
  name: nonEmpty("Section name required").max(100),
});

export const sectionIdSchema = z.object({
  sectionId: nonEmpty("Section required"),
});

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
