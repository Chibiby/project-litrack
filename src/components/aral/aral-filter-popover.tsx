"use client";

import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";

export type AralGradeOption = {
  id: string;
  label: string;
};

type Props = {
  /** Current grade (route `[gradeId]` or `"all"` on combined dashboards). */
  gradeId: string;
  grades: AralGradeOption[];
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  showSection: boolean;
  schoolId?: string;
  /** Show an "All grades" option (combined `/teacher/aral` dashboard). */
  allowAllGrades?: boolean;
  /**
   * Pass grade as `?grade=` instead of only via `pathForGrade`.
   * Use with a fixed `basePath` like `/teacher/aral` (string — safe from Server Components).
   */
  gradeAsQueryParam?: boolean;
  /**
   * Fixed path when grade is a query param. Prefer this over `pathForGrade` from
   * Server Components (functions cannot be passed to Client Components).
   */
  basePath?: string;
  /**
   * Path builder for a grade — e.g. `(id) => `/teacher/aral/${id}/attendance``.
   * Only pass from Client Components.
   */
  pathForGrade?: (gradeId: string) => string;
  /** Extra query params to keep (e.g. date, week). */
  preserveParams?: Record<string, string | undefined>;
};

function buildHref(
  path: string,
  params: Record<string, string | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function AralFilterPopover({
  gradeId,
  grades,
  section,
  sections,
  showSection,
  schoolId,
  allowAllGrades = false,
  gradeAsQueryParam = false,
  basePath,
  pathForGrade,
  preserveParams = {},
}: Props) {
  const router = useRouter();
  const showGrade = grades.length > 1 || (allowAllGrades && grades.length > 0);
  const filterActive =
    section !== "all" || (allowAllGrades && gradeId !== "all");

  if (!showGrade && !showSection) return null;

  function navigate(next: {
    gradeId?: string;
    section?: LearnerListSectionFilter;
  }) {
    const nextGradeId = next.gradeId ?? gradeId;
    const nextSection = next.section ?? section;
    const path = basePath ?? pathForGrade?.(nextGradeId);
    if (!path) return;
    const gradeChanged = nextGradeId !== gradeId;

    router.push(
      buildHref(path, {
        schoolId,
        ...preserveParams,
        ...(gradeAsQueryParam
          ? { grade: nextGradeId === "all" ? undefined : nextGradeId }
          : {}),
        // Section IDs are grade-scoped — drop on grade change.
        section:
          gradeChanged || nextSection === "all" ? undefined : nextSection,
      })
    );
  }

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative"
          aria-label="Filter by grade and section"
        >
          <Filter className="h-4 w-4" aria-hidden />
          Filter
          {filterActive && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary"
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        {showGrade && (
          <div className="space-y-1.5">
            <Label
              htmlFor="aral-filter-grade"
              className="text-xs text-muted-foreground"
            >
              Grade
            </Label>
            <Select
              value={gradeId}
              onValueChange={(value) => navigate({ gradeId: value })}
            >
              <SelectTrigger
                id="aral-filter-grade"
                className="h-8"
                aria-label="Filter by grade"
              >
                <SelectValue placeholder="Select grade" />
              </SelectTrigger>
              <SelectContent>
                {allowAllGrades && (
                  <SelectItem value="all">All grades</SelectItem>
                )}
                {grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showSection && (
          <div className="space-y-1.5">
            <Label
              htmlFor="aral-filter-section"
              className="text-xs text-muted-foreground"
            >
              Section
            </Label>
            <Select
              value={section === "all" ? "all" : section}
              onValueChange={(value) =>
                navigate({
                  section:
                    value === "all"
                      ? "all"
                      : (value as LearnerListSectionFilter),
                })
              }
            >
              <SelectTrigger
                id="aral-filter-section"
                className="h-8"
                aria-label="Filter by section"
              >
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                <SelectItem value="none">No section</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
