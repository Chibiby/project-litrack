import { z } from "zod";
import { nonEmpty } from "./common";

export const attendanceMarkSchema = z.object({
  learnerId: nonEmpty(),
  date: z.coerce.date(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

/**
 * A local calendar day, `YYYY-MM-DD`. The weekly grid keys every cell off the
 * school's local date (see `src/lib/date-keys.ts`), so the wire format is the
 * key itself rather than a coerced `Date` that a UTC lambda would shift.
 */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

/**
 * One day cell the teacher actually changed.
 *
 * `status: null` clears the day — the grid's "—" / No Class state — and deletes
 * the `Attendance` row rather than storing an absence. `LATE` is accepted but no
 * live surface produces it; it exists so a legacy row survives a save that does
 * not touch its cell.
 */
export const attendanceWeekCellSchema = z.object({
  learnerId: nonEmpty(),
  date: dateKey,
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]).nullable(),
});

/**
 * A weekly attendance save. Only dirty cells and dirty remarks travel, so an
 * untouched cell is never rewritten and a legacy status is never destroyed.
 *
 * `cells` is capped at 1400 (200 learners x 7 days) and `remarks` at 200 — one
 * grade's grid cannot legitimately exceed either.
 */
export const attendanceWeekSchema = z
  .object({
    gradeId: nonEmpty(),
    /** Monday of the week being saved. */
    weekStart: dateKey,
    cells: z.array(attendanceWeekCellSchema).max(1400),
    remarks: z
      .array(z.object({ learnerId: nonEmpty(), notes: z.string().trim().max(500) }))
      .max(200),
  })
  .refine((d) => d.cells.length > 0 || d.remarks.length > 0, {
    message: "Nothing to save",
  });

export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;
export type AttendanceWeekCellInput = z.infer<typeof attendanceWeekCellSchema>;
export type AttendanceWeekInput = z.infer<typeof attendanceWeekSchema>;
