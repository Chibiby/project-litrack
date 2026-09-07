import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import {
  getSchoolAccountsPage,
  parseSchoolAccountsParams,
  schoolAccountsTotalPages,
  type SchoolAccountRow,
} from "@/lib/admin/school-accounts";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { SchoolAccountsTable } from "@/components/admin/school-accounts-table";
import { TableSectionSkeleton } from "@/components/loading";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string }>;
}

async function SchoolAccountsBody({
  searchParams,
}: {
  searchParams: { page?: string; q?: string };
}) {
  const list = parseSchoolAccountsParams(searchParams);
  let rows: SchoolAccountRow[] = [];
  let totalCount = 0;
  let dbAvailable = true;

  try {
    const page = await getSchoolAccountsPage(list);
    rows = page.rows;
    totalCount = page.totalCount;
  } catch (err) {
    // Same degradation the schools table uses: an unreachable database must not
    // turn an authenticated admin page into a 500.
    console.error("[SchoolAccountsPage] failed to load accounts:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load school accounts right now. The database may be unavailable.
        </p>
      ) : null}

      <Card>
        <CardContent className="p-6">
          <SchoolAccountsTable
            rows={rows}
            list={{
              page: list.page,
              totalPages: schoolAccountsTotalPages(totalCount, list.pageSize),
              totalCount,
              pageSize: list.pageSize,
              q: list.q,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

export default async function SchoolAccountsPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;

  return (
    <AppShell
      title="School accounts"
      subtitle="Sign-in credentials for every school's School Head"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4 flex gap-3 rounded-xl border border-border/80 bg-muted/40 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">How passwords work here</p>
          <p className="text-muted-foreground">
            Passwords are stored as one-way hashes, so a password a School Head chose themselves
            cannot be displayed — not by anyone, including this console. What you can always do is{" "}
            <strong className="font-medium text-foreground">Reset</strong>, which puts the password
            back to the school&rsquo;s School ID so you can sign in, or{" "}
            <strong className="font-medium text-foreground">Sign in as</strong>, which takes over
            the session without changing their password at all. Both are recorded in the audit log.
          </p>
        </div>
      </div>

      <Suspense fallback={<TableSectionSkeleton rows={8} columns={6} />}>
        <SchoolAccountsBody searchParams={params} />
      </Suspense>
    </AppShell>
  );
}
