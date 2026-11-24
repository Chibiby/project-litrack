"use client";

import { cn } from "@/lib/utils";

/** Three bouncing dots. Used for "Ana is typing…" and the assistant's thinking state. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  );
}

/** The live typing line above the composer. Always mounted so screen readers hear changes. */
export function TypingIndicator({ label }: { label: string | null }) {
  return (
    <div aria-live="polite" className="min-h-5 px-4 text-xs text-muted-foreground">
      {label && (
        <span className="inline-flex items-center gap-2">
          <TypingDots />
          {label}
        </span>
      )}
    </div>
  );
}
