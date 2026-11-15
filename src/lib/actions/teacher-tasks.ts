"use server";

import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { prisma } from "@/lib/prisma";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolContext } from "@/lib/school-context";
import { REPORT_FORMAT_EXTENSION } from "@/lib/reports/kinds";
import { renderExcel } from "@/lib/reports/render";
import { loadReportFrame } from "@/lib/reports/sheet-header";
import { loadTeacherTaskSummaryFresh } from "@/lib/teacher-tasks/queries";
import { filterTeacherTaskRows } from "@/lib/teacher-tasks/rules";
import { buildTeacherTasksExportTable } from "@/lib/teacher-tasks/export";
import { aralTeacherSummary } from "@/lib/monitoring/counts";
import {
  teacherTasksExportSchema,
  type TeacherTasksExportInput,
} from "@/lib/validators/teacher-tasks.schema";


/**
 * Download the Teacher Tasks list as Excel.
 *
 * Authorization: a School Head for their own school, or a Super Admin on a
 * school view. The school is resolved exactly as the School Head pages do it
 * (`resolveSchoolContext`): a School Head's `schoolId` input is ignored in
 * favour of the session's; a Super Admin must name the school, the view is
 * audited as `ADMIN_SCHOOL_VIEW` there, and the school must exist and be live
 * (generic "School not found" otherwise).
 *
 * Audited (`TEACHER_TASKS_EXPORT`, in `SECURITY_AUDIT_ACTIONS`) because the file
 * takes staff data out of the system — the same treatment as every other
 * export. Metadata is filters and counts only.
 *
 * Returns `{ base64, filename }` like `exportMosyReport`.
 */
export const exportTeacherTasks = action(
  "exportTeacherTasks",
  async (
    input: TeacherTasksExportInput
  ): Promise<{ ok: true; data: { base64: string; filename: string } }> => {
    const user = await requireUser("SCHOOL_HEAD");
    const parsed = parseInput(teacherTasksExportSchema, input);

    if (user.role === "SUPER_ADMIN" && !parsed.schoolId) {
      throw new AppError("VALIDATION_FAILED", {
        params: { message: "Open a school first, then export its teacher tasks." },
      });
    }
    const { schoolId } = await resolveSchoolContext(
      user,
      parsed.schoolId,
      SCHOOL_HEAD_ROUTES.monitoringNonCompliance
    );
    if (user.role === "SUPER_ADMIN") {
      const school = await prisma.school.findFirst({
        where: { id: schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!school) throw resourceNotFound("School");
    }

    const today = schoolToday();
    const todayKey = formatLocalDateKey(today);
    const fresh = await loadTeacherTaskSummaryFresh(schoolId, todayKey);
    const summary = parsed.scope === "ARAL" ? aralTeacherSummary(fresh) : fresh;
    const kind = parsed.kind === "ALL" ? null : parsed.kind;
    const rows = filterTeacherTaskRows(summary.rows, { onlyPending: parsed.onlyPending, kind });

    const frame = await loadReportFrame({ schoolId, preparedBy: user.fullName });
    const table = buildTeacherTasksExportTable({
      frame,
      summary,
      rows,
      kind,
      onlyPending: parsed.onlyPending,
      asOf: today,
    });
    const buffer = await renderExcel(table, { generatedOn: today });
    // Local date key, never `toISOString()` (UTC+8).
    const filename = `litrack-${parsed.scope === "ARAL" ? "aral-teacher" : "teacher"}-tasks-${todayKey}.${REPORT_FORMAT_EXTENSION.EXCEL}`;

    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.TEACHER_TASKS_EXPORT,
      resource: "School",
      resourceId: schoolId,
      metadata: {
        schoolId,
        format: "EXCEL",
        kind: parsed.kind,
        scope: parsed.scope,
        onlyPending: parsed.onlyPending,
        rows: rows.length,
        teachers: summary.rows.length,
        teachersWithPending: summary.teachersWithPending,
      },
    });

    return { ok: true, data: { base64: buffer.toString("base64"), filename } };
  },
  { verb: "export the teacher tasks" }
);
