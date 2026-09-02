"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  GraduationCap,
  LayoutGrid,
  School,
  Search,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { globalSearch } from "@/lib/actions/global-search";
import {
  GLOBAL_SEARCH_MIN_CHARS,
  type GlobalSearchHit,
} from "@/lib/search/global";

/**
 * Header search.
 *
 * It used to submit to the role's learner list via `?q=` and nothing else, with
 * a `⌘K` badge pinned to the right — which read as a macOS command palette on a
 * machine that has no ⌘ key, and promised a palette the box did not have.
 *
 * Now it searches everything the signed-in role is allowed to see: learners, and
 * for staff also teachers, sections and (Super Admin) schools, plus the pages in
 * the app itself. What each role may match is decided on the server, in
 * `globalSearch` — this component renders whatever comes back and never widens
 * it. Pages are matched here because they are static and role-filtered by the
 * caller, so a keystroke shows them with no round trip.
 *
 * Enter with nothing highlighted still falls through to the old behaviour: the
 * role's list page with `?q=`, which those pages already parse.
 */

const KIND_ICON = {
  learner: BookOpen,
  teacher: Users,
  section: GraduationCap,
  school: School,
  page: LayoutGrid,
} as const;

const KIND_LABEL = {
  learner: "Learners",
  teacher: "Teachers",
  section: "Sections",
  school: "Schools",
  page: "Pages",
} as const;

type Kind = keyof typeof KIND_ICON;

type Row = {
  id: string;
  kind: Kind;
  title: string;
  subtitle: string | null;
  href: string;
};

export type HeaderSearchPage = { label: string; href: string };

/**
 * Module-level, not a `[]` default in the signature. A default parameter builds a
 * NEW array on every render, and `pages` is a dependency of the search effect —
 * so the effect would re-run, `setRows` would re-render, and the next render's
 * fresh `[]` would run it again, forever. One stable reference ends that.
 * `AppHeader` passes a `useMemo`'d array for the same reason.
 */
const NO_PAGES: HeaderSearchPage[] = [];

export function HeaderSearch({
  searchHref,
  placeholder = "Search learners, teachers, pages…",
  pages = NO_PAGES,
  className,
}: {
  searchHref: string;
  placeholder?: string;
  /** Nav destinations this role can reach, matched client-side. */
  pages?: HeaderSearchPage[];
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < GLOBAL_SEARCH_MIN_CHARS) {
      setRows([]);
      return;
    }

    const pageHits: Row[] = pages
      .filter((p) => p.label.toLowerCase().includes(trimmed.toLowerCase()))
      .map((p) => ({
        id: p.href,
        kind: "page" as const,
        title: p.label,
        subtitle: null,
        href: p.href,
      }));

    // Pages resolve instantly; records arrive when the server answers. Showing
    // the pages first means a keystroke is never met with an empty box.
    setRows(pageHits);

    // `cancelled` rather than an AbortController: a server action cannot be
    // aborted, so the guard is against applying a STALE result, which is the
    // actual bug — a slow "Ma" landing after a fast "Maria".
    let cancelled = false;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await globalSearch({ q: trimmed });
        if (cancelled) return;
        if (!res.ok) return;
        setRows([...pageHits, ...(res.data as GlobalSearchHit[] as Row[])]);
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, pages]);

  useEffect(() => {
    setActive(0);
  }, [rows.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A window "keydown" listener receives anything dispatched under that
      // type, including a bare `new Event("keydown")` from a browser extension
      // or dev tooling, which carries no `key` at all. TypeScript types `key`
      // as string, so nothing but this guard stops that from throwing.
      if (typeof event.key !== "string") return;
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(row: Row) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(row.href);
  }

  function submitFallback() {
    if (!trimmed) return;
    setOpen(false);
    router.push(`${searchHref}?q=${encodeURIComponent(trimmed)}`);
  }

  const showList = open && trimmed.length >= GLOBAL_SEARCH_MIN_CHARS;

  // Group headings are rendered by walking the flat list and emitting a heading
  // whenever the kind changes. The server returns rows already grouped, so this
  // needs no sort of its own — and if that ever stops being true, the headings
  // repeat rather than silently mixing two kinds under one label.
  let lastKind: Kind | null = null;

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const row = rows[active];
        if (showList && row) go(row);
        else submitFallback();
      }}
      className={cn("relative", className)}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        aria-label={placeholder}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // Deferred so a click on a result lands before the list unmounts.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
            return;
          }
          if (!showList || rows.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => (i + 1) % rows.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => (i - 1 + rows.length) % rows.length);
          }
        }}
        className="h-9 rounded-lg border-transparent bg-muted pl-9 pr-3 text-sm focus-visible:border-input focus-visible:bg-background"
      />

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches for “{trimmed}”.
              <br />
              <span className="text-xs">
                Press Enter to search the full list.
              </span>
            </p>
          ) : (
            rows.map((row, i) => {
              const Icon = KIND_ICON[row.kind];
              const heading = row.kind !== lastKind ? KIND_LABEL[row.kind] : null;
              lastKind = row.kind;
              return (
                <div key={`${row.kind}-${row.id}`}>
                  {heading && (
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {heading}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(row)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                      i === active && "bg-accent"
                    )}
                  >
                    <Icon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.title}
                      </span>
                      {row.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </form>
  );
}
