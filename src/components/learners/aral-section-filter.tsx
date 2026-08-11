"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type {
  LearnerListGradeFilter,
  LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";

export type AralGradeOption = {
  id: string;
  label: string;
};

type Props = {
  gradeId: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  schoolId?: string;
  /** Defaults to `/teacher/aral/${gradeId}` */
  basePath?: string;
  /** Extra query params to keep when filtering (e.g. date, week). */
  preserveParams?: Record<string, string | undefined>;
  /** When set (length > 1), shows a grade select that writes `grade` query. */
  grades?: AralGradeOption[];
  /** Active grade filter for combined `/teacher/aral` (`all` or grade id). */
  grade?: LearnerListGradeFilter;
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

export function AralSectionFilter({
  gradeId,
  section,
  sections,
  schoolId,
  basePath,
  preserveParams = {},
  grades = [],
  grade = "all",
}: Props) {
  const path = basePath ?? `/teacher/aral/${gradeId}`;
  const showGrade = grades.length > 1;
  const showSection = sections.length > 0;

  if (!showGrade && !showSection) return null;

  // Drop grade from preserveParams when the form owns the grade select.
  const restPreserve = { ...preserveParams };
  delete restPreserve.grade;

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border/60 p-4">
      <form
        method="get"
        action={path}
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        {schoolId && <input type="hidden" name="schoolId" value={schoolId} />}
        {Object.entries(restPreserve).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null
        )}
        {showGrade && (
          <label className="flex items-center gap-1.5">
            Grade
            <select
              name="grade"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              defaultValue={grade === "all" ? "" : grade}
              onChange={(e) => {
                // Section IDs are grade-scoped — clear when grade changes.
                const form = e.currentTarget.form;
                const sectionSelect = form?.elements.namedItem(
                  "section"
                ) as HTMLSelectElement | null;
                if (sectionSelect) sectionSelect.value = "";
                form?.requestSubmit();
              }}
              aria-label="Filter ARAL learners by grade"
            >
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {showSection && (
          <label className="flex items-center gap-1.5">
            Section
            <select
              name="section"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              defaultValue={section === "all" ? "" : section}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              aria-label="Filter ARAL learners by section"
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
      </form>
      {(section !== "all" || grade !== "all") && (
        <Button asChild size="sm" variant="outline">
          <Link
            href={buildHref(path, {
              schoolId,
              ...restPreserve,
            })}
          >
            Reset
          </Link>
        </Button>
      )}
    </div>
  );
}
