import { Skeleton } from "@/components/ui/skeleton";
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
          <Skeleton className="h-[18px] w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </div>
      <div className="p-5">
        <Skeleton className="w-full" style={{ height: chartHeight }} />
      </div>
    </section>
  );
}

/** Server-safe shimmer skeleton — CSS-only, no client JS. */
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
  );
}
