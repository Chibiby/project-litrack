import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Busy state matching `SchoolHeadPage`'s chrome.
 *
 * Every tabbed School Head route shows the same header-plus-tab-bar frame, so
 * the skeleton reproduces it once. Without this, a soft nav between tabs
 * replaced the whole frame with a bare card skeleton and the header appeared to
 * jump — the tabs are identical across the panels, so redrawing them is a lie.
 *
 * `tabs` is a count, not labels: at skeleton time the widths are all that show.
 */
export function SchoolHeadPageSkeleton({
  tabs = 0,
  children,
}: {
  tabs?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className="w-full p-4 lg:p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading page</span>

      <div className="mb-6" aria-hidden>
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>

      {tabs > 0 ? (
        <div
          className="mb-6 flex items-center gap-1 border-b border-border/70 pb-2"
          aria-hidden
        >
          {Array.from({ length: tabs }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}
