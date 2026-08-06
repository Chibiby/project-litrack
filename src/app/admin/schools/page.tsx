import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SchoolsTable, type SchoolRow } from "@/components/schools-table";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SchoolsListPage() {
  const user = await requireUser("SUPER_ADMIN");

  let tableData: SchoolRow[] = [];
  let dbAvailable = true;

  try {
    const schools = await prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, schoolIdCode: true, region: true, division: true, isActive: true,
        _count: { select: { users: true, learners: true } },
      },
    });
    tableData = schools.map((s) => ({
      ...s,
      users: s._count.users,
      learners: s._count.learners,
    }));
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty table
    // instead of a 500. requireUser already verified the session.
    console.error("[SchoolsListPage] failed to load schools:", err);
    dbAvailable = false;
  }

  return (
    <AppShell 
      title="Schools" 
      subtitle="All registered schools"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/schools/new"><Plus className="h-4 w-4 mr-2" /> New School</Link>
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
    </AppShell>
  );
}
