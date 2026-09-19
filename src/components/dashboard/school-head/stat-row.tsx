/**
 * The School Head dashboard's six-card stat row (`docs/school-head-ui-rework.md`
 * section 3.4). Not `StatCardRow` (`src/components/dashboard/teacher/stat-cards.tsx`):
 * that grid is hard-coded to four cards at `xl:grid-cols-4`, and the head has
 * six. Two-up on phones, three-up from `md` (preserving the
 * `md:max-lg:grid-cols-3` intent already in the working tree's uncommitted
 * tablet-grid edits), six-up only at `2xl` where every card has room for its
 * action pill.
 */
export function SchoolHeadStatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
      {children}
    </div>
  );
}
