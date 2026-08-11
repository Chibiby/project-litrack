"use client";

import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { AddLearnerDialog } from "@/components/learners/add-learner-dialog";
import type {
  LearnerFormGradeOption,
  LearnerFormSectionOption,
} from "@/components/forms/learner-form";
import type {
  LearnerListFilter,
  LearnerListGradeFilter,
  LearnerListSectionFilter,
  LearnerListSort,
} from "@/lib/learners/pagination";

export type SectionOption = { id: string; name: string };

export type LearnerGradeOption = {
  id: string;
  label: string;
};

export type { LearnerListGradeFilter };

export type LearnerListAddLearnerProps = {
  gradeLevelId: string;
  grades: LearnerFormGradeOption[];
  sections: LearnerFormSectionOption[];
};

type Props = {
  /** List route base — defaults to combined multi-grade path. */
  basePath?: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  /** Active grade filter (`all` or grade id). */
  grade?: LearnerListGradeFilter;
  section: LearnerListSectionFilter;
  grades?: LearnerGradeOption[];
  sections: SectionOption[];
  schoolId?: string;
  /** Current URL `q` — preserved on filter changes. */
  q?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  /** When set, mounts Add learner at the right end of the bar. */
  addLearner?: LearnerListAddLearnerProps | null;
};

const STATUS_OPTIONS: { value: LearnerListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "aral", label: "ARAL" },
  { value: "archived", label: "Archived" },
];

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

export function LearnerListToolbar({
  basePath = "/teacher/learners",
  filter,
  sort,
  grade = "all",
  section,
  grades = [],
  sections,
  schoolId,
  q = "",
  searchValue,
  onSearchChange,
  onSearchSubmit,
  addLearner = null,
}: Props) {
  const router = useRouter();
  const showGrade = grades.length > 1;
  const showSection = sections.length > 0;
  const filterActive =
    filter !== "all" ||
    sort !== "name" ||
    grade !== "all" ||
    section !== "all";

  function navigate(next: {
    filter?: LearnerListFilter;
    sort?: LearnerListSort;
    grade?: LearnerListGradeFilter;
    section?: LearnerListSectionFilter;
  }) {
    const nextFilter = next.filter ?? filter;
    const nextSort = next.sort ?? sort;
    const nextGrade = next.grade ?? grade;
    const nextSection = next.section ?? section;
    const gradeChanged = nextGrade !== grade;

    router.push(
      buildHref(basePath, {
        schoolId,
        q: q.trim() || undefined,
        filter: nextFilter !== "all" ? nextFilter : undefined,
        sort: nextSort !== "name" ? nextSort : undefined,
        grade: nextGrade !== "all" ? nextGrade : undefined,
        // Section IDs are grade-scoped — drop on grade change.
        section:
          gradeChanged || nextSection === "all" ? undefined : nextSection,
      })
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 gap-2">
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

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Popover modal>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="relative"
              aria-label="Filter learners"
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
          <PopoverContent align="end" className="w-64 space-y-3 p-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="learner-filter-status"
                className="text-xs text-muted-foreground"
              >
                Status
              </Label>
              <Select
                value={filter}
                onValueChange={(value) =>
                  navigate({ filter: value as LearnerListFilter })
                }
              >
                <SelectTrigger
                  id="learner-filter-status"
                  className="h-8"
                  aria-label="Filter by status"
                >
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="learner-filter-sort"
                className="text-xs text-muted-foreground"
              >
                Sort
              </Label>
              <Select
                value={sort}
                onValueChange={(value) =>
                  navigate({ sort: value as LearnerListSort })
                }
              >
                <SelectTrigger
                  id="learner-filter-sort"
                  className="h-8"
                  aria-label="Sort learners"
                >
                  <SelectValue placeholder="Name" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="age">Age</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showGrade && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="learner-filter-grade"
                  className="text-xs text-muted-foreground"
                >
                  Grade
                </Label>
                <Select
                  value={grade === "all" ? "all" : grade}
                  onValueChange={(value) =>
                    navigate({
                      grade: value === "all" ? "all" : value,
                    })
                  }
                >
                  <SelectTrigger
                    id="learner-filter-grade"
                    className="h-8"
                    aria-label="Filter by grade"
                  >
                    <SelectValue placeholder="All grades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All grades</SelectItem>
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
                  htmlFor="learner-filter-section"
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
                    id="learner-filter-section"
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

        {addLearner ? (
          <AddLearnerDialog
            gradeLevelId={addLearner.gradeLevelId}
            grades={addLearner.grades}
            sections={addLearner.sections}
          />
        ) : null}
      </div>
    </div>
  );
}
