"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { DeleteSchoolButton } from "@/components/delete-school-button";
import { ExternalLink } from "lucide-react";

export type School = {
  id: string;
  name: string;
  schoolIdCode: string;
  region: string | null;
  division: string | null;
  users: number;
  learners: number;
};

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

const columns = [
  {
    key: "name",
    header: "School Name",
    render: (school: School) => (
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
    render: (school: School) => (
      <code className="rounded bg-muted px-1 py-0.5 text-xs">{school.schoolIdCode}</code>
    ),
  },
  {
    key: "region",
    header: "Region",
    render: (school: School) => (
      <span className="text-sm text-muted-foreground">{school.region || "—"}</span>
    ),
  },
  {
    key: "division",
    header: "Division",
    render: (school: School) => (
      <span className="text-sm text-muted-foreground">{school.division || "—"}</span>
    ),
  },
  {
    key: "users",
    header: "Users",
    render: (school: School) => (
      <Badge variant="secondary">{school.users}</Badge>
    ),
  },
  {
    key: "learners",
    header: "Learners",
    render: (school: School) => (
      <Badge variant="outline">{school.learners}</Badge>
    ),
  },
  {
    key: "actions",
    header: "Actions",
    searchable: false,
    render: (school: School) => (
      <div className="flex justify-end">
        <DeleteSchoolButton schoolId={school.id} schoolName={school.name} />
      </div>
    ),
  },
];

export function SchoolsTable({ schools }: { schools: School[] }) {
  return (
    <DataTable
      data={schools}
      columns={columns}
      filterColumn="region"
      filterOptions={REGIONS}
      itemsPerPage={10}
      emptyMessage="No schools found. Create your first school to get started."
    />
  );
}
