import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import {
  SCHOOLS_LIST_SORTS,
  getRemovedSchools,
  getSchoolsListPage,
  parseSchoolsListParams,
  schoolsTotalPages,
} from "@/lib/cache/schools-list";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { Button } from "@/components/ui/button";
import { Surface, SurfaceBody } from "@/components/ui/surface";
import { SchoolsTable, type SchoolRow } from "@/components/schools-table";
import {
  RemovedSchoolsTable,
  SchoolsViewTabs,
  type RemovedSchoolTableRow,
} from "@/components/removed-schools";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import {
  SchoolsSummaryCards,
  SummaryUnavailable,
} from "@/components/admin/management/summary-cards";
import {
  getSchoolsSummary,
  listDistrictOptions,
  type SchoolsSummary,
} from "@/lib/admin/management";
import { Plus, School } from "lucide-react";
import { PageTip } from "@/components/admin/page-tip";
import { listKey } from "@/lib/nav/list-params";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

/**
 * Params that change which rows the schools list shows — see `listKey`.
 * `q` is left out: search runs as you type, and a remount on each search would
 * drop the search box's focus.
 */
export const SCHOOLS_LIST_KEYS = ["page", "sort", "region", "status", "district", "view"] as const;

/** Params the summary cards honour; paging, sort, status and search never re-suspend them. */
const SCHOOLS_SUMMARY_KEYS = ["region", "district", "view"] as const;

export const dynamic = "force-dynamic";

type SchoolsSearchParams = {
  page?: string;
  q?: string;
  region?: string;
  status?: string;
  district?: string;
  sort?: string;
  view?: string;
};

interface PageProps {
  searchParams: Promise<SchoolsSearchParams>;
}

async function SchoolsSummaryBody({ searchParams }: { searchParams: SchoolsSearchParams }) {
  const list = parseSchoolsListParams(searchParams);
  let summary: SchoolsSummary | null = null;
  try {
    summary = await getSchoolsSummary({ district: list.district, region: list.region });
  } catch (err) {
    console.error("[SchoolsListPage] failed to load summary:", err);
  }
  if (!summary) return <SummaryUnavailable what="school" />;
  const scope = [list.district ? `${list.district} district` : "", list.region]
    .filter(Boolean)
    .join(" · ");
  return <SchoolsSummaryCards summary={summary} scope={scope || "Whole division"} />;
}

async function RemovedSchoolsBody() {
  let rows: RemovedSchoolTableRow[] = [];
  let dbAvailable = true;

  try {
    const removed = await getRemovedSchools();
    rows = removed.map((school) => ({
      id: school.id,
      name: school.name,
      schoolIdCode: school.schoolIdCode,
      isDemo: school.isDemo,
      removedAt: school.removedAt.toISOString(),
      users: school.users,
      learners: school.learners,
    }));
  } catch (err) {
    console.error("[SchoolsListPage] failed to load removed schools:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load removed schools right now. The database may be unavailable.
        </p>
      ) : null}
      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceBody className="p-3 sm:p-5">
          <RemovedSchoolsTable schools={rows} />
        </SurfaceBody>
      </Surface>
    </>
  );
}

async function SchoolsTableBody({ searchParams }: { searchParams: SchoolsSearchParams }) {
  const list = parseSchoolsListParams(searchParams);
  let tableData: SchoolRow[] = [];
  let totalCount = 0;
  let districtOptions: string[] = [];
  let dbAvailable = true;

  try {
    const [page, districts] = await Promise.all([getSchoolsListPage(list), listDistrictOptions()]);
    tableData = page.rows;
    totalCount = page.totalCount;
    districtOptions = districts.map((d) => d.district);
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty table
    // instead of a 500. requireUser already verified the session.
    console.error("[SchoolsListPage] failed to load schools:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load schools right now. The database may be unavailable.
        </p>
      ) : null}

      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceBody className="p-3 sm:p-5">
          <SchoolsTable
            schools={tableData}
            districtOptions={districtOptions}
            list={{
              page: list.page,
              totalPages: schoolsTotalPages(totalCount, list.pageSize),
              totalCount,
              pageSize: list.pageSize,
              q: list.q,
              region: list.region,
              status: list.status,
              district: list.district ?? "",
              sort: list.sort,
              sortOptions: SCHOOLS_LIST_SORTS.options,
            }}
          />
        </SurfaceBody>
      </Surface>
    </>
  );
}

export default async function SchoolsListPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const removedView = params.view === "removed";

  return (
    <AdminPage
      title="Schools"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Division"
          eyebrowIcon={School}
          title="Schools"
          subtitle="Every registered school. Open one as its School Head, switch it off, or reset its head's password."
          topRight={
            <Button asChild size="sm" className="lg:h-9">
              <Link href={ADMIN_ROUTES.newSchool} prefetch={true}>
                <Plus aria-hidden /> <span className="max-sm:sr-only">New school</span>
              </Link>
            </Button>
          }
        />
      }
    >
      <PageTip title="School Head can't sign in?">
        Use the key icon on the school&apos;s row to put the School Head&apos;s password back to their
        School ID. They sign in with the School ID straight away and can choose a private password
        afterwards. See{" "}
        <code className="rounded bg-amber-100 px-1 text-xs dark:bg-amber-900/60">docs/runbook.md</code>.
      </PageTip>

      {removedView ? null : (
        <Suspense
          key={listKey(params, SCHOOLS_SUMMARY_KEYS)}
          fallback={<MetricsGridSkeleton className="mb-0" />}
        >
          <SchoolsSummaryBody searchParams={params} />
        </Suspense>
      )}

      <SchoolsViewTabs view={removedView ? "removed" : "active"} />

      <Suspense
        key={listKey(params, SCHOOLS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} />}
      >
        {removedView ? <RemovedSchoolsBody /> : <SchoolsTableBody searchParams={params} />}
      </Suspense>
    </AdminPage>
  );
}
