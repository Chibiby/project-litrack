import { redirect } from "next/navigation";

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
  const { channel } = await searchParams;
  const query = new URLSearchParams({ tab: "chat" });
  if (channel) query.set("channel", channel);
  redirect(`/admin/support?${query.toString()}`);
}
