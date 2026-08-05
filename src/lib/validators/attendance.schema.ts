import { z } from "zod";
import { nonEmpty } from "./common";

/** YYYY-MM-DD local calendar date (see src/lib/date-local.ts). */
const localDateYmd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const attendanceMarkSchema = z.object({
  learnerId: nonEmpty(),
  date: localDateYmd,
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;