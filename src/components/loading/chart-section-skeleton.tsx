"use client";

import { ThemedSkeleton, SkeletonThemeProvider } from "./themed-skeleton";
import { cn } from "@/lib/utils";

export function ChartCardSkeleton({
  className,
  chartHeight = 192,
}: {
  className?: string;
  chartHeight?: number;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/80 bg-card text-card-foreground shadow-card",
        className
      )}
      aria-hidden
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0 space-y-1.5">
          <ThemedSkeleton width={160} height={18} />
          <ThemedSkeleton width={220} height={14} />
        </div>
      </div>
      <div className="p-5">
        <ThemedSkeleton height={chartHeight} className="w-full" />
      </div>
    </section>
  );
}

export function ChartSectionSkeleton({
  columns = 2,
  className,
  chartHeight,
}: {
  columns?: 1 | 2;
  className?: string;
  chartHeight?: number;
}) {
  return (
    <SkeletonThemeProvider>
      <div
        className={cn(
          "mb-6 grid gap-4",
          columns === 2 ? "lg:grid-cols-2" : undefined,
          className
        )}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <ChartCardSkeleton key={i} chartHeight={chartHeight} />
        ))}
      </div>
    </SkeletonThemeProvider>
  );
}
