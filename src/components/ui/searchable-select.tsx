"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchableOption = { value: string; label: string; hint?: string };

/**
 * Rendering every match of a few-hundred-item list is wasteful and janky; a cap
 * plus a "N more" footer keeps it fast without pulling in virtualization.
 */
export const MAX_VISIBLE_OPTIONS = 100;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matches(option: SearchableOption, tokens: string[]): boolean {
  const haystack = fold(`${option.label} ${option.hint ?? ""}`);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Every whitespace-separated token must appear somewhere in the label or hint,
 * so "alabel central" and "central alabel" both find "Alabel Central ES".
 */
export function filterOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options.slice(0, MAX_VISIBLE_OPTIONS);

  const found: SearchableOption[] = [];
  for (const option of options) {
    if (matches(option, tokens)) {
      found.push(option);
      if (found.length === MAX_VISIBLE_OPTIONS) break;
    }
  }
  return found;
}

function countMatches(options: SearchableOption[], query: string): number {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options.length;
  return options.filter((o) => matches(o, tokens)).length;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  disabled = false,
  id,
}: {
  options: SearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const reactId = React.useId();
  const baseId = id ?? `searchable-${reactId}`;
  const listId = `${baseId}-listbox`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const visible = React.useMemo(() => filterOptions(options, query), [options, query]);
  const total = React.useMemo(() => countMatches(options, query), [options, query]);
  const hidden = Math.max(0, total - visible.length);
  const selected = options.find((o) => o.value === value);

  // A filter change can leave the active index past the end of the new list.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Keep the active option in view without moving DOM focus off the search input.
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (option: SearchableOption) => {
    onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, visible.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={baseId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate text-left">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={visible.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined}
            className="h-9"
          />
        </div>
        <div ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            visible.map((option, index) => (
              <div
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                  ) : null}
                </span>
                {option.value === value ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
              </div>
            ))
          )}
        </div>
        {hidden > 0 ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {hidden} more {hidden === 1 ? "match" : "matches"} — keep typing to narrow.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
