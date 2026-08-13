"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, ExternalLink, KeyRound, Copy, CheckCircle2, AlertTriangle, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { deleteSchool, regenerateSchoolHeadCredential } from "@/lib/actions/school";
import { SchoolActiveToggle } from "@/components/admin/school-active-toggle";
import { ConfirmAction } from "@/components/confirm-action";
import { setSchoolActive } from "@/lib/actions/school-management";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

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

export type SchoolsTableList = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  q: string;
  region: string;
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
      aria-label={`Regenerate activation credential for ${schoolName}`}
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
      <KeyRound className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function hrefFor(list: SchoolsTableList, page: number): string {
  const params = new URLSearchParams();
  if (list.q) params.set("q", list.q);
  if (list.region) params.set("region", list.region);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/schools?${qs}` : "/admin/schools";
}

export function SchoolsTable({
  schools,
  list,
}: {
  schools: SchoolRow[];
  list: SchoolsTableList;
}) {
  const router = useRouter();
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(list.q);
  const [optimisticSchools, dispatchOptimistic] = useOptimistic(
    schools,
    (state: SchoolRow[], op: ListOptimisticOp<SchoolRow>) =>
      listOptimisticReducer(state, op)
  );

  useEffect(() => {
    setSearchValue(list.q);
  }, [list.q]);

  const pushList = (next: { page?: number; q?: string; region?: string }) => {
    const params = new URLSearchParams();
    const q = next.q !== undefined ? next.q : list.q;
    const region = next.region !== undefined ? next.region : list.region;
    const page = next.page !== undefined ? next.page : list.page;
    if (q) params.set("q", q);
    if (region) params.set("region", region);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.push(qs ? `/admin/schools?${qs}` : "/admin/schools");
  };

  const toggleActive = (school: SchoolRow, nextActive: boolean) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({
        type: "patch",
        id: school.id,
        patch: { isActive: nextActive },
      });
      const fd = new FormData();
      fd.set("schoolId", school.id);
      fd.set("isActive", nextActive ? "true" : "false");
      const res = await setSchoolActive(fd);
      await settleActionResult(
        res,
        nextActive ? "School activated" : "School deactivated"
      );
    });

  const from =
    list.totalCount > 0 ? (list.page - 1) * list.pageSize + 1 : 0;
  const to = Math.min(list.page * list.pageSize, list.totalCount);

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
            <div className="break-all rounded-lg border bg-card p-3 font-mono text-sm">
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

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search schools…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                pushList({ page: 1, q: searchValue.trim() });
              }
            }}
            className="pl-9"
            aria-label="Search schools"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={list.region || "all"}
            onValueChange={(value) =>
              pushList({ page: 1, region: value === "all" ? "" : value })
            }
          >
            <SelectTrigger className="w-[160px]" aria-label="Filter by region">
              <SelectValue placeholder="Filter by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {REGIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => pushList({ page: 1, q: searchValue.trim() })}
          >
            Search
          </Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {from} to {to} of {list.totalCount} results
      </div>

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead>School Name</TableHead>
              <TableHead>School ID</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Learners</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticSchools.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-muted-foreground"
                >
                  No schools found. Create your first school to get started.
                </TableCell>
              </TableRow>
            ) : (
              optimisticSchools.map((school) => (
                <TableRow key={school.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{school.name}</span>
                      <Link
                        href={`/school-head?schoolId=${school.id}`}
                        prefetch={true}
                        aria-label={`Open ${school.name} as School Head`}
                        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {school.schoolIdCode}
                    </code>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {school.region || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {school.division || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{school.users}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{school.learners}</Badge>
                  </TableCell>
                  <TableCell>
                    {school.isActive ? (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      <SchoolActiveToggle
                        schoolId={school.id}
                        isActive={school.isActive}
                        schoolName={school.name}
                        pending={pending}
                        onToggle={(nextActive) => toggleActive(school, nextActive)}
                      />
                      <RegenButton
                        schoolId={school.id}
                        schoolName={school.name}
                        onCredential={setCredential}
                      />
                      <ConfirmAction
                        title="Remove this school?"
                        description={`${school.name} will be hidden from active lists. Existing data is kept and can be restored by support if needed.`}
                        confirmLabel="Remove"
                        variant="destructive"
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Remove ${school.name}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        }
                        onConfirm={async () => {
                          const fd = new FormData();
                          fd.set("id", school.id);
                          try {
                            await deleteSchool(fd);
                            toast.success("School removed");
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Could not remove school"
                            );
                            throw err;
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {list.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={list.page <= 1}
          >
            <Link
              href={hrefFor(list, list.page - 1)}
              className={list.page <= 1 ? "pointer-events-none opacity-50" : ""}
              aria-disabled={list.page <= 1}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={list.page >= list.totalPages}
          >
            <Link
              href={hrefFor(list, list.page + 1)}
              className={
                list.page >= list.totalPages
                  ? "pointer-events-none opacity-50"
                  : ""
              }
              aria-disabled={list.page >= list.totalPages}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
