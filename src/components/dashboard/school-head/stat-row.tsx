import { STAT_GRID } from "@/components/dashboard/teacher/stat-cards";

/**
 * The School Head and admin dashboards' stat row (`docs/school-head-ui-rework.md`
 * section 3.4). Uses the shared `STAT_GRID`: two-up on phones, then as many
 * cards per row as fit at 17rem or wider, so each card keeps the full
 * dashboard layout whether the attention rail sits beside the row or not.
 */
export function SchoolHeadStatRow({ children }: { children: React.ReactNode }) {
  return <div className={STAT_GRID}>{children}</div>;
}
