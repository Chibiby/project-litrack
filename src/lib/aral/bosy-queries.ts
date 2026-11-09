import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  FRUSTRATION_SUBTYPE_LABELS,
  GRADE_LEVEL_LABELS,
  labelReadingProfile,
} from "@/lib/constants/enum-labels";
import {
  LEARNER_PAGE_SIZE,
  nameSearchWhere,
  sectionIdWhere,
  totalPages,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import { languagesForGrade } from "@/lib/reading/policy";
import { mosyLearnerScope } from "@/lib/teachers/scope";
import { loadMosyGradeOptions, type MosyGradeOption } from "@/lib/aral/mosy-queries";
import {
  BOSY_TIERS,
  bosyTierOf,
  bosyTierWhere,
  computeBosyStats,
  type BosyStatCard,
  type BosyTier,
  type BosyTierFilter,
} from "@/lib/aral/bosy";

/** Plain, serializable row for the BOSY table. No `Date` crosses to the client. */
export type BosyRow = {
  id: string;
  fullName: string;
  gradeLabel: string;
  sectionName: string | null;
  tier: BosyTier | null;
  filipinoLabel: string;
  filipinoDifficulties: string[];
  /** `null` when the grade does not read English or none was recorded. */
  englishLabel: string | null;
  englishDifficulties: string[];
  /** Whether the grade reads English at all (Kinder–Grade 2 do not). */
  readsEnglish: boolean;
  isAralLearner: boolean;
  /** When the learner joined ARAL, e.g. "Jun 16, 2026", or null. */
  aralEnrolledLabel: string | null;
};

export type BosyPageData = {
  cards: BosyStatCard[];
  counts: Record<BosyTierFilter, number>;
  rows: BosyRow[];
  totalCount: number;
  page: number;
  pages: number;
  gradeOptions: MosyGradeOption[];
};

export type LoadBosyPageArgs = {
  schoolId: string;
  schoolYearId: string;
  /** Advisory section ids (`resolveMosyAccess`), or `null` for the Super Admin view. */
  sectionIds: string[] | null;
  q: string;
  grade: string;
  section: LearnerListSectionFilter;
  tier: BosyTierFilter;
  page: number;
};

type WhereArgs = Omit<LoadBosyPageArgs, "tier" | "page">;

/**
 * Which learners the BOSY list shows: the same scope as the MOSY Report (ARAL
 * learners of the teacher's advisory, plus those moved out this school year),
 * so the two pages count the same learners. Every `where` pins `schoolId`.
 */
function bosyListWhere(
  args: WhereArgs,
  tier: BosyTierFilter,
  filtered: boolean
): Prisma.LearnerWhereInput {
  return {
    schoolId: args.schoolId,
    deletedAt: null,
    archivedAt: null,
    ...(filtered
      ? {
          ...nameSearchWhere(args.q),
          ...(args.grade && args.grade !== "all" ? { gradeLevelId: args.grade } : {}),
          ...sectionIdWhere(args.section),
        }
      : {}),
    AND: [mosyLearnerScope(args.sectionIds, args.schoolYearId), bosyTierWhere(tier)],
  };
}

const ROW_SELECT = {
  id: true,
  fullName: true,
  isAralLearner: true,
  aralEnrolledAt: true,
  filipinoReadingProfile: true,
  filipinoFrustrationSubtypes: true,
  englishReadingProfile: true,
  englishFrustrationSubtypes: true,
  gradeLevel: { select: { type: true } },
  section: { select: { name: true } },
} as const satisfies Prisma.LearnerSelect;

type BosyLearnerRecord = Prisma.LearnerGetPayload<{ select: typeof ROW_SELECT }>;

const enrolledFormat = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

function difficultyLabels(subtypes: readonly string[]): string[] {
  return subtypes.map(
    (s) => FRUSTRATION_SUBTYPE_LABELS[s as keyof typeof FRUSTRATION_SUBTYPE_LABELS] ?? s
  );
}

export function toBosyRow(l: BosyLearnerRecord): BosyRow {
  const gradeType = l.gradeLevel.type;
  const readsEnglish = languagesForGrade(gradeType).includes("ENGLISH");
  return {
    id: l.id,
    fullName: l.fullName,
    gradeLabel: GRADE_LEVEL_LABELS[gradeType] ?? gradeType,
    sectionName: l.section?.name ?? null,
    tier: bosyTierOf(l.filipinoReadingProfile),
    filipinoLabel: labelReadingProfile(l.filipinoReadingProfile, gradeType),
    filipinoDifficulties: difficultyLabels(l.filipinoFrustrationSubtypes),
    englishLabel:
      readsEnglish && l.englishReadingProfile
        ? labelReadingProfile(l.englishReadingProfile, gradeType)
        : null,
    englishDifficulties: readsEnglish ? difficultyLabels(l.englishFrustrationSubtypes) : [],
    readsEnglish,
    isAralLearner: l.isAralLearner,
    aralEnrolledLabel: l.aralEnrolledAt ? enrolledFormat.format(l.aralEnrolledAt) : null,
  };
}

/**
 * Server-side data for the BOSY page. The caller derives `schoolId` and
 * `sectionIds` from the session (`resolveMosyAccess`; Super Admin: `?schoolId=`,
 * `null`), exactly as the MOSY page does.
 */
export async function loadBosyPage(args: LoadBosyPageArgs): Promise<BosyPageData> {
  const { schoolId, schoolYearId, sectionIds, tier } = args;
  const whereArgs: WhereArgs = args;

  const baseWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    AND: [mosyLearnerScope(sectionIds, schoolYearId)],
  };

  const [tierCounts, totalCount, gradeOptions] = await Promise.all([
    Promise.all(BOSY_TIERS.map((t) => prisma.learner.count({ where: bosyListWhere(whereArgs, t, false) }))),
    prisma.learner.count({ where: bosyListWhere(whereArgs, tier, true) }),
    loadMosyGradeOptions(schoolId, sectionIds, baseWhere),
  ]);
  const counts = Object.fromEntries(BOSY_TIERS.map((t, i) => [t, tierCounts[i]])) as Record<
    BosyTierFilter,
    number
  >;

  const pages = totalPages(totalCount, LEARNER_PAGE_SIZE);
  const page = Math.min(Math.max(1, Number.isFinite(args.page) ? Math.trunc(args.page) : 1), pages);

  const learners = await prisma.learner.findMany({
    where: bosyListWhere(whereArgs, tier, true),
    select: ROW_SELECT,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  });

  return {
    cards: computeBosyStats(counts),
    counts,
    rows: learners.map(toBosyRow),
    totalCount,
    page,
    pages,
    gradeOptions,
  };
}
