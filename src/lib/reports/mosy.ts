/**
 * MOSY ("Middle of School Year") report — pure decision layer.
 *
 * Combines the reading-level profile per grade level (English and Filipino,
 * as two separate blocks per the project owner's explicit request) with the
 * ARAL profiling summary and a full learner-detail listing, all as
 * `ReportBlock[]` for `renderExcel`/`renderPdf` (`./render.ts`).
 *
 * No Prisma, no I/O. The Prisma query that assembles `MosyInput` is a
 * separate module — this file only turns already-fetched plain data into
 * blocks, so it is testable with hand-built fixtures.
 *
 * `null` is this module's single "nothing to show" value for a table cell —
 * `renderExcel`/`renderPdf` both already collapse `null` to a blank cell, so
 * every "not applicable" and "no data" case below returns `null`, never `0`
 * and never a literal "—" string. That keeps one answer to "is there a value
 * here" instead of two competing conventions.
 *
 * Hard rule (see the calling task and `docs/aral-profile.md`): this function
 * must never throw and must never emit fewer than four blocks, even when
 * every learner's `profile` is `null` — the ARAL Profile is a dormant-safe,
 * optional record, and no workflow (this report included) may gate on it.
 */
import { computeReadingLevelStats } from "@/lib/aral/reading-level-stats";
import { parseLocalDateKey } from "@/lib/date-keys";
import {
  INTERVENTION_LABELS,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
} from "@/lib/constants/enum-labels";
import { formatListingName } from "@/lib/names";
import {
  allowedReadingValuesForGrade,
  languagesForGrade,
  readingProfileOptionsForGrade,
} from "@/lib/reading/policy";
import type { ReportBlock } from "./render";

/** Same shape `resolveMosyWindow` (`./mosy-window.ts`) produces, plus how it
 * was resolved — the query agent decides `source`, this module only reads it. */
export type MosyWindowInfo = {
  startKey: string | null;
  endKey: string | null;
  label: string;
  source: "term" | "custom" | "unresolved";
};

export type MosyGrade = {
  id: string;
  /** `GradeLevel.type` — feeds `allowedReadingValuesForGrade`/`languagesForGrade`. */
  type: string;
  label: string;
};

export type MosyReadingRecord = {
  weekStartKey: string;
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  /** Already computed by the caller via `isReadingRecordComplete` — this
   * module trusts it rather than recomputing, so the two can never disagree. */
  complete: boolean;
};

export type MosyAralProfileInfo = {
  updatedAtKey: string;
  interventions: string[];
};

export type MosyLearner = {
  id: string;
  gradeLevelId: string;
  gradeType: string;
  gradeLabel: string;
  sectionName: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  isAralLearner: boolean;
  aralTutorName: string | null;
  record: MosyReadingRecord | null;
  profile: MosyAralProfileInfo | null;
};

export type MosyInput = {
  window: MosyWindowInfo;
  /** Ordered; every learner's `gradeLevelId` is expected to match one of these. */
  grades: MosyGrade[];
  /** The exact learner set blocks 1-3 must reconcile against block 4. */
  learners: MosyLearner[];
};

const DEFAULT_WIDTH = 14;

/**
 * When the window could not be resolved from the school year's own Second
 * Term dates (no `SchoolYear`/override found) or was overridden by a School
 * Head, the caller needs a sentence for the report subtitle. Exported rather
 * than folded into a block's `note` so the caller can place it next to the
 * other subtitle lines (school name, generated-at) instead of mid-table.
 */
export function describeMosyWindowNote(window: MosyWindowInfo): string | null {
  if (window.source === "unresolved") {
    return "No Second Term window could be resolved for this school year; the report could not be bounded to a MOSY date range.";
  }
  if (window.source === "custom") {
    return `Using a School Head override for the MOSY window (${window.label}), not the school year's default Second Term dates.`;
  }
  return null;
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Union of every grade's rubric bands, in first-seen order across `grades`.
 * English and Filipino share the same `ReadingProfile` vocabulary, so one
 * column set serves both blocks. A value's header label is taken from the
 * first grade whose rubric offers it — grades disagreeing on a value's label
 * (e.g. K-3 vs G4+ phrasing of `NON_DECODER_LOW_EMERGENT`) is a display
 * nuance, not a correctness issue, since the underlying value is unambiguous. */
function collectBandColumns(grades: MosyGrade[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const grade of grades) {
    for (const option of readingProfileOptionsForGrade(grade.type)) {
      if (!seen.has(option.value)) seen.set(option.value, option.label);
    }
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

type LanguageKey = "englishProfile" | "filipinoProfile";

function buildLanguageBlock(
  heading: string,
  sheetName: string,
  language: "ENGLISH" | "FILIPINO",
  langKey: LanguageKey,
  grades: MosyGrade[],
  learners: MosyLearner[],
  bandColumns: { value: string; label: string }[]
): ReportBlock {
  const rows: (string | number | null)[][] = [];
  for (const grade of grades) {
    const learnersInGrade = learners.filter((l) => l.gradeLevelId === grade.id);
    const total = learnersInGrade.length;
    const collectsLanguage = languagesForGrade(grade.type).includes(language);

    if (!collectsLanguage) {
      rows.push([
        grade.label,
        null,
        null,
        null,
        null,
        ...bandColumns.map(() => null),
        null,
      ]);
      continue;
    }

    const allowed = allowedReadingValuesForGrade(grade.type);
    // A value not on this grade's rubric (e.g. a promoted learner's stale
    // early-rubric value carried under a later grade) has no band column on
    // this row, so it must not count toward "Assessed" either — otherwise
    // Assessed and the band-column sum disagree and a reader can't add
    // across the row. `computeReadingLevelStats`'s own docblock already
    // treats off-rubric values as "ignored" for the average; this keeps that
    // same rule for the assessed/coverage figures.
    const assessedCount = learnersInGrade.filter((l) => {
      const value = l.record?.[langKey];
      return value != null && allowed.includes(value);
    }).length;
    const statsRecords = learnersInGrade.map((l) => ({
      englishProfile: langKey === "englishProfile" ? (l.record?.englishProfile ?? null) : null,
      filipinoProfile: langKey === "filipinoProfile" ? (l.record?.filipinoProfile ?? null) : null,
    }));
    const stats = computeReadingLevelStats({
      total,
      completed: assessedCount,
      records: statsRecords,
      gradeType: grade.type,
    });

    // `computeReadingLevelStats` reports 0% for a zero-learner grade (its
    // divide-by-zero guard); this report needs "no data" (null) instead, so
    // a grade with no learners cannot be misread as 0% coverage.
    const coveragePct = total > 0 ? `${stats.completionPct}%` : null;

    const bandCounts = bandColumns.map((col) => {
      if (!allowed.includes(col.value)) return null;
      return learnersInGrade.filter((l) => l.record?.[langKey] === col.value).length;
    });

    rows.push([
      grade.label,
      total,
      stats.assessed,
      stats.pending,
      coveragePct,
      ...bandCounts,
      stats.averageLabel,
    ]);
  }

  return {
    heading,
    sheetName,
    columns: [
      { header: "Grade Level", width: 16 },
      { header: "Learners", width: DEFAULT_WIDTH },
      { header: "Assessed", width: DEFAULT_WIDTH },
      { header: "Not Assessed", width: DEFAULT_WIDTH },
      { header: "Coverage %", width: DEFAULT_WIDTH },
      ...bandColumns.map((c) => ({ header: c.label, width: 20 })),
      { header: "Average Level", width: 20 },
    ],
    rows,
  };
}

/**
 * Deterministic modal pick: count how many profiles list each intervention
 * key, then take the highest count; a tie breaks toward whichever key comes
 * first in `INTERVENTION_LABELS`'s own declaration order (a fixed, arbitrary
 * but stable tiebreak — same input always yields the same output).
 */
function pickModalIntervention(profiles: MosyAralProfileInfo[]): string | null {
  const canonicalOrder = Object.keys(INTERVENTION_LABELS);
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    for (const key of profile.interventions) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;

  let bestKey: string | null = null;
  let bestCount = -1;
  for (const key of canonicalOrder) {
    const count = counts.get(key);
    if (count == null) continue;
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  // Any intervention key not in `INTERVENTION_LABELS` (stale data) is never
  // picked as modal — it also has no label to render.
  if (!bestKey) return null;
  return INTERVENTION_LABELS[bestKey as keyof typeof INTERVENTION_LABELS] ?? bestKey;
}

function buildAralProfilingBlock(grades: MosyGrade[], learners: MosyLearner[]): ReportBlock {
  const rows: (string | number | null)[][] = grades.map((grade) => {
    const aralLearners = learners.filter(
      (l) => l.gradeLevelId === grade.id && l.isAralLearner
    );
    const total = aralLearners.length;
    const completedProfiles = aralLearners
      .map((l) => l.profile)
      .filter((p): p is MosyAralProfileInfo => p != null);
    const completed = completedProfiles.length;
    const pending = Math.max(0, total - completed);
    const completionPct = total > 0 ? `${clampPct((completed / total) * 100)}%` : null;

    const modalIntervention = pickModalIntervention(completedProfiles);
    const lastUpdated =
      completedProfiles.length > 0
        ? completedProfiles.reduce(
            (max, p) => (p.updatedAtKey > max ? p.updatedAtKey : max),
            completedProfiles[0]!.updatedAtKey
          )
        : null;

    return [
      grade.label,
      total,
      completed,
      pending,
      completionPct,
      modalIntervention,
      lastUpdated,
    ];
  });

  return {
    heading: "ARAL Profiling",
    columns: [
      { header: "Grade Level", width: 16 },
      { header: "ARAL Learners", width: DEFAULT_WIDTH },
      { header: "Profiles Completed", width: DEFAULT_WIDTH },
      { header: "Pending", width: DEFAULT_WIDTH },
      { header: "Completion %", width: DEFAULT_WIDTH },
      { header: "Most Suggested Intervention", width: 30 },
      { header: "Last Profile Updated", width: 18 },
    ],
    rows,
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatAssessmentMonth(weekStartKey: string): string {
  const date = parseLocalDateKey(weekStartKey);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function labelForBand(value: string | null, gradeType: string): string | null {
  if (value == null) return null;
  const option = readingProfileOptionsForGrade(gradeType).find((o) => o.value === value);
  return option?.label ?? value;
}

function assessmentStatus(record: MosyReadingRecord | null): string {
  if (!record) return "Not assessed";
  return record.complete ? "Complete" : "Partial";
}

function buildLearnerDetailBlock(learners: MosyLearner[]): ReportBlock {
  const rows: (string | number | null)[][] = learners.map((learner, index) => {
    const record = learner.record;
    const interventions =
      learner.profile && learner.profile.interventions.length > 0
        ? learner.profile.interventions
            .map((key) => INTERVENTION_LABELS[key as keyof typeof INTERVENTION_LABELS] ?? key)
            .join(", ")
        : null;

    return [
      index + 1,
      formatListingName(learner.firstName, learner.middleName, learner.lastName),
      learner.gradeLabel,
      learner.sectionName ?? null,
      learner.isAralLearner ? "Yes" : "No",
      learner.isAralLearner ? (learner.aralTutorName ?? null) : null,
      record ? formatAssessmentMonth(record.weekStartKey) : null,
      labelForBand(record?.englishProfile ?? null, learner.gradeType),
      labelForBand(record?.filipinoProfile ?? null, learner.gradeType),
      record?.wordRecognitionLevel
        ? (WEEKLY_WORD_RECOGNITION_LEVEL_LABELS[
            record.wordRecognitionLevel as keyof typeof WEEKLY_WORD_RECOGNITION_LEVEL_LABELS
          ] ?? record.wordRecognitionLevel)
        : null,
      record?.readingComprehensionLevel
        ? (WEEKLY_READING_COMPREHENSION_LEVEL_LABELS[
            record.readingComprehensionLevel as keyof typeof WEEKLY_READING_COMPREHENSION_LEVEL_LABELS
          ] ?? record.readingComprehensionLevel)
        : null,
      assessmentStatus(record),
      learner.isAralLearner ? (learner.profile ? "Completed" : "Not completed") : null,
      interventions,
    ];
  });

  return {
    heading: "Learner Detail",
    columns: [
      { header: "#", width: 6 },
      { header: "Learner", width: 26 },
      { header: "Grade", width: 14 },
      { header: "Section", width: 14 },
      { header: "ARAL", width: 8 },
      { header: "ARAL Tutor", width: 20 },
      { header: "Assessment Month", width: 18 },
      { header: "English", width: 20 },
      { header: "Filipino", width: 20 },
      { header: "Word Recognition", width: 22 },
      { header: "Comprehension", width: 22 },
      { header: "Assessment Status", width: 16 },
      { header: "ARAL Profile", width: 14 },
      { header: "Suggested Interventions", width: 32 },
    ],
    rows,
  };
}

/**
 * Builds the four MOSY blocks in report order. Never throws and never omits
 * a block: an empty `learners`/`grades` list yields blocks with zero or
 * null-filled rows, not fewer blocks — see the file header on the ARAL
 * Profile dormant-safety rule this guards.
 */
export function buildMosyBlocks(input: MosyInput): ReportBlock[] {
  const { grades, learners } = input;
  const bandColumns = collectBandColumns(grades);

  return [
    buildLanguageBlock(
      "Reading Level Profile per Grade Level (English)",
      "Reading Level (English)",
      "ENGLISH",
      "englishProfile",
      grades,
      learners,
      bandColumns
    ),
    buildLanguageBlock(
      "Reading Level Profile per Grade Level (Filipino)",
      "Reading Level (Filipino)",
      "FILIPINO",
      "filipinoProfile",
      grades,
      learners,
      bandColumns
    ),
    buildAralProfilingBlock(grades, learners),
    buildLearnerDetailBlock(learners),
  ];
}
