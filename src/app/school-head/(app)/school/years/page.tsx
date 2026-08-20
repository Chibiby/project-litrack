import { CalendarRange } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  SCHOOL_TABS,
  SCHOOL_WORKSPACE_TABS,
} from "@/components/school-head/workspace-tabs";
import { Callout } from "@/components/ui/callout";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CreateSchoolYearForm,
  SchoolYearsList,
} from "@/components/school-head/school-year-forms";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolYearsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.schoolYears
  );

  const years = await prisma.schoolYear.findMany({
    where: { schoolId: view.schoolId },
    orderBy: { startDate: "desc" },
  });

  const active = years.find((y) => y.isActive);

  return (
    <SchoolHeadPage
      title="School years"
      description="One year is active at a time. Learners are enrolled against the active year."
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.years}
      callout={
        active ? null : (
          <Callout title="No active school year">
            New learners will be created without an enrollment record until you mark
            a year active.
          </Callout>
        )
      }
      contentClassName="grid gap-6 lg:grid-cols-2"
    >
      {view.isSuperAdminView ? null : (
        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">Create school year</h2>
          </SurfaceHeader>
          <SurfaceBody>
            <CreateSchoolYearForm />
          </SurfaceBody>
        </Surface>
      )}

      <Surface as="section" className={view.isSuperAdminView ? "lg:col-span-2" : undefined}>
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Years</h2>
        </SurfaceHeader>
        <SurfaceBody>
          {years.length === 0 ? (
            <EmptyState
              title="No school years yet"
              description="Create a school year and mark one active to start enrolling learners."
              icon={CalendarRange}
            />
          ) : (
            <SchoolYearsList
              readOnly={view.isSuperAdminView}
              years={years.map((y) => ({
                id: y.id,
                label: y.label,
                startDate: y.startDate.toISOString().slice(0, 10),
                endDate: y.endDate.toISOString().slice(0, 10),
                isActive: y.isActive,
              }))}
            />
          )}
        </SurfaceBody>
      </Surface>
    </SchoolHeadPage>
  );
}
