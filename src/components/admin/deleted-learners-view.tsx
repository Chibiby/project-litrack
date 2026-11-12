"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, GraduationCap, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  CellText,
  NoValue,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DeletedLearnerRestoreButton } from "@/components/admin/deleted-learners-restore-button";
import { LearnerPurgeButton } from "@/components/admin/archive-row-actions";
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
  showFilters = true,
  showHeading = false,
  canPurge = false,
}: {
  data: DeletedLearnersPage;
  filters: { school: string; q: string };
  /** Division-wide admins also see each school's district. */
  showDistrict: boolean;
  basePath: string;
  /** False when the page draws one shared filter bar above several lists. */
  showFilters?: boolean;
  /** A "Deleted learners" title with the count, for a page with more than one list. */
  showHeading?: boolean;
  /** Developer Admin: also offer "Delete permanently" on soft-deleted rows. */
  canPurge?: boolean;
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

  const actions = (row: DeletedLearnerRow, labelled: boolean) => (
    <div className={labelled ? "flex flex-wrap gap-2" : "flex justify-end gap-2"}>
      <DeletedLearnerRestoreButton
        id={row.id}
        name={row.name}
        schoolName={row.schoolName}
        onRestored={markRestored}
      />
      {canPurge && row.purgeCounts ? (
        <LearnerPurgeButton
          id={row.id}
          fullName={row.fullName}
          purgeCounts={row.purgeCounts}
          labelled={labelled}
          onPurged={markRestored}
        />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {showFilters ? (
      <Surface as="section" className="rounded-lg p-3 sm:p-4">
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
      ) : null}

      <Surface
        as="section"
        aria-label="Deleted learners"
        aria-busy={pending || undefined}
        className="min-w-0 space-y-3 rounded-lg p-4 sm:p-5"
      >
        {showHeading ? (
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GraduationCap className="h-5 w-5" aria-hidden />
            Deleted learners
            <Badge variant="secondary">{data.total.toLocaleString()}</Badge>
          </h2>
        ) : null}
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
          <ResponsiveTable
            // Wide roster: the full table needs ~1300px of its own width.
            breakpoint={1300}
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>School</TableHead>
                    {showDistrict ? <TableHead>District</TableHead> : null}
                    <TableHead>Grade / Section</TableHead>
                    <TableHead>Removed on</TableHead>
                    <TableHead>Deleted on</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-[16rem] font-medium">
                        <CellText>{row.name}</CellText>
                        {row.removalReason ? (
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {row.removalReason}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[16rem] text-muted-foreground">
                        <CellText>{row.schoolName}</CellText>
                      </TableCell>
                      {showDistrict ? (
                        <TableCell className="text-muted-foreground">
                          {row.district ?? <NoValue />}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-muted-foreground">{placement(row)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.removedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.deletedAt)}
                      </TableCell>
                      <TableCell>
                        <RowActions>{actions(row, false)}</RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            stacked={
              <StackedList aria-label="Deleted learners">
                {rows.map((row) => (
                  <StackedRow
                    key={row.id}
                    className="px-0"
                    title={row.name}
                    value={<span className="text-sm font-medium">{placement(row)}</span>}
                    meta={<span className="truncate">{schoolLine(row, showDistrict)}</span>}
                    details={[
                      ...(row.removalReason ? [{ label: "Reason", value: row.removalReason }] : []),
                      { label: "Removed on", value: formatDate(row.removedAt) },
                      { label: "Deleted on", value: formatDate(row.deletedAt) },
                    ]}
                    detailActions={actions(row, true)}
                  />
                ))}
              </StackedList>
            }
          />
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
