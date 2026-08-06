import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  SkeletonThemeProvider,
  ThemedSkeleton,
} from "@/components/loading";

export default function AdminLoading() {
  return (
    <SkeletonThemeProvider>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
          <div className="space-y-2">
            <ThemedSkeleton width={140} height={14} />
            <ThemedSkeleton width={220} height={28} />
            <ThemedSkeleton width={280} height={14} />
          </div>
          <MetricsGridSkeleton variant="admin" />
          <ChartSectionSkeleton columns={2} />
        </div>
      </div>
    </SkeletonThemeProvider>
  );
}
