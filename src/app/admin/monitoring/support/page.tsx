import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { LifeBuoy } from "lucide-react";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TableSectionSkeleton } from "@/components/loading";
import { listInboxTickets } from "@/lib/support/queries";
import { listAdminChatSchools } from "@/lib/chat/queries";
import { AdminSupportHub } from "@/components/admin/admin-support-hub";
import { listAdminEmailRecipients } from "@/lib/admin-email/queries";
import { isEmailConfigured } from "@/lib/email";
import { readChannel } from "@/lib/actions/chat";

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
export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; channel?: string }>;
}) {
  const user = await requireUser("SUPER_ADMIN");
  const { tab, channel } = await searchParams;

  return (
    <AdminPage
      title="Support"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Help desk"
          eyebrowIcon={LifeBuoy}
          title="Support"
          subtitle="Chat with schools, answer their tickets, and send private emails."
        />
      }
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <SupportQueue
          adminId={user.id}
          initialTab={tab === "tickets" || tab === "email" ? tab : "chat"}
          initialChannelId={channel}
        />
      </Suspense>
    </AdminPage>
  );
}

/** Its own boundary so the queue's query does not hold up the shell. */
async function SupportQueue({
  adminId,
  initialTab,
  initialChannelId,
}: {
  adminId: string;
  initialTab: "chat" | "tickets" | "email";
  initialChannelId?: string;
}) {
  const [tickets, schools, emailRecipients] = await Promise.all([
    listInboxTickets({ kind: "division" }),
    listAdminChatSchools(adminId),
    listAdminEmailRecipients(),
  ]);
  const knownChannel = initialChannelId && schools.some((school) => school.staffRoom?.id === initialChannelId || school.directThreads.some((thread) => thread.id === initialChannelId));
  const initialRead = knownChannel && initialChannelId ? await readChannel({ channelId: initialChannelId }) : null;
  return (
    <AdminSupportHub
      tickets={tickets}
      schools={schools}
      initialTab={initialTab}
      initialChannelId={initialChannelId}
      emailRecipients={emailRecipients}
      emailConfigured={isEmailConfigured()}
      initialChannel={initialRead?.ok ? initialRead.data ?? null : null}
    />
  );
}
