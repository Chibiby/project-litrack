"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Header quick search. Submits to the role's learner list via `?q=`, which the
 * list pages already parse — no client-side index and no new endpoint.
 */
export function HeaderSearch({
  searchHref,
  placeholder = "Search learners...",
  className,
}: {
  searchHref: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

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

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (!trimmed) return;
        router.push(`${searchHref}?q=${encodeURIComponent(trimmed)}`);
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
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") inputRef.current?.blur();
        }}
        className="h-9 rounded-lg border-transparent bg-muted pl-9 pr-14 text-sm focus-visible:border-input focus-visible:bg-background"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex"
      >
        ⌘K
      </kbd>
    </form>
  );
}
