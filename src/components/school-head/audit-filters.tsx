"use client";

import { useState } from "react";
import { useListNavigate } from "@/components/nav/list-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  // Remounted whenever the URL changes, which is what re-seeds the three
  // inputs from the new query string. A prop→state effect would do the same
  // job and is what this used to be, but it costs a second render pass on
  // every navigation and the compiler lint rejects it; a key is the pattern
  // the rest of this codebase already resets child state with.
  const { state } = props;
  return <AuditFiltersForm key={`${state.q}|${state.from ?? ""}|${state.to ?? ""}`} {...props} />;
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

  const hasFilters = Boolean(state.q || state.from || state.to);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] max-lg:basis-full flex-1 space-y-1">
        <Label htmlFor="audit-search" className="text-xs text-muted-foreground">
          Search actor or action
        </Label>
        <Input
          id="audit-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              push({ q });
            }
          }}
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
        className="sm:h-10 lg:h-9"
        onClick={() => push({ q, from: from || null, to: to || null })}
      >
        Apply
      </Button>
      {hasFilters ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="sm:h-10 lg:h-9"
          onClick={() => {
            setQ("");
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
