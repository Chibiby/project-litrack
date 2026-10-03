"use client";

import { useState, type FormEvent } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useListNavigate, useListPending } from "@/components/nav/list-navigation";
import { summaryHref, withoutPageParams, type FlatSearchParams } from "./summary-href";

export type SummarySchoolSearchProps = {
  basePath: string;
  searchParams: FlatSearchParams;
  /** The `q` in the URL, trimmed. */
  query: string;
};

/**
 * One search for every by-school table on the page. It lives in the URL (`q`)
 * so a view can be shared; a new search sends every table back to page 1.
 */
export function SummarySchoolSearch({ basePath, searchParams, query }: SummarySchoolSearchProps) {
  const navigate = useListNavigate();
  const pending = useListPending();
  const [draft, setDraft] = useState(query);
  const [synced, setSynced] = useState(query);
  if (synced !== query) {
    setSynced(query);
    setDraft(query);
  }

  function search(next: string) {
    const text = next.trim();
    navigate(summaryHref(basePath, withoutPageParams(searchParams), { q: text || null }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    search(draft);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="flex min-w-0 flex-col gap-1.5 sm:max-w-xl">
      <Label htmlFor="summary-school-search" className="text-xs font-medium text-muted-foreground">
        Search schools
      </Label>
      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="summary-school-search"
            type="search"
            value={draft}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="School name or ID"
            autoComplete="off"
            className="h-11 bg-card pl-9 lg:h-10"
          />
        </div>
        <Button type="submit" variant="secondary" className="shrink-0" aria-busy={pending || undefined}>
          Search
        </Button>
        {query ? (
          <Button
            type="button"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              setDraft("");
              search("");
            }}
          >
            <X aria-hidden />
            Clear search
          </Button>
        ) : null}
      </div>
    </form>
  );
}
