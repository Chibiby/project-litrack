import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
  SkeletonThemeProvider,
  ThemedSkeleton,
} from "@/components/loading";

export default function TeacherLoading() {
  return (
    <SkeletonThemeProvider>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
          <div className="space-y-2">
            <ThemedSkeleton width={120} height={14} />
            <ThemedSkeleton width={200} height={28} />
            <ThemedSkeleton width={260} height={14} />
          </div>
          <MetricsGridSkeleton variant="teacher" />
          <ChartSectionSkeleton columns={1} />
          <ListCardSkeleton grid items={3} />
        </div>
      </div>
    </SkeletonThemeProvider>
  );
}
