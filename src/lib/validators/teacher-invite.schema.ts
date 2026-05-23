import { z } from "zod";
import { nonEmpty, email } from "./common";

export const teacherInviteSchema = z.object({
  gradeLevelId: nonEmpty("Grade level required"),
  email,
  firstName: nonEmpty("First name required").max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
  lastName: nonEmpty("Last name required").max(80),
});

export type TeacherInviteInput = z.infer<typeof teacherInviteSchema>;

export const createGradeLevelSchema = z.object({
  type: z.enum([
    "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
  ]),
});

export type CreateGradeLevelInput = z.infer<typeof createGradeLevelSchema>;
