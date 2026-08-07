"use client";

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { LearnerListFilter, LearnerListSort } from "@/lib/learners/pagination";

type Props = {
  gradeId: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  schoolId?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
};

const FILTERS: { value: LearnerListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "aral", label: "ARAL" },
  { value: "archived", label: "Archived" },
];

function filterHref(
  gradeId: string,
  filter: LearnerListFilter,
  sort: LearnerListSort,
  schoolId?: string
): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (sort !== "name") params.set("sort", sort);
  if (schoolId) params.set("schoolId", schoolId);
  const qs = params.toString();
  return qs ? `/teacher/grade/${gradeId}?${qs}` : `/teacher/grade/${gradeId}`;
}

export function LearnerListToolbar({
  gradeId,
  filter,
  sort,
  schoolId,
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: Props) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="flex flex-1 gap-2">
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearchSubmit();
            }
          }}
          placeholder="Search by name…"
          className="max-w-xs"
          aria-label="Search learners by name"
        />
        <Button type="button" variant="secondary" size="sm" onClick={onSearchSubmit}>
          Search
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              asChild
              size="sm"
              variant={filter === f.value ? "default" : "ghost"}
              className="h-8"
            >
              <Link href={filterHref(gradeId, f.value, sort, schoolId)}>
                {f.label}
              </Link>
            </Button>
          ))}
        </div>

        <form
          method="get"
          action={`/teacher/grade/${gradeId}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          {schoolId && <input type="hidden" name="schoolId" value={schoolId} />}
          <label className="flex items-center gap-1.5">
            Sort
            <select
              name="sort"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              defaultValue={sort}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              aria-label="Sort learners"
            >
              <option value="name">Name</option>
              <option value="age">Age</option>
            </select>
          </label>
        </form>

        <Button asChild size="sm" variant="outline">
          <Link href={`/teacher/grade/${gradeId}`}>Reset</Link>
        </Button>

        {!schoolId && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/teacher/grade/${gradeId}/import`}>Import CSV</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
