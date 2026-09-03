import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
import { SupportInbox } from "@/components/support/support-inbox";
import { listInboxTickets } from "@/lib/support/queries";

export const dynamic = "force-dynamic";

/**
 * The division admin's support inbox.
 *
 * Cross-tenant by design: this is the one screen in the app that reads rows from
 * every school at once, which is what the Super Admin role is for. The role gate
 * is `requireUser("SUPER_ADMIN")` here and `requireUser(["SUPER_ADMIN"])` again
 * inside every action the page can call, so nothing depends on this page being
 * the only way in.
 */
export default async function AdminSupportPage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AppShell
      title="Support requests"
      subtitle="Access requests and questions from every school"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <SupportQueue />
      </Suspense>
    </AppShell>
  );
}

/** Its own boundary so the queue's query does not hold up the shell. */
async function SupportQueue() {
  const tickets = await listInboxTickets();
  return <SupportInbox tickets={tickets} />;
}
