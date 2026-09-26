import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import {
  SCHOOLS_LIST_SORTS,
  getSchoolsListPage,
  parseSchoolsListParams,
  schoolsTotalPages,
} from "@/lib/cache/schools-list";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { Button } from "@/components/ui/button";
import { Surface, SurfaceBody } from "@/components/ui/surface";
import { SchoolsTable, type SchoolRow } from "@/components/schools-table";
import { TableSectionSkeleton } from "@/components/loading";
import { Plus, School } from "lucide-react";
import { PageTip } from "@/components/admin/page-tip";
import { listKey } from "@/lib/nav/list-params";

/** Params that change which rows the schools list shows — see `listKey`. */
export const SCHOOLS_LIST_KEYS = ["page", "sort", "q", "region", "status"] as const;

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    q?: string;
    region?: string;
    status?: string;
    sort?: string;
  }>;
}

async function SchoolsTableBody({
  searchParams,
}: {
  searchParams: {
    page?: string;
    q?: string;
    region?: string;
    status?: string;
    sort?: string;
  };
}) {
  const list = parseSchoolsListParams(searchParams);
  let tableData: SchoolRow[] = [];
  let totalCount = 0;
  let dbAvailable = true;

  try {
    const page = await getSchoolsListPage(list);
    tableData = page.rows;
    totalCount = page.totalCount;
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
            list={{
              page: list.page,
              totalPages: schoolsTotalPages(totalCount, list.pageSize),
              totalCount,
              pageSize: list.pageSize,
              q: list.q,
              region: list.region,
              status: list.status,
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
              <Link href="/admin/schools/new" prefetch={true}>
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

      <Suspense
        key={listKey(params, SCHOOLS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={8} columns={5} />}
      >
        <SchoolsTableBody searchParams={params} />
      </Suspense>
    </AdminPage>
  );
}
