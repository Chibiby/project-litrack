"use client";

import { ThemedSkeleton, SkeletonThemeProvider } from "./themed-skeleton";
import { cn } from "@/lib/utils";

export function TableSectionSkeleton({
  rows = 8,
  columns = 5,
  showToolbar = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showToolbar?: boolean;
  className?: string;
}) {
  return (
    <SkeletonThemeProvider>
      <div
        className={cn(
          "rounded-xl border border-border/80 bg-card shadow-card",
          className
        )}
        aria-hidden
      >
        {showToolbar ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <ThemedSkeleton width={180} height={20} />
            <div className="flex gap-2">
              <ThemedSkeleton width={100} height={32} />
              <ThemedSkeleton width={100} height={32} />
            </div>
          </div>
        ) : null}
        <div className="overflow-x-auto p-2">
          <div className="mb-2 flex gap-3 border-b border-border/60 px-3 py-3">
            {Array.from({ length: columns }).map((_, i) => (
              <ThemedSkeleton key={i} height={14} className="min-w-[80px] flex-1" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className="flex gap-3 border-b border-border/40 px-3 py-3 last:border-0"
            >
              {Array.from({ length: columns }).map((_, col) => (
                <ThemedSkeleton
                  key={col}
                  height={16}
                  className="min-w-[80px] flex-1"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonThemeProvider>
  );
}
