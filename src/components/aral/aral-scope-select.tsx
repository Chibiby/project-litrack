"use client";

import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";
import type { AralGradeOption } from "@/components/aral/aral-filter-popover";

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

/**
 * The Weekly Attendance toolbar's highlighted grade dropdown — visually
 * identical to `AdvisorySelect`, standing apart from the plain section select
 * beside it because grade is this page's scope. Renders nothing for a single
 * grade: a dropdown with one option is noise.
 */
export function AralGradeSelect({
  gradeId,
  grades,
  schoolId,
  pathForGrade,
  preserveParams = {},
  className,
}: {
  gradeId: string;
  grades: AralGradeOption[];
  schoolId?: string;
  pathForGrade: (gradeId: string) => string;
  preserveParams?: Record<string, string | undefined>;
  className?: string;
}) {
  const router = useRouter();
  if (grades.length <= 1) return null;

  function navigate(nextGradeId: string) {
    if (nextGradeId === gradeId) return;
    const path = pathForGrade(nextGradeId);
    router.push(
      buildHref(path, {
        schoolId,
        ...preserveParams,
        // Section IDs are grade-scoped — drop on grade change.
        section: undefined,
      })
    );
  }

  return (
    <Select value={gradeId} onValueChange={navigate}>
      <SelectTrigger
        aria-label="Grade"
        className={cn(
          "h-11 gap-2 rounded-xl border-violet-300 bg-violet-50 font-semibold text-violet-800 shadow-sm hover:bg-violet-100 focus:ring-violet-400 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-300",
          className
        )}
      >
        <GraduationCap
          className="size-4 shrink-0 text-violet-600 dark:text-violet-300"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {grades.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The plain section select beside it — same options `AralFilterPopover` used
 * to offer, now surfaced inline instead of hidden behind a Filter button.
 */
export function AralSectionSelect({
  gradeId,
  section,
  sections,
  schoolId,
  pathForGrade,
  preserveParams = {},
  className,
}: {
  gradeId: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  schoolId?: string;
  pathForGrade: (gradeId: string) => string;
  preserveParams?: Record<string, string | undefined>;
  className?: string;
}) {
  const router = useRouter();

  function navigate(nextSection: LearnerListSectionFilter) {
    const path = pathForGrade(gradeId);
    router.push(
      buildHref(path, {
        schoolId,
        ...preserveParams,
        section: nextSection === "all" ? undefined : nextSection,
      })
    );
  }

  return (
    <Select
      value={section === "all" ? "all" : section}
      onValueChange={(value) =>
        navigate(value === "all" ? "all" : (value as LearnerListSectionFilter))
      }
    >
      <SelectTrigger
        aria-label="Section"
        className={cn("h-11 lg:h-9", className)}
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
  );
}
