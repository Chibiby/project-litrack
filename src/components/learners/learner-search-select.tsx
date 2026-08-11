"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchActiveLearners } from "@/lib/actions/search-learners";
import {
  LEARNER_SEARCH_MIN_CHARS,
  type LearnerSearchHit,
} from "@/lib/learners/search";
import { cn } from "@/lib/utils";

type Props = {
  schoolId: string;
  value: LearnerSearchHit | null;
  onChange: (learner: LearnerSearchHit | null) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  id?: string;
};

export function LearnerSearchSelect({
  schoolId,
  value,
  onChange,
  disabled = false,
  label = "Learner",
  placeholder = "Search by name…",
  id: idProp,
}: Props) {
  const reactId = useId();
  const inputId = idProp ?? `learner-search-${reactId}`;
  const listId = `${inputId}-list`;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LearnerSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery("");
    setHits([]);
    setOpen(false);
    setError(null);
  }, [schoolId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = (raw: string) => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const q = raw.trim();
    if (!schoolId || q.length < LEARNER_SEARCH_MIN_CHARS) {
      setHits([]);
      setError(null);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      startTransition(async () => {
        const res = await searchActiveLearners({ schoolId, q });
        if (!res.ok) {
          setHits([]);
          setError(res.error);
          setOpen(true);
          return;
        }
        setError(null);
        setHits(res.data);
        setOpen(true);
      });
    }, 250);
  };

  return (
    <div className="space-y-2" ref={wrapRef}>
      <Label htmlFor={inputId}>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {value.fullName}{" "}
            <span className="text-muted-foreground">({value.gradeLabel})</span>
          </span>
          <button
            type="button"
            className="shrink-0 text-sm text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setQuery("");
              setHits([]);
              setOpen(false);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            disabled={disabled || !schoolId}
            placeholder={
              !schoolId ? "Select a school first" : placeholder
            }
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              runSearch(next);
            }}
            onFocus={() => {
              if (hits.length > 0 || error) setOpen(true);
            }}
            autoComplete="off"
          />
          {open ? (
            <ul
              id={listId}
              role="listbox"
              className={cn(
                "absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-md"
              )}
            >
              {pending && hits.length === 0 && !error ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Searching…
                </li>
              ) : null}
              {error ? (
                <li className="px-3 py-2 text-sm text-destructive">{error}</li>
              ) : null}
              {!pending && !error && hits.length === 0 && query.trim() ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  No learners found
                </li>
              ) : null}
              {hits.map((hit) => (
                <li key={hit.id} role="option">
                  <button
                    type="button"
                    className="flex w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onChange(hit);
                      setQuery("");
                      setHits([]);
                      setOpen(false);
                    }}
                  >
                    {hit.fullName}{" "}
                    <span className="ml-1 text-muted-foreground">
                      ({hit.gradeLabel})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
