import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";
import { formatListingNameFromRecord } from "@/lib/names";

/**
 * Everything the Super Admin school page shows about one school.
 *
 * Deliberately uncached, for the same reason `/admin/database` is: this is the
 * page an admin reads immediately before deleting what it lists. A 60-second
 * stale roster here would be read as the result of the removal they just
 * performed, and the next thing they click is destructive.
 *
 * Archived and soft-deleted rows are excluded throughout. A removed teacher's
 * Prisma row survives to keep "who recorded this" answerable, but it is not
 * something to offer for removal a second time.
 */

/** Learners per page. Enough that a sample school fits on one screen. */
export const LEARNER_PAGE_SIZE = 50;

/**
 * "Sort by" for the school-detail learners roster. Alphabetical is the
 * default — this is a name-bearing list, and surname-first order (`lastName`
 * then `firstName`) is what `listingName` renders, never the denormalized
 * `fullName`. Server-side: this roster is paginated with skip/take, so the
 * order must be decided by the query, not by the client after the fact.
 *
 * No "Reading level" option: `LearnerRow` does not carry a reading level
 * today, and adding the join/query just to sort by it would be a new field
 * introduced for this feature alone rather than an existing one exposed.
 */
export const SCHOOL_LEARNER_SORTS = defineSort(
  [
    { value: "alphabetical", label: "Alphabetical" },
    { value: "grade-level", label: "Grade level" },
    { value: "section", label: "Section" },
    { value: "date-added", label: "Date added" },
  ] as const,
  "alphabetical"
);

export type SchoolLearnerSort = (typeof SCHOOL_LEARNER_SORTS.options)[number]["value"];

/**
 * The primary `orderBy` clause per sort option, without the tiebreaker. Kept
 * alongside `SCHOOL_LEARNER_SORTS` so an option added to one and not the
 * other is a build-time (`satisfies`) and test-time
 * (`assertOrderByCoversOptions`) failure rather than a silently unsorted
 * table. `grade-level` orders on the enum's declared K-to-12 progression
 * (`GradeLevelType`'s Postgres ordinal), the same convention every other
 * `orderBy: [{ gradeLevel: { type: "asc" } }, ...]` call site in this repo
 * relies on — never alphabetical, which would put "G10" before "G2".
 */
const SCHOOL_LEARNER_SORT_ORDER_BY = {
  alphabetical: [{ lastName: "asc" }, { firstName: "asc" }],
  "grade-level": [{ gradeLevel: { type: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
  section: [{ section: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
  "date-added": [{ createdAt: "desc" }],
} satisfies Record<SchoolLearnerSort, Prisma.LearnerOrderByWithRelationInput[]>;

assertOrderByCoversOptions(SCHOOL_LEARNER_SORTS, SCHOOL_LEARNER_SORT_ORDER_BY);

/**
 * Prisma `orderBy` array for a parsed school-detail learners sort, always
 * ending in the `id` tiebreaker. This roster is server-paginated with
 * skip/take — `grade-level`, `section` and `date-added` are not unique keys,
 * so without the tiebreaker Postgres can repeat or skip a row across pages.
 */
export function schoolLearnerOrderBy(
  sort: SchoolLearnerSort
): Prisma.LearnerOrderByWithRelationInput[] {
  return [...SCHOOL_LEARNER_SORT_ORDER_BY[sort], { id: "asc" }];
}

export type SchoolProfile = {
  id: string;
  name: string;
  schoolIdCode: string;
  address: string | null;
  region: string | null;
  division: string | null;
  district: string | null;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
};

export type SchoolCounts = {
  teachers: number;
  learners: number;
  sections: number;
  gradeLevels: number;
  schoolYears: number;
};

export type TeacherRow = {
  id: string;
  fullName: string;
  /**
   * Surname-first display form ("Lastname, Firstname Middlename"), built from
   * `firstName`/`middleName`/`lastName` via `formatListingNameFromRecord` —
   * never by parsing `fullName` apart. `fullName` keeps its existing shape:
   * search and dedupe depend on that stored value, so this is an added
   * display field, not a replacement.
   */
  listingName: string;
  /**
   * Raw name parts, exposed alongside `listingName` so the (client-sorted,
   * unpaginated) teachers table can order by lastName/firstName the same way
   * every server-sorted list does — never by re-parsing `fullName` apart.
   */
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  approvalStatus: string | null;
  advisorySection: string | null;
  createdAt: string;
};

export type LearnerRow = {
  id: string;
  fullName: string;
  /** Surname-first display form — see `TeacherRow.listingName`. */
  listingName: string;
  gradeLevel: string;
  section: string | null;
  isAralLearner: boolean;
  createdAt: string;
};

export type SchoolDetail = {
  school: SchoolProfile;
  counts: SchoolCounts;
  teachers: TeacherRow[];
  learners: LearnerRow[];
  learnerPage: number;
  learnerPages: number;
};

/** Null when the school does not exist or has been removed. */
export async function getSchoolProfile(schoolId: string): Promise<SchoolProfile | null> {
  const school = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: {
      id: true,
      name: true,
      schoolIdCode: true,
      address: true,
      region: true,
      division: true,
      district: true,
      isActive: true,
      isDemo: true,
      createdAt: true,
    },
  });
  if (!school) return null;
  return { ...school, createdAt: school.createdAt.toISOString() };
}

/**
 * The profile, the counts, every teacher, and one page of learners.
 *
 * Teachers are not paginated: a school has a handful, and the whole point of
 * this page is seeing all of them at once. Learners are, because a real school
 * has hundreds and the page would otherwise ship the entire roster to the
 * browser to render a table nobody scrolls to the end of.
 */
export async function getSchoolDetail(
  schoolId: string,
  learnerPage = 1,
  learnerSort?: string
): Promise<SchoolDetail | null> {
  const school = await getSchoolProfile(schoolId);
  if (!school) return null;

  const page = Number.isFinite(learnerPage) && learnerPage > 0 ? Math.floor(learnerPage) : 1;
  const sort = SCHOOL_LEARNER_SORTS.parse(learnerSort);

  const [teachers, learnerCount, learners, sections, gradeLevels, schoolYears] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId, role: "TEACHER", deletedAt: null },
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        email: true,
        isActive: true,
        approvalStatus: true,
        createdAt: true,
        advisorySections: {
          where: { deletedAt: null },
          select: { name: true },
          orderBy: { name: "asc" },
        },
      },
      // Teachers are not paginated (the whole roster is one prop), so this
      // only sets the order shown before the client's own "Sort by"
      // (`SchoolDetailView`, client-sorted) runs — kept alphabetical to match
      // that default rather than drift from it (the consistency rule: display
      // and ordering must agree).
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.learner.count({ where: { schoolId, deletedAt: null } }),
    prisma.learner.findMany({
      where: { schoolId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        isAralLearner: true,
        createdAt: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
      },
      orderBy: schoolLearnerOrderBy(sort),
      skip: (page - 1) * LEARNER_PAGE_SIZE,
      take: LEARNER_PAGE_SIZE,
    }),
    prisma.section.count({ where: { schoolId, deletedAt: null } }),
    prisma.gradeLevel.count({ where: { schoolId, deletedAt: null } }),
    prisma.schoolYear.count({ where: { schoolId } }),
  ]);

  return {
    school,
    counts: {
      teachers: teachers.length,
      learners: learnerCount,
      sections,
      gradeLevels,
      schoolYears,
    },
    teachers: teachers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      listingName: formatListingNameFromRecord(t),
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      isActive: t.isActive,
      approvalStatus: t.approvalStatus,
      // Archived sections are excluded by the select; all live ones are shown.
      advisorySection:
        t.advisorySections.map((s) => s.name).join(", ") || null,
      createdAt: t.createdAt.toISOString(),
    })),
    learners: learners.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      listingName: formatListingNameFromRecord(l),
      gradeLevel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      section: l.section?.name ?? null,
      isAralLearner: l.isAralLearner,
      createdAt: l.createdAt.toISOString(),
    })),
    learnerPage: page,
    learnerPages: Math.max(1, Math.ceil(learnerCount / LEARNER_PAGE_SIZE)),
  };
}
