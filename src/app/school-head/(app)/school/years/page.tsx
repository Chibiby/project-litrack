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
  CreateSchoolYearDialog,
  SchoolYearsList,
  type SchoolYearListItem,
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
  });

  const items: SchoolYearListItem[] = years.map((y) => ({
    id: y.id,
    label: y.label,
    startDate: y.startDate.toISOString().slice(0, 10),
    endDate: y.endDate.toISOString().slice(0, 10),
    isActive: y.isActive,
    enrollmentCount: y._count.enrollments,
    termGradeCount: y._count.termGrades,
  }));

  const active = items.find((y) => y.isActive);

  return (
    <SchoolHeadPage
      title="School years"
      description="One year is active at a time. Learners are enrolled against the active year."
      view={view}
      tabs={SCHOOL_WORKSPACE_TABS}
      activeTab={SCHOOL_TABS.years}
      actions={
        view.isSuperAdminView ? null : (
          <CreateSchoolYearDialog existingYears={items} />
        )
      }
      callout={
        active ? null : (
          <Callout title="No active school year">
            New learners will be created without an enrollment record until you mark
            a year active.
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
              description="Add a school year and mark one active to start enrolling learners."
              icon={CalendarRange}
            />
          ) : (
            <SchoolYearsList readOnly={view.isSuperAdminView} years={items} />
          )}
        </SurfaceBody>
      </Surface>

      {view.isSuperAdminView ? null : (
        <Surface as="section">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">Correcting a school year</h2>
          </SurfaceHeader>
          <SurfaceBody className="space-y-3 text-sm text-muted-foreground">
            <p>
              Mistakes here are fixable. <strong className="text-foreground">Edit</strong>{" "}
              on any row opens the label and the date range for correction — use it
              when a year was typed as the wrong span, or the division moved the
              opening date after you had already set it up.
            </p>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>Press Edit on the year you need to fix.</li>
              <li>
                Correct the label (YYYY-YYYY, consecutive years) or either date, then
                Save changes.
              </li>
              <li>
                The list and every report pick up the new details immediately. Nobody
                is unenrolled and no grades move — enrolments are attached to the
                year itself, not to its dates.
              </li>
            </ol>
            <p>
              Two things editing deliberately cannot do.{" "}
              <strong className="text-foreground">It never changes which year is active</strong>{" "}
              — that stays a separate Set active decision, so a typo fix cannot
              quietly redirect where new learners are enrolled. And a year with
              enrolments or grades behind it{" "}
              <strong className="text-foreground">cannot be removed</strong>, only
              corrected; the remove button appears only on a year that still has no
              records, which is the duplicate you meant to undo.
            </p>
            <p>
              Every correction is written to the audit log with its before and after
              values, so a range that changed mid-year can always be traced.
            </p>
          </SurfaceBody>
        </Surface>
      )}
    </SchoolHeadPage>
  );
}
