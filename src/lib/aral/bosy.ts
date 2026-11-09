import type { Prisma, ReadingProfile } from "@prisma/client";

/**
 * BOSY (beginning of school year) reading levels: the Filipino and English
 * levels recorded on the learner when they were enrolled (`Learner.
 * filipinoReadingProfile` / `englishReadingProfile`). Read-only — the page
 * never writes them; the learner form is still the only place they change.
 *
 * Learners are grouped into four tiers by their Filipino BOSY level. The
 * Kinder–Grade 2 letter/word rubric (Level 0–3) folds into the same four tiers
 * by rank, so one set of tabs and cards covers every grade.
 */

export const BOSY_TIERS = ["all", "tier1", "tier2", "tier3", "tier4"] as const;
export type BosyTierFilter = (typeof BOSY_TIERS)[number];
export type BosyTier = Exclude<BosyTierFilter, "all">;

export const BOSY_TIER_VALUES: Record<BosyTier, readonly ReadingProfile[]> = {
  tier1: ["NON_DECODER_LOW_EMERGENT", "CANNOT_NAME_SOUND_LETTERS"],
  tier2: ["FRUSTRATION_HIGH_EMERGENT", "LETTER_LEVEL"],
  // DEVELOPING / TRANSITIONING are the Grade 1-3 split of the Instructional band.
  tier3: ["INSTRUCTIONAL_DEVELOPING", "DEVELOPING", "TRANSITIONING", "CV_BLENDING"],
  tier4: ["INDEPENDENT_GRADE_READY", "CVC_BLENDING"],
};

export const BOSY_TIER_LABELS: Record<BosyTierFilter, string> = {
  all: "All",
  tier1: "Low Emergent",
  tier2: "High Emergent",
  tier3: "Developing",
  tier4: "Grade Ready",
};

/** What each tier holds, in the words a teacher reads on the level picker. */
export const BOSY_TIER_HINTS: Record<BosyTier, string> = {
  tier1: "Non-Decoder / Low Emergent, or Level 0",
  tier2: "Frustration / High Emergent, or Level 1",
  tier3: "Instructional, Developing or Transitioning, or Level 2",
  tier4: "Independent / Grade Ready, or Level 3",
};

export function parseBosyTier(raw: string | undefined): BosyTierFilter {
  return (BOSY_TIERS as readonly string[]).includes(raw ?? "") ? (raw as BosyTierFilter) : "all";
}

export function bosyTierOf(filipino: string | null): BosyTier | null {
  if (!filipino) return null;
  for (const tier of BOSY_TIERS) {
    if (tier === "all") continue;
    if ((BOSY_TIER_VALUES[tier] as readonly string[]).includes(filipino)) return tier;
  }
  return null;
}

/** `where` fragment for one tier tab. `all` adds nothing. */
export function bosyTierWhere(tier: BosyTierFilter): Prisma.LearnerWhereInput {
  if (tier === "all") return {};
  return { filipinoReadingProfile: { in: [...BOSY_TIER_VALUES[tier]] } };
}

export type BosyStatCard = {
  key: "total" | BosyTier;
  label: string;
  value: number;
  hint: string;
};

/** The five BOSY cards: total, then one per Filipino tier. Negatives clamp to zero. */
export function computeBosyStats(counts: Record<BosyTierFilter, number>): BosyStatCard[] {
  const n = (v: number) => Math.max(0, v);
  return [
    {
      key: "total",
      label: "Total ARAL learners",
      value: n(counts.all),
      hint: "This school year, including moved out",
    },
    ...(["tier1", "tier2", "tier3", "tier4"] as const).map((tier) => ({
      key: tier,
      label: BOSY_TIER_LABELS[tier],
      value: n(counts[tier]),
      hint: BOSY_TIER_HINTS[tier],
    })),
  ];
}
