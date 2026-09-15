import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyError } from "@/lib/errors/classify";
import { reportError } from "@/lib/errors/report";
import { nameSearchWhere, totalPages } from "@/lib/learners/pagination";
import { getSheetSubjects, healLegacyTermGrades } from "@/lib/terms/subjects-db";
import {
  computeSheetStats,
  sliceSheetPage,
  type SheetStats,
} from "@/lib/terms/sheet-view";
import {
  getTermWindows,
  isTermLocked,
  type TermPeriodValue,
  type TermWindow,
  type TermWindowOverrideInput,
} from "@/lib/terms/windows";
import { formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import { readUnlockState } from "@/lib/unlock/grants";

/**
 * One section of the End of Terms sheet — an advisory for a teacher, or the
 * whole grade (optionally narrowed to a section) for a Super Admin.
 *
 * `rosterWhere` is the caller's tenancy clause and must already carry
 * `schoolId`, the grade, `deletedAt: null` and `archivedAt: null`. The loader
 * only ever ANDs a name search onto it, so it can never widen a scope.
 */
export type SheetScope = {
  key: string;
  gradeLevelId: string;
  /** Null for a Super Admin's whole-grade scope. */
  sectionId: string | null;
  /** "Grade 3 - Atis" */
  label: string;
  /** "3" for Grade 3, "K" for Kindergarten: the table's Advisory / Section cell. */
  gradeShort: string;
  rosterWhere: Prisma.LearnerWhereInput;
};

export type SheetGroup = {
  key: string;
  gradeLevelId: string;
  sectionId: string | null;
  label: string;
  subjects: { id: string; name: string }[];
  learners: { id: string; fullName: string; sectionLabel: string }[];
  initialGrades: { learnerId: string; termSubjectId: string; score: number }[];
  /** Row number (0-based) of the group's first learner on the combined list. */
  indexOffset: number;
};

export type SheetData = {
  groups: SheetGroup[];
  stats: SheetStats;
  page: number;
  pageCount: number;
  totalCount: number;
};

/**
 * Everything the v2 End of Terms sheet renders for one term: the page's groups
 * (one per scope that has rows on this page), and the four figures over the
 * whole scope.
 *
 * The figures ignore the name search — they frame the class, and the footer
 * reports the filtered view. Scores are read once, for the whole scope, and
 * both the figures and the page's cells come out of that one read.
 */
export async function loadTermSheet(args: {
  schoolId: string;
  schoolYearId: string;
  term: TermPeriodValue;
  scopes: SheetScope[];
  q: string;
  page: number;
  pageSize: number;
  /** For the error log if a legacy-score adoption fails. */
  route: string;
}): Promise<SheetData> {
  const { schoolId, schoolYearId, term, scopes, q, pageSize } = args;
  const gradeIds = [...new Set(scopes.map((s) => s.gradeLevelId))];

  // Seeded before the scores are read: the filter below needs each grade's
  // active id set, and the lazy seed runs once per grade whoever reads first.
  const subjectLists = await Promise.all(
    gradeIds.map((gradeLevelId) => getSheetSubjects(prisma, { schoolId, gradeLevelId }))
  );
  const subjectsByGrade = new Map(
    gradeIds.map((id, i) => [id, subjectLists[i].map((s) => ({ id: s.id, name: s.name }))])
  );

  // Adopt scores the pre-TermSubject build saved (termSubjectId NULL) before
  // reading. Best-effort: this page only reads, so a failed UPDATE is logged
  // for an admin and the sheet renders with what is already adopted. No-op
  // after M2; removed with M3.
  for (const gradeLevelId of gradeIds) {
    try {
      await healLegacyTermGrades(prisma, { schoolId, gradeLevelId, schoolYearId });
    } catch (err) {
      reportError(classifyError(err, { verb: "adopt legacy term grades" }), {
        route: args.route,
        routeType: "render",
        schoolId,
      });
    }
  }

  const search = nameSearchWhere(q);
  const scopeWhere: Prisma.LearnerWhereInput = { OR: scopes.map((s) => s.rosterWhere) };
  const allSubjectIds = subjectLists.flat().map((s) => s.id);

  const [counts, everyone, scores] = await Promise.all([
    Promise.all(
      scopes.map((s) => prisma.learner.count({ where: { AND: [s.rosterWhere, search] } }))
    ),
    // The figures' denominator: every learner in scope, search ignored.
    prisma.learner.findMany({
      where: scopeWhere,
      select: { id: true, gradeLevelId: true },
    }),
    prisma.termGrade.findMany({
      where: {
        schoolYearId,
        term,
        // Active subjects only: an archived column, and scores kept from a
        // grade the learner moved out of, stay off the sheet.
        termSubjectId: { in: allSubjectIds },
        // Tenancy rides on the roster clause, so cells and rows cannot drift.
        learner: scopeWhere,
      },
      select: { learnerId: true, termSubjectId: true, score: true },
    }),
  ]);

  const stats = computeSheetStats({
    learners: everyone,
    subjectIdsByGrade: new Map(
      [...subjectsByGrade].map(([id, list]) => [id, list.map((s) => s.id)])
    ),
    scores,
  });

  // Size the pager before the roster reads: `?page=` is user-supplied and the
  // filtered set shrinks as the search narrows. `totalPages` floors at 1.
  const totalCount = counts.reduce((sum, n) => sum + n, 0);
  const pageCount = totalPages(totalCount, pageSize);
  const page = Math.min(Math.max(1, args.page), pageCount);
  const slices = sliceSheetPage(
    scopes.map((s, i) => ({ key: s.key, count: counts[i] })),
    page,
    pageSize
  );

  const rows = await Promise.all(
    slices.map((slice) => {
      const scope = scopes.find((s) => s.key === slice.key)!;
      return prisma.learner.findMany({
        where: { AND: [scope.rosterWhere, search] },
        select: { id: true, fullName: true, section: { select: { name: true } } },
        orderBy: { fullName: "asc" },
        skip: slice.skip,
        take: slice.take,
      });
    })
  );

  const groups: SheetGroup[] = slices.map((slice, i) => {
    const scope = scopes.find((s) => s.key === slice.key)!;
    const subjects = subjectsByGrade.get(scope.gradeLevelId) ?? [];
    const subjectIds = new Set(subjects.map((s) => s.id));
    const learners = rows[i].map((l) => ({
      id: l.id,
      fullName: l.fullName,
      sectionLabel: l.section ? `${scope.gradeShort} - ${l.section.name}` : scope.gradeShort,
    }));
    const learnerIds = new Set(learners.map((l) => l.id));
    return {
      key: scope.key,
      gradeLevelId: scope.gradeLevelId,
      sectionId: scope.sectionId,
      label: scope.label,
      subjects,
      learners,
      initialGrades: scores
        .filter(
          (g): g is typeof g & { termSubjectId: string } =>
            g.termSubjectId !== null &&
            learnerIds.has(g.learnerId) &&
            subjectIds.has(g.termSubjectId)
        )
        .map((g) => ({ learnerId: g.learnerId, termSubjectId: g.termSubjectId, score: g.score })),
      indexOffset: slice.offset,
    };
  });

  return { groups, stats, page, pageCount, totalCount };
}

/**
 * Which term the sheet opens on.
 *
 * An explicit `?term=` wins. Otherwise the term whose window contains today —
 * the one a teacher is actually encoding.
 *
 * Outside every window the search runs FORWARD and falls back to the LAST term,
 * because the two edges want opposite answers. Before the first window (a School
 * Head activating a year ahead of its own `startDate` month) nothing is locked
 * yet, so the first unlocked term is First — reversing the search would open the
 * sheet on Third before the year has begun. After the last window (the months
 * between one school year and the next) everything is locked and `find` returns
 * nothing, so the fallback is Third — the last term anyone actually encoded,
 * where First would send them back to the start of a finished year.
 *
 * `windows` is non-empty by construction: `getTermWindows` maps `TERM_PERIODS`,
 * which has three entries, so the final index is always defined.
 */
export function resolveActiveTerm(
  windows: TermWindow[],
  requested: string | undefined,
  todayKey: string
): TermPeriodValue {
  const explicit = windows.find((w) => w.term === requested);
  if (explicit) return explicit.term;

  const current = windows.find((w) => todayKey >= w.startKey && todayKey <= w.endKey);
  if (current) return current.term;

  const firstOpen = windows.find((w) => !isTermLocked(w, todayKey));
  return firstOpen?.term ?? windows[windows.length - 1].term;
}

/**
 * The term tabs, the active term and whether encoding is closed, for one
 * viewer.
 *
 * The lock is computed, and a grant reopens one term for one teacher. The save
 * action re-checks grants when a save arrives; the sheet has to see the same
 * answer or it would claim a term is locked that `saveTermGrades` would accept.
 * Locking switched off programme-wide reopens every term for everyone, which is
 * why the flag is checked before the set: an empty `unlockedKeys` means no grant
 * was read, not that the teacher holds none. Admin views are always read-only.
 */
export async function resolveSheetTerms(args: {
  schoolYear: { startDateKey: string; overrides: TermWindowOverrideInput[] };
  requestedTerm: string | undefined;
  viewer: { id: string; schoolId: string | null; isSuperAdmin: boolean };
}) {
  const todayKey = formatLocalDateKey(schoolToday());
  const windows = getTermWindows(
    parseLocalDateKey(args.schoolYear.startDateKey),
    args.schoolYear.overrides
  );
  const activeTerm = resolveActiveTerm(windows, args.requestedTerm, todayKey);
  const activeWindow = windows.find((w) => w.term === activeTerm) ?? windows[0];

  const unlock = args.viewer.isSuperAdmin
    ? { lockingEnabled: true, unlockedKeys: new Set<string>() }
    : await readUnlockState({
        userId: args.viewer.id,
        schoolId: args.viewer.schoolId,
        scope: "TERM_GRADES",
      });
  const isEncodingClosed = (w: TermWindow) =>
    unlock.lockingEnabled && isTermLocked(w, todayKey) && !unlock.unlockedKeys.has(w.term);

  return {
    activeTerm,
    activeWindow,
    terms: windows.map((w) => ({
      term: w.term,
      label: w.label,
      rangeLabel: w.rangeLabel,
      locked: isEncodingClosed(w),
    })),
    readOnly: args.viewer.isSuperAdmin || isEncodingClosed(activeWindow),
  };
}

/** "Grade 3" → "3", "Kindergarten" → "K": the table's short grade. */
export function shortGradeLabel(label: string): string {
  const match = /(\d+)/.exec(label);
  if (match) return match[1];
  return label.slice(0, 1).toUpperCase();
}
