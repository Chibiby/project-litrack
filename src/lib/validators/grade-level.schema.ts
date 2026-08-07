import { z } from "zod";

export const createGradeLevelSchema = z.object({
  type: z.enum([
    "KINDER",
    "G1",
    "G2",
    "G3",
    "G4",
    "G5",
    "G6",
    "G7",
    "G8",
    "G9",
    "G10",
    "G11",
    "G12",
    "FLOATING",
  ]),
});

export type CreateGradeLevelInput = z.infer<typeof createGradeLevelSchema>;
