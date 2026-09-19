import { Suspense } from "react";
import { School, GraduationCap, Layers, CalendarRange } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import {
  SCHOOL_TABS,
  SCHOOL_WORKSPACE_TABS,
} from "@/components/school-head/workspace-tabs";
import { ListCardSkeleton } from "@/components/loading";
import { GradeLevelsClient } from "@/components/school-head/grade-levels-client";

export const dynamic = "force-dynamic";

/**
 * The School workspace root serves grade levels rather than redirecting to a
 * child segment — see the note on `SCHOOL_HEAD_ROUTES.schoolGradeLevels`.
 */

const ALL_TYPES = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

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
  const existing = await prisma.gradeLevel.findMany({
    where: { schoolId },
    select: {
      id: true,
      type: true,
      deletedAt: true,
      _count: { select: { teachers: true, learners: true } },
      sections: {
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
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
      sections: grade.sections,
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
    />
  );
}

export default async function SchoolWorkspacePage({ searchParams }: GradeLevelsPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.schoolGradeLevels
  );

  // Light counts for the hero's stat row — cheap, indexed queries kept apart
  // from `GradeLevelsGrid`'s own (heavier, deactivated-grades-included) read so
  // the hero can paint without waiting on the grid's Suspense boundary.
  const [activeGradeCount, activeSectionCount, activeYear] = await Promise.all([
    prisma.gradeLevel.count({ where: { schoolId: view.schoolId, deletedAt: null } }),
    prisma.section.count({
      where: {
        schoolId: view.schoolId,
        deletedAt: null,
        gradeLevel: { deletedAt: null },
      },
    }),
    prisma.schoolYear.findFirst({
      where: { schoolId: view.schoolId, isActive: true },
      select: { label: true },
    }),
  ]);

  return (
    <SchoolHeadPage
      title="Grade levels"
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.gradeLevels}
      hero={
        <SchoolHeadHero
          eyebrow="School"
          eyebrowIcon={School}
          title="Grade levels"
          subtitle="Activate the grades your school offers, then add each grade's sections."
          stats={
            <>
              <StatCard
                title="Active grades"
                value={activeGradeCount}
                hint="Grades this school offers"
                icon={GraduationCap}
                tone="emerald"
                inlineOnPhone
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Sections"
                value={activeSectionCount}
                hint="Across all active grades"
                icon={Layers}
                tone="emerald"
                inlineOnPhone
                denseOnPhone
                valueClassName="text-xl sm:text-2xl"
              />
              <StatCard
                title="Active school year"
                value={activeYear?.label ?? "Not set"}
                hint="Learners enroll against this year"
                icon={CalendarRange}
                tone="primary"
                inlineOnPhone
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
