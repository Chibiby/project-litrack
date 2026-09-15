"use client";

import Link from "next/link";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  LEARNER_PAGE_SIZE_OPTIONS,
  stepAdvisory,
  type LearnerAralStatusFilter,
  type LearnerGenderFilter,
  type LearnerListSort,
} from "@/lib/learners/pagination";

/**
 * v2 roster controls, to the owner's Learners mockups.
 *
 * `LearnerRosterNav` sits above the table panel: the three tabs, the Advisory
 * switcher and the add control. `LearnerListToolbar` is the panel's own top
 * row: search, every facet, More Filters and bulk actions. Below xl the facets
 * move into a sheet behind one filter button, as in the phone mockup.
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
 * Facet control: a small caption stacked over the current value, matching the
 * mockup. `line-clamp-none` undoes SelectTrigger's single-line clamp.
 */
function FacetSelect({
  id,
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn(
          "h-auto w-full gap-2 rounded-xl py-1.5 [&>span]:line-clamp-none",
          className
        )}
      >
        {/* Block children, not flex: the clamp reset above sets display:block
            on this span, so its two lines must stack on their own. */}
        <span className="min-w-0 text-left">
          <span className="block text-[11px] font-normal leading-tight text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm font-medium leading-tight text-foreground">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

const TAB_BASE =
  "h-9 shrink-0 gap-1.5 rounded-xl px-3 text-[13px] font-medium sm:h-10 sm:gap-2 sm:px-4 sm:text-sm";
const TAB_ON =
  "border-transparent bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm shadow-violet-500/30 hover:from-violet-600 hover:to-violet-600 hover:text-white";

export function LearnerRosterNav({
  basePath,
  state,
  advisories,
  showProfiling,
  addControl,
  onNavigate,
}: {
  basePath: string;
  state: RosterUrlState;
  advisories: readonly AdvisoryOption[];
  /** Hidden for Super Admin, who tutors nobody. */
  showProfiling: boolean;
  addControl?: React.ReactNode;
  onNavigate: (href: string) => void;
}) {
  const activeHref = rosterHref(basePath, {
    ...state,
    archivedView: false,
    q: "",
  });
  const archivedHref = rosterHref(basePath, {
    ...state,
    archivedView: true,
    q: "",
  });
  const ids = advisories.map((a) => a.id);
  const go = (advisory: string | null) =>
    onNavigate(rosterHref(basePath, withAdvisory(state, advisory, advisories)));
  const noAdvisories = advisories.length === 0;

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <nav
        aria-label="Learner lists"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 xl:pb-0"
      >
        <Button
          asChild
          variant="outline"
          className={cn(TAB_BASE, !state.archivedView && TAB_ON)}
        >
          <Link
            href={activeHref}
            aria-current={!state.archivedView ? "page" : undefined}
          >
            <Users className="size-4" aria-hidden />
            Active Learners
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className={cn(TAB_BASE, state.archivedView && TAB_ON)}
        >
          <Link
            href={archivedHref}
            aria-current={state.archivedView ? "page" : undefined}
          >
            <Archive className="size-4" aria-hidden />
            Archived Learners
          </Link>
        </Button>
        {showProfiling ? (
          <Button asChild variant="outline" className={TAB_BASE}>
            <Link href={ARAL_PROFILING_HREF}>
              <ClipboardList className="size-4" aria-hidden />
              Learner Profiling
            </Link>
          </Button>
        ) : null}
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <span className="shrink-0 text-sm font-medium text-foreground">
            Advisory
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0 rounded-xl"
              disabled={noAdvisories}
              onClick={() => go(stepAdvisory(ids, state.advisory, -1))}
              aria-label="Previous advisory"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Select
              value={state.advisory ?? "all"}
              onValueChange={(v) => go(v === "all" ? null : v)}
              disabled={noAdvisories}
            >
              <SelectTrigger
                aria-label="Advisory"
                className="h-10 min-w-0 flex-1 justify-between rounded-xl font-medium sm:w-48 sm:flex-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {noAdvisories ? "No advisory" : "All advisories"}
                </SelectItem>
                {advisories.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0 rounded-xl"
              disabled={noAdvisories}
              onClick={() => go(stepAdvisory(ids, state.advisory, 1))}
              aria-label="Next advisory"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        {addControl ? <div className="shrink-0">{addControl}</div> : null}
      </div>
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
        id={`${idPrefix}-advisory`}
        label="Advisory"
        value={state.advisory ?? "all"}
        onValueChange={(v) =>
          go(withAdvisory(state, v === "all" ? null : v, advisories))
        }
        className={className}
      >
        <SelectItem value="all">All Advisories</SelectItem>
        {advisories.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.label}
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
      <FacetSelect
        id={`${idPrefix}-sort`}
        label="Sort by"
        value={state.sort}
        onValueChange={(v) => go({ ...state, sort: v as LearnerListSort })}
      >
        <SelectItem value="name">Name (A–Z)</SelectItem>
        <SelectItem value="age">Age (youngest first)</SelectItem>
      </FacetSelect>
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
  const { searchValue, onSearchChange, onSearchSubmit, bulkActions } = props;

  const search = (
    <div className="relative min-w-[12rem] flex-1 xl:min-w-0 xl:max-w-xs 2xl:max-w-sm">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSearchSubmit();
          }
        }}
        placeholder="Search by name or keyword…"
        className="h-11 rounded-xl pl-10"
        aria-label="Search learners by name"
      />
    </div>
  );

  return (
    <div className="border-b border-border/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-end gap-2 xl:flex-nowrap">
        {search}
        {/* xl and up: every facet inline, as in the desktop mockup. */}
        <div className="hidden min-w-0 flex-[3] items-center gap-2 xl:flex">
          <Facets {...props} idPrefix="learner-facet" className="min-w-0 flex-1" />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 gap-2 rounded-xl"
              >
                <SlidersHorizontal className="size-4" aria-hidden />
                More Filters
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <SortAndSize {...props} idPrefix="learner-more" />
            </PopoverContent>
          </Popover>
        </div>
        {/* Below xl: one filter button, as in the phone mockup. The sheet's
            content mounts only while open, so the facets never render twice. */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0 rounded-xl xl:hidden"
              aria-label="Filters"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Narrow the learner list.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Facets {...props} idPrefix="learner-sheet" />
            </div>
            <div className="mt-3">
              <SortAndSize {...props} idPrefix="learner-sheet-more" />
            </div>
          </SheetContent>
        </Sheet>
        {bulkActions ? <div className="shrink-0">{bulkActions}</div> : null}
      </div>
    </div>
  );
}

