import { DualListCardSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for school years. Sidebar stays mounted in RoleShell;
 * matches the create-form + list layout.
 */
export default function SchoolHeadSchoolYearsLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <DualListCardSkeleton />
    </div>
  );
}
