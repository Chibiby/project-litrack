"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { Trash2, ExternalLink, KeyRound, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { deleteSchool, regenerateSchoolHeadCredential } from "@/lib/actions/school";
import { SchoolActiveToggle } from "@/components/admin/school-active-toggle";

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

function RegenButton({
  schoolId,
  schoolName,
  onCredential,
}: {
  schoolId: string;
  schoolName: string;
  onCredential: (value: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Regenerate School Head activation credential"
      onClick={() => {
        if (
          !window.confirm(
            `Regenerate activation credential for ${schoolName}? The School Head must use the new credential and change their password.`
          )
        ) {
          return;
        }
        const fd = new FormData();
        fd.set("schoolId", schoolId);
        startTransition(async () => {
          const res = await regenerateSchoolHeadCredential(fd);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          if (res.data?.activationCredential) {
            onCredential(res.data.activationCredential);
          }
        });
      }}
    >
      <KeyRound className="h-4 w-4" />
    </Button>
  );
}

export function SchoolsTable({ schools }: { schools: SchoolRow[] }) {
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const columns = [
    {
      key: "name",
      header: "School Name",
      render: (school: SchoolRow) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{school.name}</span>
          <Link href={`/school-head?schoolId=${school.id}`} prefetch={true}>
            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
          </Link>
        </div>
      ),
    },
    {
      key: "schoolIdCode",
      header: "School ID",
      render: (school: SchoolRow) => (
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{school.schoolIdCode}</code>
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
      key: "isActive",
      header: "Status",
      searchable: false,
      render: (school: SchoolRow) =>
        school.isActive ? (
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      searchable: false,
      render: (school: SchoolRow) => (
        <div className="flex flex-wrap justify-end gap-1">
          <SchoolActiveToggle
            schoolId={school.id}
            isActive={school.isActive}
            schoolName={school.name}
          />
          <RegenButton
            schoolId={school.id}
            schoolName={school.name}
            onCredential={setCredential}
          />
          <form action={deleteSchool}>
            <input type="hidden" name="id" value={school.id} />
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-destructive hover:text-destructive"
              onClick={(e) => {
                if (!window.confirm(`Archive (soft-delete) ${school.name}?`)) {
                  e.preventDefault();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </form>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {credential ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-start gap-2 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">New activation credential (shown once)</p>
                <p className="text-sm text-amber-900/90">
                  Copy and share securely with the School Head. It will not be shown again.
                </p>
              </div>
            </div>
            <div className="break-all rounded-lg border bg-white p-3 font-mono text-sm">
              {credential}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(credential);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" size="sm" onClick={() => setCredential(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        data={schools}
        columns={columns}
        filterColumn="region"
        filterOptions={REGIONS}
        itemsPerPage={10}
        emptyMessage="No schools found. Create your first school to get started."
      />
    </div>
  );
}
