"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

function ChartPlaceholder({ height = 220 }: { height?: number }) {
  return (
    <Skeleton className="w-full rounded-md" style={{ height }} aria-hidden />
  );
}

/** Code-split recharts so dashboard shells do not pay for it up front. */
export const DashboardBarChart = dynamic(
  () =>
    import("@/components/dashboard/simple-charts").then(
      (m) => m.DashboardBarChart
    ),
  { ssr: false, loading: () => <ChartPlaceholder /> }
);

export const DashboardLineChart = dynamic(
  () =>
    import("@/components/dashboard/simple-charts").then(
      (m) => m.DashboardLineChart
    ),
  { ssr: false, loading: () => <ChartPlaceholder /> }
);
