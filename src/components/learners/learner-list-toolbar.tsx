"use client";

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  LearnerListFilter,
  LearnerListSectionFilter,
  LearnerListSort,
} from "@/lib/learners/pagination";

export type SectionOption = { id: string; name: string };

type Props = {
  gradeId: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
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

function listHref(
  gradeId: string,
  opts: {
    filter: LearnerListFilter;
    sort: LearnerListSort;
    section: LearnerListSectionFilter;
    schoolId?: string;
  }
): string {
  const params = new URLSearchParams();
  if (opts.filter !== "all") params.set("filter", opts.filter);
  if (opts.sort !== "name") params.set("sort", opts.sort);
  if (opts.section !== "all") params.set("section", opts.section);
  if (opts.schoolId) params.set("schoolId", opts.schoolId);
  const qs = params.toString();
  const path = `/teacher/grade/${gradeId}`;
  return qs ? `${path}?${qs}` : path;
}

export function LearnerListToolbar({
  gradeId,
  filter,
  sort,
  section,
  sections,
  schoolId,
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: Props) {
  const path = `/teacher/grade/${gradeId}`;
  const showSectionFilter = sections.length > 0;

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
              <Link
                href={listHref(gradeId, {
                  filter: f.value,
                  sort,
                  section,
                  schoolId,
                })}
              >
                {f.label}
              </Link>
            </Button>
          ))}
        </div>

        <form
          method="get"
          action={path}
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          {schoolId && <input type="hidden" name="schoolId" value={schoolId} />}
          {showSectionFilter && (
            <label className="flex items-center gap-1.5">
              Section
              <select
                name="section"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                defaultValue={section === "all" ? "" : section}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                aria-label="Filter by section"
              >
                <option value="">All sections</option>
                <option value="none">No section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          <Link href={path}>Reset</Link>
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
