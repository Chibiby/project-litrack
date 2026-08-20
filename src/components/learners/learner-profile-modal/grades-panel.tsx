import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/dashboard";

/**
 * Grades tab.
 *
 * The comp draws this tab and LITRACK has no grades model — no marks, no
 * subjects, no quarters, nothing in `prisma/schema.prisma` to read. The tab is
 * kept so the strip matches the comp, and it says plainly that the data lives
 * elsewhere rather than showing an empty table that implies grades are coming.
 */
export function GradesPanel() {
  return (
    <EmptyState
      icon={GraduationCap}
      title="Grades aren't tracked in LITRACK"
      description="LITRACK records reading levels and ARAL progress. Academic grades stay in the school's LIS/e-Class record."
    />
  );
}
