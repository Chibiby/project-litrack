import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadAdminSchoolsList } from "@/lib/admin/dashboard-data";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Plus, ExternalLink, Trash2 } from "lucide-react";
import { deleteSchool } from "@/lib/actions/school";

export const dynamic = "force-dynamic";

// Define unique regions for filter
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
        <div className="flex items-center gap-2">
          <span className="font-medium">{school.name}</span>
          <Link href={`/school-head?schoolId=${school.id}`}>
            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
          </Link>
        </div>
      ),
    },
    {
      key: "schoolIdCode",
      header: "School ID",
      render: (school: (typeof tableData)[0]) => (
        <code className="text-xs bg-muted px-1 py-0.5 rounded">{school.schoolIdCode}</code>
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
      header: "",
      searchable: false,
      render: (school: (typeof tableData)[0]) => (
        <form action={deleteSchool} className="flex justify-end">
          <input type="hidden" name="id" value={school.id} />
          <Button variant="ghost" size="sm" type="submit" className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </form>
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
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database is unavailable. School list cannot load until{" "}
          <code className="text-xs">DATABASE_URL</code> is fixed on Vercel.
        </div>
      ) : null}

      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/schools/new"><Plus className="h-4 w-4 mr-2" /> New School</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-6">
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
