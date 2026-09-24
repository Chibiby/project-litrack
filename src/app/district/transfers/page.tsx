import { Suspense } from "react";
import { ArrowRightLeft } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { prisma } from "@/lib/prisma";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { CrossSchoolTransferForm } from "@/components/admin/cross-school-transfer-form";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

async function DistrictTransferBody({
  scope,
  fromParam,
  toParam,
}: {
  scope: AdminScope;
  fromParam: string;
  toParam: string;
}) {
  const schools = (await resolveScopeSchools(scope, false)).filter((school) => school.isActive);
  // A school id from the URL is used only when it is one of the caller's own
  // schools; anything else is treated as not chosen, and never queried.
  const inScope = (id: string) => (id && schools.some((school) => school.id === id) ? id : "");
  const fromSchoolId = inScope(fromParam);
  const toSchoolId = inScope(toParam);

  const [grades, sections, teachers, targetActiveYear] = toSchoolId
    ? await Promise.all([
        prisma.gradeLevel.findMany({
          // FLOATING is a same-school holding state, never a cross-school target.
          where: { schoolId: toSchoolId, deletedAt: null, type: { not: "FLOATING" } },
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true },
        }),
        prisma.section.findMany({
          where: { schoolId: toSchoolId, deletedAt: null },
          select: { id: true, name: true, gradeLevelId: true },
        }),
        prisma.user.findMany({
          where: { schoolId: toSchoolId, role: "TEACHER", deletedAt: null, isActive: true },
          select: {
            id: true,
            fullName: true,
            advisorySections: { where: { deletedAt: null }, select: { gradeLevelId: true } },
          },
        }),
        prisma.schoolYear.findFirst({
          where: { schoolId: toSchoolId, isActive: true },
          select: { id: true },
        }),
      ])
    : [[], [], [], null];

  return (
    <div className="space-y-6">
      {toSchoolId && !targetActiveYear ? (
        <Callout variant="warning" className="max-w-2xl">
          The target school has no active school year. The transfer still moves the learner, but
          no new enrollment record is created until that school starts a year.
        </Callout>
      ) : null}

      <Card className="min-w-0 max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Transfer learner</CardTitle>
        </CardHeader>
        <CardContent>
          {schools.length < 2 ? (
            <EmptyState
              title="Need at least two active schools"
              description="Transfers move a learner between two of your active schools."
              icon={ArrowRightLeft}
            />
          ) : (
            <CrossSchoolTransferForm
              basePath={DISTRICT_ROUTES.transfers}
              schools={schools.map((school) => ({ id: school.id, name: school.name }))}
              fromSchoolId={fromSchoolId}
              toSchoolId={toSchoolId}
              grades={grades.map((grade) => ({ id: grade.id, label: GRADE_LEVEL_LABELS[grade.type] }))}
              sections={sections}
              teachers={teachers.map((teacher) => ({
                id: teacher.id,
                fullName: teacher.fullName,
                gradeIds: [...new Set(teacher.advisorySections.map((section) => section.gradeLevelId))],
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DistrictTransfersPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const params = await searchParams;

  return (
    <AppShell
      title="Learner transfers"
      subtitle={describeScope(scope)}
      role={user.role}
      userName={user.fullName || user.email}
    >
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <>
          {scope.kind === "districts" ? (
            <Callout variant="info" className="mb-6 max-w-2xl">
              Transfers to or from schools outside your districts are handled by the division
              office.
            </Callout>
          ) : null}
          <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
            <DistrictTransferBody
              scope={scope}
              fromParam={params.from?.trim() ?? ""}
              toParam={params.to?.trim() ?? ""}
            />
          </Suspense>
        </>
      )}
    </AppShell>
  );
}
