import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadAdminSchoolsList } from "@/lib/admin/dashboard-data";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SchoolsTable } from "@/components/schools-table";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SchoolsListPage() {
  const user = await requireUser("SUPER_ADMIN");
  const { schools, dbAvailable } = await loadAdminSchoolsList();

  return (
    <AppShell
      title="Schools"
      subtitle="All registered schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      {!dbAvailable ? (
        <div className="mb-4 rounded-lg border border-border bg-amber-muted px-4 py-3 text-sm text-amber-foreground">
          Database is unavailable. School list cannot load until{" "}
          <code className="text-xs">DATABASE_URL</code> is fixed on Vercel.
        </div>
      ) : null}

      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/schools/new">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New School
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <SchoolsTable schools={schools} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
