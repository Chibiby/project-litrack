"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortSelect } from "@/components/ui/sort-select";
import { useListNavigate, useListPending } from "@/components/nav/list-navigation";
import type { SortOption } from "@/lib/sort/registry";

const ANY = "any";

export type ListFilterOption = { value: string; label: string; hint?: string };

/** One URL-backed filter. The server page builds these; the bar only renders them. */
export type ListFilterField = {
  /** URL search param this filter writes. */
  key: string;
  label: string;
  /** Label of the "no filter" choice, e.g. "All districts". */
  allLabel: string;
  value: string;
  options: ListFilterOption[];
  /** Params cleared when this one changes — a school pick drops a stale section. */
  clears?: readonly string[];
  /** Set when the filter cannot be used yet; the field is disabled and shows this. */
  disabledReason?: string;
  /** One short line under the field, e.g. how it differs from a nearby card. */
  help?: string;
  /** A type-to-search picker for long lists (schools, sections). */
  searchable?: boolean;
};

/** "District: Koronadal", "Search: “ana”" — what is narrowing the list right now. */
export function describeActiveFilters(fields: ListFilterField[], q: string): string[] {
  const parts: string[] = [];
  for (const field of fields) {
    if (!field.value) continue;
    const option = field.options.find((o) => o.value === field.value);
    parts.push(`${field.label}: ${option?.label ?? field.value}`);
  }
  if (q) parts.push(`Search: “${q}”`);
  return parts;
}

/**
 * Search box, contextual filters and sort for one server-paginated list. Every
 * value lives in the URL; any change drops `page` so the list starts over at
 * page 1. Must render inside a `ListNavigationProvider`.
 *
 * The search box keeps its own text and only adopts the URL's `q` when it did
 * not send it — adopting our own debounced term back would erase characters
 * typed while the request was in flight. Pages leave `q` out of their Suspense
 * `listKey` for the same reason: a remount would drop the box's focus.
 */
export function ListFilterBar<K extends string>({
  basePath,
  q,
  resultCount,
  searchLabel,
  searchPlaceholder,
  fields,
  sort,
}: {
  basePath: string;
  q: string;
  resultCount: number;
  searchLabel: string;
  searchPlaceholder: string;
  fields: ListFilterField[];
  sort?: { value: K; options: readonly SortOption<K>[] };
}) {
  const searchParams = useSearchParams();
  const navigate = useListNavigate();
  const pending = useListPending();
  const [query, setQuery] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const [pushedQ, setPushedQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== pushedQ) {
      setQuery(q);
      setPushedQ(q);
    }
  }

  const apply = (changes: Record<string, string | null>, clears: readonly string[] = []) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of clears) next.delete(key);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    navigate(qs ? `${basePath}?${qs}` : basePath);
  };

  const searchNow = (value: string) => {
    const term = value.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    apply({ q: term || null });
  };

  const clearAll = () => {
    setQuery("");
    setPushedQ("");
    const sortValue = searchParams.get("sort");
    navigate(sortValue ? `${basePath}?sort=${encodeURIComponent(sortValue)}` : basePath);
  };

  const active = describeActiveFilters(fields, q);
  const sortParams: Record<string, string | undefined> = { q: q || undefined };
  for (const field of fields) sortParams[field.key] = field.value || undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <SearchInput
            id={`${basePath.replaceAll("/", "-")}-q`}
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={searchNow}
            resultCount={resultCount}
            label={searchLabel}
            labelVisible
            placeholder={searchPlaceholder}
          />
        </div>
        {sort ? (
          <div className="w-full sm:w-56">
            <SortSelect
              mode="link"
              id={`${basePath.replaceAll("/", "-")}-sort`}
              basePath={basePath}
              value={sort.value}
              options={sort.options}
              searchParams={sortParams}
            />
          </div>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {fields.map((field) => {
            const id = `filter-${field.key}`;
            const hintId = `${id}-hint`;
            const disabled = pending || Boolean(field.disabledReason);
            const hint = field.disabledReason ?? field.help;
            return (
              <div key={field.key} className="min-w-0 space-y-1.5">
                <Label htmlFor={id} className="text-xs font-medium">
                  {field.label}
                </Label>
                {field.searchable ? (
                  <SearchableSelect
                    id={id}
                    chevron="down"
                    value={field.value}
                    onValueChange={(value) => apply({ [field.key]: value || null }, field.clears)}
                    options={[{ value: "", label: field.allLabel }, ...field.options]}
                    placeholder={field.allLabel}
                    searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
                    emptyMessage={`No ${field.label.toLowerCase()} matches.`}
                    disabled={disabled}
                  />
                ) : (
                  <Select
                    value={field.value || ANY}
                    onValueChange={(value) => apply({ [field.key]: value }, field.clears)}
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id={id}
                      className="h-11 w-full lg:h-10"
                      aria-describedby={hint ? hintId : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>{field.allLabel}</SelectItem>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {hint ? (
                  <p id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Filtered by</span>
          {active.map((part) => (
            <span
              key={part}
              className="max-w-full truncate rounded-full border border-border/80 bg-muted/60 px-2.5 py-1"
            >
              {part}
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            disabled={pending}
            onClick={clearAll}
          >
            <X aria-hidden /> Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
