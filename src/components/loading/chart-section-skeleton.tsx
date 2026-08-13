import { Skeleton } from "@/components/ui/skeleton";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export function ChartCardSkeleton({
  className,
  chartHeight = 192,
}: {
  className?: string;
  chartHeight?: number;
}) {
  return (
    <Surface as="section" className={className} aria-hidden>
      <SurfaceHeader>
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-[18px] w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </SurfaceHeader>
      <SurfaceBody>
        <Skeleton className="w-full" style={{ height: chartHeight }} />
      </SurfaceBody>
    </Surface>
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
