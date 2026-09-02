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
 *
 * `notes` is the reason attached to THIS day, which is what `Attendance.notes`
 * has always been column-wise. It is `null` to clear a stored reason and
 * `undefined` when the cell's reason is not part of this edit. A Present cell
 * carries no reason by design — the picker states "No remarks required" — so a
 * status change to PRESENT sends `notes: null` and drops whatever reason an
 * earlier Absent/Excused left behind.
 */
export const attendanceWeekCellSchema = z.object({
  learnerId: nonEmpty(),
  date: dateKey,
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]).nullable(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * A weekly attendance save. Only dirty cells travel, so an untouched cell is
 * never rewritten and a legacy status is never destroyed.
 *
 * `cells` is capped at 1400 (200 learners x 7 days) — one grade's grid cannot
 * legitimately exceed it.
 *
 * There is deliberately no weekly `remarks` array. A reason belongs to the day
 * it explains, so it rides on the cell; a single note smeared across every
 * marked day of the week could not say which day it was about, and its UPDATE
 * pass overwrote any per-day reason that had been entered.
 */
export const attendanceWeekSchema = z
  .object({
    gradeId: nonEmpty(),
    /** Monday of the week being saved. */
    weekStart: dateKey,
    cells: z.array(attendanceWeekCellSchema).max(1400),
  })
  .refine((d) => d.cells.length > 0, { message: "Nothing to save" });

export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;
export type AttendanceWeekCellInput = z.infer<typeof attendanceWeekCellSchema>;
export type AttendanceWeekInput = z.infer<typeof attendanceWeekSchema>;
