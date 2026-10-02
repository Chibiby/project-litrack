import { Suspense } from "react";
import { HandHelping } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  aralTutorsTotalPages,
  getAralTutorsPage,
  getAralTutorsSummary,
  parseAralTutorsParams,
  type AralTutorRow,
  type AralTutorsParams,
  type AralTutorsSummary,
} from "@/lib/admin/aral-tutors";
import { listGradeOptions } from "@/lib/admin/management";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { AralTutorsTable } from "@/components/admin/management/aral-tutors-table";
import { gradeField } from "@/components/admin/management/filter-fields";
import {
  AralTutorsSummaryCards,
  SummaryUnavailable,
} from "@/components/admin/management/summary-cards";
import { listKey } from "@/lib/nav/list-params";

export const dynamic = "force-dynamic";

/** Params that change the rows; `q` left out so typing keeps focus (see `listKey`). */
const ARAL_TUTORS_LIST_KEYS = ["page", "grade", "sort"] as const;

interface PageProps {
  searchParams: Promise<{ schoolId?: string; page?: string; q?: string; grade?: string; sort?: string }>;
}

async function AralTutorsCards({ view }: { view: SchoolHeadView }) {
  let summary: AralTutorsSummary;
  try {
    summary = await getAralTutorsSummary({ kind: "school", schoolId: view.schoolId });
  } catch (err) {
    console.error("[SchoolHeadAralTutorsPage] failed to load summary:", err);
    return <SummaryUnavailable what="ARAL tutor" />;
  }
  return <AralTutorsSummaryCards summary={summary} scope={view.schoolName ?? "Your school"} />;
}

async function AralTutorsBody({
  view,
  params,
}: {
  view: SchoolHeadView;
  params: AralTutorsParams;
}) {
  let rows: AralTutorRow[] = [];
  let totalCount = 0;
  let dbAvailable = true;
  try {
    const page = await getAralTutorsPage({ kind: "school", schoolId: view.schoolId }, params);
    rows = page.rows;
    totalCount = page.totalCount;
  } catch (err) {
    console.error("[SchoolHeadAralTutorsPage] failed to load tutors:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load ARAL tutors right now. The database may be unavailable.
        </p>
      ) : null}
      <AralTutorsTable
        rows={rows}
        filters={[
          {
            ...gradeField(listGradeOptions(), params.grade),
            help: "Tutors with at least one ARAL learner in this grade.",
          },
        ]}
        sort={params.sort}
        basePath={SCHOOL_HEAD_ROUTES.aralTutors}
        keepParams={view.isSuperAdminView ? ["schoolId"] : undefined}
        clearHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.aralTutors)}
        list={{
          page: params.page,
          pageSize: params.pageSize,
          totalPages: aralTutorsTotalPages(totalCount, params.pageSize),
          totalCount,
          q: params.q,
        }}
      />
    </>
  );
}

/** Teachers who tutor ARAL learners in this school, with how many and in which grades. */
export default async function SchoolHeadAralTutorsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.aralTutors);
  const params = parseAralTutorsParams({
    page: raw.page,
    q: raw.q,
    grade: raw.grade,
    sort: raw.sort,
  });

  return (
    <SchoolHeadPage
      title="ARAL Tutors"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={HandHelping}
          title="ARAL Tutors"
          subtitle="The teachers who tutor ARAL learners in your school, and how many learners each one has."
        />
      }
    >
      <Suspense fallback={<MetricsGridSkeleton className="mb-0" count={3} />}>
        <AralTutorsCards view={view} />
      </Suspense>

      <Suspense
        key={listKey(raw, ARAL_TUTORS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} />}
      >
        <AralTutorsBody view={view} params={params} />
      </Suspense>
    </SchoolHeadPage>
  );
}
