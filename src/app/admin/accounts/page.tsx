import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
import { AccountsTable } from "@/components/admin/accounts-table";
import {
  getAccountsPage,
  parseAccountsParams,
  accountsTotalPages,
  type AccountRow,
} from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string; role?: string; schoolId?: string }>;
}

async function AccountsTableBody({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; role?: string; schoolId?: string };
}) {
  const params = parseAccountsParams(searchParams);
  let rows: AccountRow[] = [];
  let totalCount = 0;
  let dbAvailable = true;

  try {
    const page = await getAccountsPage(params);
    rows = page.rows;
    totalCount = page.totalCount;
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty table
    // instead of a 500. requireUser already verified the session.
    console.error("[AdminAccountsPage] failed to load accounts:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load accounts right now. The database may be unavailable.
        </p>
      ) : null}

      <AccountsTable
        rows={rows}
        list={{
          page: params.page,
          totalPages: accountsTotalPages(totalCount, params.pageSize),
          totalCount,
          role: params.role ?? "",
          schoolId: params.schoolId ?? "",
          q: params.q,
        }}
      />
    </>
  );
}

/**
 * Super Admin accounts console: every account across every school, one place
 * to find a person by name and diagnose what is wrong with their login
 * (reveal / reset a password, or sign in as them). Replaces
 * `/admin/school-accounts`, which now redirects here.
 *
 * `getAccountsPage` is pinned at 3 Prisma calls regardless of row count: the
 * rows, their count, and one batch lookup for each school's sign-in head.
 * Nothing here may add a per-row query or per-row `await`.
 */
export default async function AdminAccountsPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;

  return (
    <AppShell
      title="Accounts"
      subtitle="Every account across every school"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={6} />}>
        <AccountsTableBody searchParams={params} />
      </Suspense>
    </AppShell>
  );
}
