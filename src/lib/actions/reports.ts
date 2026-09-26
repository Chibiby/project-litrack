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
import { reportLocksFor } from "@/lib/reports/availability";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { renderReport, reportBlocks } from "@/lib/reports/render";
import {
  buildAttendanceTable,
  buildClassRosterTable,
  buildMosyTable,
  buildReadingLevelTable,
  buildTeacherSummaryTable,
  buildTermGradesTable,
  type ReportScope,
  type ReportTableWithAudit,
} from "@/lib/reports/queries";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";

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
  (scope: ReportScope, filters: ReportFilters) => Promise<ReportTableWithAudit>
> = {
  ATTENDANCE: buildAttendanceTable,
  READING_LEVEL: buildReadingLevelTable,
  TERM_GRADES: buildTermGradesTable,
  TEACHER_SUMMARY: buildTeacherSummaryTable,
  CLASS_ROSTER: buildClassRosterTable,
  MOSY: buildMosyTable,
};

/**
 * Resolves who is asking and what they may see, once, for every report.
 *
 * A Super Admin passes every role check by default (impersonation), so the
 * teacher narrowing is keyed on `role === "TEACHER"` explicitly rather than on
 * "the role check passed" — the trap `CLAUDE.md` names.
 */
async function resolveScope(): Promise<{ scope: ReportScope; userId: string }> {
  const user = await requireUser(["TEACHER", "SCHOOL_HEAD"]);
  if (!user.schoolId) throw resourceNotFound("School");

  const school = await prisma.school.findFirst({
    where: { id: user.schoolId, deletedAt: null },
    select: { name: true },
  });
  if (!school) throw resourceNotFound("School");

  return {
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

/**
 * Authorization: `resolveScope` → `requireUser(["TEACHER","SCHOOL_HEAD"])`.
 * Tenancy: every filter id (section, grade, school year) is verified against
 * `resolved.scope.schoolId` before any builder runs, and a TEACHER's builder
 * call is further narrowed by `scope.teacherId` inside each `BUILDERS[kind]`.
 */
export const generateReport = action(
  "generateReport",
  async (
    input: unknown
  ): Promise<{ ok: true; data: { base64: string; filename: string; reportId: string } }> => {
  const resolved = await resolveScope();

  const parsed = parseInput(reportGenerateSchema, input);

  const { kind, format, purpose, ...filters } = parsed;
  if (kind === "CUSTOM") {
    throw new AppError("VALIDATION_FAILED", {
      params: { message: "Custom reports are not available yet" },
    });
  }

  // A real TEACHER (never a Super Admin impersonating the shell — that is
  // exactly what `scope.teacherId === null` means here) may be locked out of
  // a report kind: a Non-DepEd ARAL Volunteer or a FLOATING DepEd teacher
  // advises no section, so there is no End of Term sheet to cover. Checked
  // BEFORE any builder runs, so a locked kind never touches a query.
  if (resolved.scope.teacherId) {
    const profile = await prisma.teacherProfile.findFirst({
      where: { userId: resolved.scope.teacherId, user: { schoolId: resolved.scope.schoolId } },
      select: { designation: true, advisoryMode: true },
    });
    const locks = reportLocksFor(
      advisoryRosterDenial({
        isSuperAdmin: false,
        designation: profile?.designation,
        advisoryMode: profile?.advisoryMode,
      })
    );
    const lockMessage = locks[kind];
    if (lockMessage) {
      throw new AppError("VALIDATION_FAILED", { params: { message: lockMessage } });
    }
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
    if (!ok) throw resourceNotFound("Section");
  }
  if (filters.gradeLevelId) {
    const ok = await prisma.gradeLevel.findFirst({
      where: { id: filters.gradeLevelId, schoolId: resolved.scope.schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) throw resourceNotFound("Grade level");
  }
  if (filters.schoolYearId) {
    const ok = await prisma.schoolYear.findFirst({
      where: { id: filters.schoolYearId, schoolId: resolved.scope.schoolId },
      select: { id: true },
    });
    if (!ok) throw resourceNotFound("School year");
  }

  // Any builder/render failure below is classified and reported by `action()`
  // (Prisma/system failures get a reference; a bug gets INTERNAL_ERROR) rather
  // than swallowed into one generic message here.
  const table: ReportTableWithAudit = await BUILDERS[kind](resolved.scope, filters);
  const buffer = await renderReport(table, format, { purpose, generatedOn: schoolToday() });

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
      // `purpose` rides with the filters so Re-generate replays it (the
      // history row has no column of its own for it).
      filters: { ...filters, purpose },
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
      // Builder-supplied keys, counts and ids only — for MOSY this is the
      // window it actually resolved, which the request filters do not name.
      // Spread FIRST: a future builder's `auditMeta` must never be able to
      // overwrite the fixed keys below by happening to reuse one of their
      // names.
      ...(table.auditMeta ?? {}),
      kind,
      format,
      purpose,
      rows: table.rows.length,
      // A multi-block report (MOSY) exports more than one table, so the single
      // `rows` count above does not describe what was generated on its own.
      blockRows: reportBlocks(table).map((b) => b.rows.length),
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
  },
  { verb: "generate the report" }
);

/**
 * Authorization: `resolveScope`. Tenancy: scoped to this school AND this
 * author — a teacher cannot remove a colleague's history row — and the
 * generic NOT_FOUND means existence in another tenant (or another author's
 * row) never leaks.
 */
export const deleteReport = action(
  "deleteReport",
  async (input: unknown): Promise<{ ok: true }> => {
  const resolved = await resolveScope();

  const parsed = parseInput(reportIdSchema, input);

  const existing = await prisma.report.findFirst({
    where: {
      id: parsed.id,
      schoolId: resolved.scope.schoolId,
      createdById: resolved.userId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!existing) throw resourceNotFound("Report");

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
  },
  { verb: "delete the report" }
);
