"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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

/** Debounce pause before applying typed search (ms). Same value as the roster. */
export const PROFILING_SEARCH_DEBOUNCE_MS = 500;

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt the URL's `q` (e.g. browser back/forward) during render, per the
  // React docs "adjusting state when a prop changes" pattern.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setInputValue(q);
  }

  const clearDebounce = () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };
  useEffect(() => () => clearDebounce(), []);

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${ARAL_PROFILING_HREF}?${qs}` : ARAL_PROFILING_HREF);
  }

  const pushSearch = (raw: string) => {
    clearDebounce();
    navigate({ q: raw.trim() || undefined });
  };

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    clearDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushSearch(value);
    }, PROFILING_SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={inputValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pushSearch(inputValue);
            }
          }}
          placeholder="Search learner name…"
          className="h-11 rounded-xl pl-9 sm:h-9"
          aria-label="Search learners by name"
        />
      </div>

      <Select
        value={section === "all" ? "all" : section}
        onValueChange={(value) => navigate({ section: value === "all" ? undefined : value })}
      >
        <SelectTrigger aria-label="Section" className="h-11 sm:h-9 sm:w-40">
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
        <SelectTrigger aria-label="Status" className="h-11 sm:h-9 sm:w-40">
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
