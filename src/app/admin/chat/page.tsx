import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
import { AdminChatBrowser } from "@/components/chat/admin-chat-browser";
import { listAdminChatSchools } from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

/**
 * Every school's chat, from the division.
 *
 * Cross-tenant by design, like the support inbox next door: this is what the
 * Super Admin role exists for. The role gate is here and again inside every
 * action this page can call, so nothing depends on this page being the only way
 * in — and each channel an admin actually opens is audited.
 */
export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const user = await requireUser("SUPER_ADMIN");
  const { channel } = await searchParams;

  return (
    <AppShell
      title="School chat"
      subtitle="Staff rooms and private questions from every school"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <ChatBrowser initialChannelId={channel} />
      </Suspense>
    </AppShell>
  );
}

async function ChatBrowser({ initialChannelId }: { initialChannelId?: string }) {
  const user = await requireUser("SUPER_ADMIN");
  const schools = await listAdminChatSchools(user.id);

  return <AdminChatBrowser schools={schools} initialChannelId={initialChannelId} />;
}
