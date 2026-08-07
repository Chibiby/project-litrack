import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getSchoolsList } from "@/lib/cache/schools-list";
import { AppShell } from "@/components/app-shell";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SchoolsTable, type SchoolRow } from "@/components/schools-table";
import { TableSectionSkeleton } from "@/components/loading";
import { getAdminSchoolImpersonationWarmHrefs } from "@/lib/nav/warm-hrefs";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

async function SchoolsTableBody() {
  let tableData: SchoolRow[] = [];
  let dbAvailable = true;

  try {
    tableData = await getSchoolsList();
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty table
    // instead of a 500. requireUser already verified the session.
    console.error("[SchoolsListPage] failed to load schools:", err);
    dbAvailable = false;
  }

  const impersonationHrefs = getAdminSchoolImpersonationWarmHrefs(tableData);
  const impersonationKey = `admin:schools:impersonation:${tableData.map((s) => s.id).join(",")}`;

  return (
    <>
      <NavPrefetcher cacheKey={impersonationKey} hrefs={impersonationHrefs} />
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load schools right now. The database may be unavailable.
        </p>
      ) : null}

      <Card>
        <CardContent className="p-6">
          <SchoolsTable schools={tableData} />
        </CardContent>
      </Card>
    </>
  );
}

export default async function SchoolsListPage() {
  const user = await requireUser("SUPER_ADMIN");

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
        <SchoolsTableBody />
      </Suspense>
    </AppShell>
  );
}
