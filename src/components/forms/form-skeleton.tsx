import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for a `FormSections` form while its chunk — or the context it
 * needs — is still loading.
 *
 * Holds the real geometry, a completion bar over collapsed section headers, so a
 * dialog sized around it does not resize when the form lands. Kept in its own
 * module rather than in form-sections.tsx so a host can show the placeholder
 * without eagerly importing the form it stands in for.
 */
export function FormSectionsSkeleton({
  sectionCount = 4,
  showBar = true,
}: {
  sectionCount?: number;
  /** Match the host — the completion bar is add-mode only. */
  showBar?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-4 px-5 py-5 sm:px-6" aria-hidden>
      {showBar ? <Skeleton className="h-1.5 w-full rounded-full" /> : null}
      <div className="divide-y divide-border rounded-xl border border-border">
        {Array.from({ length: sectionCount }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    </div>
  );
}
