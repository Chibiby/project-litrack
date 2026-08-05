"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Trash2, ExternalLink } from "lucide-react";
import { deleteSchool } from "@/lib/actions/school";

export type SchoolRow = {
  id: string;
  name: string;
  schoolIdCode: string;
  region: string | null;
  division: string | null;
  isActive: boolean;
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
    render: (school: SchoolRow) => (
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
    render: (school: SchoolRow) => (
      <code className="text-xs bg-muted px-1 py-0.5 rounded">{school.schoolIdCode}</code>
    ),
  },
  {
    key: "region",
    header: "Region",
    render: (school: SchoolRow) => (
      <span className="text-sm text-muted-foreground">{school.region || "—"}</span>
    ),
  },
  {
    key: "division",
    header: "Division",
    render: (school: SchoolRow) => (
      <span className="text-sm text-muted-foreground">{school.division || "—"}</span>
    ),
  },
  {
    key: "users",
    header: "Users",
    render: (school: SchoolRow) => <Badge variant="secondary">{school.users}</Badge>,
  },
  {
    key: "learners",
    header: "Learners",
    render: (school: SchoolRow) => <Badge variant="outline">{school.learners}</Badge>,
  },
  {
    key: "actions",
    header: "",
    searchable: false,
    render: (school: SchoolRow) => (
      <form action={deleteSchool} className="flex justify-end">
        <input type="hidden" name="id" value={school.id} />
        <Button variant="ghost" size="sm" type="submit" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </form>
    ),
  },
];

export function SchoolsTable({ schools }: { schools: SchoolRow[] }) {
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
