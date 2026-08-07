import { TableSectionSkeleton } from "@/components/loading";

/** Content-slot only — RoleShell sidebar stays mounted during soft nav. */
export default function TeacherGradeLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-8">
      <TableSectionSkeleton rows={8} columns={6} />
    </div>
  );
}
