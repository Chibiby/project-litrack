"use server";

import { action } from "@/lib/errors/action";
import { tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import type { ActionResult } from "@/lib/errors/result";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import { resolveSummaryScope } from "@/lib/auth/admin-scope";
import { checkRateLimit } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { isDemoVisible } from "@/lib/demo/session";
import { renderReport } from "@/lib/reports/render";
import { loadReportFrame } from "@/lib/reports/sheet-header";
import { REPORT_FORMAT_EXTENSION } from "@/lib/reports/kinds";
import { summaryExportSchema } from "@/lib/validators/summary.schema";
import { SUMMARY_FACETS } from "@/lib/summary/facets";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { frameForScope } from "@/lib/summary/export";

/** Deliberate work, not a hammer: 20 exports per 10 minutes per admin (spec 3.6). */
const EXPORT_RATE = { limit: 20, windowMs: 10 * 60 * 1000 } as const;

export type SummaryExportResult = { base64: string; filename: string };

/**
 * Export one summary facet as Excel (Print or Records) or PDF, through the
 * Reports hub's renderer.
 *
 * Authorization and tenancy, in order:
 * 1. `requireAdminScope` — Super Admin (division) or District Admin (their
 *    districts); anyone else is refused before anything is read.
 * 2. `resolveSummaryScope` narrows the requested district/school to that scope;
 *    an out-of-scope district is NOT_FOUND before any query runs.
 * 3. A requested school must pass `loadSchoolInScope` (scope in the WHERE).
 * 4. The facet reads only the ids `resolveScopeSchools` returns for that
 *    narrowed scope.
 *
 * Writes no `Report` row (`Report.schoolId` is required and a district export
 * has no single school). The audit row carries counts, never a name.
 */
export const exportSummary = action(
  "exportSummary",
  async (input: unknown): Promise<ActionResult<SummaryExportResult>> => {
    const { user, scope } = await requireAdminScope();

    const req = parseInput(summaryExportSchema, input);

    const rate = await checkRateLimit(`summary-export:${user.id}`, EXPORT_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const summaryScope = resolveSummaryScope(scope, {
      district: req.district,
      schoolId: req.schoolId,
    });
    if (summaryScope.kind === "school") {
      await loadSchoolInScope(scope, summaryScope.schoolId, { id: true });
    }

    const facet = SUMMARY_FACETS[req.facet];
    const result = await facet.load(summaryScope, {
      level: req.level,
      month: req.month,
      from: req.from,
      to: req.to,
      schoolYearLabel: req.schoolYearLabel,
      term: req.term,
    });

    const schools = await resolveScopeSchools(summaryScope, await isDemoVisible());
    const schoolYearLabel = result.params.schoolYearLabel ?? "";
    const frame =
      summaryScope.kind === "school"
        ? await loadReportFrame({ schoolId: summaryScope.schoolId, preparedBy: user.fullName }).then(
            (f) => ({ ...f, schoolYearLabel: schoolYearLabel || f.schoolYearLabel })
          )
        : frameForScope(summaryScope, schools, { schoolYearLabel, preparedBy: user.fullName });

    const table = facet.toReportTable(result, frame);
    const generatedOn = schoolToday();
    const buffer = await renderReport(table, req.format, { purpose: req.purpose, generatedOn });

    const districtCount = new Set(schools.map((s) => s.district ?? "")).size;
    await writeAudit({
      userId: user.id,
      schoolId: summaryScope.kind === "school" ? summaryScope.schoolId : null,
      action: AUDIT_ACTIONS.SUMMARY_EXPORT,
      resource: "Summary",
      resourceId: req.facet,
      // Counts and choices only: no school, district, learner or teacher name.
      metadata: {
        facet: req.facet,
        level: result.level,
        scopeKind: summaryScope.kind,
        districtCount,
        schoolCount: result.schoolCount,
        format: req.format,
        purpose: req.purpose,
      },
    });

    // Local date key, never `toISOString()` (UTC+8 would name yesterday).
    const today = formatLocalDateKey(generatedOn);
    const filename = `litrack-${req.facet}-summary-${today}.${REPORT_FORMAT_EXTENSION[req.format]}`;
    return { ok: true, data: { base64: buffer.toString("base64"), filename } };
  },
  { verb: "export the summary" }
);
