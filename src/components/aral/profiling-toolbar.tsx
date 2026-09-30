"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useListNavigate } from "@/components/nav/list-navigation";
import { SearchInput } from "@/components/ui/search-input";
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

export type ProfilingSectionOption = { id: string; name: string };

/**
 * ARAL Profiling's own search + Section + Status row. Not `AralSectionSelect`
 * from `aral-scope-select.tsx`: that component's `pathForGrade` signature
 * assumes one grade in the URL, but Profiling lists a tutor's learners across
 * every grade they are assigned to.
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
  sections,
  status,
}: {
  q: string;
  section: LearnerListSectionFilter;
  sections: ProfilingSectionOption[];
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
        className="min-w-[12rem] flex-1 sm:max-w-xs"
        inputClassName="rounded-xl lg:h-9"
      />

      <Select
        value={section === "all" ? "all" : section}
        onValueChange={(value) => navigate({ section: value === "all" ? undefined : value })}
      >
        <SelectTrigger aria-label="Section" className="h-11 sm:w-40 lg:h-9">
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

      <Select
        value={status}
        onValueChange={(value) => navigate({ status: value === "all" ? undefined : value })}
      >
        <SelectTrigger aria-label="Status" className="h-11 sm:w-40 lg:h-9">
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
