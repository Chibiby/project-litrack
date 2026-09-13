"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, Mail, MessageCircle } from "lucide-react";
import { AdminEmailComposer } from "@/components/admin/admin-email-composer";
import type { AdminEmailRecipientOption } from "@/lib/admin-email/queries";
import { AdminChatBrowser } from "@/components/chat/admin-chat-browser";
import { SupportInbox } from "@/components/support/support-inbox";
import { Button } from "@/components/ui/button";
import type { AdminChatSchool } from "@/lib/chat/queries";
import type { ChatChannelView } from "@/lib/actions/chat";
import type { TicketRow } from "@/lib/support/queries";
import { cn } from "@/lib/utils";

export function AdminSupportHub({
  schools,
  tickets,
  initialTab = "chat",
  initialChannelId,
  emailRecipients = [],
  emailConfigured = false,
  initialChannel,
}: {
  schools: AdminChatSchool[];
  tickets: TicketRow[];
  initialTab?: "chat" | "tickets" | "email";
  initialChannelId?: string;
  emailRecipients?: AdminEmailRecipientOption[];
  emailConfigured?: boolean;
  initialChannel?: ChatChannelView | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"chat" | "tickets" | "email">(initialTab);
  const [channelId, setChannelId] = useState(initialChannelId);

  // Presence is a live status, not a page-load fact. Refresh the server query
  // while this workspace is actually visible so a teacher can move online or
  // offline without the admin manually reloading the page.
  useEffect(() => {
    if (tab !== "chat") return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, tab]);

  function selectTab(next: "chat" | "tickets" | "email") {
    setTab(next);
    const params = new URLSearchParams({ tab: next });
    if (next === "chat" && channelId) params.set("channel", channelId);
    router.replace(`/admin/support?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card px-2 shadow-sm">
        <div className="flex gap-1" role="tablist" aria-label="Support sections">
          <Button
            type="button"
            role="tab"
            variant="ghost"
            aria-selected={tab === "chat"}
            aria-controls="admin-support-chat"
            onClick={() => selectTab("chat")}
            className={cn(
              "h-11 rounded-none border-b-2 px-4 text-sm",
              tab === "chat"
                ? "border-violet text-violet hover:bg-violet-soft/60 hover:text-violet"
                : "border-transparent text-muted-foreground"
            )}
          >
            <MessageCircle className="size-4" aria-hidden />
            Chat
          </Button>
          <Button type="button" role="tab" variant="ghost" aria-selected={tab === "email"} aria-controls="admin-support-email" onClick={() => selectTab("email")} className={cn("h-11 rounded-none border-b-2 px-4 text-sm", tab === "email" ? "border-violet text-violet hover:bg-violet-soft/60 hover:text-violet" : "border-transparent text-muted-foreground")}>
            <Mail className="size-4" aria-hidden />Email
          </Button>
          <Button
            type="button"
            role="tab"
            variant="ghost"
            aria-selected={tab === "tickets"}
            aria-controls="admin-support-tickets"
            onClick={() => selectTab("tickets")}
            className={cn(
              "h-11 rounded-none border-b-2 px-4 text-sm",
              tab === "tickets"
                ? "border-violet text-violet hover:bg-violet-soft/60 hover:text-violet"
                : "border-transparent text-muted-foreground"
            )}
          >
            <FileText className="size-4" aria-hidden />
            Support Tickets
          </Button>
        </div>
      </div>

      {tab === "chat" ? (
        <div id="admin-support-chat" role="tabpanel">
          <AdminChatBrowser
            schools={schools}
            initialChannelId={channelId}
            initialChannel={initialChannel}
            onSelectChannel={(channelId) => {
              setChannelId(channelId);
              const params = new URLSearchParams({ tab: "chat", channel: channelId });
              router.replace(`/admin/support?${params.toString()}`, { scroll: false });
            }}
          />
        </div>
      ) : tab === "tickets" ? (
        <div id="admin-support-tickets" role="tabpanel" className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
          <SupportInbox tickets={tickets} />
        </div>
      ) : <div id="admin-support-email" role="tabpanel"><AdminEmailComposer recipients={emailRecipients} configured={emailConfigured} /></div>}
    </div>
  );
}
