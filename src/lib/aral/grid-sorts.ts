import type { Prisma } from "@prisma/client";
import { compareNames } from "@/lib/sort/compare";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";

/**
 * "Sort by" for the two ARAL entry grids — weekly attendance and monthly
 * reading level.
 *
 * Pure and Prisma-free at runtime (the `Prisma` import above is type-only and
 * erases at compile time), so a `"use client"` panel can import the option
 * lists and the comparator without pulling the client bundle into Prisma.
 *
 * The two grids sort through different mechanisms on purpose:
 *
 * - Weekly attendance is NOT paginated — the whole roster is in one grid, and
 *   the grid holds unsaved marks in state keyed by learner id. Sorting it in
 *   the browser is instant and, because the row state is a map rather than a
 *   positional array, reordering cannot disturb a mark the teacher has typed
 *   but not saved. A URL round trip would re-render the page and throw those
 *   marks away, which is a worse trade than losing a bookmarkable sort.
 * - Monthly reading level IS paginated (`skip`/`take`), so sorting only the
 *   rows already on screen would be wrong — page 2 would still hold whoever
 *   the server's own ordering put there. It sorts through a Prisma `orderBy`
 *   with the sort in the URL, like every other paginated table.
 */

/* -------------------------------------------------------------------------- */
/* Weekly attendance — client-sorted                                          */
/* -------------------------------------------------------------------------- */

export const ARAL_ATTENDANCE_SORTS = defineSort(
  [
    { value: "name", label: "Alphabetical" },
    { value: "section", label: "Section" },
    { value: "absences", label: "Absences this week (most)" },
  ] as const,
  "name"
);

export type AralAttendanceSort =
  (typeof ARAL_ATTENDANCE_SORTS.options)[number]["value"];

export type AttendanceSortableLearner = {
  id: string;
  /** Surname-first display form, which is also what the column shows. */
  listingName: string;
  sectionName: string | null;
};

/**
 * Sort a weekly attendance roster.
 *
 * Every option falls back to the surname-first name, so the order is total and
 * a re-render cannot reshuffle rows that tie. `absences` counts the week's
 * SAVED records only — deliberately not the live grid state, or a row would
 * jump out from under the cursor the moment a teacher marked someone absent.
 *
 * Learners with no section sort last under `section` rather than first: "no
 * section yet" is the incomplete case, and burying it keeps the named sections
 * contiguous at the top where they are being read.
 */
export function sortAttendanceLearners<T extends AttendanceSortableLearner>(
  learners: readonly T[],
  sort: AralAttendanceSort,
  absencesByLearner: ReadonlyMap<string, number>
): T[] {
  const byName = (a: T, b: T) => compareNames(a.listingName, b.listingName);
  const rows = [...learners];

  switch (sort) {
    case "section":
      return rows.sort((a, b) => {
        if (a.sectionName !== b.sectionName) {
          if (!a.sectionName) return 1;
          if (!b.sectionName) return -1;
          const bySection = compareNames(a.sectionName, b.sectionName);
          if (bySection !== 0) return bySection;
        }
        return byName(a, b);
      });
    case "absences":
      return rows.sort((a, b) => {
        const diff =
          (absencesByLearner.get(b.id) ?? 0) - (absencesByLearner.get(a.id) ?? 0);
        return diff !== 0 ? diff : byName(a, b);
      });
    case "name":
      return rows.sort(byName);
  }
}

/* -------------------------------------------------------------------------- */
/* Monthly reading level — server-sorted                                      */
/* -------------------------------------------------------------------------- */

export const ARAL_READING_LEVEL_SORTS = defineSort(
  [
    { value: "name", label: "Alphabetical" },
    { value: "section", label: "Section" },
    { value: "reading-level", label: "Filipino reading level" },
  ] as const,
  "name"
);

export type AralReadingLevelSort =
  (typeof ARAL_READING_LEVEL_SORTS.options)[number]["value"];

/**
 * The primary `orderBy` per option, without the tiebreaker. Kept beside the
 * option list so an option added to one and not the other fails the build
 * (`satisfies`) and the test (`assertOrderByCoversOptions`) instead of
 * silently sorting nothing.
 *
 * Alphabetical orders by `lastName`/`firstName`, not the denormalized
 * `fullName`: the Learner column reads surname-first, and ordering by a
 * Firstname-first string would sort against what the column shows and cut page
 * boundaries mid-alphabet.
 *
 * `reading-level` orders by the learner's stored Filipino profile — the roster
 * field, not the month's record — because that is the value the whole app
 * already treats as the learner's current level. `ReadingProfile`'s
 * declaration order in the schema IS the rubric order, so ascending runs
 * lowest level first, which is the scan a teacher wants.
 */
const ARAL_READING_LEVEL_ORDER_BY = {
  name: [{ lastName: "asc" }, { firstName: "asc" }],
  section: [{ section: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
  "reading-level": [
    { filipinoReadingProfile: "asc" },
    { lastName: "asc" },
    { firstName: "asc" },
  ],
} satisfies Record<AralReadingLevelSort, Prisma.LearnerOrderByWithRelationInput[]>;

assertOrderByCoversOptions(ARAL_READING_LEVEL_SORTS, ARAL_READING_LEVEL_ORDER_BY);

/**
 * Prisma `orderBy` for the monthly reading level grid, always ending in the
 * `id` tiebreaker. The grid is paginated with `skip`/`take`, and none of these
 * keys is unique — without a unique last key Postgres is free to return a
 * learner on two pages and another on none.
 */
export function aralReadingLevelOrderBy(
  sort: AralReadingLevelSort
): Prisma.LearnerOrderByWithRelationInput[] {
  return [...ARAL_READING_LEVEL_ORDER_BY[sort], { id: "asc" }];
}
