import { Suspense } from "react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope } from "@/lib/auth/admin-scope";
import { listInboxTickets } from "@/lib/support/queries";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
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
    >
      {hasNoDistricts(scope) ? (
        <NoDistrictsState />
      ) : (
        <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
          <DistrictTicketQueue scope={scope} />
        </Suspense>
      )}
    </AppShell>
  );
}

async function DistrictTicketQueue({ scope }: { scope: AdminScope }) {
  const tickets = await listInboxTickets(scope);
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <SupportInbox tickets={tickets} districtScoped />
    </div>
  );
}
