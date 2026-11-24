"use client";

import { TabNav } from "@/components/school-head/tab-nav";
import { SEARCH_BAR_WIDTH, SearchInput } from "@/components/ui/search-input";
import { FilterMenu } from "@/components/ui/filter-menu";
import { AdvisorySelect } from "@/components/learners/advisory-select";
import { SelectItem } from "@/components/ui/select";
import { FacetSelect } from "@/components/ui/facet-select";
import { SortSelect } from "@/components/ui/sort-select";
import {
  LEARNER_LIST_SORTS,
  LEARNER_PAGE_SIZE_OPTIONS,
  type LearnerAralStatusFilter,
  type LearnerGenderFilter,
  type LearnerListSort,
} from "@/lib/learners/pagination";

/**
 * v2 roster controls, to the owner's Learners mockups.
 *
 * `LearnerRosterNav` sits above the table panel: the two tabs and the add
 * control. The highlighted advisory dropdown lives in the page hero's
 * top-right corner instead (see `TeacherLearnersPage`), not in this row.
 * `LearnerListToolbar` is the panel's own top row: search, the advisory
 * filter, one Filters menu (every facet, sort and page size) and bulk actions.
 *
 * Every control writes the URL; the page re-reads it. Advisory, Grade and
 * Section all narrow the same rows, so each change settles the other two
 * rather than leaving a combination that can only match nothing: picking an
 * advisory pins its grade and clears Section; picking a grade drops a section
 * and an advisory from another grade; picking a section drops the advisory.
 */

/** Still exported for the ARAL grade pages' section filter. */
export type SectionOption = { id: string; name: string };

export type LearnerGradeOption = {
  id: string;
  label: string;
};

/** A section this teacher advises. */
export type AdvisoryOption = {
  id: string;
  gradeLevelId: string;
  /** "Grade 3 - Atis" */
  label: string;
};

/** The roster's current URL state, as every control needs to rebuild it. */
export type RosterUrlState = {
  q: string;
  grade: string;
  section: string;
  advisory: string | null;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  sort: LearnerListSort;
  perPage?: number;
  schoolId?: string;
  archivedView: boolean;
};

export const ARAL_PROFILING_HREF = "/teacher/aral/profiling";

/** Build the roster URL from state; defaults are left out, page resets to 1. */
export function rosterHref(basePath: string, s: RosterUrlState): string {
  const sp = new URLSearchParams();
  const set = (k: string, v: string | undefined | null, skip = "all") => {
    if (v && v !== skip) sp.set(k, v);
  };
  set("schoolId", s.schoolId);
  set("filter", s.archivedView ? "archived" : undefined);
  set("q", s.q.trim());
  set("grade", s.grade);
  set("section", s.section);
  set("advisory", s.advisory);
  set("gender", s.gender);
  set("aralStatus", s.aralStatus);
  set("sort", s.sort, "name");
  set("perPage", s.perPage ? String(s.perPage) : undefined);
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Apply an Advisory choice, settling Grade and Section with it. */
export function withAdvisory(
  s: RosterUrlState,
  advisory: string | null,
  advisories: readonly AdvisoryOption[]
): RosterUrlState {
  const picked = advisories.find((a) => a.id === advisory);
  if (!picked) return { ...s, advisory: null };
  return { ...s, advisory: picked.id, grade: picked.gradeLevelId, section: "all" };
}

/** Apply a Grade choice: a section or advisory from another grade is dropped. */
export function withGrade(
  s: RosterUrlState,
  grade: string,
  advisories: readonly AdvisoryOption[]
): RosterUrlState {
  const advisory = advisories.find((a) => a.id === s.advisory);
  const keepAdvisory = advisory && (grade === "all" || advisory.gradeLevelId === grade);
  return {
    ...s,
    grade,
    section: "all",
    advisory: keepAdvisory ? s.advisory : null,
  };
}

/** Apply a Section choice: an advisory filter would contradict it. */
export function withSection(s: RosterUrlState, section: string): RosterUrlState {
  return { ...s, section, advisory: section === "all" ? s.advisory : null };
}

/**
 * The Active / Removed tabs, as underline tabs (the shared `TabNav`, the
 * same style as the Transfer page's kind tabs), with the add control on the
 * right. ARAL Profiling is reached from its own sidebar row, not from here.
 */
export function LearnerRosterNav({
  basePath,
  state,
  addControl,
}: {
  basePath: string;
  state: RosterUrlState;
  addControl?: React.ReactNode;
}) {
  const activeHref = rosterHref(basePath, { ...state, archivedView: false, q: "" });
  const archivedHref = rosterHref(basePath, { ...state, archivedView: true, q: "" });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <TabNav
        label="Learner lists"
        className="min-w-0 flex-1"
        activeKey={state.archivedView ? "removed" : "active"}
        items={[
          { key: "active", label: "Active Learners", href: activeHref },
          { key: "removed", label: "Removed Learners", href: archivedHref },
        ]}
      />
      {addControl ? <div className="shrink-0 sm:pb-1">{addControl}</div> : null}
    </div>
  );
}

type ToolbarProps = {
  basePath: string;
  state: RosterUrlState;
  grades: readonly LearnerGradeOption[];
  sections: readonly SectionOption[];
  advisories: readonly AdvisoryOption[];
  pageSize: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  /** Total matching rows, for the search field's screen-reader status text. */
  resultCount?: number;
  onNavigate: (href: string) => void;
  /** The bulk action menu, owned by the list so it can see the selection. */
  bulkActions?: React.ReactNode;
};

function Facets({
  basePath,
  state,
  grades,
  sections,
  advisories,
  onNavigate,
  idPrefix,
  className,
}: Pick<
  ToolbarProps,
  "basePath" | "state" | "grades" | "sections" | "advisories" | "onNavigate"
> & { idPrefix: string; className?: string }) {
  const go = (next: RosterUrlState) => onNavigate(rosterHref(basePath, next));
  return (
    <>
      <FacetSelect
        id={`${idPrefix}-grade`}
        label="Grade"
        value={state.grade}
        onValueChange={(v) => go(withGrade(state, v, advisories))}
        className={className}
      >
        <SelectItem value="all">All Grades</SelectItem>
        {grades.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.label}
          </SelectItem>
        ))}
      </FacetSelect>
      <FacetSelect
        id={`${idPrefix}-section`}
        label="Section"
        value={state.section}
        onValueChange={(v) => go(withSection(state, v))}
        className={className}
      >
        <SelectItem value="all">All Sections</SelectItem>
        {sections.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </FacetSelect>
      <FacetSelect
        id={`${idPrefix}-gender`}
        label="Gender"
        value={state.gender}
        onValueChange={(v) => go({ ...state, gender: v as LearnerGenderFilter })}
        className={className}
      >
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="MALE">Male</SelectItem>
        <SelectItem value="FEMALE">Female</SelectItem>
      </FacetSelect>
      <FacetSelect
        id={`${idPrefix}-aral`}
        label="ARAL Status"
        value={state.aralStatus}
        onValueChange={(v) =>
          go({ ...state, aralStatus: v as LearnerAralStatusFilter })
        }
        className={className}
      >
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="enrolled">Enrolled</SelectItem>
        <SelectItem value="not-enrolled">Not enrolled</SelectItem>
      </FacetSelect>
    </>
  );
}

function SortAndSize({
  basePath,
  state,
  pageSize,
  onNavigate,
  idPrefix,
}: Pick<ToolbarProps, "basePath" | "state" | "pageSize" | "onNavigate"> & {
  idPrefix: string;
}) {
  const go = (next: RosterUrlState) => onNavigate(rosterHref(basePath, next));
  return (
    <div className="grid gap-3">
      <SortSelect
        id={`${idPrefix}-sort`}
        mode="client"
        options={LEARNER_LIST_SORTS.options}
        value={state.sort}
        onSortChange={(v) => go({ ...state, sort: v as LearnerListSort })}
      />
      <FacetSelect
        id={`${idPrefix}-per-page`}
        label="Rows per page"
        value={String(pageSize)}
        onValueChange={(v) => go({ ...state, perPage: Number(v) })}
      >
        {LEARNER_PAGE_SIZE_OPTIONS.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {size}
          </SelectItem>
        ))}
      </FacetSelect>
    </div>
  );
}

export function LearnerListToolbar(props: ToolbarProps) {
  const { searchValue, onSearchChange, onSearchSubmit, resultCount, bulkActions } =
    props;
  const { basePath, state, advisories, onNavigate } = props;

  // Multi-advisory only: with one advisory (or none) there is nothing to pick.
  // Beside the search box on every width, never inside the filter sheet,
  // because it is the page's scope, not one filter among many.
  const advisory =
    advisories.length > 1 ? (
      <AdvisorySelect
        advisories={advisories}
        value={state.advisory}
        onChange={(next) => onNavigate(rosterHref(basePath, withAdvisory(state, next, advisories)))}
        className="w-full shrink-0 sm:w-56"
      />
    ) : null;

  const search = (
    <SearchInput
      value={searchValue}
      onValueChange={onSearchChange}
      onSubmit={onSearchSubmit}
      resultCount={resultCount}
      label="Search learners by name"
      placeholder="Search by name or keyword…"
      className={SEARCH_BAR_WIDTH}
      inputClassName="h-11 rounded-md lg:h-9"
    />
  );

  const activeCount = [state.grade, state.section, state.gender, state.aralStatus].filter(
    (v) => v !== "all"
  ).length;

  return (
    <div className="border-b border-border/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {search}
        {advisory}
        {/* Every other filter, and sort, sits behind one button on every width. */}
        <FilterMenu
          activeCount={activeCount}
          onClear={() =>
            onNavigate(
              rosterHref(basePath, {
                ...state,
                grade: "all",
                section: "all",
                gender: "all",
                aralStatus: "all",
              })
            )
          }
          className="h-11 lg:h-9"
        >
          <Facets {...props} idPrefix="learner-facet" />
          <SortAndSize {...props} idPrefix="learner-more" />
        </FilterMenu>
        {bulkActions ? <div className="shrink-0">{bulkActions}</div> : null}
      </div>
    </div>
  );
}

