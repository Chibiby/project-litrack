"use client";

import { useState } from "react";
import { useListNavigate } from "@/components/nav/list-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";

export type AuditFiltersState = {
  q: string;
  from: string | null;
  to: string | null;
};

/**
 * Free-text (actor name + action) and date-range controls for the audit table.
 *
 * URL-driven like the rest of the list controls in this codebase
 * (`AralTeacherTable`, the learner roster toolbar): every change pushes a new
 * `basePath?...` route rather than filtering client-side, so a reload, a
 * shared link, and the back button all reproduce the same filtered page. Every
 * push resets `page` to 1 — a stale page number past the new, narrower result
 * count would otherwise render an empty table that looks broken rather than
 * filtered.
 */
export function AuditFilters(props: AuditFiltersProps) {
  // Remounted whenever the applied dates change, which re-seeds the date
  // inputs from the new query string. The search text is left out of the key on
  // purpose: a remount when a search lands would drop focus and any letters
  // typed while it loaded, so the form adopts a changed `q` itself.
  const { state } = props;
  return <AuditFiltersForm key={`${state.from ?? ""}|${state.to ?? ""}`} {...props} />;
}

type AuditFiltersProps = {
  basePath: string;
  state: AuditFiltersState;
  /** Params outside this component's control that must survive a push, e.g. `schoolId`. */
  otherParams: Record<string, string | undefined>;
};

function AuditFiltersForm({ basePath, state, otherParams }: AuditFiltersProps) {
  const listNavigate = useListNavigate();
  const [q, setQ] = useState(state.q);
  const [prevStateQ, setPrevStateQ] = useState(state.q);
  // The last term the box sent to the URL. When that same term comes back it is
  // our own search landing, and adopting it would erase characters typed while
  // the request was in flight.
  const [pushedQ, setPushedQ] = useState(state.q);
  if (state.q !== prevStateQ) {
    setPrevStateQ(state.q);
    if (state.q !== pushedQ) {
      setQ(state.q);
      setPushedQ(state.q);
    }
  }
  const [from, setFrom] = useState(state.from ?? "");
  const [to, setTo] = useState(state.to ?? "");

  const push = (next: Partial<AuditFiltersState>) => {
    const merged: AuditFiltersState = {
      q: next.q !== undefined ? next.q : q,
      from: next.from !== undefined ? next.from : from || null,
      to: next.to !== undefined ? next.to : to || null,
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(otherParams)) {
      if (v) params.set(k, v);
    }
    if (merged.q.trim()) params.set("q", merged.q.trim());
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    const qs = params.toString();
    listNavigate(qs ? `${basePath}?${qs}` : basePath);
  };

  // Searching by text keeps the dates that are already applied, not whatever
  // is half-typed in the date boxes, which still wait for Apply.
  const searchNow = (value: string) => {
    const term = value.trim();
    if (term === pushedQ) return;
    setPushedQ(term);
    push({ q: term, from: state.from, to: state.to });
  };

  const hasFilters = Boolean(state.q || state.from || state.to);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] max-lg:basis-full flex-1 space-y-1">
        <SearchInput
          id="audit-search"
          label="Search actor or action"
          labelVisible
          value={q}
          onValueChange={setQ}
          onDebouncedChange={searchNow}
          placeholder="Name or action…"
          className="max-w-sm max-lg:max-w-none"
        />
      </div>
      <div className="max-lg:flex-1 space-y-1">
        <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="audit-from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40 max-lg:w-full"
        />
      </div>
      <div className="max-lg:flex-1 space-y-1">
        <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="audit-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="w-40 max-lg:w-full"
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="lg:h-9"
        onClick={() => {
          setPushedQ(q.trim());
          push({ q, from: from || null, to: to || null });
        }}
      >
        Apply filters
      </Button>
      {hasFilters ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="lg:h-9"
          onClick={() => {
            setQ("");
            setPushedQ("");
            setFrom("");
            setTo("");
            push({ q: "", from: null, to: null });
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
