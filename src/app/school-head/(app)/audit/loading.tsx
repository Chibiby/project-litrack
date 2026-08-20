import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/**
 * Content-slot skeleton for the audit table. Column count matches the four
 * rendered columns; sidebar stays mounted in RoleShell.
 */
export default function Loading() {
  return (
    <SchoolHeadPageSkeleton>
      <TableSectionSkeleton rows={10} columns={4} />
    </SchoolHeadPageSkeleton>
  );
}
