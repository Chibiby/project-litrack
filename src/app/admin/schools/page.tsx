import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import {
  getSchoolsListPage,
  parseSchoolsListParams,
  schoolsTotalPages,
} from "@/lib/cache/schools-list";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SchoolsTable, type SchoolRow } from "@/components/schools-table";
import { TableSectionSkeleton } from "@/components/loading";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string; region?: string }>;
}

async function SchoolsTableBody({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; region?: string };
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

      <Card>
        <CardContent className="p-6">
          <SchoolsTable
            schools={tableData}
            list={{
              page: list.page,
              totalPages: schoolsTotalPages(totalCount, list.pageSize),
              totalCount,
              pageSize: list.pageSize,
              q: list.q,
              region: list.region,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

export default async function SchoolsListPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;

  return (
    <AppShell
      title="Schools"
      subtitle="All registered schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/schools/new" prefetch={true}>
            <Plus className="h-4 w-4 mr-2" /> New School
          </Link>
        </Button>
      </div>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">After deploying migrations, regenerate School Head credentials</p>
        <p className="mt-1 text-amber-900/90">
          Schools created before the auth overhaul may still rely on School-ID-era passwords. Use the
          key icon on each row to regenerate a one-time activation credential, then have the School
          Head sign in and set a private password. See{" "}
          <code className="rounded bg-amber-100 px-1 text-xs">docs/migrate-checklist.md</code>.
        </p>
      </div>

      <Suspense fallback={<TableSectionSkeleton rows={8} columns={5} />}>
        <SchoolsTableBody searchParams={params} />
      </Suspense>
    </AppShell>
  );
}
