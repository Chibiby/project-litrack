import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export type MetricsGridVariant =
  | "admin"
  | "school-head"
  | "teacher"
  | "teacher-secondary";

const gridClass: Record<MetricsGridVariant, string> = {
  admin: "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  "school-head":
    "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  teacher: "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
  "teacher-secondary": "mb-6 grid gap-4 sm:grid-cols-2",
};

const counts: Record<MetricsGridVariant, number> = {
  admin: 6,
  "school-head": 6,
  teacher: 4,
  "teacher-secondary": 2,
};

/** Server-safe shimmer skeleton — CSS-only, no client JS. */
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
    <div className={cn(gridClass[variant], className)} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <Surface key={i} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-1.5 h-3 w-28" />
        </Surface>
      ))}
    </div>
  );
}
