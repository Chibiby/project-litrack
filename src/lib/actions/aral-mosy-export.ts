"use server";

import { requireSchoolUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { AppError } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { aralMosyExportSchema } from "@/lib/validators/aral-mosy.schema";
import { getActiveSchoolYear } from "@/lib/cache/school-year";
import { formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import { loadMosyExport } from "@/lib/aral/mosy-queries";
import { buildMosyExportTable } from "@/lib/aral/mosy-export";
import { REPORT_FORMAT_EXTENSION } from "@/lib/reports/kinds";
import { resolveMosyWindow } from "@/lib/reports/mosy-window";
import { renderReport } from "@/lib/reports/render";
import { loadReportFrame } from "@/lib/reports/sheet-header";

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

/**
 * Exports the MOSY Report page (the filtered list plus the five stats) as Excel
 * or PDF, through the Reports Hub renderer so it carries the same DepEd frame.
 *
 * Authorization: `requireSchoolUser("TEACHER")`. Tenancy: `schoolId` is the
 * session's, and the tutor scope is the session user (`teacherId = user.id`);
 * a Super Admin, who passes the role check, gets the whole-school read-only
 * scope exactly as the page gives them, and only for the school on their
 * session. Neither comes from the input. Grade and section ids from the input
 * are pinned to `schoolId` inside `loadMosyExport`, so a foreign id matches no
 * rows and no label.
 *
 * No `Report` history row: the Reports Hub no longer lists MOSY, so a row would
 * be an entry nobody can see, re-generate or delete. No revalidation: nothing
 * is written. Audited (`ARAL_MOSY_EXPORT`, in `SECURITY_AUDIT_ACTIONS`) because
 * the file takes learner data out of the system.
 *
 * Returns the same `{ base64, filename }` the hub's `generateReport` returns
 * (minus `reportId`); the client turns it into a download.
 */
export const exportMosyReport = action(
  "exportMosyReport",
  async (
    formData: FormData
  ): Promise<{ ok: true; data: { base64: string; filename: string } }> => {
    const user = await requireSchoolUser("TEACHER");
    const input = parseInput(aralMosyExportSchema, formToObj(formData));

    const schoolYear = await getActiveSchoolYear(user.schoolId);
    if (!schoolYear) {
      throw new AppError("VALIDATION_FAILED", {
        params: { message: "There is no active school year yet, so there is no MOSY report to export." },
      });
    }

    const data = await loadMosyExport({
      schoolId: user.schoolId,
      schoolYear: { id: schoolYear.id, startDateKey: schoolYear.startDateKey },
      teacherId: user.role === "SUPER_ADMIN" ? null : user.id,
      q: input.q,
      grade: input.grade,
      section: input.section,
      status: input.status,
    });

    const frame = await loadReportFrame({
      schoolId: user.schoolId,
      schoolYearId: schoolYear.id,
      preparedBy: user.fullName,
    });

    const window = resolveMosyWindow(parseLocalDateKey(schoolYear.startDateKey), schoolYear.overrides);
    const today = schoolToday();
    const table = buildMosyExportTable({
      frame,
      teacherName: user.fullName,
      windowLabel: window.label,
      asOf: today,
      filters: {
        q: input.q,
        status: input.status,
        gradeLabel: data.gradeLabel,
        sectionLabel: data.sectionLabel,
      },
      stats: data.stats,
      rows: data.rows,
      totalCount: data.totalCount,
      truncated: data.truncated,
    });

    const buffer = await renderReport(table, input.format, {
      purpose: input.purpose,
      generatedOn: today,
    });
    // Local date key, never `toISOString()` (UTC+8), same as the hub.
    const filename = `litrack-mosy-report-${formatLocalDateKey(today)}.${REPORT_FORMAT_EXTENSION[input.format]}`;

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.ARAL_MOSY_EXPORT,
      resource: "AralMosyDecision",
      resourceId: schoolYear.id,
      // Counts, ids and codes only. `q` is left out on purpose: it is usually a
      // learner's name.
      metadata: {
        schoolId: user.schoolId,
        schoolYearId: schoolYear.id,
        format: input.format,
        purpose: input.purpose,
        status: input.status,
        gradeLevelId: input.grade === "all" ? null : input.grade,
        // "all" / "none" / a section id.
        section: input.section,
        hasSearch: input.q.length > 0,
        rows: data.rows.length,
        totalMatching: data.totalCount,
        truncated: data.truncated,
      },
    });

    return { ok: true, data: { base64: buffer.toString("base64"), filename } };
  },
  { verb: "export the MOSY report" }
);
