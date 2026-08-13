import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/** Server-safe shimmer skeleton — CSS-only, no client JS. */
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
  if (grid) {
    return (
      <div
        className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}
        aria-hidden
      >
        {Array.from({ length: items }).map((_, i) => (
          <Surface key={i} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-[22px] w-[120px]" />
              <Skeleton className="h-[22px] w-16" />
            </div>
            <Skeleton className="mb-3 h-3.5 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-[72px]" />
              <Skeleton className="h-8 w-[100px]" />
            </div>
          </Surface>
        ))}
      </div>
    );
  }

  return (
    <Surface className={className} aria-hidden>
      <div className="border-b border-border/60 px-5 py-4">
        <Skeleton className="h-[18px] w-[140px]" />
      </div>
      <ul className="space-y-0 px-5 py-2">
        {Array.from({ length: items }).map((_, i) => (
          <li
            key={i}
            className="flex justify-between gap-2 border-b border-border/60 py-3 last:border-0"
          >
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-[72px]" />
          </li>
        ))}
      </ul>
    </Surface>
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
