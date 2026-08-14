import { TableSectionSkeleton } from "@/components/loading";

/** Content-slot only — RoleShell sidebar stays mounted during soft nav. */
export default function TeacherLearnersLoading() {
  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <TableSectionSkeleton rows={8} columns={6} />
    </div>
  );
}
