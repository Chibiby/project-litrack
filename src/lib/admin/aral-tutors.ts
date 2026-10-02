import "server-only";
import type { GradeLevelType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDemoVisible } from "@/lib/demo/session";
import { demoSchoolFilter } from "@/lib/settings/system-settings";
import { GRADE_LEVEL_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import { schoolWhereForScope, type AdminScope } from "@/lib/auth/admin-scope";
import { aralTutorScope } from "@/lib/teachers/aral-tutor";
import { ACCOUNT_GRADE_VALUES, cleanFilterId, cleanFilterText } from "@/lib/admin/accounts";
import { ARAL_TUTOR_SORTS, type AralTutorSort } from "@/lib/admin/aral-tutor-sorts";
import {
  ARAL_TUTOR_DEPED,
  ARAL_TUTOR_NON_DEPED,
  classifyAralTutor,
} from "@/lib/summary/queries/aral";

/**
 * "ARAL Tutors": every live, approved, switched-on teacher who is the ARAL
 * teacher (`Learner.aralTeacherId`) of at least one live, un-archived ARAL
 * learner, DepEd or Non-DepEd volunteer alike. "Active" is the Teachers page's
 * definition (`isActive` + `approvalStatus APPROVED`), the same rule
 * `aralTutorScope` applies to the tutor picker.
 *
 * Used by /school-head/aral-tutors (scope `school`) and
 * /admin/management/aral-tutors (scope `admin`).
 *
 * Tenancy: `school` scope pins `schoolId` on both the teacher and the learner
 * side. `admin` scope is for pages already behind `requireUser("SUPER_ADMIN")`
 * (like the Teachers page); `district` / `schoolId` there are the admin's
 * *filters*, never an authorization input, and `scope` (an `AdminScope`) can
 * confine a district admin. Never build a `school` scope from a request param.
 *
 * Cost: 4 queries, constant in row count: page + count (parallel), one
 * `learner.groupBy` for every row's counts and grades, one small grade lookup.
 */

export const ARAL_TUTORS_PAGE_SIZE = 25;

export type AralTutorsScope =
  | { kind: "school"; schoolId: string }
  | {
      kind: "admin";
      district?: string;
      schoolId?: string;
      /** Defaults to the whole division (Super Admin). */
      scope?: AdminScope;
    };

export { ARAL_TUTOR_SORTS, type AralTutorSort };

export type AralTutorsSearchParams = {
  page?: string;
  q?: string;
  district?: string;
  schoolId?: string;
  grade?: string;
  sort?: string;
};

export type AralTutorsParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  /** Admin filters; the school-scope loader ignores both. */
  district?: string;
  schoolId?: string;
  /** Tutors with at least one live ARAL learner in this grade. */
  grade?: GradeLevelType;
  sort: AralTutorSort;
};

/** Invalid values are dropped, never thrown. */
export function parseAralTutorsParams(
  searchParams: AralTutorsSearchParams,
  pageSize: number = ARAL_TUTORS_PAGE_SIZE
): AralTutorsParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const size = pageSize > 0 ? pageSize : ARAL_TUTORS_PAGE_SIZE;
  return {
    page,
    pageSize: size,
    skip: (page - 1) * size,
    take: size,
    q: (searchParams.q ?? "").trim().slice(0, 100),
    district: cleanFilterText(searchParams.district),
    schoolId: cleanFilterId(searchParams.schoolId),
    grade: ACCOUNT_GRADE_VALUES.find((g) => g === searchParams.grade),
    sort: ARAL_TUTOR_SORTS.parse(searchParams.sort),
  };
}

export function aralTutorsTotalPages(
  totalCount: number,
  pageSize: number = ARAL_TUTORS_PAGE_SIZE
): number {
  return totalCount <= 0 ? 1 : Math.ceil(totalCount / pageSize);
}

export type AralTutorRow = {
  id: string;
  /** Surname-first display form. */
  listingName: string;
  /** DepEd / Non-DepEd, or null when the profile answers neither. */
  employment: "DEPED" | "NON_DEPED" | null;
  /** "DepEd" / "Non-DepEd" / null — from `EMPLOYMENT_TYPE_LABELS`. */
  employmentLabel: string | null;
  /** The raw `TeacherProfile.designation`, if any. */
  designation: string | null;
  /** "Grade 3 · Sampaguita, Grade 4 · Rizal", or null when they advise nothing. */
  advisorySummary: string | null;
  /** Live, un-archived ARAL learners this teacher tutors. */
  aralLearnerCount: number;
  /** Grades those learners are in, Kinder first, with per-grade counts. */
  grades: { grade: GradeLevelType; label: string; count: number }[];
  /** The tutor's school. Shown on the admin page; present on both. */
  school: { id: string; name: string };
};

export type AralTutorsPage = {
  rows: AralTutorRow[];
  totalCount: number;
};

export type AralTutorsSummary = {
  /** Tutors in scope (ignores search and the grade filter). */
  tutors: number;
  /** Live ARAL learners in scope with an ARAL teacher. */
  learnersWithTutor: number;
  /** Live ARAL learners in scope with no ARAL teacher. */
  learnersWithoutTutor: number;
};

/** The learner rule: live, un-archived ARAL learners. */
const LIVE_ARAL_LEARNER = {
  deletedAt: null,
  archivedAt: null,
  isAralLearner: true,
} as const;

/** Where for the tutor teachers (page + count). Exported for tests. */
export function aralTutorsWhere(
  scope: AralTutorsScope,
  q: string,
  demoVisible: boolean,
  grade?: GradeLevelType
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];

  if (scope.kind === "school") {
    // schoolId + TEACHER + live + isActive + APPROVED — the picker's own rule.
    and.push(aralTutorScope(scope.schoolId));
    and.push({
      aralLearners: { some: { ...LIVE_ARAL_LEARNER, schoolId: scope.schoolId } },
    });
  } else {
    and.push({ role: "TEACHER", deletedAt: null, isActive: true, approvalStatus: "APPROVED" });
    and.push({
      school: {
        AND: [
          schoolWhereForScope(scope.scope ?? { kind: "division" }),
          demoSchoolFilter(demoVisible),
          ...(scope.district ? [{ district: scope.district }] : []),
        ],
      },
    });
    if (scope.schoolId) and.push({ schoolId: scope.schoolId });
    and.push({ aralLearners: { some: LIVE_ARAL_LEARNER } });
  }

  if (grade) {
    and.push({
      aralLearners: {
        some: {
          ...LIVE_ARAL_LEARNER,
          ...(scope.kind === "school" ? { schoolId: scope.schoolId } : {}),
          gradeLevel: { type: grade },
        },
      },
    });
  }

  if (q) {
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

/** Where for the live ARAL learners of the same scope the tutor list covers. Exported for tests. */
export function aralLearnersWhere(
  scope: AralTutorsScope,
  demoVisible: boolean
): Prisma.LearnerWhereInput {
  if (scope.kind === "school") return { ...LIVE_ARAL_LEARNER, schoolId: scope.schoolId };
  return {
    ...LIVE_ARAL_LEARNER,
    school: {
      AND: [
        schoolWhereForScope(scope.scope ?? { kind: "division" }),
        demoSchoolFilter(demoVisible),
        ...(scope.district ? [{ district: scope.district }] : []),
      ],
    },
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
  };
}

/**
 * The three summary cards: tutors, ARAL learners with a tutor, ARAL learners
 * without one. Three counts, same scope and demo rule as the list; search and
 * the grade filter do not narrow them.
 */
export async function getAralTutorsSummary(scope: AralTutorsScope): Promise<AralTutorsSummary> {
  if (scope.kind === "school" && !scope.schoolId) {
    throw new Error("getAralTutorsSummary: school scope requires a schoolId");
  }
  const demoVisible = scope.kind === "admin" ? await isDemoVisible() : true;
  const learnerWhere = aralLearnersWhere(scope, demoVisible);
  const [tutors, totalLearners, withoutTutor] = await Promise.all([
    prisma.user.count({ where: aralTutorsWhere(scope, "", demoVisible) }),
    prisma.learner.count({ where: learnerWhere }),
    prisma.learner.count({ where: { ...learnerWhere, aralTeacherId: null } }),
  ]);
  return {
    tutors,
    learnersWithTutor: Math.max(totalLearners - withoutTutor, 0),
    learnersWithoutTutor: withoutTutor,
  };
}

function gradeRank(grade: GradeLevelType): number {
  const i = ACCOUNT_GRADE_VALUES.indexOf(grade);
  return i === -1 ? ACCOUNT_GRADE_VALUES.length : i;
}

/**
 * One page of ARAL tutors, surname / first name / id order.
 *
 * `school` scope: the caller's schoolId must come from
 * `requireSchoolUser("SCHOOL_HEAD")` or `resolveSchoolContext`. Page params'
 * `district` / `schoolId` are ignored there.
 */
export async function getAralTutorsPage(
  scope: AralTutorsScope,
  params: Pick<AralTutorsParams, "q" | "skip" | "take"> &
    Partial<Pick<AralTutorsParams, "grade" | "sort">>
): Promise<AralTutorsPage> {
  if (scope.kind === "school" && !scope.schoolId) {
    throw new Error("getAralTutorsPage: school scope requires a schoolId");
  }
  const demoVisible = scope.kind === "admin" ? await isDemoVisible() : true;
  const where = aralTutorsWhere(scope, params.q, demoVisible, params.grade);
  const byName = [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }] as const;

  // "Most ARAL learners" orders by a live-learner count Prisma cannot sort a
  // relation by (it would count archived and removed learners too), so the
  // page's ids are ranked from one grouped count over the same `where`.
  let rankedIds: string[] | null = null;
  if (params.sort === "learners") {
    const candidates = await prisma.user.findMany({
      where,
      orderBy: [...byName],
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    const counted = candidateIds.length
      ? await prisma.learner.groupBy({
          by: ["aralTeacherId"],
          where: {
            aralTeacherId: { in: candidateIds },
            ...LIVE_ARAL_LEARNER,
            ...(scope.kind === "school" ? { schoolId: scope.schoolId } : {}),
          },
          _count: { _all: true },
        })
      : [];
    const countById = new Map(counted.map((c) => [c.aralTeacherId, c._count._all]));
    rankedIds = candidateIds
      .map((id, i) => ({ id, i, n: countById.get(id) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(params.skip, params.skip + params.take)
      .map((c) => c.id);
  }

  const [fetched, totalCount] = await Promise.all([
    rankedIds && rankedIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({
      relationLoadStrategy: "join",
      where: rankedIds ? { AND: [where, { id: { in: rankedIds } }] } : where,
      orderBy: [...byName],
      ...(rankedIds ? {} : { skip: params.skip, take: params.take }),
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        school: { select: { id: true, name: true } },
        teacherProfile: { select: { employmentType: true, designation: true } },
        advisorySections: {
          where: { deletedAt: null },
          select: { name: true, gradeLevel: { select: { type: true } } },
          orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
        },
      },
    }),
    prisma.user.count({ where }),
  ]);
  const teachers = rankedIds
    ? [...fetched].sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id))
    : fetched;

  const ids = teachers.map((t) => t.id);
  const groups = ids.length
    ? await prisma.learner.groupBy({
        by: ["aralTeacherId", "gradeLevelId"],
        where: {
          aralTeacherId: { in: ids },
          ...LIVE_ARAL_LEARNER,
          ...(scope.kind === "school" ? { schoolId: scope.schoolId } : {}),
        },
        _count: { _all: true },
      })
    : [];

  // Grade levels are per school; fold `gradeLevelId` to the grade type.
  const gradeIds = [...new Set(groups.map((g) => g.gradeLevelId))];
  const gradeRows = gradeIds.length
    ? await prisma.gradeLevel.findMany({
        where: { id: { in: gradeIds } },
        select: { id: true, type: true },
      })
    : [];
  const typeById = new Map(gradeRows.map((g) => [g.id, g.type]));

  const perTeacher = new Map<string, Map<GradeLevelType, number>>();
  for (const g of groups) {
    const type = typeById.get(g.gradeLevelId);
    if (!g.aralTeacherId || !type) continue;
    const m = perTeacher.get(g.aralTeacherId) ?? new Map<GradeLevelType, number>();
    m.set(type, (m.get(type) ?? 0) + g._count._all);
    perTeacher.set(g.aralTeacherId, m);
  }

  const rows: AralTutorRow[] = teachers.map((t) => {
    const byGrade = perTeacher.get(t.id) ?? new Map<GradeLevelType, number>();
    const grades = [...byGrade.entries()]
      .map(([grade, count]) => ({
        grade,
        label: GRADE_LEVEL_LABELS[grade] ?? grade,
        count,
      }))
      .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
    const kind = classifyAralTutor(
      t.teacherProfile?.employmentType ?? null,
      t.teacherProfile?.designation ?? null
    );
    const employment =
      kind === ARAL_TUTOR_DEPED ? "DEPED" : kind === ARAL_TUTOR_NON_DEPED ? "NON_DEPED" : null;
    return {
      id: t.id,
      listingName: formatListingNameFromRecord(t),
      employment,
      employmentLabel:
        employment === "DEPED"
          ? EMPLOYMENT_TYPE_LABELS.DEPED_PLANTILLA
          : employment === "NON_DEPED"
            ? EMPLOYMENT_TYPE_LABELS.NON_DEPED
            : null,
      designation: t.teacherProfile?.designation ?? null,
      advisorySummary:
        t.advisorySections
          .map((s) => `${GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type} · ${s.name}`)
          .join(", ") || null,
      aralLearnerCount: grades.reduce((n, g) => n + g.count, 0),
      grades,
      school: t.school ?? { id: "", name: "" },
    };
  });

  return { rows, totalCount };
}
