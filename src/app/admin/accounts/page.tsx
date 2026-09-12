import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
import { AccountsTable } from "@/components/admin/accounts-table";
import {
  getAccountSummary,
  getAccountsPage,
  parseAccountsParams,
  accountsTotalPages,
  type AccountSummary,
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
  let summary: AccountSummary | undefined;
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

  if (dbAvailable) {
    try {
      summary = await getAccountSummary();
    } catch (err) {
      // The directory remains useful if its non-essential overview query is
      // temporarily unavailable; keep its rows and account controls visible.
      console.error("[AdminAccountsPage] failed to load account summary:", err);
    }
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
        summary={summary}
        list={{
          page: params.page,
          pageSize: params.pageSize,
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
 * The paged list is pinned at 3 Prisma calls regardless of row count: the
 * rows, their count, and one batch lookup for each school's sign-in head. The
 * compact overview adds one grouped aggregate query; nothing here may add a
 * per-row query or per-row `await`.
 */
export default async function AdminAccountsPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;

  return (
    <AppShell
      title="Accounts Management"
      subtitle="Manage all user accounts across schools and programs"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={10} columns={6} />}>
        <AccountsTableBody searchParams={params} />
      </Suspense>
    </AppShell>
  );
}
