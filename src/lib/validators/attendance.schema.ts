import { z } from "zod";
import { nonEmpty } from "./common";

export const attendanceMarkSchema = z.object({
  learnerId: nonEmpty(),
  date: z.coerce.date(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export const attendanceBulkSchema = z.object({
  date: z.coerce.date(),
  entries: z.array(attendanceMarkSchema.omit({ date: true })).min(1),
});

export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;
export type AttendanceBulkInput = z.infer<typeof attendanceBulkSchema>;
