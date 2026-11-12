import { CalendarRange, GraduationCap, Layers, School } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSchoolHeadMetricCounts } from "@/lib/dashboard/aggregates";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import {
  SCHOOL_TABS,
  SCHOOL_WORKSPACE_TABS,
} from "@/components/school-head/workspace-tabs";
import { Callout } from "@/components/ui/callout";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  SchoolYearsList,
  type SchoolYearListItem,
} from "@/components/school-head/school-year-forms";
import { toMonthKey } from "@/lib/school-year/months";

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

  const [years, { gradeCount: activeGradeCount, sectionCount: activeSectionCount }] =
    await Promise.all([
      prisma.schoolYear.findMany({
        where: { schoolId: view.schoolId },
        orderBy: { startDate: "desc" },
        // Counts decide two things per row: whether the edit dialog warns that
        // changing dates will not move existing records, and whether removal is
        // offered at all. Cheap here (one grouped count per year) versus a second
        // round trip from the client once the dialog is already open.
        select: {
          id: true,
          label: true,
          startDate: true,
          endDate: true,
          isActive: true,
          _count: { select: { enrollments: true, termGrades: true } },
        },
      }),
      // Hero's grade/section stats reuse the cached dashboard aggregate — the
      // active-year figure below comes from `years` itself, not this call.
      getSchoolHeadMetricCounts(view.schoolId),
    ]);

  const items: SchoolYearListItem[] = years.map((y) => ({
    id: y.id,
    label: y.label,
    startMonth: toMonthKey(y.startDate),
    endMonth: y.endDate ? toMonthKey(y.endDate) : null,
    isActive: y.isActive,
    enrollmentCount: y._count.enrollments,
    termGradeCount: y._count.termGrades,
  }));

  const active = items.find((y) => y.isActive);

  return (
    <SchoolHeadPage
      title="School years"
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.years}
      hero={
        <SchoolHeadHero
          eyebrow="School"
          eyebrowIcon={School}
          title="School years"
          subtitle="The Division Admin creates school years and picks the active one. You set when each year starts and ends at your school."
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
                value={active?.label ?? "Not set"}
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
      callout={
        active ? null : (
          <Callout title="No active school year">
            New learners will be created without an enrollment record until the
            Division Admin makes a year active.
          </Callout>
        )
      }
    >
      <Surface as="section">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Years</h2>
        </SurfaceHeader>
        <SurfaceBody>
          {items.length === 0 ? (
            <EmptyState
              title="No school years yet"
              description="The Division Admin adds school years for every school."
              icon={CalendarRange}
            />
          ) : (
            <SchoolYearsList
              years={items}
              canSetMonths
              canManage={view.isSuperAdminView}
            />
          )}
        </SurfaceBody>
      </Surface>

    </SchoolHeadPage>
  );
}
