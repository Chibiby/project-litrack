"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  LEARNING_AREA_LABELS,
  LEARNING_AREA_ORDER,
} from "@/lib/constants/enum-labels";
import { nameSearchWhere, sectionIdWhere } from "@/lib/learners/pagination";
import {
  getAdvisoryPlacement,
  NO_ADVISORY_MESSAGE,
  type AdvisoryPlacement,
} from "@/lib/teachers/advisory";
import { deniesAdvisoryRoster } from "@/lib/teachers/scope";
import { generalAverage } from "@/lib/terms/average";
import {
  getTermWindows,
  isTermLocked,
  resolveTermWindow,
} from "@/lib/terms/windows";
import {
  termGradesExportSchema,
  termGradesSaveSchema,
  type TermGradesSaveInput,
} from "@/lib/validators/term-grade.schema";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

type TermGradeEntry = TermGradesSaveInput["entries"][number];

/**
 * Client-facing refusals. Deliberately short and placement-free: they must never
 * reveal whether a learner, grade or section exists in another tenant.
 */
const DEPED_ONLY_MESSAGE =
  "End of Terms Reports is for DepEd teachers who advise a section.";
const NO_SCHOOL_YEAR_MESSAGE =
  "No school year is active. Ask your School Head to activate one before encoding term grades.";
const WRONG_GRADE_MESSAGE = "You are not assigned to this grade level";
const NOT_IN_ADVISORY_MESSAGE =
  "One or more learners are not in your advisory section";

/**
 * The gate every teacher entry point re-derives: they must be a DepEd teacher
 * (not a Non-DepEd ARAL Volunteer) AND currently advise a live section.
 *
 * `isSuperAdmin: false` is correct here because both callers handle the Super
 * Admin before reaching this — save refuses them outright (admin view is
 * read-only) and export takes a separate, school-resolved branch. Routing the
 * decision through `deniesAdvisoryRoster` anyway keeps the one tested predicate
 * as the only place the designation rule lives.
 */
async function requireAdvisoryForTermSheet(user: {
  id: string;
  schoolId: string;
  advisorySectionId: string | null;
}): Promise<{ ok: true; advisory: AdvisoryPlacement } | { ok: false; error: string }> {
  // `findFirst` over `findUnique` so the tenant stays in the where clause even
  // though `userId` is unique — TeacherProfile carries no `schoolId` of its own.
  const profile = await prisma.teacherProfile.findFirst({
    where: { userId: user.id, user: { schoolId: user.schoolId } },
    select: { designation: true },
  });
  if (
    deniesAdvisoryRoster({ isSuperAdmin: false, designation: profile?.designation })
  ) {
    return { ok: false, error: DEPED_ONLY_MESSAGE };
  }

  const advisory = await getAdvisoryPlacement(user);
  if (!advisory) return { ok: false, error: NO_ADVISORY_MESSAGE };

  return { ok: true, advisory };
}

/**
 * Save one term's grade sheet for the caller's advisory section.
 *
 * Takes a parsed object rather than `FormData`: the grid posts a diff of changed
 * cells, which is a nested array. It sends only what the teacher touched, so an
 * untouched sheet writes nothing and the audit counts mean something.
 *
 * A cleared cell arrives as `score: null` and is DELETED rather than nulled —
 * `TermGrade.score` is a non-nullable `Int`, so absence of a row is the only
 * representation of "not encoded".
 */
export async function saveTermGrades(
  input: unknown
): Promise<ActionResult<{ saved: number; cleared: number }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = termGradesSaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // A Super Admin passes every role check by impersonation, and their view of
  // this sheet is read-only. Branch on the role explicitly rather than assuming
  // `requireSchoolUser("TEACHER")` returned an actual teacher.
  if (user.role === "SUPER_ADMIN") {
    return { ok: false, error: "Admin view is read-only" };
  }

  const gate = await requireAdvisoryForTermSheet(user);
  if (!gate.ok) return gate;
  const { advisory } = gate;

  // The client disables the grade picker, but a stale tab can still post the
  // grade it was showing. Refuse rather than quietly writing into another grade.
  if (parsed.data.gradeLevelId !== advisory.gradeLevelId) {
    return { ok: false, error: WRONG_GRADE_MESSAGE };
  }

  // A term enum carries no year, so the row needs one. No active year is a real
  // state the schema permits — refuse instead of writing orphaned rows.
  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId: user.schoolId, isActive: true },
    select: { id: true, startDate: true },
  });
  if (!schoolYear) return { ok: false, error: NO_SCHOOL_YEAR_MESSAGE };

  const window = resolveTermWindow(
    getTermWindows(schoolYear.startDate),
    parsed.data.term
  );
  if (!window) return { ok: false, error: "Invalid input" };

  // Re-derived server-side: the grid disables its inputs once a term closes, but
  // the client is not the enforcement point. `schoolToday()`, never `new Date()`,
  // or every term locks a day early between midnight and 08:00 Manila.
  if (isTermLocked(window, formatLocalDateKey(schoolToday()))) {
    return {
      ok: false,
      error: `${window.label} is closed. Its months have passed, so grades can no longer be changed.`,
    };
  }

  const learnerIds = [...new Set(parsed.data.entries.map((e) => e.learnerId))];
  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      gradeLevelId: advisory.gradeLevelId,
      sectionId: advisory.sectionId,
      deletedAt: null,
      archivedAt: null,
    },
    select: { id: true },
  });
  // Fail closed on the whole batch: a cross-tenant or cross-section id makes the
  // counts disagree, and a partial write would leave the sheet half-saved with no
  // indication of which half.
  if (learners.length !== learnerIds.length) {
    return { ok: false, error: NOT_IN_ADVISORY_MESSAGE };
  }

  const toSave: (TermGradeEntry & { score: number })[] = [];
  const toClear: TermGradeEntry[] = [];
  for (const entry of parsed.data.entries) {
    if (entry.score === null) toClear.push(entry);
    else toSave.push({ ...entry, score: entry.score });
  }

  await prisma.$transaction([
    // Deletions run first so that, in the impossible-but-cheap case of a cell
    // arriving twice, the encoded score wins over the clear.
    ...(toClear.length
      ? [
          prisma.termGrade.deleteMany({
            where: {
              schoolYearId: schoolYear.id,
              term: parsed.data.term,
              OR: toClear.map((e) => ({
                learnerId: e.learnerId,
                subject: e.subject,
              })),
            },
          }),
        ]
      : []),
    ...toSave.map((entry) =>
      prisma.termGrade.upsert({
        where: {
          learnerId_schoolYearId_term_subject: {
            learnerId: entry.learnerId,
            schoolYearId: schoolYear.id,
            term: parsed.data.term,
            subject: entry.subject,
          },
        },
        create: {
          learnerId: entry.learnerId,
          schoolYearId: schoolYear.id,
          term: parsed.data.term,
          subject: entry.subject,
          score: entry.score,
          recordedById: user.id,
        },
        update: {
          score: entry.score,
          recordedById: user.id,
        },
      })
    ),
  ]);

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TERM_GRADES_BULK_SAVE,
    resource: "TermGrade",
    resourceId: advisory.gradeLevelId,
    // Placement, counts and learner ids only. Scores are learner PII and must
    // never reach `AuditLog` — see `docs/privacy.md`.
    metadata: {
      schoolId: user.schoolId,
      gradeLevelId: advisory.gradeLevelId,
      sectionId: advisory.sectionId,
      term: parsed.data.term,
      schoolYearId: schoolYear.id,
      saved: toSave.length,
      cleared: toClear.length,
      learnerIds,
    },
  });

  revalidatePath(`/teacher/aral/${advisory.gradeLevelId}/terms-reports`);
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });

  return { ok: true, data: { saved: toSave.length, cleared: toClear.length } };
}

/** Label for a learning area, tolerant of a key the label map has not got. */
function learningAreaLabel(subject: string): string {
  return (LEARNING_AREA_LABELS as Record<string, string>)[subject] ?? subject;
}

/**
 * Excel export of one term's sheet. Available while a term is locked and to a
 * Super Admin in a school view — viewing and exporting deliberately survive the
 * lock, only encoding stops.
 */
export async function exportTermGrades(
  input: unknown
): Promise<ActionResult<{ filename: string; base64: string }>> {
  // `requireUser`, not `requireSchoolUser`: a Super Admin holds no `schoolId` and
  // would be redirected away from a page they are entitled to read.
  const user = await requireUser("TEACHER");
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  const parsed = termGradesExportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  let schoolId: string;
  let sectionId: string | null;
  let rosterWhere: Prisma.LearnerWhereInput;

  if (isSuperAdmin) {
    // The school is DERIVED from the grade, never posted. A Super Admin is
    // cross-tenant by design, so resolving it this way costs no isolation and
    // keeps a client-supplied `schoolId` out of the payload entirely.
    const grade = await prisma.gradeLevel.findFirst({
      where: { id: parsed.data.gradeLevelId, deletedAt: null },
      select: { id: true, schoolId: true },
    });
    if (!grade) return { ok: false, error: "Not found" };

    schoolId = grade.schoolId;
    const section = parsed.data.section ?? "all";
    // `"none"` is kept verbatim rather than flattened to null, so the audit row
    // distinguishes "the whole grade" from "the learners with no section" —
    // matching how `export-learners.ts` logs its own section filter.
    sectionId = section === "all" ? null : section;
    rosterWhere = {
      schoolId,
      gradeLevelId: grade.id,
      deletedAt: null,
      archivedAt: null,
      ...sectionIdWhere(section),
      ...nameSearchWhere(parsed.data.q ?? ""),
    };
  } else {
    if (!user.schoolId) return { ok: false, error: "Not found" };
    const gate = await requireAdvisoryForTermSheet({
      id: user.id,
      schoolId: user.schoolId,
      advisorySectionId: user.advisorySectionId,
    });
    if (!gate.ok) return gate;
    const { advisory } = gate;

    if (parsed.data.gradeLevelId !== advisory.gradeLevelId) {
      return { ok: false, error: WRONG_GRADE_MESSAGE };
    }

    schoolId = user.schoolId;
    sectionId = advisory.sectionId;
    // The teacher's roster IS their advisory section, so `?section=` is not
    // consulted — it cannot widen or redirect the export.
    rosterWhere = {
      schoolId,
      gradeLevelId: advisory.gradeLevelId,
      sectionId: advisory.sectionId,
      deletedAt: null,
      archivedAt: null,
      ...nameSearchWhere(parsed.data.q ?? ""),
    };
  }

  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId, isActive: true },
    select: { id: true, label: true, startDate: true },
  });
  if (!schoolYear) return { ok: false, error: NO_SCHOOL_YEAR_MESSAGE };

  const window = resolveTermWindow(
    getTermWindows(schoolYear.startDate),
    parsed.data.term
  );
  if (!window) return { ok: false, error: "Invalid input" };

  const [learners, rows] = await Promise.all([
    prisma.learner.findMany({
      where: rosterWhere,
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.termGrade.findMany({
      where: {
        schoolYearId: schoolYear.id,
        term: parsed.data.term,
        // Tenancy rides on the same roster clause the learner query uses, so the
        // two can never disagree about which rows belong to this export.
        learner: rosterWhere,
      },
      select: { learnerId: true, subject: true, score: true },
    }),
  ]);

  const byLearner = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const cells = byLearner.get(row.learnerId) ?? new Map<string, number>();
    cells.set(row.subject, row.score);
    byLearner.set(row.learnerId, cells);
  }

  // Dynamic import keeps exceljs off every other code path in this module.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  const sheet = wb.addWorksheet(window.label);
  sheet.columns = [
    { header: "#", key: "index", width: 6 },
    { header: "Complete Name", key: "fullName", width: 30 },
    ...LEARNING_AREA_ORDER.map((subject) => ({
      header: learningAreaLabel(subject),
      key: subject,
      width: 16,
    })),
    { header: "General Average", key: "average", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  learners.forEach((learner, index) => {
    const cells = byLearner.get(learner.id);
    const scores = LEARNING_AREA_ORDER.map(
      (subject) => cells?.get(subject) ?? null
    );
    const row: Record<string, string | number> = {
      index: index + 1,
      fullName: learner.fullName,
    };
    LEARNING_AREA_ORDER.forEach((subject, i) => {
      row[subject] = scores[i] ?? "";
    });
    row.average = generalAverage(scores) ?? "";
    sheet.addRow(row);
  });

  const meta = wb.addWorksheet("Export info");
  meta.addRow(["School year", schoolYear.label]);
  meta.addRow(["Term", window.label]);
  meta.addRow(["Months", window.rangeLabel]);
  meta.addRow(["Learner count", learners.length]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  // Local date key, not `toISOString().slice(0, 10)` — the latter names the file
  // for yesterday between midnight and 08:00 Manila.
  const filename = `litrack-term-grades-${parsed.data.term.toLowerCase()}-${formatLocalDateKey(
    schoolToday()
  )}.xlsx`;

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.TERM_GRADES_EXPORT,
    resource: "TermGrade",
    resourceId: parsed.data.gradeLevelId,
    // Counts only. The exported scores themselves stay out of `AuditLog`.
    metadata: {
      schoolId,
      gradeLevelId: parsed.data.gradeLevelId,
      sectionId,
      term: parsed.data.term,
      schoolYearId: schoolYear.id,
      learnerCount: learners.length,
      cellCount: rows.length,
      role: user.role,
    },
  });

  return { ok: true, data: { filename, base64: buffer.toString("base64") } };
}
