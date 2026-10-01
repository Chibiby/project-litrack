/**
 * MOSY (middle of school year) ARAL decision — the pure layer.
 *
 * No Prisma runtime import (types only) and no `server-only`, so the client
 * dialog can import it too. See
 * docs/superpowers/specs/2026-09-29-mosy-report-page-design.md.
 */
import type {
  AralMosyMoveOutReason,
  AralMosyOutcome,
  Prisma,
  ReadingProfile,
} from "@prisma/client";
import {
  ARAL_MOSY_MOVE_OUT_REASON_LABELS,
  labelReadingProfile,
} from "@/lib/constants/enum-labels";
import { parseLocalDateKey } from "@/lib/date-keys";
import {
  isReadingValueAllowedForGrade,
  languagesForGrade,
  readingProfileOptionsForGrade,
} from "@/lib/reading/policy";

export type MosyReasonChoice = {
  /** Stable, unique per choice; the dropdown's option value. */
  key: string;
  reason: AralMosyMoveOutReason;
  improvedToLevel: ReadingProfile | null;
  label: string;
};

/**
 * The only place that decides which move-out reasons a learner may use. The
 * dialog renders its result and `resolveMosySave` validates against it.
 *
 * Improvement choices: one per level of the grade's scale, in scale order, only
 * strictly above the previous Filipino level. No previous level, or one outside
 * the scale, offers every level except the lowest. The two LSEN reasons are
 * always offered.
 */
export function mosyReasonChoices(
  gradeType: string,
  previousFilipinoLevel: string | null
): MosyReasonChoice[] {
  const scale = readingProfileOptionsForGrade(gradeType);
  const prevIndex =
    previousFilipinoLevel === null
      ? -1
      : scale.findIndex((o) => o.value === previousFilipinoLevel);
  // Unknown previous level behaves like "at the lowest": everything above index 0.
  const from = prevIndex < 0 ? 1 : prevIndex + 1;
  const improved: MosyReasonChoice[] = scale.slice(from).map((o) => ({
    key: `IMPROVED_READING_LEVEL:${o.value}`,
    reason: "IMPROVED_READING_LEVEL",
    improvedToLevel: o.value as ReadingProfile,
    label: `Improved to ${o.label}`,
  }));
  return [
    ...improved,
    {
      key: "DIAGNOSED_LSEN",
      reason: "DIAGNOSED_LSEN",
      improvedToLevel: null,
      label: ARAL_MOSY_MOVE_OUT_REASON_LABELS.DIAGNOSED_LSEN,
    },
    {
      key: "RECOMMENDED_LSEN_ASSESSMENT",
      reason: "RECOMMENDED_LSEN_ASSESSMENT",
      improvedToLevel: null,
      label: ARAL_MOSY_MOVE_OUT_REASON_LABELS.RECOMMENDED_LSEN_ASSESSMENT,
    },
  ];
}

/** Display label for a saved reason. Legacy reasons fall back to the enum label. */
export function mosyReasonLabel(
  reason: AralMosyMoveOutReason,
  improvedToLevel: ReadingProfile | null,
  gradeType: string
): string {
  if (reason === "IMPROVED_READING_LEVEL") {
    if (!improvedToLevel) return ARAL_MOSY_MOVE_OUT_REASON_LABELS.IMPROVED_READING_LEVEL;
    const option = readingProfileOptionsForGrade(gradeType).find(
      (o) => o.value === improvedToLevel
    );
    return `Improved to ${option?.label ?? labelReadingProfile(improvedToLevel, gradeType)}`;
  }
  return ARAL_MOSY_MOVE_OUT_REASON_LABELS[reason];
}

export const MOSY_STATUSES = ["all", "not_updated", "for_decision", "moved_out", "stay"] as const;
export type MosyStatusFilter = (typeof MOSY_STATUSES)[number];
export type MosyRowStatus = Exclude<MosyStatusFilter, "all">;

export const MOSY_STATUS_LABELS: Record<MosyStatusFilter, string> = {
  all: "All",
  not_updated: "Not updated",
  for_decision: "For decision",
  moved_out: "Moved out",
  stay: "Stay in ARAL",
};

/** Parse `?status=`, falling back to `"all"` on anything unknown. */
export function parseMosyStatus(raw: string | undefined): MosyStatusFilter {
  return (MOSY_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as MosyStatusFilter)
    : "all";
}

/**
 * Status of one learner row. A MOVE_OUT on a learner who is tagged again (someone
 * re-enrolled them through the toggle since) reads as "for decision".
 * Keep in step with `mosyStatusWhere` (parity test).
 */
export function mosyRowStatus(args: {
  isAralLearner: boolean;
  row: { decision: AralMosyOutcome | null } | null;
}): MosyRowStatus {
  const { isAralLearner, row } = args;
  if (!row) return "not_updated";
  if (row.decision === null) return "for_decision";
  if (row.decision === "STAY") return "stay";
  return isAralLearner ? "for_decision" : "moved_out";
}

/**
 * Prisma version of `mosyRowStatus`. Clauses live inside `AND: [...]` so they
 * never collide with the scope's `OR`.
 *
 * `for_decision` is "still waiting for a move out or stay decision", so it is a
 * superset: it also matches `not_updated` rows (no level saved yet). The tabs
 * therefore overlap; `not_updated` stays as the narrower "no level yet" view.
 */
export function mosyStatusWhere(
  status: MosyStatusFilter,
  schoolYearId: string
): Prisma.LearnerWhereInput {
  switch (status) {
    case "all":
      return {};
    case "not_updated":
      return { AND: [{ mosyDecisions: { none: { schoolYearId } } }] };
    case "for_decision":
      return {
        AND: [
          {
            OR: [
              { mosyDecisions: { none: { schoolYearId } } },
              { mosyDecisions: { some: { schoolYearId, decision: null } } },
              {
                isAralLearner: true,
                mosyDecisions: { some: { schoolYearId, decision: "MOVE_OUT" } },
              },
            ],
          },
        ],
      };
    case "moved_out":
      return {
        AND: [
          {
            isAralLearner: false,
            mosyDecisions: { some: { schoolYearId, decision: "MOVE_OUT" } },
          },
        ],
      };
    case "stay":
      return { AND: [{ mosyDecisions: { some: { schoolYearId, decision: "STAY" } } }] };
  }
}

export type MosyStatsInput = {
  /** Every learner in the MOSY scope (ARAL learners plus moved out this year). */
  total: number;
  notUpdated: number;
  forDecision: number;
  movedOut: number;
  stay: number;
};

export type MosyStatCard = {
  key: "total" | "updated" | "forDecision" | "movedOut" | "stay";
  label: string;
  value: number;
  hint: string;
};

export type MosyStats = {
  total: number;
  /** `total - notUpdated`, floored at zero. */
  updated: number;
  forDecision: number;
  movedOut: number;
  stay: number;
  cards: MosyStatCard[];
};

/** The five card numbers with their hints. Negatives are clamped to zero. */
export function computeMosyStats(input: MosyStatsInput): MosyStats {
  const total = Math.max(0, input.total);
  const updated = Math.max(0, total - Math.max(0, input.notUpdated));
  const forDecision = Math.max(0, input.forDecision);
  const movedOut = Math.max(0, input.movedOut);
  const stay = Math.max(0, input.stay);
  return {
    total,
    updated,
    forDecision,
    movedOut,
    stay,
    cards: [
      {
        key: "total",
        label: "Total ARAL learners",
        value: total,
        hint: "This school year, including moved out",
      },
      { key: "updated", label: "Updated MOSY level", value: updated, hint: "Level saved" },
      {
        key: "forDecision",
        label: "For MOSY decision",
        value: forDecision,
        hint: "Waiting for a move out or stay decision",
      },
      { key: "movedOut", label: "Moved out", value: movedOut, hint: "No longer in ARAL" },
      { key: "stay", label: "Stay in ARAL", value: stay, hint: "Continuing in ARAL" },
    ],
  };
}

export type MosyLevelLanguage = "FILIPINO" | "ENGLISH";

/** The language the MOSY reading level is assessed in: Filipino for Kinder to G2, English above. */
export function mosyLevelLanguage(gradeType: string): MosyLevelLanguage {
  return languagesForGrade(gradeType).includes("ENGLISH") ? "ENGLISH" : "FILIPINO";
}

export const MOSY_LEVEL_LANGUAGE_NAMES: Record<MosyLevelLanguage, string> = {
  FILIPINO: "Filipino",
  ENGLISH: "English",
};

export const MOSY_LEVEL_LANGUAGE_PREFIXES: Record<MosyLevelLanguage, string> = {
  FILIPINO: "Fil",
  ENGLISH: "Eng",
};

export type PreviousLevel = {
  filipino: string | null;
  english: string | null;
  monthLabel: string;
};

const monthFormat = new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" });

/**
 * Latest monthly reading level for the row. English is left out when the grade
 * does not read English. `monthKey` is a local `YYYY-MM-DD` key.
 */
export function formatPreviousLevel(
  record: {
    monthKey: string;
    englishProfile: string | null;
    filipinoProfile: string | null;
  } | null,
  gradeType: string
): PreviousLevel | null {
  if (!record) return null;
  const showEnglish = languagesForGrade(gradeType).includes("ENGLISH");
  return {
    filipino: record.filipinoProfile
      ? labelReadingProfile(record.filipinoProfile, gradeType)
      : null,
    english:
      showEnglish && record.englishProfile
        ? labelReadingProfile(record.englishProfile, gradeType)
        : null,
    monthLabel: monthFormat.format(parseLocalDateKey(record.monthKey)),
  };
}

export type MosySaveFailure =
  | "LEVEL_NOT_ALLOWED"
  | "REASON_REQUIRED"
  | "REASON_NOT_ALLOWED"
  | "DECISION_REQUIRED";

export type MosyTransition = "NONE" | "MOVED_OUT" | "RETAGGED";

export type MosySaveInput = {
  actorId: string;
  now: Date;
  learner: {
    gradeType: string;
    isAralLearner: boolean;
    aralTeacherId: string | null;
    aralEnrolledAt: Date | null;
  };
  existing: {
    decision: AralMosyOutcome | null;
    tutorId: string | null;
    priorAralEnrolledAt: Date | null;
  } | null;
  submitted: {
    mosyLevel: ReadingProfile;
    decision: AralMosyOutcome | null;
    reason: AralMosyMoveOutReason | null;
    improvedToLevel: ReadingProfile | null;
    remarks: string | null;
  };
  /** Filipino profile of the latest reading record (what the page shows as previous level). */
  previousFilipinoLevel: string | null;
};

export type MosySaveResult =
  | {
      ok: true;
      row: {
        mosyLevel: ReadingProfile;
        decision: AralMosyOutcome | null;
        reason: AralMosyMoveOutReason | null;
        improvedToLevel: ReadingProfile | null;
        remarks: string | null;
        tutorId: string;
        priorAralEnrolledAt: Date | null;
      };
      learnerPatch: null | {
        isAralLearner: boolean;
        aralTeacherId: string | null;
        aralEnrolledAt: Date | null;
      };
      transition: MosyTransition;
    }
  | { ok: false; failure: MosySaveFailure };

/**
 * Decides every MOSY save. Never throws.
 *
 * A level change never produces a `learnerPatch` by itself: only the `decision`
 * input can, and `aralTeacherId` is always null when the patch untags.
 */
export function resolveMosySave(input: MosySaveInput): MosySaveResult {
  const { actorId, now, learner, existing, submitted } = input;

  // Scope (advisory section) is the caller's job: `saveMosyDecision` checks
  // `teacherOwnsMosyRow` on the locked learner row before calling this.
  if (!isReadingValueAllowedForGrade(submitted.mosyLevel, learner.gradeType)) {
    return { ok: false, failure: "LEVEL_NOT_ALLOWED" };
  }

  const { decision } = submitted;
  if (decision === null) {
    if (!learner.isAralLearner || (existing !== null && existing.decision !== null)) {
      return { ok: false, failure: "DECISION_REQUIRED" };
    }
  }

  let reason: AralMosyMoveOutReason | null = null;
  let improvedToLevel: ReadingProfile | null = null;
  if (decision === "MOVE_OUT") {
    if (!submitted.reason) return { ok: false, failure: "REASON_REQUIRED" };
    const wantedLevel =
      submitted.reason === "IMPROVED_READING_LEVEL" ? submitted.improvedToLevel : null;
    const allowed = mosyReasonChoices(learner.gradeType, input.previousFilipinoLevel).some(
      (c) => c.reason === submitted.reason && c.improvedToLevel === wantedLevel
    );
    if (!allowed) return { ok: false, failure: "REASON_NOT_ALLOWED" };
    reason = submitted.reason;
    improvedToLevel = wantedLevel;
  }

  const base = {
    mosyLevel: submitted.mosyLevel,
    decision,
    reason,
    improvedToLevel,
    remarks: submitted.remarks,
    tutorId: actorId,
  };

  if (learner.isAralLearner && decision === "MOVE_OUT") {
    return {
      ok: true,
      row: { ...base, priorAralEnrolledAt: learner.aralEnrolledAt },
      learnerPatch: { isAralLearner: false, aralTeacherId: null, aralEnrolledAt: null },
      transition: "MOVED_OUT",
    };
  }

  if (!learner.isAralLearner && decision === "STAY") {
    // aralTeacherId = actorId: the adviser saving the STAY becomes the learner's
    // designated ARAL teacher again (the Move out cleared the previous one).
    // notifyAralAssigned is deliberately not called: the actor is the assignee, so
    // it would only notify them of their own action.
    return {
      ok: true,
      row: { ...base, priorAralEnrolledAt: null },
      learnerPatch: {
        isAralLearner: true,
        aralTeacherId: actorId,
        aralEnrolledAt: existing?.priorAralEnrolledAt ?? now,
      },
      transition: "RETAGGED",
    };
  }

  return {
    ok: true,
    row: { ...base, priorAralEnrolledAt: existing?.priorAralEnrolledAt ?? null },
    learnerPatch: null,
    transition: "NONE",
  };
}
