"use client";

import { ThemedSkeleton, SkeletonThemeProvider } from "./themed-skeleton";
import { cn } from "@/lib/utils";

export type MetricsGridVariant = "admin" | "school-head" | "teacher" | "teacher-secondary";

const gridClass: Record<MetricsGridVariant, string> = {
  admin: "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  "school-head": "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  teacher: "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
  "teacher-secondary": "mb-6 grid gap-4 sm:grid-cols-2",
};

const counts: Record<MetricsGridVariant, number> = {
  admin: 6,
  "school-head": 6,
  teacher: 4,
  "teacher-secondary": 2,
};

export function MetricsGridSkeleton({
  variant = "admin",
  className,
  count,
}: {
  variant?: MetricsGridVariant;
  className?: string;
  count?: number;
}) {
  const n = count ?? counts[variant];
  return (
    <SkeletonThemeProvider>
      <div className={cn(gridClass[variant], className)} aria-hidden>
        {Array.from({ length: n }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/80 bg-card p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <ThemedSkeleton width={96} height={16} />
              <ThemedSkeleton circle width={32} height={32} />
            </div>
            <ThemedSkeleton className="mt-3" width={80} height={32} />
            <ThemedSkeleton className="mt-1.5" width={112} height={12} />
          </div>
        ))}
      </div>
    </SkeletonThemeProvider>
  );
}
