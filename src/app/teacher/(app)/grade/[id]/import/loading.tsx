import { TableSectionSkeleton } from "@/components/loading";

/** Content-slot only — RoleShell sidebar stays mounted during soft nav. */
export default function TeacherGradeImportLoading() {
  return (
    <div className="w-full space-y-4 p-4 lg:p-8">
      <TableSectionSkeleton rows={6} columns={3} />
    </div>
  );
}
