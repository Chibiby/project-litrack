"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";
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
import { EmptyState } from "@/components/dashboard/empty-state";
import { DeletedLearnerRestoreButton } from "@/components/admin/deleted-learners-restore-button";
import type { DeletedLearnerRow, DeletedLearnersPage } from "@/lib/learners/deleted-learners";

const ANY_SCHOOL = "any";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

function placement(row: DeletedLearnerRow): string {
  return row.sectionName ? `${row.gradeLabel} · ${row.sectionName}` : row.gradeLabel;
}

function schoolLine(row: DeletedLearnerRow, showDistrict: boolean): string {
  return showDistrict && row.district ? `${row.schoolName} · ${row.district}` : row.schoolName;
}

export function DeletedLearnersView({
  data,
  filters,
  showDistrict,
  basePath,
}: {
  data: DeletedLearnersPage;
  filters: { school: string; q: string };
  /** Division-wide admins also see each school's district. */
  showDistrict: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [pushedQ, setPushedQ] = useState(filters.q);
  const [restoredIds, setRestoredIds] = useState<ReadonlySet<string>>(() => new Set());

  const rows = data.rows.filter((row) => !restoredIds.has(row.id));
  const filtered = Boolean(filters.school || filters.q);

  const hrefFor = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const apply = (changes: Record<string, string | null>) => {
    startTransition(() => router.push(hrefFor({ ...changes, page: null })));
  };

  const searchNow = (value: string) => {
    const term = value.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    apply({ q: term || null });
  };

  const markRestored = (id: string) => {
    setRestoredIds((prev) => new Set(prev).add(id));
  };

  const restoreButton = (row: DeletedLearnerRow) => (
    <DeletedLearnerRestoreButton
      id={row.id}
      name={row.name}
      schoolName={row.schoolName}
      onRestored={markRestored}
    />
  );

  return (
    <div className="space-y-6">
      <Surface as="section" className="rounded-2xl p-3 sm:p-4">
        <form
          className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="space-y-2">
            <Label htmlFor="deleted-learners-school">School</Label>
            <Select
              value={filters.school || ANY_SCHOOL}
              onValueChange={(value) => apply({ school: value })}
              disabled={pending}
            >
              <SelectTrigger id="deleted-learners-school" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_SCHOOL}>All schools</SelectItem>
                {data.schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SearchInput
            id="deleted-learners-q"
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={searchNow}
            resultCount={data.total}
            label="Search name"
            labelVisible
            placeholder="Learner name"
            className="w-full sm:w-64"
          />

          {filtered ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setQuery("");
                setPushedQ("");
                apply({ school: null, q: null });
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
      </Surface>

      <Surface
        as="section"
        aria-label="Deleted learners"
        aria-busy={pending || undefined}
        className="min-w-0 space-y-3 rounded-2xl p-4 sm:p-5"
      >
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No deleted learners match"
              description="Try a different name or school, or clear the filters."
              icon={UserX}
            />
          ) : (
            <EmptyState
              title="No deleted learners"
              description="Learners removed by teachers move here 30 days after removal."
              icon={UserX}
            />
          )
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>School</TableHead>
                    {showDistrict ? <TableHead>District</TableHead> : null}
                    <TableHead>Grade / Section</TableHead>
                    <TableHead>Removed on</TableHead>
                    <TableHead>Deleted on</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.schoolName}</TableCell>
                      {showDistrict ? (
                        <TableCell className="text-sm text-muted-foreground">{row.district ?? "—"}</TableCell>
                      ) : null}
                      <TableCell className="text-sm text-muted-foreground">{placement(row)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(row.removedAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(row.deletedAt)}</TableCell>
                      <TableCell className="text-right">{restoreButton(row)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border/60 lg:hidden" aria-label="Deleted learners">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-words font-medium text-foreground">{row.name}</p>
                    <p className="break-words text-sm text-muted-foreground">{schoolLine(row, showDistrict)}</p>
                    <p className="text-xs text-muted-foreground">
                      {placement(row)}
                      {" · removed "}
                      {formatDate(row.removedAt)}
                      {" · deleted "}
                      {formatDate(row.deletedAt)}
                    </p>
                  </div>
                  <div className="shrink-0">{restoreButton(row)}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {data.pages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-sm text-muted-foreground">
              Page {data.page} of {data.pages}
            </span>
            <div className="flex gap-2">
              <Button asChild={data.page > 1} variant="outline" size="sm" className="lg:h-9" disabled={data.page <= 1}>
                {data.page > 1 ? (
                  <Link href={hrefFor({ page: String(data.page - 1) })}>
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                    Previous
                  </Link>
                ) : (
                  <span>
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                    Previous
                  </span>
                )}
              </Button>
              <Button
                asChild={data.page < data.pages}
                variant="outline"
                size="sm"
                className="lg:h-9"
                disabled={data.page >= data.pages}
              >
                {data.page < data.pages ? (
                  <Link href={hrefFor({ page: String(data.page + 1) })}>
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                ) : (
                  <span>
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </Surface>
    </div>
  );
}
