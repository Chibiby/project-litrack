import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/** Server-safe shimmer skeleton — CSS-only, no client JS. */
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
    <Surface className={className} aria-hidden>
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <Skeleton className="h-5 w-[180px]" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-[100px]" />
            <Skeleton className="h-8 w-[100px]" />
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto p-2">
        <div className="mb-2 flex gap-3 border-b border-border/60 px-3 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 min-w-[80px] flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, row) => (
          <div
            key={row}
            className="flex gap-3 border-b border-border/40 px-3 py-3 last:border-0"
          >
            {Array.from({ length: columns }).map((_, col) => (
              <Skeleton key={col} className="h-4 min-w-[80px] flex-1" />
            ))}
          </div>
        ))}
      </div>
    </Surface>
  );
}
