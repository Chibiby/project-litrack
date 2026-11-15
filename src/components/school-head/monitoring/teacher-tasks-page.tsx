import { Suspense } from "react";
import { BookOpenCheck, ClipboardCheck } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import { getTeacherTaskSummary } from "@/lib/teacher-tasks/queries";
import type { TeacherTaskSummary } from "@/lib/teacher-tasks/types";
import { aralTeacherSummary } from "@/lib/monitoring/counts";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TeacherTasksBoard } from "@/components/school-head/teacher-tasks/teacher-tasks-board";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";

type Scope = "ALL" | "ARAL";

const COPY: Record<Scope, { title: string; subtitle: string; route: string }> = {
  ALL: {
    title: "Non-compliance",
    subtitle:
      "Teachers who have not finished MOSY, reading levels, attendance, ARAL profiling or end-of-term reports for the periods below. Export the list to follow up.",
    route: SCHOOL_HEAD_ROUTES.monitoringNonCompliance,
  },
  ARAL: {
    title: "ARAL Monitoring",
    subtitle:
      "ARAL teachers who are behind on weekly attendance, the monthly reading level or ARAL profiling for their ARAL learners.",
    route: SCHOOL_HEAD_ROUTES.monitoringAral,
  },
};

async function Body({ view, scope }: { view: SchoolHeadView; scope: Scope }) {
  const todayKey = formatLocalDateKey(schoolToday());
  let summary: TeacherTaskSummary;
  try {
    const all = await getTeacherTaskSummary(view.schoolId, todayKey);
    summary = scope === "ARAL" ? aralTeacherSummary(all) : all;
  } catch (err) {
    console.error(`[Monitoring ${scope}] failed to load summary:`, err);
    return (
      <p className="text-sm text-destructive">
        Could not load the list right now. The database may be unavailable. Reload the page to try again.
      </p>
    );
  }
  return (
    <TeacherTasksBoard
      summary={summary}
      readOnly={view.isSuperAdminView}
      schoolId={view.schoolId}
      scope={scope}
    />
  );
}

/** Shared page body for Monitoring > Non-compliance and Monitoring > ARAL Monitoring. */
export async function TeacherTasksMonitoringPage({
  scope,
  schoolIdParam,
}: {
  scope: Scope;
  schoolIdParam: string | undefined;
}) {
  const copy = COPY[scope];
  const { view } = await resolveSchoolHeadView(schoolIdParam, copy.route);
  return (
    <SchoolHeadPage
      title={copy.title}
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="Monitoring"
          eyebrowIcon={scope === "ARAL" ? BookOpenCheck : ClipboardCheck}
          title={copy.title}
          subtitle={copy.subtitle}
        />
      }
    >
      <Suspense
        fallback={
          <div className="space-y-4">
            <MetricsGridSkeleton className="mb-0" count={scope === "ARAL" ? 4 : 6} />
            <TableSectionSkeleton rows={8} columns={scope === "ARAL" ? 5 : 7} />
          </div>
        }
      >
        <Body view={view} scope={scope} />
      </Suspense>
    </SchoolHeadPage>
  );
}
