import { Suspense } from "react";
import { ArrowRightLeft } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { prisma } from "@/lib/prisma";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { CrossSchoolTransferForm } from "@/components/admin/cross-school-transfer-form";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { parseTransferKind } from "@/lib/transfers/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; school?: string; kind?: string }>;
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

      <Surface as="section" aria-labelledby="district-transfer-title" className="min-w-0 max-w-2xl rounded-lg">
        <SurfaceHeader className="px-4 sm:px-5">
          <h2 id="district-transfer-title" className="text-base font-semibold">
            Transfer learner
          </h2>
        </SurfaceHeader>
        <SurfaceBody className="p-4 sm:p-5">
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
        </SurfaceBody>
      </Surface>
    </div>
  );
}

/**
 * The cross-school transfer workspace for one school the admin picks. The
 * admin acts for that school: send, cancel, accept or decline, exactly as its
 * School Head would (resolveTransferActor checks the scope on every action).
 */
async function SchoolTransfersSection({
  scope,
  schoolParam,
  kindParam,
}: {
  scope: AdminScope;
  schoolParam: string;
  kindParam: string | undefined;
}) {
  const schools = (await resolveScopeSchools(scope, false)).filter((school) => school.isActive);
  const schoolId = schoolParam && schools.some((school) => school.id === schoolParam) ? schoolParam : "";
  const { param } = parseTransferKind(kindParam);
  const href = (kind: string) =>
    `${DISTRICT_ROUTES.transfers}?school=${encodeURIComponent(schoolId)}&kind=${kind}`;

  return (
    <Surface as="section" aria-labelledby="school-transfers-title" className="min-w-0 rounded-lg">
      <SurfaceHeader className="px-4 sm:px-5">
        <h2 id="school-transfers-title" className="text-base font-semibold">
          Transfers between schools
        </h2>
        <p className="text-sm text-muted-foreground">
          Learners, teachers and ARAL volunteers. Nobody moves until the receiving school accepts.
        </p>
      </SurfaceHeader>
      <SurfaceBody className="space-y-4 p-4 sm:p-5">
        <form method="get" action={DISTRICT_ROUTES.transfers} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
            <Label htmlFor="transfer-school">School</Label>
            <select
              id="transfer-school"
              name="school"
              defaultValue={schoolId}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm lg:h-9"
            >
              <option value="">Choose a school</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="kind" value={param} />
          <Button type="submit" variant="outline">
            Show transfers
          </Button>
        </form>
        {schoolId ? (
          <TransferPanel schoolId={schoolId} kindParam={param} kindHref={href} />
        ) : (
          <p className="text-sm text-muted-foreground">Choose a school to see and answer its transfers.</p>
        )}
      </SurfaceBody>
    </Surface>
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
      hideTitle
    >
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="Learners"
          eyebrowIcon={ArrowRightLeft}
          title="Transfers"
          subtitle="Answer transfers between your schools, or move a learner at once with their records."
          meta={describeScope(scope)}
          variant="compact"
        />
      </div>
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
          <Suspense
            key={`${params.school ?? ""}:${params.kind ?? ""}`}
            fallback={<TableSectionSkeleton rows={6} columns={4} className="mb-6 rounded-lg" />}
          >
            <div className="mb-6">
              <SchoolTransfersSection
                scope={scope}
                schoolParam={params.school?.trim() ?? ""}
                kindParam={params.kind}
              />
            </div>
          </Suspense>
          <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} className="max-w-2xl rounded-lg" />}>
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
