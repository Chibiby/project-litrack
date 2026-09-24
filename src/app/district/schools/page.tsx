import { Suspense } from "react";
import { School } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { parseSchoolsListParams, schoolsTotalPages } from "@/lib/cache/schools-list";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { listKey } from "@/lib/nav/list-params";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { SchoolsTable, type SchoolsTableRow } from "@/components/schools-table";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

const DISTRICT_SCHOOLS_LIST_KEYS = ["page", "q", "status"] as const;

type SearchParams = { page?: string; q?: string; status?: string };

interface PageProps {
  searchParams: Promise<SearchParams>;
}

async function DistrictSchoolsBody({
  scope,
  searchParams,
}: {
  scope: AdminScope;
  searchParams: SearchParams;
}) {
  // The district portal never lists the demo tenant, whoever is viewing it.
  const schools = await resolveScopeSchools(scope, false);

  if (schools.length === 0) {
    return (
      <EmptyState
        title="No schools in your districts yet"
        description="Schools appear here once the division office registers them under your districts."
        icon={School}
      />
    );
  }

  const list = parseSchoolsListParams(searchParams);
  const q = list.q.toLowerCase();
  const filtered = schools.filter((school) => {
    if (list.status === "active" && !school.isActive) return false;
    if (list.status === "inactive" && school.isActive) return false;
    if (!q) return true;
    return (
      school.name.toLowerCase().includes(q) ||
      school.schoolIdCode.toLowerCase().includes(q) ||
      (school.district ?? "").toLowerCase().includes(q)
    );
  });
  const totalPages = schoolsTotalPages(filtered.length, list.pageSize);
  const page = Math.min(list.page, totalPages);
  const start = (page - 1) * list.pageSize;
  const rows: SchoolsTableRow[] = filtered.slice(start, start + list.pageSize).map((school) => ({
    id: school.id,
    name: school.name,
    schoolIdCode: school.schoolIdCode,
    region: school.region,
    division: school.division,
    district: school.district,
    isActive: school.isActive,
    isDemo: false,
  }));

  return (
    <Card className="min-w-0">
      <CardContent className="p-4 sm:p-6">
        <SchoolsTable
          schools={rows}
          list={{
            page,
            totalPages,
            totalCount: filtered.length,
            pageSize: list.pageSize,
            q: list.q,
            region: "",
            status: list.status,
          }}
          capabilities={{
            toggleActive: true,
            resetHead: true,
            edit: true,
            delete: false,
            openAsSchoolHead: false,
            columns: "district",
            basePath: DISTRICT_ROUTES.schools,
            emptyMessage: "No school matches your search.",
          }}
        />
      </CardContent>
    </Card>
  );
}

export default async function DistrictSchoolsPage({ searchParams }: PageProps) {
  const { user, scope } = await requireAdminScope();
  const params = await searchParams;

  return (
    <AppShell
      title="Schools"
      subtitle={describeScope(scope)}
      role={user.role}
      userName={user.fullName || user.email}
    >
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <Suspense
          key={listKey(params, DISTRICT_SCHOOLS_LIST_KEYS)}
          fallback={<TableSectionSkeleton rows={8} columns={5} />}
        >
          <DistrictSchoolsBody scope={scope} searchParams={params} />
        </Suspense>
      )}
    </AppShell>
  );
}
