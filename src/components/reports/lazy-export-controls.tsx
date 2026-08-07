"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

function ExportControlsFallback() {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
      aria-hidden
    >
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-10 w-28" />
      <Skeleton className="h-10 w-28" />
    </div>
  );
}

/** Lazy-load export UI; Excel generation stays in the server action. */
export const ExportControls = dynamic(
  () =>
    import("@/components/reports/export-controls").then((m) => m.ExportControls),
  { ssr: false, loading: () => <ExportControlsFallback /> }
);
