"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Users, X } from "lucide-react";
import { ARAL_SCOPE_TRIGGER } from "@/components/learners/advisory-select";
import { SEARCH_BAR_WIDTH } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { useListNavigate } from "@/components/nav/list-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ARAL_MOSY_HREF } from "@/lib/nav/nav-config";
import type { MosyGradeOption } from "@/lib/aral/mosy-queries";
import { MOSY_STATUSES, MOSY_STATUS_LABELS, type MosyStatusFilter } from "@/lib/aral/mosy";

export const MOSY_SEARCH_DEBOUNCE_MS = 500;

const MOSY_STATUS_OPTIONS = MOSY_STATUSES.map((value) => ({
  value,
  label: value === "all" ? "All ARAL statuses" : MOSY_STATUS_LABELS[value],
}));

const ALL = "all";
const STALE = "stale";
const gradeValue = (gradeId: string) => `g:${gradeId}`;
const sectionValue = (gradeId: string, sectionId: string) => `s:${gradeId}:${sectionId}`;

/**
 * MOSY's own search + Advisory + ARAL status row. The advisory filter is the
 * same purple, grade-grouped picker as Learners and Weekly Attendance: All
 * advisories, then each grade as a heading over its sections, with no "All of
 * Kinder" row. It still writes both URL facets (`grade` and `section`), so
 * every change here resets `page` and keeps `schoolId` and whichever params
 * it did not touch. A grade-only link from before keeps working: that grade
 * shows as one extra row so the trigger never reads blank.
 */
export function MosyToolbar({
  q,
  grade,
  section,
  status,
  grades,
  basePath = ARAL_MOSY_HREF,
  statusParam = "status",
  statusOptions = MOSY_STATUS_OPTIONS,
  statusAriaLabel = "ARAL status",
}: {
  q: string;
  grade: string;
  section: string;
  /** Selected value of the third select; `"all"` means unfiltered. */
  status: MosyStatusFilter | (string & {});
  grades: MosyGradeOption[];
  /** List page this toolbar navigates. The BOSY page reuses the toolbar. */
  basePath?: string;
  /** URL key the third select writes. */
  statusParam?: string;
  /** Options of the third select. The first must be `"all"`. */
  statusOptions?: readonly { value: string; label: string }[];
  statusAriaLabel?: string;
}) {
  const listNavigate = useListNavigate();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    listNavigate(qs ? `${basePath}?${qs}` : basePath);
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
    }, MOSY_SEARCH_DEBOUNCE_MS);
  };

  const selectedGrade = grades.find((g) => g.id === grade);
  const selectedSection = selectedGrade?.sections.find((s) => s.id === section);
  const gradeStale = grade !== "" && !selectedGrade;
  const sectionStale = section !== ALL && !selectedSection;
  const facetStale = gradeStale || sectionStale;
  const facetValue = facetStale
    ? STALE
    : !selectedGrade
      ? ALL
      : selectedSection
        ? sectionValue(selectedGrade.id, selectedSection.id)
        : gradeValue(selectedGrade.id);

  function handleFacetChange(value: string) {
    if (value === STALE) return;
    if (value === ALL) {
      navigate({ grade: undefined, section: undefined });
      return;
    }
    const [kind, gradeId, sectionId] = value.split(":");
    navigate({ grade: gradeId, section: kind === "s" ? sectionId : undefined });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      <div className={cn("relative", SEARCH_BAR_WIDTH)}>
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
          className="h-11 rounded-md pl-9 lg:h-9"
          aria-label="Search learners by name"
        />
      </div>

      <Select value={facetValue} onValueChange={handleFacetChange}>
        <SelectTrigger aria-label="Advisory" className={cn(ARAL_SCOPE_TRIGGER, "w-full sm:w-56")}>
          <Users className="size-4 shrink-0 text-aral-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">
            <SelectValue placeholder="All advisories" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {facetStale ? (
            <SelectItem value={STALE} disabled>
              Unknown advisory
            </SelectItem>
          ) : null}
          <SelectItem value={ALL}>All advisories</SelectItem>
          {selectedGrade && !selectedSection ? (
            <SelectItem value={gradeValue(selectedGrade.id)}>{selectedGrade.label}</SelectItem>
          ) : null}
          {grades.map((g) => (
            <SelectGroup key={g.id}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.sections.map((s) => (
                <SelectItem key={s.id} value={sectionValue(g.id, s.id)}>
                  {g.label} - {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {facetStale ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 lg:h-9"
          onClick={() => navigate({ grade: undefined, section: undefined })}
        >
          <X className="size-4" aria-hidden />
          Clear advisory filter
        </Button>
      ) : null}

      <Select
        value={status}
        onValueChange={(value) => navigate({ [statusParam]: value === "all" ? undefined : value })}
      >
        <SelectTrigger aria-label={statusAriaLabel} className="h-11 sm:w-44 lg:h-9">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
