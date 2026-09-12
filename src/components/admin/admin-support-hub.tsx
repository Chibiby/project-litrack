"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, MessageCircle } from "lucide-react";
import { AdminChatBrowser } from "@/components/chat/admin-chat-browser";
import { SupportInbox } from "@/components/support/support-inbox";
import { PageTip } from "@/components/admin/page-tip";
import type { AdminChatSchool } from "@/lib/chat/queries";
import type { TicketRow } from "@/lib/support/queries";
import { cn } from "@/lib/utils";

export function AdminSupportHub({
  schools,
  tickets,
  initialTab = "chat",
  initialChannelId,
}: {
  schools: AdminChatSchool[];
  tickets: TicketRow[];
  initialTab?: "chat" | "tickets";
  initialChannelId?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"chat" | "tickets">(initialTab);
  const [channelId, setChannelId] = useState(initialChannelId);

  function selectTab(next: "chat" | "tickets") {
    setTab(next);
    const params = new URLSearchParams({ tab: next });
    if (next === "chat" && channelId) params.set("channel", channelId);
    router.replace(`/admin/support?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <PageTip title="Support hub tips">
        Use the conversation filters to focus on unread school chats or private concerns.
        Teachers and school heads submit tickets from their own accounts; this view is for
        reviewing and answering them.
      </PageTip>

      <div className="flex items-center justify-between border-b">
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => selectTab("chat")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium",
              tab === "chat" ? "border-violet text-violet" : "border-transparent text-muted-foreground"
            )}
          >
            <MessageCircle className="size-4" aria-hidden />
            Chat
          </button>
          <button
            type="button"
            onClick={() => selectTab("tickets")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium",
              tab === "tickets" ? "border-violet text-violet" : "border-transparent text-muted-foreground"
            )}
          >
            <FileText className="size-4" aria-hidden />
            Support Tickets
          </button>
        </div>
      </div>

      {tab === "chat" ? (
        <AdminChatBrowser
          schools={schools}
          initialChannelId={channelId}
          onSelectChannel={(channelId) => {
            setChannelId(channelId);
            const params = new URLSearchParams({ tab: "chat", channel: channelId });
            router.replace(`/admin/support?${params.toString()}`, { scroll: false });
          }}
        />
      ) : (
        <SupportInbox tickets={tickets} />
      )}
    </div>
  );
}
