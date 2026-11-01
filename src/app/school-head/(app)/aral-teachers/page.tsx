import { Suspense } from "react";
import { HandHelping } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  aralTeachersTotalPages,
  getAralTeachersPage,
  getAralTeachersSummary,
  parseAralTeachersParams,
  type AralTeacherRow,
  type AralTeachersParams,
  type AralTeachersSummary,
} from "@/lib/admin/aral-teachers";
import { listGradeOptions } from "@/lib/admin/management";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { AralTeachersTable } from "@/components/admin/management/aral-teachers-table";
import { gradeField } from "@/components/admin/management/filter-fields";
import {
  AralTeachersSummaryCards,
  SummaryUnavailable,
} from "@/components/admin/management/summary-cards";
import { listKey } from "@/lib/nav/list-params";

export const dynamic = "force-dynamic";

/** Params that change the rows; `q` left out so typing keeps focus (see `listKey`). */
const ARAL_TEACHERS_LIST_KEYS = ["page", "grade", "sort"] as const;

interface PageProps {
  searchParams: Promise<{ schoolId?: string; page?: string; q?: string; grade?: string; sort?: string }>;
}

async function AralTeachersCards({ view }: { view: SchoolHeadView }) {
  let summary: AralTeachersSummary;
  try {
    summary = await getAralTeachersSummary({ kind: "school", schoolId: view.schoolId });
  } catch (err) {
    console.error("[SchoolHeadAralTeachersPage] failed to load summary:", err);
    return <SummaryUnavailable what="ARAL teacher" />;
  }
  return <AralTeachersSummaryCards summary={summary} scope={view.schoolName ?? "Your school"} />;
}

async function AralTeachersBody({
  view,
  params,
}: {
  view: SchoolHeadView;
  params: AralTeachersParams;
}) {
  let rows: AralTeacherRow[] = [];
  let totalCount = 0;
  let dbAvailable = true;
  try {
    const page = await getAralTeachersPage({ kind: "school", schoolId: view.schoolId }, params);
    rows = page.rows;
    totalCount = page.totalCount;
  } catch (err) {
    console.error("[SchoolHeadAralTeachersPage] failed to load teachers:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load ARAL teachers right now. The database may be unavailable.
        </p>
      ) : null}
      <AralTeachersTable
        rows={rows}
        filters={[
          {
            ...gradeField(listGradeOptions(), params.grade),
            help: "ARAL teachers with at least one ARAL learner in this grade.",
          },
        ]}
        sort={params.sort}
        basePath={SCHOOL_HEAD_ROUTES.aralTeachers}
        keepParams={view.isSuperAdminView ? ["schoolId"] : undefined}
        clearHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.aralTeachers)}
        list={{
          page: params.page,
          pageSize: params.pageSize,
          totalPages: aralTeachersTotalPages(totalCount, params.pageSize),
          totalCount,
          q: params.q,
        }}
      />
    </>
  );
}

/** Teachers who handle ARAL learners in this school, with how many and in which grades. */
export default async function SchoolHeadAralTeachersPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.aralTeachers);
  const params = parseAralTeachersParams({
    page: raw.page,
    q: raw.q,
    grade: raw.grade,
    sort: raw.sort,
  });

  return (
    <SchoolHeadPage
      title="ARAL Teachers"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={HandHelping}
          title="ARAL Teachers"
          subtitle="The teachers who handle ARAL learners in your school, and how many learners each one has."
        />
      }
    >
      <Suspense fallback={<MetricsGridSkeleton className="mb-0" count={3} />}>
        <AralTeachersCards view={view} />
      </Suspense>

      <Suspense
        key={listKey(raw, ARAL_TEACHERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} />}
      >
        <AralTeachersBody view={view} params={params} />
      </Suspense>
    </SchoolHeadPage>
  );
}
