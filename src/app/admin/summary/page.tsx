import { redirect } from "next/navigation";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";

export const dynamic = "force-dynamic";

export default async function AdminSummaryIndexPage() {
  const { user } = await requireAdminScope();
  if (user.role !== "SUPER_ADMIN") redirect(DISTRICT_ROUTES.home);

  return (
    <AppShell
      title="Division Summary"
      subtitle="Every school in the division, overall, by district and by school"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <SummaryFacetIndex basePath="/admin/summary" />
    </AppShell>
  );
}
