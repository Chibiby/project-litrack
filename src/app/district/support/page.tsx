import { Suspense } from "react";
import { LifeBuoy } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { listInboxTickets } from "@/lib/support/queries";
import { AppShell } from "@/components/app-shell";
import { Surface } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { SupportInbox } from "@/components/support/support-inbox";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { describeScope, hasNoDistricts } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

/**
 * The support tickets from the admin's own schools. Only the ticket queue:
 * chat and email stay with the division office.
 */
export default async function DistrictSupportPage() {
  const { user, scope } = await requireAdminScope();

  return (
    <AppShell
      title="Support"
      subtitle={`Help requests · ${describeScope(scope)}`}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="Help desk"
          eyebrowIcon={LifeBuoy}
          title="Support"
          subtitle="Help requests from teachers and School Heads in your schools."
          meta={describeScope(scope)}
        />
      </div>
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} className="rounded-2xl" />}>
          <DistrictTicketQueue scope={scope} />
        </Suspense>
      )}
    </AppShell>
  );
}

async function DistrictTicketQueue({ scope }: { scope: AdminScope }) {
  const tickets = await listInboxTickets(scope);
  return (
    <Surface as="section" aria-label="Support requests" className="min-w-0 rounded-2xl p-3 sm:p-4 lg:p-5">
      <SupportInbox tickets={tickets} districtScoped />
    </Surface>
  );
}
