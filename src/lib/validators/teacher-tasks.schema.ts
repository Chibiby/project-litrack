import { z } from "zod";
import { TEACHER_TASK_KINDS } from "@/lib/teacher-tasks/types";

/**
 * The Teacher Tasks export.
 *
 * `schoolId` is only honoured for a Super Admin school view, and only after
 * `resolveSchoolContext` — a School Head's own school always wins. `kind` set
 * exports that one task's columns; with `onlyPending` it also keeps only the
 * teachers pending on it.
 */
export const teacherTasksExportSchema = z.object({
  schoolId: z.string().trim().max(64, "Invalid school").optional(),
  onlyPending: z.boolean().default(false),
  kind: z.enum([...TEACHER_TASK_KINDS, "ALL"], { message: "Invalid task" }).default("ALL"),
  /** ARAL: only ARAL teachers, each narrowed to the ARAL tasks. */
  scope: z.enum(["ALL", "ARAL"], { message: "Invalid list" }).default("ALL"),
});

export type TeacherTasksExportInput = z.input<typeof teacherTasksExportSchema>;
