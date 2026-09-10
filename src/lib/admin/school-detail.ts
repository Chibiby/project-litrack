import "server-only";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

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
  email: string;
  isActive: boolean;
  approvalStatus: string | null;
  advisorySection: string | null;
  createdAt: string;
};

export type LearnerRow = {
  id: string;
  fullName: string;
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
  learnerPage = 1
): Promise<SchoolDetail | null> {
  const school = await getSchoolProfile(schoolId);
  if (!school) return null;

  const page = Number.isFinite(learnerPage) && learnerPage > 0 ? Math.floor(learnerPage) : 1;

  const [teachers, learnerCount, learners, sections, gradeLevels, schoolYears] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId, role: "TEACHER", deletedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        approvalStatus: true,
        createdAt: true,
        advisorySection: { select: { name: true, deletedAt: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.learner.count({ where: { schoolId, deletedAt: null } }),
    prisma.learner.findMany({
      where: { schoolId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        isAralLearner: true,
        createdAt: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
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
      email: t.email,
      isActive: t.isActive,
      approvalStatus: t.approvalStatus,
      // An archived section is not an advisory — same rule as `toManagedRow`.
      advisorySection:
        t.advisorySection && t.advisorySection.deletedAt === null
          ? t.advisorySection.name
          : null,
      createdAt: t.createdAt.toISOString(),
    })),
    learners: learners.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      gradeLevel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      section: l.section?.name ?? null,
      isAralLearner: l.isAralLearner,
      createdAt: l.createdAt.toISOString(),
    })),
    learnerPage: page,
    learnerPages: Math.max(1, Math.ceil(learnerCount / LEARNER_PAGE_SIZE)),
  };
}
