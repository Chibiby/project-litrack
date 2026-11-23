"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useListNavigate } from "@/components/nav/list-navigation";
import { SEARCH_BAR_WIDTH, SearchInput } from "@/components/ui/search-input";
import { AdvisorySelect } from "@/components/learners/advisory-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import { PROFILING_STATUS_LABELS, type ProfilingStatusFilter } from "@/lib/aral/profiling-stats";

/** A section, labelled with its grade: "Kinder - A". */
export type ProfilingAdvisoryOption = { id: string; label: string };

/**
 * ARAL Profiling's own search + Advisory + Status row. The advisory filter is
 * the same purple, grade-grouped picker as Learners: All advisories, then each
 * grade as a heading over its sections. It writes `section` only, since a
 * section id already names its grade; Profiling lists an ARAL tutor's
 * learners across every grade they are assigned to.
 *
 * URL-driven: `q`, `section` and `status` all live in the query string, and
 * every change here resets `page` to `1` while preserving `schoolId` and
 * whichever of the other two params it did not touch (both read straight off
 * the current URL via `useSearchParams`, so nothing here needs to be re-passed
 * as a prop just to survive a navigation).
 */
export function ProfilingToolbar({
  q,
  section,
  advisories,
  status,
}: {
  q: string;
  section: LearnerListSectionFilter;
  advisories: ProfilingAdvisoryOption[];
  status: ProfilingStatusFilter;
}) {
  const listNavigate = useListNavigate();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);

  // Adopt the URL's `q` (e.g. browser back/forward) during render, per the
  // React docs "adjusting state when a prop changes" pattern. A `q` this box
  // itself sent is skipped: adopting it would erase characters typed while the
  // request was in flight.
  const [prevQ, setPrevQ] = useState(q);
  const [pushedQ, setPushedQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== pushedQ) {
      setInputValue(q);
      setPushedQ(q);
    }
  }

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const qs = params.toString();
    listNavigate(qs ? `${ARAL_PROFILING_HREF}?${qs}` : ARAL_PROFILING_HREF);
  }

  const pushSearch = (raw: string) => {
    const term = raw.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    navigate({ q: term || undefined });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      <SearchInput
        value={inputValue}
        onValueChange={setInputValue}
        onDebouncedChange={pushSearch}
        label="Search learners by name"
        placeholder="Search learner name…"
        className={SEARCH_BAR_WIDTH}
        inputClassName="rounded-md lg:h-9"
      />

      {advisories.length > 1 ? (
        <AdvisorySelect
          advisories={advisories}
          // "none" (learners with no section) is an old link only; it reads as All.
          value={section === "all" || section === "none" ? null : section}
          onChange={(next) => navigate({ section: next ?? undefined })}
          className="w-full shrink-0 sm:w-56"
        />
      ) : null}

      <Select
        value={status}
        onValueChange={(value) => navigate({ status: value === "all" ? undefined : value })}
      >
        <SelectTrigger aria-label="Status" className="h-11 sm:w-40">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(PROFILING_STATUS_LABELS) as [ProfilingStatusFilter, string][]).map(
            ([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            )
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
