import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { TEACHER_TABS } from "@/components/school-head/workspace-tabs";

/**
 * Content-slot skeleton for the whole teachers workspace.
 *
 * There is no `layout.tsx` under `teachers/`, so this boundary also covers the
 * pending, inactive and declined segments — which is what we want, because all
 * four panels are one table under the same tab bar. Only the row count differs
 * between them, and guessing it per tab would be a lie either way.
 */
export default function SchoolHeadTeachersLoading() {
  return (
    <SchoolHeadPageSkeleton tabs={Object.keys(TEACHER_TABS).length}>
      <TableSectionSkeleton rows={6} columns={7} />
    </SchoolHeadPageSkeleton>
  );
}
