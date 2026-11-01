import { Suspense } from "react";
import { HandHelping } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import {
  aralTeachersTotalPages,
  getAralTeachersPage,
  getAralTeachersSummary,
  parseAralTeachersParams,
  type AralTeacherRow,
  type AralTeachersParams,
  type AralTeachersSearchParams,
  type AralTeachersSummary,
} from "@/lib/admin/aral-teachers";
import { listDistrictOptions, listGradeOptions, listSchoolOptions } from "@/lib/admin/management";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { AralTeachersTable } from "@/components/admin/management/aral-teachers-table";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  gradeField,
  schoolField,
  scopeLabel,
} from "@/components/admin/management/filter-fields";
import {
  AralTeachersSummaryCards,
  SummaryUnavailable,
} from "@/components/admin/management/summary-cards";
import { listKey } from "@/lib/nav/list-params";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

export const dynamic = "force-dynamic";

/** Params that change the rows; `q` left out so typing keeps focus (see `listKey`). */
const ARAL_TEACHERS_LIST_KEYS = ["page", "district", "schoolId", "grade", "sort"] as const;

/** Params the summary cards honour; paging, sorting and the grade filter never re-suspend them. */
const SUMMARY_KEYS = ["district", "schoolId"] as const;

async function directoryFilters(params: AralTeachersParams): Promise<ListFilterField[]> {
  const [districts, schools] = await Promise.all([
    listDistrictOptions(),
    listSchoolOptions({ district: params.district }),
  ]);
  return [
    districtField(districts, params.district, ["schoolId"]),
    schoolField(schools, params.schoolId),
    {
      ...gradeField(listGradeOptions(), params.grade),
      help: "ARAL teachers with at least one ARAL learner in this grade.",
    },
  ];
}

async function AralTeachersCards({ params }: { params: AralTeachersParams }) {
  let loaded: { summary: AralTeachersSummary; scope: string } | null = null;
  try {
    const [schools, summary] = await Promise.all([
      params.schoolId ? listSchoolOptions({ district: params.district }) : Promise.resolve([]),
      getAralTeachersSummary({ kind: "admin", district: params.district, schoolId: params.schoolId }),
    ]);
    loaded = {
      summary,
      scope: scopeLabel({ district: params.district, schoolId: params.schoolId, schools }),
    };
  } catch (err) {
    console.error("[AdminAralTeachersPage] failed to load summary:", err);
  }
  if (!loaded) return <SummaryUnavailable what="ARAL teacher" />;
  return <AralTeachersSummaryCards summary={loaded.summary} scope={loaded.scope} />;
}

async function AralTeachersBody({ params }: { params: AralTeachersParams }) {
  let rows: AralTeacherRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, loadedFilters] = await Promise.all([
      getAralTeachersPage({ kind: "admin", district: params.district, schoolId: params.schoolId }, params),
      directoryFilters(params),
    ]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
  } catch (err) {
    console.error("[AdminAralTeachersPage] failed to load teachers:", err);
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
        filters={filters}
        sort={params.sort}
        basePath={ADMIN_ROUTES.aralTeachers}
        showSchool
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

/** Every teacher who handles ARAL learners, division-wide; narrow by district, school or grade. */
export default async function AdminAralTeachersPage({
  searchParams,
}: {
  searchParams: Promise<AralTeachersSearchParams>;
}) {
  const user = await requireUser("SUPER_ADMIN");
  const raw = await searchParams;
  const params = parseAralTeachersParams(raw);

  return (
    <AdminPage
      title="ARAL Teachers"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={HandHelping}
          title="ARAL Teachers"
          subtitle="Every teacher who handles ARAL learners, and how many learners each one has."
        />
      }
    >
      <Suspense key={listKey(raw, SUMMARY_KEYS)} fallback={<MetricsGridSkeleton className="mb-0" count={3} />}>
        <AralTeachersCards params={params} />
      </Suspense>

      <Suspense
        key={listKey(raw, ARAL_TEACHERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={6} />}
      >
        <AralTeachersBody params={params} />
      </Suspense>
    </AdminPage>
  );
}
