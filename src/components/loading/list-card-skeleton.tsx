"use client";

import { ThemedSkeleton, SkeletonThemeProvider } from "./themed-skeleton";
import { cn } from "@/lib/utils";

export function ListCardSkeleton({
  items = 5,
  className,
  grid = false,
}: {
  items?: number;
  className?: string;
  /** Card grid layout (e.g. teacher grade cards). */
  grid?: boolean;
}) {
  return (
    <SkeletonThemeProvider>
      {grid ? (
        <div
          className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}
          aria-hidden
        >
          {Array.from({ length: items }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/80 bg-card p-5 shadow-card"
            >
              <div className="mb-3 flex items-center justify-between">
                <ThemedSkeleton width={120} height={22} />
                <ThemedSkeleton width={64} height={22} />
              </div>
              <ThemedSkeleton width={96} height={14} className="mb-3" />
              <div className="flex gap-2">
                <ThemedSkeleton width={72} height={32} />
                <ThemedSkeleton width={100} height={32} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-border/80 bg-card shadow-card",
            className
          )}
          aria-hidden
        >
          <div className="border-b border-border/60 px-5 py-4">
            <ThemedSkeleton width={140} height={18} />
          </div>
          <ul className="space-y-0 px-5 py-2">
            {Array.from({ length: items }).map((_, i) => (
              <li
                key={i}
                className="flex justify-between gap-2 border-b border-border/60 py-3 last:border-0"
              >
                <ThemedSkeleton width="60%" height={16} />
                <ThemedSkeleton width={72} height={12} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SkeletonThemeProvider>
  );
}

/** Two side-by-side list cards (school-head recent notices / activity). */
export function DualListCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mb-6 grid gap-4 lg:grid-cols-2", className)}>
      <ListCardSkeleton items={5} />
      <ListCardSkeleton items={5} />
    </div>
  );
}
