"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  getAdvisoryPlacements,
  resolveAdvisoryTarget,
  type AdvisoryPlacement,
} from "@/lib/teachers/advisory";
import { splitByKinderGradeType } from "@/lib/terms/kinder-checklist-view";
import {
  KINDER_COMPETENCY_ENTRIES_IN_ORDER,
  KINDER_COMPETENCY_RATING_LABELS,
  isKinderCompetencyKey,
  isKinderGradeType,
} from "@/lib/terms/kinder-competencies";
import { canWriteWindow } from "@/lib/unlock/grants";
import {
  getTermWindows,
  isTermLocked,
  resolveTermWindow,
  type TermPeriodValue,
} from "@/lib/terms/windows";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  kinderCompetencyExportSchema,
  kinderCompetencySaveSchema,
} from "@/lib/validators/kinder-competency.schema";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  loadReportFooter,
  loadReportHeader,
  writeSheetFooter,
  writeSheetHeader,
} from "@/lib/reports/sheet-header";

/**
 * Server actions for the Kindergarten End-of-Term competency checklist — see
 * docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md sections
 * 6 and 8.
 *
 * New code, so it uses the house `action()` wrapper (throw `AppError`, never
 * hand-roll `{ ok: false, error }`) rather than copying `term-grades.ts`'s
 * legacy try/catch shape.
 *
 * DEVIATION FROM THE SPEC'S SCOPE REUSE: the term-window lock below passes
 * `scope: "TERM_GRADES"` to `canWriteWindow`. The Prisma `UnlockScope` enum
 * (owned by database-engineer, not touched here) has no Kindergarten-specific
 * member, and `KinderCompetencyRecord` shares the exact same `TermWindow`
 * concept `TermGrade` uses (same school year, same three-term calendar). The
 * spec does not name a scope explicitly, so this reuses `TERM_GRADES` rather
 * than requesting a schema change for a value that would behave identically.
 * If the owner wants the two audited/unlockable separately, that needs a new
 * `UnlockScope` enum member from database-engineer — flagged in the report,
 * not decided here.
 */

type SaveResult = { ok: true; data: { saved: number } };
type ExportResult = { ok: true; data: { filename: string; base64: string } };

/**
 * Which of the teacher's KINDER advisories this save/export belongs to.
 * Mirrors `requireAdvisoryForTermSheet` in `term-grades.ts`, narrowed to the
 * Kinder subset per spec section 4 — never falls back to "the first
 * placement" when a teacher holds more than one Kinder section.
 */
async function requireKinderAdvisory(
  user: { id: string; schoolId: string },
  sectionId?: string | null
): Promise<AdvisoryPlacement> {
  const placements = await getAdvisoryPlacements(user);
  const { kinder } = splitByKinderGradeType(placements);
  const target = resolveAdvisoryTarget(kinder, sectionId);
  if (!target.ok) {
    throw new AppError("VALIDATION_FAILED", { params: { message: target.error } });
  }
  return target.placement;
}

/**
 * Save one learner's touched competency rows.
 *
 * Diffs at the (learner x competency) row grain the table is keyed on — see
 * the schema's own doc comment. `undefined` on a field means "not touched,
 * leave the stored value alone"; `null` clears it; a value sets it, which
 * maps directly onto Prisma's own `update` input semantics.
 *
 * Term-window lock is evaluated PER TOUCHED TERM COLUMN, not once for the
 * whole request: all three columns are editable in one save, so a batch that
 * touches a closed term fails as a whole and names which term(s) were
 * rejected — same fail-closed-on-the-whole-batch rule `saveTermGrades` uses
 * for a cross-tenant id, extended from "the request's one term" to "any
 * locked column touched".
 *
 * Tenancy: the learner load is the boundary. `prisma.learner.findFirst`
 * filtered by `schoolId` AND the resolved advisory's `sectionId`,
 * `deletedAt`/`archivedAt` null; a miss is a generic not-found. No
 * `gradeLevelId`: a section belongs to one school and one grade, and the
 * learner's denormalized grade pointer can drift from it.
 */
export const saveKinderCompetencies = action(
  "saveKinderCompetencies",
  async (input: unknown): Promise<SaveResult> => {
    const user = await requireSchoolUser("TEACHER");

    // A Super Admin passes every role check by impersonation. `requireSchoolUser`
    // already redirects a schoolId-less Super Admin away before this line, but
    // the explicit branch is kept for the same reason `saveTermGrades` keeps
    // its own — never assume a role check returned an actual teacher.
    if (user.role === "SUPER_ADMIN") {
      throw new AppError("AUTH_FORBIDDEN", { params: { what: "saving this checklist" } });
    }

    const parsed = parseInput(kinderCompetencySaveSchema, input);

    for (const entry of parsed.entries) {
      if (!isKinderCompetencyKey(entry.competencyKey)) {
        throw new AppError("VALIDATION_FAILED", {
          params: { message: "One or more competencies are no longer on this checklist. Reload the page." },
        });
      }
    }

    const advisory = await requireKinderAdvisory(user, parsed.advisorySectionId);

    const schoolYear = await prisma.schoolYear.findFirst({
      where: { schoolId: user.schoolId, isActive: true },
      select: {
        id: true,
        startDate: true,
        termWindowOverrides: {
          select: { term: true, startKey: true, endKey: true, deadlineKey: true },
        },
      },
    });
    if (!schoolYear) {
      throw new AppError("VALIDATION_FAILED", {
        params: {
          message:
            "No school year is active. Ask your School Head to activate one before encoding the checklist.",
        },
      });
    }

    const windows = getTermWindows(schoolYear.startDate, schoolYear.termWindowOverrides);
    const todayKey = formatLocalDateKey(schoolToday());

    const touchedTerms = new Set<TermPeriodValue>();
    for (const entry of parsed.entries) {
      if (entry.t1Rating !== undefined) touchedTerms.add("FIRST");
      if (entry.t2Rating !== undefined) touchedTerms.add("SECOND");
      if (entry.t3Rating !== undefined) touchedTerms.add("THIRD");
    }

    // The remark is one field shared by all three terms, so no single term's
    // window owns it. It closes only when EVERY term has closed: while any one
    // term is still open — or reopened by an unlock grant — the remark is part
    // of an assessment that can still change. `KinderChecklistRow` disables the
    // field on the same condition, so render and save agree.
    const touchesRemark = parsed.entries.some((entry) => entry.remark !== undefined);

    const ALL_TERMS = ["FIRST", "SECOND", "THIRD"] as const;
    const termsToResolve = touchesRemark ? new Set<TermPeriodValue>(ALL_TERMS) : touchedTerms;

    /** Per term: whether this teacher may write it right now, and why. */
    const writable = new Map<TermPeriodValue, boolean>();
    const lockedLabels: string[] = [];
    let usedGrantId: string | null = null;
    let usedGrantKind: "user" | "school" | null = null;
    for (const term of termsToResolve) {
      const window = resolveTermWindow(windows, term);
      if (!window) continue;
      if (!isTermLocked(window, todayKey)) {
        writable.set(term, true);
        continue;
      }

      const verdict = await canWriteWindow({
        userId: user.id,
        schoolId: user.schoolId,
        scope: "TERM_GRADES",
        targetKey: term,
      });
      if (!verdict.writable) {
        writable.set(term, false);
        // Only a term the save actually writes a rating into refuses the save.
        // A closed term the caller did not touch is just context for the
        // remark rule below.
        if (touchedTerms.has(term)) lockedLabels.push(window.label);
        continue;
      }
      writable.set(term, true);
      // First grant found is what the audit row attributes the save to — same
      // "personal grant wins" rule `canWriteWindow` itself already applies per
      // term; across terms, the first touched-and-locked term's grant is as
      // good an attribution as any other.
      if (usedGrantId === null) {
        usedGrantId = verdict.grantId;
        usedGrantKind = verdict.grantKind;
      }
    }
    if (lockedLabels.length > 0) {
      const verb = lockedLabels.length === 1 ? "is" : "are";
      throw new AppError("VALIDATION_FAILED", {
        params: {
          message: `${lockedLabels.join(", ")} ${verb} closed. Its months have passed, so the checklist can no longer be changed for that term.`,
        },
      });
    }
    if (touchesRemark && ALL_TERMS.every((term) => writable.get(term) === false)) {
      throw new AppError("VALIDATION_FAILED", {
        params: {
          message:
            "Every term is closed, so remarks can no longer be changed. Ask your School Head to reopen a term if something needs correcting.",
        },
      });
    }

    // Deliberately NOT gated on `gradeLevelId`: it is a denormalized pointer
    // on `Learner` that can drift from the section's own grade (CLAUDE.md). A
    // section belongs to exactly one school (`Section.schoolId`), so
    // `schoolId` + `sectionId` is already a complete tenancy boundary — this
    // matches the identity `/teacher/learners` uses to list the same roster.
    const learner = await prisma.learner.findFirst({
      where: {
        id: parsed.learnerId,
        schoolId: user.schoolId,
        sectionId: advisory.sectionId,
        deletedAt: null,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!learner) throw resourceNotFound("Learner");

    const now = new Date();
    await prisma.$transaction(
      parsed.entries.map((entry) =>
        prisma.kinderCompetencyRecord.upsert({
          where: {
            learnerId_schoolYearId_competencyKey: {
              learnerId: learner.id,
              schoolYearId: schoolYear.id,
              competencyKey: entry.competencyKey,
            },
          },
          create: {
            learnerId: learner.id,
            schoolYearId: schoolYear.id,
            competencyKey: entry.competencyKey,
            t1Rating: entry.t1Rating ?? null,
            t2Rating: entry.t2Rating ?? null,
            t3Rating: entry.t3Rating ?? null,
            remark: entry.remark ?? null,
            recordedById: user.id,
          },
          update: {
            ...(entry.t1Rating !== undefined ? { t1Rating: entry.t1Rating } : {}),
            ...(entry.t2Rating !== undefined ? { t2Rating: entry.t2Rating } : {}),
            ...(entry.t3Rating !== undefined ? { t3Rating: entry.t3Rating } : {}),
            ...(entry.remark !== undefined ? { remark: entry.remark } : {}),
            recordedById: user.id,
            updatedAt: now,
          },
        })
      )
    );

    const savedByTerm = {
      t1: parsed.entries.filter((e) => e.t1Rating !== undefined).length,
      t2: parsed.entries.filter((e) => e.t2Rating !== undefined).length,
      t3: parsed.entries.filter((e) => e.t3Rating !== undefined).length,
    };

    // Ids, keys and counts only — never the ratings or the remark text
    // (docs/privacy.md).
    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.KINDER_COMPETENCY_BULK_SAVE,
      resource: "KinderCompetencyRecord",
      resourceId: learner.id,
      metadata: {
        schoolId: user.schoolId,
        gradeLevelId: advisory.gradeLevelId,
        sectionId: advisory.sectionId,
        learnerId: learner.id,
        schoolYearId: schoolYear.id,
        competencyKeys: parsed.entries.map((e) => e.competencyKey),
        savedByTerm,
        grantKind: usedGrantKind,
      },
    });

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
          gradeLevelId: advisory.gradeLevelId,
          sectionId: advisory.sectionId,
          learnerId: learner.id,
          grantKind: usedGrantKind,
        },
      });
    }

    // One path covers every learner: the query-param learner selection means
    // there is nothing per-learner to revalidate.
    revalidatePath("/teacher/terms-reports/kinder");

    return { ok: true, data: { saved: parsed.entries.length } };
  },
  { verb: "save the checklist" }
);

/**
 * Excel export of one learner's checklist. `requireUser`, not
 * `requireSchoolUser`: a Super Admin holds no `schoolId` and would be
 * redirected away from a page they are entitled to read, same reasoning as
 * `exportTermGrades`.
 *
 * Three admitted roles, same shape `exportTermGrades` uses for its two:
 * `requireUser` lists the non-admin roles, and Super Admin (which passes
 * every role check by impersonation) is branched on explicitly rather than
 * assumed. TEACHER stays advisory-scoped (unchanged). SCHOOL_HEAD is new:
 * scoped to `user.schoolId` only (never a client-supplied value), with no
 * grade/section narrowing — a School Head may export any Kindergarten
 * learner in their own school. A learner outside that school, or one who
 * isn't Kindergarten, reads as the same generic not-found Super Admin and
 * teacher get, so tenancy and grade-type never leak via a different error.
 */
export const exportKinderChecklist = action(
  "exportKinderChecklist",
  async (input: unknown): Promise<ExportResult> => {
    const user = await requireUser(["TEACHER", "SCHOOL_HEAD"]);
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const isSchoolHead = user.role === "SCHOOL_HEAD";

    const parsed = parseInput(kinderCompetencyExportSchema, input);

    let schoolId: string;
    let gradeLevelId: string;
    let sectionId: string | null;
    let learner: { id: string; fullName: string };

    // Each branch resolves the learner with the filter that IS its tenancy
    // boundary, and nothing re-checks it afterwards: for the two admin
    // branches the scope is read off the learner row itself, so a second
    // lookup filtered by those same values could never fail.
    //
    // The Kindergarten check reads the SECTION's grade type, not the
    // learner's own `gradeLevelId` pointer: that pointer is denormalized and
    // can drift from the section it is rostered in (CLAUDE.md), and the
    // section is what decides which End-of-Term report the learner actually
    // gets. A learner with no section yet (floating, `sectionId: null`) has
    // no section to ask, so its own `gradeLevel.type` is the only signal —
    // same fallback the teacher branch has no need for, since a floating
    // learner can never match an advisory's `sectionId` anyway.
    const learnerSelect = {
      id: true,
      fullName: true,
      schoolId: true,
      gradeLevelId: true,
      sectionId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { gradeLevel: { select: { type: true } } } },
    } as const;

    const effectiveGradeType = (target: {
      gradeLevel: { type: string };
      section: { gradeLevel: { type: string } } | null;
    }): string => target.section?.gradeLevel.type ?? target.gradeLevel.type;

    if (isSuperAdmin) {
      // The school is DERIVED from the learner, never posted — same reasoning
      // `exportTermGrades` gives for deriving it from `gradeLevelId`.
      const target = await prisma.learner.findFirst({
        where: { id: parsed.learnerId, deletedAt: null, archivedAt: null },
        select: learnerSelect,
      });
      if (!target || !isKinderGradeType(effectiveGradeType(target))) {
        throw resourceNotFound("Learner");
      }
      schoolId = target.schoolId;
      gradeLevelId = target.gradeLevelId;
      sectionId = target.sectionId;
      learner = { id: target.id, fullName: target.fullName };
    } else if (isSchoolHead) {
      if (!user.schoolId) throw resourceNotFound("Learner");
      // Tenant boundary: `schoolId: user.schoolId` from the session, not the
      // request. A learner in another school never reaches the grade-type
      // check below — it is already a miss here, same generic not-found.
      const target = await prisma.learner.findFirst({
        where: {
          id: parsed.learnerId,
          schoolId: user.schoolId,
          deletedAt: null,
          archivedAt: null,
        },
        select: learnerSelect,
      });
      if (!target || !isKinderGradeType(effectiveGradeType(target))) {
        throw resourceNotFound("Learner");
      }
      schoolId = target.schoolId;
      gradeLevelId = target.gradeLevelId;
      sectionId = target.sectionId;
      learner = { id: target.id, fullName: target.fullName };
    } else {
      if (!user.schoolId) throw resourceNotFound("Learner");
      const advisory = await requireKinderAdvisory(
        { id: user.id, schoolId: user.schoolId },
        parsed.advisorySectionId
      );
      schoolId = user.schoolId;
      gradeLevelId = advisory.gradeLevelId;
      sectionId = advisory.sectionId;
      // The teacher branch's scope comes from the advisory, not the learner,
      // so this lookup is a real boundary: a learner outside the section the
      // teacher advises is a miss. Deliberately NOT gated on `gradeLevelId`:
      // it is a denormalized pointer on `Learner` that can drift from the
      // section's own grade, and a section belongs to exactly one school, so
      // `schoolId` + `sectionId` is already complete.
      const target = await prisma.learner.findFirst({
        where: {
          id: parsed.learnerId,
          schoolId,
          sectionId,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true, fullName: true },
      });
      if (!target) throw resourceNotFound("Learner");
      learner = target;
    }

    const schoolYear = await prisma.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { id: true, label: true },
    });
    if (!schoolYear) {
      throw new AppError("VALIDATION_FAILED", {
        params: { message: "No school year is active." },
      });
    }

    const records = await prisma.kinderCompetencyRecord.findMany({
      where: { learnerId: learner.id, schoolYearId: schoolYear.id },
      select: {
        competencyKey: true,
        t1Rating: true,
        t2Rating: true,
        t3Rating: true,
        remark: true,
      },
    });
    const byKey = new Map(records.map((r) => [r.competencyKey, r]));

    // Dynamic import keeps exceljs off every other code path in this module.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "LITRACK";
    wb.created = new Date();

    const sheet = wb.addWorksheet("Checklist");

    // This export is Kindergarten-only by construction (`isKinderGradeType`
    // above), so the header's "Grade / Section" is always Kindergarten — no
    // extra read needed for a section name the sheet never varies by.
    const header = await loadReportHeader({
      schoolId,
      schoolYearId: schoolYear.id,
      gradeSectionLabel: GRADE_LEVEL_LABELS.KINDER ?? "Kindergarten",
      preparedBy: user.fullName,
    });
    writeSheetHeader(sheet, header);

    // Widths only (no `header` key) — a `header` here would ask ExcelJS to
    // write these labels into row 1, which the block above just claimed. The
    // table's own header row is written explicitly below instead.
    sheet.columns = [
      { key: "index", width: 6 },
      { key: "domain", width: 10 },
      { key: "competency", width: 60 },
      { key: "t1", width: 14 },
      { key: "t2", width: 14 },
      { key: "t3", width: 14 },
      { key: "remarks", width: 30 },
    ];
    const tableHeaderRow = sheet.addRow([
      "#",
      "Domain",
      "Competency",
      "T1",
      "T2",
      "T3",
      "Remarks",
    ]);
    tableHeaderRow.font = { bold: true };

    KINDER_COMPETENCY_ENTRIES_IN_ORDER.forEach((entry, index) => {
      const row = byKey.get(entry.key);
      sheet.addRow({
        index: index + 1,
        domain: entry.domain,
        competency: entry.text,
        t1: row?.t1Rating ? KINDER_COMPETENCY_RATING_LABELS[row.t1Rating] : "",
        t2: row?.t2Rating ? KINDER_COMPETENCY_RATING_LABELS[row.t2Rating] : "",
        t3: row?.t3Rating ? KINDER_COMPETENCY_RATING_LABELS[row.t3Rating] : "",
        remarks: row?.remark ?? "",
      });
    });

    const footer = await loadReportFooter({ schoolId, preparedBy: user.fullName });
    writeSheetFooter(wb, sheet, footer);

    const meta = wb.addWorksheet("Export info");
    meta.addRow(["School year", schoolYear.label]);
    meta.addRow(["Learner", learner.fullName]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `litrack-kinder-checklist-${formatLocalDateKey(schoolToday())}.xlsx`;

    // Ids, counts and the caller's role only — the ratings and the remark
    // text stay out of `AuditLog`, same rule the save path follows.
    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.KINDER_COMPETENCY_EXPORT,
      resource: "KinderCompetencyRecord",
      resourceId: learner.id,
      metadata: {
        schoolId,
        gradeLevelId,
        sectionId,
        learnerId: learner.id,
        schoolYearId: schoolYear.id,
        recordCount: records.length,
        role: user.role,
      },
    });

    return { ok: true, data: { filename, base64: buffer.toString("base64") } };
  },
  { verb: "export the checklist" }
);
