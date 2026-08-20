import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

export default function Loading() {
  return (
    <SchoolHeadPageSkeleton>
      <TableSectionSkeleton rows={6} columns={3} />
    </SchoolHeadPageSkeleton>
  );
}
