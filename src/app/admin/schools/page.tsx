import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadAdminSchoolsList } from "@/lib/admin/dashboard-data";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { DeleteSchoolButton } from "@/components/delete-school-button";
import { Plus, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

const REGIONS = [
  { value: "NCR", label: "NCR - National Capital Region" },
  { value: "CAR", label: "CAR - Cordillera Administrative Region" },
  { value: "Region I", label: "Region I - Ilocos" },
  { value: "Region II", label: "Region II - Cagayan Valley" },
  { value: "Region III", label: "Region III - Central Luzon" },
  { value: "Region IV-A", label: "Region IV-A - Calabarzon" },
  { value: "Region IV-B", label: "Region IV-B - Mimaropa" },
  { value: "Region V", label: "Region V - Bicol" },
  { value: "Region VI", label: "Region VI - Western Visayas" },
  { value: "Region VII", label: "Region VII - Central Visayas" },
  { value: "Region VIII", label: "Region VIII - Eastern Visayas" },
  { value: "Region IX", label: "Region IX - Zamboanga Peninsula" },
  { value: "Region X", label: "Region X - Northern Mindanao" },
  { value: "Region XI", label: "Region XI - Davao" },
  { value: "Region XII", label: "Region XII - Soccsksargen" },
  { value: "Region XIII", label: "Region XIII - Caraga" },
  { value: "BARMM", label: "BARMM - Bangsamoro" },
];

export default async function SchoolsListPage() {
  const user = await requireUser("SUPER_ADMIN");
  const { schools, dbAvailable } = await loadAdminSchoolsList();

  const tableData = schools;

  const columns = [
    {
      key: "name",
      header: "School Name",
      render: (school: (typeof tableData)[0]) => (
        <div className="flex min-w-[10rem] items-center gap-2">
          <span className="font-medium">{school.name}</span>
          <Link
            href={`/school-head?schoolId=${school.id}`}
            aria-label={`Open school head view for ${school.name}`}
            className="inline-flex rounded-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ),
    },
    {
      key: "schoolIdCode",
      header: "School ID",
      render: (school: (typeof tableData)[0]) => (
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{school.schoolIdCode}</code>
      ),
    },
    {
      key: "region",
      header: "Region",
      render: (school: (typeof tableData)[0]) => (
        <span className="text-sm text-muted-foreground">{school.region || "—"}</span>
      ),
    },
    {
      key: "division",
      header: "Division",
      render: (school: (typeof tableData)[0]) => (
        <span className="text-sm text-muted-foreground">{school.division || "—"}</span>
      ),
    },
    {
      key: "users",
      header: "Users",
      render: (school: (typeof tableData)[0]) => (
        <Badge variant="secondary">{school.users}</Badge>
      ),
    },
    {
      key: "learners",
      header: "Learners",
      render: (school: (typeof tableData)[0]) => (
        <Badge variant="outline">{school.learners}</Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      searchable: false,
      render: (school: (typeof tableData)[0]) => (
        <div className="flex justify-end">
          <DeleteSchoolButton schoolId={school.id} schoolName={school.name} />
        </div>
      ),
    },
  ];

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
          <DataTable
            data={tableData}
            columns={columns}
            filterColumn="region"
            filterOptions={REGIONS}
            itemsPerPage={10}
            emptyMessage="No schools found. Create your first school to get started."
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
