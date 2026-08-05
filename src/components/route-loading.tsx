import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="min-h-screen bg-background lg:pl-64" role="status" aria-label={label}>
      <div className="sticky top-0 z-30 border-b border-border bg-card/80 px-4 py-4 lg:px-8">
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="space-y-6 p-4 lg:p-8">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
