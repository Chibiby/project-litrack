import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListCardSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { CreateGradeLevelButton } from "@/components/school-head/create-grade-level-button";
import { GradeSectionsPanel } from "@/components/school-head/section-forms";

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
  const inactiveTypes = ALL_TYPES.filter((type) => !existingMap.has(type));

  return (
    <div className="space-y-8">
      {activeTypes.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Active grades</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {activeTypes.map((type) => {
              const grade = existingMap.get(type)!;
              const sectionCount = grade.sections.length;
              return (
                <Card key={type} className="border-primary/50">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{GRADE_LEVEL_LABELS[type]}</span>
                      <Badge variant="secondary">Active</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {grade._count.teachers} teachers · {grade._count.learners} learners ·{" "}
                      {sectionCount} {sectionCount === 1 ? "section" : "sections"}
                    </p>
                    <GradeSectionsPanel
                      gradeLevelId={grade.id}
                      sections={grade.sections}
                      readOnly={isSuperAdminView}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {inactiveTypes.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {isSuperAdminView ? "Not created" : "Create a grade"}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            {inactiveTypes.map((type) => (
              <Card key={type}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{GRADE_LEVEL_LABELS[type]}</span>
                  </div>
                  {isSuperAdminView ? (
                    <p className="text-xs text-muted-foreground">Not created</p>
                  ) : (
                    <CreateGradeLevelButton
                      type={type}
                      label={GRADE_LEVEL_LABELS[type]}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
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
