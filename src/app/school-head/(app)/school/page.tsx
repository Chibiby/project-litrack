import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
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
  const existing = await prisma.gradeLevel.findMany({
    where: { schoolId, deletedAt: null },
    select: {
      id: true,
      type: true,
      _count: { select: { teachers: true, learners: true } },
      sections: {
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
  });
  const existingMap = new Map(existing.map((g) => [g.type, g]));

  const activeTypes = ALL_TYPES.filter((type) => existingMap.has(type));
  // FLOATING stays in ALL_TYPES so an existing floating grade still renders (with
  // its learner count), but it is never offered as something to create: it is
  // system-managed and appears only once a transfer puts a learner into it.
  const inactiveTypes = ALL_TYPES.filter(
    (type) => !existingMap.has(type) && type !== "FLOATING"
  );

  const active = activeTypes.map((type) => {
    const grade = existingMap.get(type)!;
    return {
      id: grade.id,
      type,
      teacherCount: grade._count.teachers,
      learnerCount: grade._count.learners,
      sections: grade.sections,
    };
  });

  return (
    <GradeLevelsClient
      active={active}
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

  return (
    <SchoolHeadPage
      title="Grade levels"
      description="Activate the grades your school offers, then add each grade's sections."
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.gradeLevels}
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
