"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  LearnerAralStatusFilter,
  LearnerGenderFilter,
} from "@/lib/learners/pagination";

/**
 * The roster toolbar, to the approved comp: one wide search field on the left,
 * then the facet dropdowns, then the bulk action menu hard right.
 *
 * The comp's Filter and Export buttons are gone by direction — every facet the
 * popover used to hide is now a visible dropdown, so a second filter affordance
 * would only duplicate them.
 *
 * Section is not a facet here: the roster already prints each learner's section
 * in its own column, and a teacher scanning one advisory class has nothing to
 * narrow. The ARAL grade pages keep their section filter — that plumbing still
 * lives in `pagination.ts`.
 */

/** Still exported for the ARAL grade pages' section filter. */
export type SectionOption = { id: string; name: string };

export type LearnerGradeOption = {
  id: string;
  label: string;
};

type Props = {
  basePath?: string;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  schoolId?: string;
  /** Current URL `q` — preserved when a facet changes. */
  q?: string;
  /** Current rows-per-page — preserved when a facet changes. */
  perPage?: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  /** The bulk action menu, owned by the list so it can see the selection. */
  bulkActions?: React.ReactNode;
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

/**
 * Facet control: a small caption stacked over the current value, matching the
 * comp. `line-clamp-none` undoes SelectTrigger's single-line clamp, which would
 * otherwise collapse the two rows into one.
 */
function FacetSelect({
  id,
  label,
  value,
  onValueChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className="h-auto w-full min-w-[8.5rem] gap-2 py-1.5 sm:w-auto [&>span]:line-clamp-none"
      >
        <span className="flex flex-col items-start text-left">
          <span className="text-[11px] font-normal leading-tight text-muted-foreground">
            {label}
          </span>
          <span className="text-sm font-medium leading-tight text-foreground">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export function LearnerListToolbar({
  basePath = "/teacher/learners",
  gender,
  aralStatus,
  schoolId,
  q = "",
  perPage,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  bulkActions,
}: Props) {
  const router = useRouter();

  function navigate(next: {
    gender?: LearnerGenderFilter;
    aralStatus?: LearnerAralStatusFilter;
  }) {
    const nextGender = next.gender ?? gender;
    const nextAralStatus = next.aralStatus ?? aralStatus;

    router.push(
      buildHref(basePath, {
        schoolId,
        q: q.trim() || undefined,
        gender: nextGender !== "all" ? nextGender : undefined,
        aralStatus: nextAralStatus !== "all" ? nextAralStatus : undefined,
        perPage: perPage ? String(perPage) : undefined,
      })
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
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
          placeholder="Search by name…"
          className="pl-9"
          aria-label="Search learners by name"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
        <FacetSelect
          id="learner-facet-gender"
          label="Gender"
          value={gender}
          onValueChange={(value) =>
            navigate({ gender: value as LearnerGenderFilter })
          }
        >
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="MALE">Male</SelectItem>
          <SelectItem value="FEMALE">Female</SelectItem>
        </FacetSelect>

        <FacetSelect
          id="learner-facet-aral"
          label="ARAL Status"
          value={aralStatus}
          onValueChange={(value) =>
            navigate({ aralStatus: value as LearnerAralStatusFilter })
          }
        >
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="enrolled">Enrolled</SelectItem>
          <SelectItem value="not-enrolled">Not enrolled</SelectItem>
        </FacetSelect>

        {bulkActions}
      </div>
    </div>
  );
}
