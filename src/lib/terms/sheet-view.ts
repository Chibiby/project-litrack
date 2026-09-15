import { generalAverage } from "@/lib/terms/average";
import { LEARNER_LIST_DEFAULT_PAGE_SIZE } from "@/lib/learners/pagination";
import type { TermPeriodValue } from "@/lib/terms/windows";

/**
 * Pure helpers behind the v2 End of Terms sheet: the four figures, how one page
 * of the combined (All Advisories) roster maps onto its sections, and the
 * phone's five-subjects-at-a-time window. No Prisma here, so every rule is
 * unit-tested without a database.
 */

/** The sheet's URL state, as every control needs to rebuild it. */
export type SheetUrlState = {
  /** A Super Admin's school view. */
  schoolId?: string;
  /** One advisory section, or null for All Advisories. */
  advisory: string | null;
  section: string;
  term: TermPeriodValue;
  q: string;
  pageSize: number;
};

/**
 * The sheet's URL. Defaults are left out; the page index is kept only when
 * passed, because every filter change invalidates it.
 */
export function sheetHref(basePath: string, s: SheetUrlState, page?: number): string {
  const sp = new URLSearchParams();
  if (s.schoolId) sp.set("schoolId", s.schoolId);
  if (s.advisory) sp.set("advisory", s.advisory);
  if (s.section !== "all") sp.set("section", s.section);
  sp.set("term", s.term);
  if (s.q.trim()) sp.set("q", s.q.trim());
  if (s.pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE) sp.set("perPage", String(s.pageSize));
  if (page && page > 1) sp.set("page", String(page));
  return `${basePath}?${sp.toString()}`;
}

export type SheetStats = {
  /** Learners in scope. */
  total: number;
  /** Learners with a score in every active subject of their grade. */
  complete: number;
  /** `round(complete / total × 100)`, 0 when there is nobody in scope. */
  completionPct: number;
  /** Mean of the complete learners' general averages, 2 decimals; null when none. */
  classAverage: number | null;
};

/**
 * The sheet's four figures for one term.
 *
 * "Complete" needs every active subject of the learner's own grade, because an
 * All Advisories scope can span grades with different subject lists. A grade
 * with no subjects set can never be complete — there is nothing to have saved.
 * The class average counts complete learners only, so a half-encoded row cannot
 * drag the figure around while the teacher is still typing.
 */
export function computeSheetStats(input: {
  learners: readonly { id: string; gradeLevelId: string }[];
  subjectIdsByGrade: ReadonlyMap<string, readonly string[]>;
  scores: readonly { learnerId: string; termSubjectId: string | null; score: number }[];
}): SheetStats {
  const byLearner = new Map<string, Map<string, number>>();
  for (const s of input.scores) {
    if (!s.termSubjectId) continue;
    const cells = byLearner.get(s.learnerId) ?? new Map<string, number>();
    cells.set(s.termSubjectId, s.score);
    byLearner.set(s.learnerId, cells);
  }

  let complete = 0;
  const averages: number[] = [];
  for (const learner of input.learners) {
    const subjectIds = input.subjectIdsByGrade.get(learner.gradeLevelId) ?? [];
    if (subjectIds.length === 0) continue;
    const cells = byLearner.get(learner.id);
    const scores = subjectIds.map((id) => cells?.get(id));
    if (scores.some((s) => s === undefined)) continue;
    complete += 1;
    const average = generalAverage(scores);
    if (average !== null) averages.push(average);
  }

  const total = input.learners.length;
  return {
    total,
    complete,
    completionPct: total === 0 ? 0 : Math.round((complete / total) * 100),
    classAverage: generalAverage(averages),
  };
}

export type SheetSlice = {
  key: string;
  /** Rows to skip inside this section. */
  skip: number;
  /** Rows to take from this section. */
  take: number;
  /** Row number (0-based) of this slice's first learner on the combined list. */
  offset: number;
};

/**
 * Which sections, and which rows of each, land on one page of the combined
 * roster. Sections keep the order given (advisory placement order); inside a
 * section the caller orders by name. Sections with no rows on the page are
 * left out.
 */
export function sliceSheetPage(
  sections: readonly { key: string; count: number }[],
  page: number,
  pageSize: number
): SheetSlice[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  const end = start + pageSize;
  const slices: SheetSlice[] = [];
  let before = 0;
  for (const section of sections) {
    const from = Math.max(start, before);
    const to = Math.min(end, before + section.count);
    if (to > from) {
      slices.push({ key: section.key, skip: from - before, take: to - from, offset: from });
    }
    before += section.count;
  }
  return slices;
}

/** DepEd names the phone's narrow columns use; anything else is derived. */
const KNOWN_ABBREVIATIONS: Record<string, string> = {
  english: "ENG",
  filipino: "FIL",
  mathematics: "MATH",
  math: "MATH",
  science: "SCI",
  "araling panlipunan": "AP",
  "edukasyon sa pagpapakatao": "ESP",
  "good manners and right conduct": "GMRC",
  "values education": "VE",
  "mother tongue": "MT",
  "technology and livelihood education": "TLE",
  "edukasyong pantahanan at pangkabuhayan": "EPP",
  makabansa: "MAKA",
  "reading and literacy": "RL",
  language: "LANG",
};

/** Words initials skip, so "Edukasyon sa …" does not become "ESP…"-with-an-S. */
const MINOR_WORDS = new Set(["sa", "ng", "at", "and", "of", "the", "&"]);

/**
 * The short column label a phone row shows ("ENG", "AP"). Subjects are named by
 * each School Head, so unknown names are derived: a short single word stays as
 * it is written in capitals (MAPEH, TLE), a long one keeps its first four
 * letters, and several words become their initials. The full name stays in the
 * input's accessible label.
 */
export function subjectAbbreviation(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  const known = KNOWN_ABBREVIATIONS[normalized];
  if (known) return known;
  const words = normalized.split(" ").filter((w) => w && !MINOR_WORDS.has(w));
  if (words.length === 0) return name.trim().slice(0, 4).toUpperCase();
  if (words.length === 1) {
    const word = words[0];
    return (word.length <= 5 ? word : word.slice(0, 4)).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

/** Subjects a phone row shows at once, per the mockup. */
export const PHONE_SUBJECTS_PER_VIEW = 5;

/**
 * The phone's subject window: which slice of a subject list is showing. Each
 * group clamps to its own list, since grades in one scope can carry different
 * subject counts; stepping past the last window wraps to the first.
 */
export function subjectWindow(
  subjectCount: number,
  step: number,
  size = PHONE_SUBJECTS_PER_VIEW
): { start: number; end: number; windows: number } {
  const windows = Math.max(1, Math.ceil(subjectCount / size));
  const index = ((step % windows) + windows) % windows;
  const start = index * size;
  return { start, end: Math.min(subjectCount, start + size), windows };
}
