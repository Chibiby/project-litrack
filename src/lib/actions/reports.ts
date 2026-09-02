"use server";

import { revalidatePath } from "next/cache";
import type { ReportKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { reportGenerateSchema, reportIdSchema } from "@/lib/validators/report.schema";
import {
  REPORT_FORMAT_EXTENSION,
  REPORT_KIND_LABELS,
  type ReportFilters,
} from "@/lib/reports/kinds";
import { renderReport, type ReportTable } from "@/lib/reports/render";
import {
  buildAttendanceTable,
  buildClassRosterTable,
  buildReadingLevelTable,
  buildTeacherSummaryTable,
  buildTermGradesTable,
  type ReportScope,
} from "@/lib/reports/queries";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Reports Hub actions.
 *
 * The generated FILE is never stored. A `Report` row records what was asked for
 * and Re-generate replays it, which is why nothing here writes bytes anywhere
 * and why a history row holds no learner PII — only ids, a name and the filter
 * set. Deleting a row deletes the record of the request, not a file.
 */

/** Every builder keyed by kind, so `generateReport` has no switch to fall off. */
const BUILDERS: Record<
  Exclude<ReportKind, "CUSTOM">,
  (scope: ReportScope, filters: ReportFilters) => Promise<ReportTable>
> = {
  ATTENDANCE: buildAttendanceTable,
  READING_LEVEL: buildReadingLevelTable,
  TERM_GRADES: buildTermGradesTable,
  TEACHER_SUMMARY: buildTeacherSummaryTable,
  CLASS_ROSTER: buildClassRosterTable,
};

/**
 * Resolves who is asking and what they may see, once, for every report.
 *
 * A Super Admin passes every role check by default (impersonation), so the
 * teacher narrowing is keyed on `role === "TEACHER"` explicitly rather than on
 * "the role check passed" — the trap `CLAUDE.md` names.
 */
async function resolveScope(): Promise<
  { ok: true; scope: ReportScope; userId: string } | { ok: false; error: string }
> {
  const user = await requireUser(["TEACHER", "SCHOOL_HEAD"]);
  if (!user.schoolId) return { ok: false, error: "No school assigned" };

  const school = await prisma.school.findFirst({
    where: { id: user.schoolId, deletedAt: null },
    select: { name: true },
  });
  if (!school) return { ok: false, error: "School not found" };

  return {
    ok: true,
    userId: user.id,
    scope: {
      schoolId: user.schoolId,
      teacherId: user.role === "TEACHER" ? user.id : null,
      schoolName: school.name,
      actorName: user.fullName,
    },
  };
}

/** "Grade 5 - Section A" / "All Classes" for the history row's scope cell. */
async function scopeLabelFor(
  schoolId: string,
  filters: ReportFilters
): Promise<string> {
  if (filters.sectionId) {
    const section = await prisma.section.findFirst({
      where: { id: filters.sectionId, schoolId, deletedAt: null },
      select: { name: true, gradeLevel: { select: { type: true } } },
    });
    if (section) {
      const { GRADE_LEVEL_LABELS } = await import("@/lib/constants/enum-labels");
      const grade =
        GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type;
      return `${grade} - ${section.name}`;
    }
  }
  if (filters.gradeLevelId) {
    const grade = await prisma.gradeLevel.findFirst({
      where: { id: filters.gradeLevelId, schoolId, deletedAt: null },
      select: { type: true },
    });
    if (grade) {
      const { GRADE_LEVEL_LABELS } = await import("@/lib/constants/enum-labels");
      return GRADE_LEVEL_LABELS[grade.type] ?? grade.type;
    }
  }
  return "All Classes";
}

export async function generateReport(
  input: unknown
): Promise<ActionResult<{ base64: string; filename: string; reportId: string }>> {
  const resolved = await resolveScope();
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const parsed = reportGenerateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { kind, format, ...filters } = parsed.data;
  if (kind === "CUSTOM") {
    return { ok: false, error: "Custom reports are not available yet" };
  }

  // Every id in the filter set is verified against this tenant before it
  // reaches a query. Without this a crafted sectionId from another school
  // would narrow the report to rows the learner scope would then exclude —
  // an empty file rather than a leak, but the check is what makes that true
  // by construction rather than by luck.
  if (filters.sectionId) {
    const ok = await prisma.section.findFirst({
      where: { id: filters.sectionId, schoolId: resolved.scope.schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Not found" };
  }
  if (filters.gradeLevelId) {
    const ok = await prisma.gradeLevel.findFirst({
      where: { id: filters.gradeLevelId, schoolId: resolved.scope.schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Not found" };
  }
  if (filters.schoolYearId) {
    const ok = await prisma.schoolYear.findFirst({
      where: { id: filters.schoolYearId, schoolId: resolved.scope.schoolId },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Not found" };
  }

  let buffer: Buffer;
  let table: ReportTable;
  try {
    table = await BUILDERS[kind](resolved.scope, filters);
    buffer = await renderReport(table, format);
  } catch (err) {
    console.error("[generateReport] failed:", err);
    return { ok: false, error: "Could not generate the report. Please try again." };
  }

  const scopeLabel = await scopeLabelFor(resolved.scope.schoolId, filters);
  // Local date key, never `toISOString()`: the school runs at UTC+8, so between
  // 00:00 and 08:00 Manila the UTC slice names the report for yesterday.
  const today = formatLocalDateKey(schoolToday());
  const name = `${table.title} (${scopeLabel})`;
  const slug = REPORT_KIND_LABELS[kind].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filename = `litrack-${slug}-${today}.${REPORT_FORMAT_EXTENSION[format]}`;

  const report = await prisma.report.create({
    data: {
      schoolId: resolved.scope.schoolId,
      createdById: resolved.userId,
      kind,
      format,
      name,
      scopeLabel,
      filters,
    },
    select: { id: true },
  });

  await writeAudit({
    userId: resolved.userId,
    schoolId: resolved.scope.schoolId,
    action: AUDIT_ACTIONS.REPORT_GENERATE,
    resource: "Report",
    resourceId: report.id,
    // Counts and ids only — a report is built over learner PII and none of it
    // enters an audit row.
    metadata: {
      kind,
      format,
      rows: table.rows.length,
      gradeLevelId: filters.gradeLevelId ?? null,
      sectionId: filters.sectionId ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
  });

  revalidatePath("/teacher/reports");
  revalidatePath("/school-head/reports");

  return {
    ok: true,
    data: { base64: buffer.toString("base64"), filename, reportId: report.id },
  };
}

export async function deleteReport(input: unknown): Promise<ActionResult> {
  const resolved = await resolveScope();
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const parsed = reportIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  // Scoped to this school AND this author: a teacher cannot remove a colleague's
  // history row, and the generic "Not found" means existence in another tenant
  // never leaks.
  const existing = await prisma.report.findFirst({
    where: {
      id: parsed.data.id,
      schoolId: resolved.scope.schoolId,
      createdById: resolved.userId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Not found" };

  await prisma.report.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });

  await writeAudit({
    userId: resolved.userId,
    schoolId: resolved.scope.schoolId,
    action: AUDIT_ACTIONS.REPORT_DELETE,
    resource: "Report",
    resourceId: existing.id,
    metadata: { schoolId: resolved.scope.schoolId },
  });

  revalidatePath("/teacher/reports");
  revalidatePath("/school-head/reports");
  return { ok: true };
}
