"use client";

import { useRouter } from "next/navigation";
import { GraduationCap, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ARAL_SCOPE_TRIGGER } from "@/components/learners/advisory-select";
import { runGuarded } from "@/lib/ui/unsaved-guard";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";
import type { AralGradeOption } from "@/components/aral/aral-filter-popover";
import { ALL_GRADES_LABEL, ALL_GRADES_VALUE } from "@/lib/aral/all-grades";

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
 *
 * `allHref` adds an "All grades" option first, leading to the page that shows
 * every grade at once; `gradeId` is then `ALL_GRADES_VALUE` on that page.
 */
export function AralGradeSelect({
  gradeId,
  grades,
  schoolId,
  pathForGrade,
  preserveParams = {},
  allHref,
  className,
}: {
  gradeId: string;
  grades: AralGradeOption[];
  schoolId?: string;
  pathForGrade: (gradeId: string) => string;
  preserveParams?: Record<string, string | undefined>;
  allHref?: string;
  className?: string;
}) {
  const router = useRouter();
  if (grades.length <= 1) return null;

  function navigate(nextGradeId: string) {
    if (nextGradeId === gradeId) return;
    const path =
      nextGradeId === ALL_GRADES_VALUE && allHref ? allHref : pathForGrade(nextGradeId);
    const href = buildHref(path, {
      schoolId,
      ...preserveParams,
      // Section IDs are grade-scoped — drop on grade change.
      section: undefined,
    });
    runGuarded(() => router.push(href));
  }

  return (
    <Select value={gradeId} onValueChange={navigate}>
      <SelectTrigger
        aria-label="Grade"
        className={cn(
          ARAL_SCOPE_TRIGGER,
          className
        )}
      >
        <GraduationCap
          className="size-4 shrink-0 text-aral-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {allHref ? (
          <SelectItem value={ALL_GRADES_VALUE}>{ALL_GRADES_LABEL}</SelectItem>
        ) : null}
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
    const href = buildHref(path, {
      schoolId,
      ...preserveParams,
      section: nextSection === "all" ? undefined : nextSection,
    });
    runGuarded(() => router.push(href));
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

/** One grade of the Weekly Attendance advisory filter, with its sections. */
export type AralAdvisoryGroup = {
  gradeId: string;
  gradeLabel: string;
  sections: { id: string; name: string }[];
};

const sectionValue = (id: string) => `s:${id}`;
const gradeValue = (id: string) => `g:${id}`;

/**
 * Weekly Attendance's highlighted advisory filter: "All advisories" first,
 * then each grade as a heading over its sections ("Kinder - A"). Same format
 * as the Learners and End of Terms pickers — no "All of Kinder" row. A grade
 * with no sections is one plain row, since it has nothing to group.
 *
 * With more than one grade, "All advisories" and every section open the
 * all-grades page (`allHref`, a section as `?section=`). With one grade they
 * stay on that grade's page. Renders nothing when there is nothing to choose.
 */
export function AralAdvisoryFilter({
  groups,
  value,
  schoolId,
  allHref,
  pathForGrade,
  preserveParams = {},
  currentGradeId,
  className,
}: {
  groups: AralAdvisoryGroup[];
  /** A section id, or `"all"` for every advisory (on a grade page: that grade). */
  value: string;
  schoolId?: string;
  allHref: string;
  pathForGrade: (gradeId: string) => string;
  preserveParams?: Record<string, string | undefined>;
  /** Set on a per-grade page: the grade on screen when no section is picked. */
  currentGradeId?: string;
  className?: string;
}) {
  const router = useRouter();
  const choices = groups.reduce((n, g) => n + Math.max(1, g.sections.length), 0);
  if (choices <= 1) return null;
  const multiGrade = groups.length > 1;

  const sectionGrade = new Map<string, string>();
  for (const g of groups) for (const s of g.sections) sectionGrade.set(s.id, g.gradeId);

  // On a grade page with no section picked, the view is that grade. The list
  // names a grade as a row only when it has no sections, so a sectioned grade
  // gets one extra row here and the trigger never reads blank.
  const current =
    value !== "all" && sectionGrade.has(value)
      ? sectionValue(value)
      : currentGradeId && multiGrade
        ? gradeValue(currentGradeId)
        : "all";
  const currentGroup = groups.find((g) => g.gradeId === currentGradeId);
  const showCurrentGradeRow =
    currentGroup !== undefined &&
    current === gradeValue(currentGroup.gradeId) &&
    currentGroup.sections.length > 0;

  function navigate(next: string) {
    if (next === current) return;
    const onlyGrade = groups[0]?.gradeId ?? "";
    let path: string;
    let section: string | undefined;
    if (next === "all") {
      path = multiGrade ? allHref : pathForGrade(onlyGrade);
    } else if (next.startsWith("g:")) {
      path = pathForGrade(next.slice(2));
    } else {
      section = next.slice(2);
      path = multiGrade ? allHref : pathForGrade(sectionGrade.get(section) ?? onlyGrade);
    }
    runGuarded(() => router.push(buildHref(path, { schoolId, ...preserveParams, section })));
  }

  return (
    <Select value={current} onValueChange={navigate}>
      <SelectTrigger aria-label="Advisory" className={cn(ARAL_SCOPE_TRIGGER, className)}>
        <Users className="size-4 shrink-0 text-aral-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All advisories</SelectItem>
        {showCurrentGradeRow ? (
          <SelectItem value={gradeValue(currentGroup.gradeId)}>{currentGroup.gradeLabel}</SelectItem>
        ) : null}
        {groups.map((g) =>
          g.sections.length === 0 ? (
            <SelectItem key={g.gradeId} value={gradeValue(g.gradeId)}>
              {g.gradeLabel}
            </SelectItem>
          ) : (
            <SelectGroup key={g.gradeId}>
              <SelectLabel>{g.gradeLabel}</SelectLabel>
              {g.sections.map((s) => (
                <SelectItem key={s.id} value={sectionValue(s.id)}>
                  {g.gradeLabel} - {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )
        )}
      </SelectContent>
    </Select>
  );
}
