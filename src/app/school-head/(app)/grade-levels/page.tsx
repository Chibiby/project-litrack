import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { ListCardSkeleton } from "@/components/loading";
import { GradeLevelsClient } from "@/components/school-head/grade-levels-client";

export const dynamic = "force-dynamic";

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

export default async function GradeLevelsPage({ searchParams }: GradeLevelsPageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/grade-levels"
  );

  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title={isSuperAdminView ? `Grade Levels - ${schoolName || "Unknown"}` : "Grade Levels"}
      subtitle={
        isSuperAdminView
          ? "Super Admin View"
          : "Activate grades and manage their sections here"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<ListCardSkeleton grid items={10} />}>
        <GradeLevelsGrid schoolId={schoolId} isSuperAdminView={isSuperAdminView} />
      </Suspense>
    </AppShell>
  );
}
