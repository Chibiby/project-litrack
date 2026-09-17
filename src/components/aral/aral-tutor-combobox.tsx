"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmploymentTypeChip } from "@/components/teachers/employment-type-chip";
import { cn } from "@/lib/utils";

/**
 * Structurally the `AralTutorOption` that `listAralTutors` returns, declared
 * here rather than imported: that module is `server-only`, and the shape
 * travels in this direction anyway.
 */
export type AralTutorOption = {
  id: string;
  name: string;
  /** "Grade 3 · Sampaguita", or null for a teacher who advises nothing. */
  advisoryLabel: string | null;
  employmentType: "DEPED_PLANTILLA" | "NON_DEPED" | null;
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matches(tutor: AralTutorOption, tokens: string[]): boolean {
  const haystack = fold(`${tutor.name} ${tutor.advisoryLabel ?? "ARAL only"}`);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Every whitespace-separated token must appear somewhere in the name or
 * sublabel, so "banas" finds "Bañas" and "grade 5" finds "Grade 5 · Narra".
 */
export function filterAralTutors(
  tutors: AralTutorOption[],
  query: string
): AralTutorOption[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return tutors;
  return tutors.filter((t) => matches(t, tokens));
}

type Props = {
  /** Every other teacher who may hold the designation — "Myself" excluded. */
  tutors: AralTutorOption[];
  selfId: string;
  /** Selected tutor id — `selfId` means "Myself". */
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
};

/**
 * Searchable "who tutors this learner in ARAL" picker, shared by the enroll
 * and reassign flows. "Myself" is always the first row and is never filtered
 * out — it is how a teacher un-delegates, and searching should not hide it.
 */
export function AralTutorCombobox({
  tutors,
  selfId,
  value,
  onValueChange,
  disabled = false,
  id,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const reactId = React.useId();
  const baseId = id ?? `aral-tutor-${reactId}`;
  const listId = `${baseId}-listbox`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filteredTutors = React.useMemo(
    () => filterAralTutors(tutors, query),
    [tutors, query]
  );

  const assignedToSelf = value === selfId;
  const chosenTutor = tutors.find((t) => t.id === value);
  const label = assignedToSelf ? "Myself" : (chosenTutor?.name ?? "Myself");

  // "Myself" survives any filter and always leads the list.
  const rows: Array<{ kind: "self" } | { kind: "tutor"; tutor: AralTutorOption }> =
    React.useMemo(
      () => [
        { kind: "self" as const },
        ...filteredTutors.map((tutor) => ({ kind: "tutor" as const, tutor })),
      ],
      [filteredTutors]
    );

  // A filter change resets the highlighted row. Adjusted during render (React
  // docs "adjusting state when a prop changes" pattern) rather than an effect,
  // comparing against the previously committed query.
  const [prevQuery, setPrevQuery] = React.useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  // Closing clears the search and the highlight, so reopening always starts
  // fresh rather than wherever the last visit left the cursor.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (rowValue: string) => {
    onValueChange(rowValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, rows.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) commit(row.kind === "self" ? selfId : row.tutor.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={baseId}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between rounded-md border-input bg-background px-3 py-2 text-sm font-normal ring-offset-background",
            "hover:bg-background hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search teachers…"
            aria-label="Search teachers"
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined}
            className="h-9"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="max-h-64 overflow-y-scroll p-1 [scrollbar-gutter:stable]"
        >
          {rows.map((row, index) => {
            const rowValue = row.kind === "self" ? selfId : row.tutor.id;
            return (
              <div
                key={rowValue}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={value === rowValue}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(rowValue)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
              >
                {row.kind === "self" ? (
                  <span>Myself</span>
                ) : (
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{row.tutor.name}</span>
                      <EmploymentTypeChip employmentType={row.tutor.employmentType} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.tutor.advisoryLabel ?? "ARAL only"}
                    </span>
                  </span>
                )}
                {value === rowValue ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
              </div>
            );
          })}
          {filteredTutors.length === 0 && query.trim() !== "" ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No tutor found
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
