"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma, type TermMark } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { classifyError } from "@/lib/errors/classify";
import { reportError } from "@/lib/errors/report";
import { BULK_CHUNK_ROWS, BULK_TX_OPTIONS, chunkRows } from "@/lib/db/bulk-write";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getSheetSubjects, healLegacyTermGrades } from "@/lib/terms/subjects-db";
import { nameSearchWhere, sectionIdWhere } from "@/lib/learners/pagination";
import {
  getAdvisoryPlacements,
  resolveAdvisoryTarget,
  type AdvisoryPlacement,
} from "@/lib/teachers/advisory";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import {
  rowGeneralAverage,
  termCellText,
  termGradingScale,
  type TermCell,
} from "@/lib/terms/grading-scale";
import { canWriteWindow } from "@/lib/unlock/grants";
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
// A floating teacher IS a DepEd teacher, so the message above would be wrong
// about them, and would send them to the wrong person to fix it.
const FLOATING_MESSAGE =
  "Floating teachers do not advise a section, so there is no end-of-term sheet. Your School Head can change this.";
const NO_SCHOOL_YEAR_MESSAGE =
  "No school year is active. Ask your School Head to activate one before encoding term grades.";
const WRONG_GRADE_MESSAGE = "You are not assigned to this grade level";
const NOT_IN_ADVISORY_MESSAGE =
  "One or more learners are not in your advisory section";
const STALE_SUBJECTS_MESSAGE =
  "One or more subjects are no longer on this sheet. Reload the page.";
const LETTER_SCALE_MESSAGE = "Grade 1 grades are now letter marks. Reload the page.";
const NUMERIC_SCALE_MESSAGE = "This grade uses number grades. Reload the page.";

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
async function requireAdvisoryForTermSheet(
  user: { id: string; schoolId: string },
  /**
   * Which advisory this sheet is for. Optional, because a teacher with exactly
   * one — every teacher, until a School Head adds a second — needs to name
   * nothing and behaves as they always did.
   */
  sectionId?: string | null
): Promise<{ ok: true; advisory: AdvisoryPlacement } | { ok: false; error: string }> {
  // `findFirst` over `findUnique` so the tenant stays in the where clause even
  // though `userId` is unique — TeacherProfile carries no `schoolId` of its own.
  const profile = await prisma.teacherProfile.findFirst({
    where: { userId: user.id, user: { schoolId: user.schoolId } },
    select: { designation: true, advisoryMode: true },
  });
  const denial = advisoryRosterDenial({
    isSuperAdmin: false,
    designation: profile?.designation,
    advisoryMode: profile?.advisoryMode,
  });
  if (denial) {
    return {
      ok: false,
      error: denial === "floating" ? FLOATING_MESSAGE : DEPED_ONLY_MESSAGE,
    };
  }

  const placements = await getAdvisoryPlacements(user);
  const target = resolveAdvisoryTarget(placements, sectionId);
  if (!target.ok) return { ok: false, error: target.error };

  return { ok: true, advisory: target.placement };
}

/**
 * Save one term's grade sheet for the caller's advisory section.
 *
 * Takes a parsed object rather than `FormData`: the grid posts a diff of changed
 * cells, which is a nested array. It sends only what the teacher touched, so an
 * untouched sheet writes nothing and the audit counts mean something.
 *
 * A cell carries a numeric `score` or, for a LETTER-scale grade (Grade 1), a
 * `mark`. A cleared cell arrives with neither set and is DELETED rather than
 * nulled — a stored row holds exactly one of the two (SQL CHECK
 * "TermGrade_score_xor_mark"), so absence of a row is the only representation
 * of "not encoded".
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

  const gate = await requireAdvisoryForTermSheet(user, parsed.data.sectionId);
  if (!gate.ok) return gate;
  const { advisory } = gate;

  // The client disables the grade picker, but a stale tab can still post the
  // grade it was showing. Refuse rather than quietly writing into another grade.
  if (parsed.data.gradeLevelId !== advisory.gradeLevelId) {
    return { ok: false, error: WRONG_GRADE_MESSAGE };
  }

  // The scale comes from the placement the gate resolved, never the payload. A
  // tab loaded before Grade 1 switched to letters (or a hand-built post) can
  // send the wrong kind of cell; refuse the whole batch before any write so
  // the sheet is never half letters, half numbers.
  const scale = termGradingScale(advisory.gradeType);
  const wrongKind = parsed.data.entries.some((e) =>
    scale === "LETTER" ? e.score != null : e.mark != null
  );
  if (wrongKind) {
    return {
      ok: false,
      error: scale === "LETTER" ? LETTER_SCALE_MESSAGE : NUMERIC_SCALE_MESSAGE,
    };
  }

  // A term enum carries no year, so the row needs one. No active year is a real
  // state the schema permits — refuse instead of writing orphaned rows.
  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId: user.schoolId, isActive: true },
    select: {
      id: true,
      startDate: true,
      termWindowOverrides: {
        select: {
          term: true,
          startKey: true,
          endKey: true,
          deadlineKey: true,
        },
      },
    },
  });
  if (!schoolYear) return { ok: false, error: NO_SCHOOL_YEAR_MESSAGE };

  const window = resolveTermWindow(
    getTermWindows(schoolYear.startDate, schoolYear.termWindowOverrides),
    parsed.data.term
  );
  if (!window) return { ok: false, error: "Invalid input" };

  // Re-derived server-side: the grid disables its inputs once a term closes, but
  // the client is not the enforcement point. `schoolToday()`, never `new Date()`,
  // or every term locks a day early between midnight and 08:00 Manila.
  //
  // Once the date says the term is closed, `canWriteWindow` decides: submission
  // locking switched off programme-wide reopens every term, and a live
  // `UnlockGrant` naming this term reopens it for this teacher alone. Consulted
  // only after the date test, so an in-window save still costs no extra query.
  let usedGrantId: string | null = null;
  let usedGrantKind: "user" | "school" | null = null;
  if (isTermLocked(window, formatLocalDateKey(schoolToday()))) {
    const verdict = await canWriteWindow({
      userId: user.id,
      schoolId: user.schoolId,
      scope: "TERM_GRADES",
      targetKey: parsed.data.term,
    });
    if (!verdict.writable) {
      return {
        ok: false,
        error: `${window.label} is closed. Its months have passed, so grades can no longer be changed.`,
      };
    }
    // Null when locking is off; see the same note in `saveAralWeeklyAttendance`.
    usedGrantId = verdict.grantId;
    usedGrantKind = verdict.grantKind;
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

  // Every posted subject must be live on THIS grade's sheet in THIS school. Fail
  // the whole batch — same reasoning as the roster check above. The raw write
  // re-checks inside the statement, which catches an archive mid-save.
  const sheetSubjects = await getSheetSubjects(prisma, {
    schoolId: user.schoolId,
    gradeLevelId: advisory.gradeLevelId,
  });
  const sheetSubjectIds = new Set(sheetSubjects.map((s) => s.id));
  if (parsed.data.entries.some((e) => !sheetSubjectIds.has(e.termSubjectId))) {
    return { ok: false, error: STALE_SUBJECTS_MESSAGE };
  }

  // Split, then dedupe WITHIN each side on the conflict tuple. Deduping across
  // the combined `entries` array would let a clear win over an encoded score and
  // invert the deliberate ordering decision below.
  // A cell is a clear when NEITHER value is set; the schema already refused
  // both. Normalized to explicit nulls so the raw write below binds a typed
  // NULL for the value the cell does not carry.
  const saveByTuple = new Map<
    string,
    TermGradeEntry & { score: number | null; mark: TermMark | null }
  >();
  const clearByTuple = new Map<string, TermGradeEntry>();
  for (const entry of parsed.data.entries) {
    const tuple = `${entry.learnerId}:${schoolYear.id}:${parsed.data.term}:${entry.termSubjectId}`;
    const score = entry.score ?? null;
    const mark = entry.mark ?? null;
    if (score === null && mark === null) clearByTuple.set(tuple, entry);
    else saveByTuple.set(tuple, { ...entry, score, mark });
  }
  const toSave = [...saveByTuple.values()];
  const toClear = [...clearByTuple.values()];

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // Adopt scores the pre-TermSubject build saved after M1 (termSubjectId
      // NULL) BEFORE touching the sheet, so the clear below can reach them and
      // the upsert conflicts on the termSubjectId unique instead of inserting a
      // second row. No-op after M2; removed with M3.
      await healLegacyTermGrades(tx, {
        schoolId: user.schoolId,
        gradeLevelId: advisory.gradeLevelId,
        schoolYearId: schoolYear.id,
      });

      // Deletions run first so that, in the impossible-but-cheap case of a cell
      // arriving twice, the encoded score wins over the clear. Already one
      // set-based statement, so it is left as Prisma rather than rewritten.
      if (toClear.length > 0) {
        await tx.termGrade.deleteMany({
          where: {
            schoolYearId: schoolYear.id,
            term: parsed.data.term,
            OR: toClear.map((e) => ({
              learnerId: e.learnerId,
              termSubjectId: e.termSubjectId,
            })),
            // Only this grade's active subjects: a clear can never reach a score
            // stored under another grade's subject or an archived one.
            termSubject: { gradeLevelId: advisory.gradeLevelId, deletedAt: null },
          },
        });
      }

      for (const chunk of chunkRows(toSave, BULK_CHUNK_ROWS)) {
        // `id` and `updatedAt` are supplied explicitly: Prisma's `@default(uuid())`
        // and `@updatedAt` are CLIENT-side and neither column has a database
        // default. `updatedAt` is bumped in DO UPDATE as well — leaving it out
        // there freezes the column at first-insert time with no error at all.
        const values = Prisma.join(
          chunk.map(
            (e) => Prisma.sql`(
              ${randomUUID()}::text,
              ${e.learnerId}::text,
              ${schoolYear.id}::text,
              ${parsed.data.term}::text::"TermPeriod",
              ${e.termSubjectId}::text,
              ${e.score}::integer,
              ${e.mark}::text::"TermMark",
              ${user.id}::text,
              ${now}::timestamp(3)
            )`
          )
        );

        // The tenant predicate is inside the statement. `TermGrade` carries no
        // `schoolId` of its own, so without this join the roster `findMany` above
        // would be the entire tenant boundary for a raw write. The `RETURNING`
        // count check below turns any excluded row into a rollback rather than a
        // partial commit.
        //
        // `subject` mirrors the TermSubject's `legacyArea` (NULL for a custom
        // subject) so the previous build's client, which declares `subject`
        // non-null, can still read these rows during a rollout or revert, and
        // the old subject unique keeps meaning something until M2 drops it.
        // It falls back to NULL only when ANOTHER row already holds this
        // (learner, year, term, subject) under a different termSubjectId — a
        // learner who moved grades mid-term, or a legacy row the heal had to
        // skip — because writing the area there would violate
        // "TermGrade_learnerId_schoolYearId_term_subject_key", which
        // ON CONFLICT on the termSubjectId unique does not arbitrate.
        const written = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "TermGrade" (
            "id", "learnerId", "schoolYearId", "term", "termSubjectId", "subject",
            "score", "mark", "recordedById", "updatedAt"
          )
          SELECT v."id", v."learnerId", v."schoolYearId", v."term", v."termSubjectId",
                 CASE WHEN EXISTS (
                   SELECT 1 FROM "TermGrade" o
                   WHERE o."learnerId" = v."learnerId"
                     AND o."schoolYearId" = v."schoolYearId"
                     AND o."term" = v."term"
                     AND o."subject" = ts."legacyArea"
                     AND o."termSubjectId" IS DISTINCT FROM v."termSubjectId"
                 ) THEN NULL ELSE ts."legacyArea" END,
                 v."score", v."mark", v."recordedById", v."updatedAt"
          FROM (VALUES ${values}) AS v (
            "id", "learnerId", "schoolYearId", "term", "termSubjectId", "score",
            "mark", "recordedById", "updatedAt"
          )
          JOIN "Learner" l
            ON l."id" = v."learnerId"
           AND l."schoolId" = ${user.schoolId}
           AND l."gradeLevelId" = ${advisory.gradeLevelId}
           AND l."sectionId" = ${advisory.sectionId}
           AND l."deletedAt" IS NULL
           AND l."archivedAt" IS NULL
          JOIN "TermSubject" ts
            ON ts."id" = v."termSubjectId"
           AND ts."schoolId" = ${user.schoolId}
           AND ts."gradeLevelId" = ${advisory.gradeLevelId}
           AND ts."deletedAt" IS NULL
          ON CONFLICT ("learnerId", "schoolYearId", "term", "termSubjectId") DO UPDATE SET
            "score" = EXCLUDED."score",
            -- Both columns always move together: saving a letter over a Grade 1
            -- cell that still holds a legacy number sets the mark and NULLs the
            -- score in this one statement, so the xor CHECK holds.
            "mark" = EXCLUDED."mark",
            -- Non-null EXCLUDED means no other row holds this area (checked
            -- above), so taking it is safe; NULL keeps what the row had.
            "subject" = COALESCE(EXCLUDED."subject", "TermGrade"."subject"),
            "recordedById" = EXCLUDED."recordedById",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING "id"
        `;
        if (written.length !== chunk.length) {
          throw new Error(
            `term-grades bulk write touched ${written.length} of ${chunk.length} rows`
          );
        }
      }
    }, BULK_TX_OPTIONS);
  } catch (err) {
    console.error("[saveTermGrades] transaction failed:", err);
    return { ok: false, error: "Could not save the grade sheet. Please try again." };
  }

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
      grantKind: usedGrantKind,
    },
  });

  // Only when the save got in through a grant — a closed term that was written
  // to is exactly what an auditor comes looking for.
  //
  // Which action and resource depends on WHICH table the grant came from — a
  // school-wide grant is a `SchoolUnlockGrant` row, and joining its id against
  // `UnlockGrant` finds nothing. `grantKind` also rides in `metadata` so the
  // save row and this row agree on which table answered "may this person write".
  if (usedGrantId) {
    const isSchoolGrant = usedGrantKind === "school";
    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: isSchoolGrant
        ? AUDIT_ACTIONS.UNLOCK_SCHOOL_GRANT_USED
        : AUDIT_ACTIONS.UNLOCK_GRANT_USED,
      resource: isSchoolGrant ? "SchoolUnlockGrant" : "UnlockGrant",
      resourceId: usedGrantId,
      metadata: {
        scope: "TERM_GRADES",
        targetKey: parsed.data.term,
        gradeLevelId: advisory.gradeLevelId,
        sectionId: advisory.sectionId,
        saved: toSave.length,
        cleared: toClear.length,
        grantKind: usedGrantKind,
      },
    });
  }

  revalidatePath(`/teacher/aral/${advisory.gradeLevelId}/terms-reports`);
  revalidatePath("/teacher/terms-reports");
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });

  return { ok: true, data: { saved: toSave.length, cleared: toClear.length } };
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
  /**
   * One worksheet each. A Super Admin and a single-sheet teacher export build
   * one; a teacher's All Advisories export builds one per section.
   */
  const targets: {
    gradeLevelId: string;
    /** Raw `GradeLevelType`: picks the grading scale for the worksheet. */
    gradeType: string;
    sectionId: string | null;
    label: string;
    rosterWhere: Prisma.LearnerWhereInput;
  }[] = [];

  if (isSuperAdmin) {
    if (!parsed.data.gradeLevelId) return { ok: false, error: "Invalid input" };
    // The school is DERIVED from the grade, never posted. A Super Admin is
    // cross-tenant by design, so resolving it this way costs no isolation and
    // keeps a client-supplied `schoolId` out of the payload entirely.
    const grade = await prisma.gradeLevel.findFirst({
      where: { id: parsed.data.gradeLevelId, deletedAt: null },
      select: { id: true, schoolId: true, type: true },
    });
    if (!grade) return { ok: false, error: "Not found" };

    schoolId = grade.schoolId;
    const section = parsed.data.section ?? "all";
    // `"none"` is kept verbatim rather than flattened to null, so the audit row
    // distinguishes "the whole grade" from "the learners with no section" —
    // matching how `export-learners.ts` logs its own section filter.
    targets.push({
      gradeLevelId: grade.id,
      gradeType: grade.type,
      sectionId: section === "all" ? null : section,
      label: "",
      rosterWhere: {
        schoolId,
        gradeLevelId: grade.id,
        deletedAt: null,
        archivedAt: null,
        ...sectionIdWhere(section),
        ...nameSearchWhere(parsed.data.q ?? ""),
      },
    });
  } else {
    if (!user.schoolId) return { ok: false, error: "Not found" };
    const teacherSchoolId = user.schoolId;
    schoolId = teacherSchoolId;
    // Without `sectionIds` this is the single sheet it always was: the gate
    // resolves the one advisory, and the posted grade must match it.
    const requested: (string | undefined)[] = parsed.data.sectionIds
      ? [...new Set(parsed.data.sectionIds)]
      : [undefined];
    for (const requestedSectionId of requested) {
      const gate = await requireAdvisoryForTermSheet(
        { id: user.id, schoolId: teacherSchoolId },
        requestedSectionId
      );
      if (!gate.ok) return gate;
      const { advisory } = gate;

      if (!parsed.data.sectionIds && parsed.data.gradeLevelId !== advisory.gradeLevelId) {
        return { ok: false, error: WRONG_GRADE_MESSAGE };
      }

      // The teacher's roster IS their advisory section, so `?section=` is not
      // consulted — it cannot widen or redirect the export.
      targets.push({
        gradeLevelId: advisory.gradeLevelId,
        gradeType: advisory.gradeType,
        sectionId: advisory.sectionId,
        label: advisory.label,
        rosterWhere: {
          schoolId: teacherSchoolId,
          gradeLevelId: advisory.gradeLevelId,
          sectionId: advisory.sectionId,
          deletedAt: null,
          archivedAt: null,
          ...nameSearchWhere(parsed.data.q ?? ""),
        },
      });
    }
  }

  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId, isActive: true },
    select: {
      id: true,
      label: true,
      startDate: true,
      termWindowOverrides: {
        select: {
          term: true,
          startKey: true,
          endKey: true,
          deadlineKey: true,
        },
      },
    },
  });
  if (!schoolYear) return { ok: false, error: NO_SCHOOL_YEAR_MESSAGE };

  const window = resolveTermWindow(
    getTermWindows(schoolYear.startDate, schoolYear.termWindowOverrides),
    parsed.data.term
  );
  if (!window) return { ok: false, error: "Invalid input" };

  // Prefixed so a subject id can never collide with a fixed column key.
  const columnKey = (id: string) => `subject:${id}`;

  // Dynamic import keeps exceljs off every other code path in this module.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  // Sheet names: the term for a single sheet, as it always was; the section
  // label for each sheet of an All Advisories export. Excel refuses names over
  // 31 characters or holding any of : \ / ? * [ ].
  const sheetName = (label: string, index: number) =>
    targets.length === 1
      ? window.label
      : (label.replace(/[:\\/?*[\]]/g, "-").slice(0, 28) || `Section ${index + 1}`);

  let learnerCount = 0;
  let cellCount = 0;
  for (const [index, target] of targets.entries()) {
    // Every branch above verified `gradeLevelId` belongs to `schoolId`. Seeded
    // BEFORE the grade read so the id filter below is the sheet's real column set.
    const subjects = await getSheetSubjects(prisma, {
      schoolId,
      gradeLevelId: target.gradeLevelId,
    });
    const subjectIds = subjects.map((s) => s.id);
    // Same pre-M2 adoption as the save path, so a score the previous build saved
    // is in the workbook. No-op after M2; removed with M3.
    //
    // Best-effort: export is a read. A failed UPDATE here must not turn a sheet
    // that only needed exporting into an error — log it for an admin and export
    // whatever is already pointed at a TermSubject. The save path's heal call
    // stays fatal (it runs inside `saveTermGrades`'s transaction): a save that
    // silently skipped adopting a legacy row could insert a second one instead.
    try {
      await healLegacyTermGrades(prisma, {
        schoolId,
        gradeLevelId: target.gradeLevelId,
        schoolYearId: schoolYear.id,
      });
    } catch (err) {
      reportError(classifyError(err, { verb: "adopt legacy term grades before export" }), {
        route: "exportTermGrades",
        userId: user.id,
        schoolId,
      });
    }

    const [learners, rows] = await Promise.all([
      prisma.learner.findMany({
        where: target.rosterWhere,
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }),
      prisma.termGrade.findMany({
        where: {
          schoolYearId: schoolYear.id,
          term: parsed.data.term,
          // Active subjects of this grade only: archived columns, and scores kept
          // from a grade the learner moved out of, stay out of the workbook.
          termSubjectId: { in: subjectIds },
          // Tenancy rides on the same roster clause the learner query uses, so the
          // two can never disagree about which rows belong to this export.
          learner: target.rosterWhere,
        },
        select: { learnerId: true, termSubjectId: true, score: true, mark: true },
      }),
    ]);
    learnerCount += learners.length;
    cellCount += rows.length;

    const byLearner = new Map<string, Map<string, TermCell>>();
    for (const row of rows) {
      if (!row.termSubjectId) continue;
      const cells = byLearner.get(row.learnerId) ?? new Map<string, TermCell>();
      cells.set(row.termSubjectId, { score: row.score, mark: row.mark ?? null });
      byLearner.set(row.learnerId, cells);
    }

    // A LETTER-scale grade (Grade 1) has no General Average, so its worksheet
    // drops the column rather than leaving it blank.
    const isLetterScale = termGradingScale(target.gradeType) === "LETTER";
    const sheet = wb.addWorksheet(sheetName(target.label, index));
    sheet.columns = [
      { header: "#", key: "index", width: 6 },
      { header: "Complete Name", key: "fullName", width: 30 },
      ...subjects.map((subject) => ({
        header: subject.name,
        key: columnKey(subject.id),
        width: 16,
      })),
      ...(isLetterScale ? [] : [{ header: "General Average", key: "average", width: 18 }]),
    ];
    sheet.getRow(1).font = { bold: true };

    learners.forEach((learner, index) => {
      const cells = byLearner.get(learner.id);
      const rowCells = subjects.map((subject) => cells?.get(subject.id) ?? null);
      const row: Record<string, string | number> = {
        index: index + 1,
        fullName: learner.fullName,
      };
      subjects.forEach((subject, i) => {
        const cell = rowCells[i];
        // A score stays a number cell, exactly as before; a mark is its label.
        row[columnKey(subject.id)] = !cell
          ? ""
          : cell.mark
            ? termCellText(cell)
            : (cell.score ?? "");
      });
      if (!isLetterScale) {
        row.average = rowGeneralAverage(target.gradeType, rowCells) ?? "";
      }
      sheet.addRow(row);
    });
  }

  const meta = wb.addWorksheet("Export info");
  meta.addRow(["School year", schoolYear.label]);
  meta.addRow(["Term", window.label]);
  meta.addRow(["Months", window.rangeLabel]);
  meta.addRow(["Learner count", learnerCount]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  // Local date key, not `toISOString().slice(0, 10)` — the latter names the file
  // for yesterday between midnight and 08:00 Manila.
  const filename = `litrack-term-grades-${parsed.data.term.toLowerCase()}-${formatLocalDateKey(
    schoolToday()
  )}.xlsx`;

  const single = targets.length === 1 ? targets[0] : null;
  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.TERM_GRADES_EXPORT,
    resource: "TermGrade",
    resourceId: single ? single.gradeLevelId : (targets[0]?.gradeLevelId ?? null),
    // Counts only. The exported scores themselves stay out of `AuditLog`.
    metadata: {
      schoolId,
      gradeLevelId: single ? single.gradeLevelId : null,
      sectionId: single ? single.sectionId : null,
      ...(single ? {} : { sectionIds: targets.map((t) => t.sectionId) }),
      term: parsed.data.term,
      schoolYearId: schoolYear.id,
      learnerCount,
      cellCount,
      role: user.role,
    },
  });

  return { ok: true, data: { filename, base64: buffer.toString("base64") } };
}
