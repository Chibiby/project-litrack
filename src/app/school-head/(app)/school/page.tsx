import { Suspense } from "react";
import { School, GraduationCap, Layers, CalendarRange } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSchoolHeadMetricCounts } from "@/lib/dashboard/aggregates";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { ListCardSkeleton } from "@/components/loading";
import { GradeLevelsClient } from "@/components/school-head/grade-levels-client";
import { buildSectionPeople, personName } from "@/lib/school-head/section-people";
import { advisoryCapFor } from "@/lib/teachers/advisory-limits";

export const dynamic = "force-dynamic";

/**
 * Grade and Section. The School workspace root serves this page rather than
 * redirecting to a child segment — see the note on `SCHOOL_HEAD_ROUTES.schoolGradeLevels`.
 */

const ALL_TYPES = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

const PERSON = {
  id: true,
  firstName: true,
  lastName: true,
  isActive: true,
  deletedAt: true,
} as const;

interface GradeLevelsPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function GradeLevelsGrid({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  // Deactivated grades are read too, not filtered out: a grade that exists but
  // is switched off is a different thing from one that was never created, and
  // the page has to offer Restore for the first and Create for the second.
  const [existing, adviserRows, pendingRows] = await Promise.all([
    prisma.gradeLevel.findMany({
    where: { schoolId },
    select: {
      id: true,
      type: true,
      deletedAt: true,
      _count: { select: { teachers: true, learners: true } },
      sections: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          // Learners on the roster right now (not removed, not archived), so the
          // page can warn before Remove. `deleteSection` re-counts in its own
          // transaction and is the authority; this number is only a warning.
          _count: { select: { learners: { where: { deletedAt: null, archivedAt: null } } } },
          // Who is in the section, for its expandable row. Names only; the
          // same live-roster filter as the count above.
          adviser: { select: { ...PERSON, role: true } },
          teachers: { select: { teacher: { select: PERSON } } },
          learners: {
            where: { deletedAt: null, archivedAt: null },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              isAralLearner: true,
              aralTeacher: { select: PERSON },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  }),
    // Who may be made an adviser: the same filter `setTeacherAdvisorySection`
    // applies, so the picker never offers a teacher the action would refuse.
    prisma.user.findMany({
      where: {
        schoolId,
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        advisorySections: { where: { deletedAt: null }, select: { id: true } },
        teacherProfile: { select: { designation: true, advisoryMode: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    // Learners with a transfer request waiting cannot be moved directly.
    prisma.sectionTransferRequest.findMany({
      where: { schoolId, status: "PENDING" },
      select: { learnerId: true },
    }),
  ]);
  const pendingLearnerIds = new Set(pendingRows.map((r) => r.learnerId));
  // Volunteers and floating teachers advise nothing (cap 0), so they are not
  // offered at all; a teacher at their cap stays listed, marked full.
  const adviserOptions = adviserRows.flatMap((t) => {
    const cap = advisoryCapFor(t.teacherProfile?.designation, t.teacherProfile?.advisoryMode);
    return cap === 0
      ? []
      : [{ id: t.id, name: personName(t), advisoryCount: t.advisorySections.length, cap }];
  });
  const existingMap = new Map(existing.map((g) => [g.type, g]));

  const activeTypes = ALL_TYPES.filter(
    (type) => existingMap.get(type)?.deletedAt === null
  );
  const archivedTypes = ALL_TYPES.filter((type) => existingMap.get(type)?.deletedAt);
  // FLOATING stays in ALL_TYPES so an existing floating grade still renders (with
  // its learner count), but it is never offered as something to create: it is
  // system-managed and appears only once a transfer puts a learner into it.
  // A grade that exists and is merely deactivated is excluded too — it belongs
  // under Restore, where its sections come back with it, rather than under
  // Create, which would revive the grade alone and leave them behind.
  const inactiveTypes = ALL_TYPES.filter(
    (type) => !existingMap.has(type) && type !== "FLOATING"
  );

  const active = activeTypes.map((type) => {
    const grade = existingMap.get(type)!;
    return {
      id: grade.id,
      type,
      teacherCount: grade._count.teachers,
      // Every learner row, soft-deleted ones included — this is the same
      // unfiltered `_count` the page has always shown. `archiveGradeLevel` runs
      // its own count and is the authority on whether a grade may be switched
      // off; this number is a label, not a gate.
      learnerCount: grade._count.learners,
      sections: grade.sections.map((s) => ({
        id: s.id,
        name: s.name,
        learnerCount: s._count.learners,
        people: buildSectionPeople(s, pendingLearnerIds),
      })),
    };
  });

  const archived = archivedTypes.map((type) => {
    const grade = existingMap.get(type)!;
    return { id: grade.id, type };
  });

  return (
    <GradeLevelsClient
      active={active}
      archived={archived}
      inactiveTypes={[...inactiveTypes]}
      readOnly={isSuperAdminView}
      adviserOptions={adviserOptions}
    />
  );
}

export default async function SchoolWorkspacePage({ searchParams }: GradeLevelsPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.schoolGradeLevels
  );

  // Hero's stat row reuses the cached dashboard aggregate — same figures, no
  // ad-hoc counts blocking first paint apart from `GradeLevelsGrid`'s own
  // (heavier, deactivated-grades-included) read behind its Suspense boundary.
  const {
    gradeCount: activeGradeCount,
    sectionCount: activeSectionCount,
    activeYear,
  } = await getSchoolHeadMetricCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Grade and Section"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="School"
          eyebrowIcon={School}
          title="Grade and Section"
          subtitle="Activate the grades your school offers, then add each grade's sections. Open a section to see its teachers and learners."
          stats={
            <>
              <StatCard
                title="Active grades"
                value={activeGradeCount}
                hint="Grades this school offers"
                icon={GraduationCap}
                tone="emerald"
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Sections"
                value={activeSectionCount}
                hint="Across all active grades"
                icon={Layers}
                tone="emerald"
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Active school year"
                value={activeYear?.label ?? "Not set"}
                hint="Learners enroll against this year"
                icon={CalendarRange}
                tone="primary"
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
            </>
          }
        />
      }
    >
      <Suspense fallback={<ListCardSkeleton grid items={10} />}>
        <GradeLevelsGrid
          schoolId={view.schoolId}
          isSuperAdminView={view.isSuperAdminView}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
