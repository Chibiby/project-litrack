"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  ChevronLeft,
  MessageCircle,
  MoreVertical,
  Search,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatThread } from "@/components/chat/chat-thread";
import { cn } from "@/lib/utils";
import type { AdminChatSchool } from "@/lib/chat/queries";

type Filter = "all" | "school" | "admin" | "unread";

type Selected =
  | { kind: "SCHOOL"; schoolId: string; label: string }
  | { kind: "ADMIN_DIRECT"; schoolId: string; memberId: string; channelId: string; label: string };

type Conversation = {
  id: string;
  kind: "SCHOOL" | "ADMIN_DIRECT";
  schoolId: string;
  label: string;
  hint: string;
  preview: string;
  lastMessageAt: Date | null;
  unread: boolean;
};

export function AdminChatBrowser({
  schools,
  initialChannelId,
  onSelectChannel,
}: {
  schools: AdminChatSchool[];
  initialChannelId?: string;
  onSelectChannel?: (channelId: string) => void;
}) {
  const initial = findInitial(schools, initialChannelId);
  const [selected, setSelected] = useState<Selected | null>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageQuery, setMessageQuery] = useState("");

  function selectConversation(conversation: Conversation) {
    const member =
      conversation.kind === "ADMIN_DIRECT"
        ? schools
            .find((school) => school.schoolId === conversation.schoolId)
            ?.directThreads.find((thread) => thread.id === conversation.id)
        : undefined;
    setSelected(
      conversation.kind === "SCHOOL"
        ? { kind: "SCHOOL", schoolId: conversation.schoolId, label: conversation.label }
        : {
            kind: "ADMIN_DIRECT",
            schoolId: conversation.schoolId,
            memberId: member?.memberId ?? "",
            channelId: conversation.id,
            label: conversation.label,
          }
    );
    onSelectChannel?.(conversation.id);
  }

  const conversations = useMemo(() => {
    const rows: Conversation[] = [];
    for (const school of schools) {
      if (school.staffRoom) {
        rows.push({
          id: school.staffRoom.id,
          kind: "SCHOOL",
          schoolId: school.schoolId,
          label: school.schoolName,
          hint: "School chat",
          preview: "Open the staff room to view messages",
          lastMessageAt: school.staffRoom.lastMessageAt,
          unread: school.staffRoom.unread,
        });
      }
      for (const thread of school.directThreads) {
        rows.push({
          id: thread.id,
          kind: "ADMIN_DIRECT",
          schoolId: school.schoolId,
          label: thread.memberName,
          hint: thread.memberRole,
          preview: "Private concern",
          lastMessageAt: thread.lastMessageAt,
          unread: thread.unread,
        });
      }
    }
    return rows
      .filter((row) => {
        if (filter === "school") return row.kind === "SCHOOL";
        if (filter === "admin") return row.kind === "ADMIN_DIRECT";
        if (filter === "unread") return row.unread;
        return true;
      })
      .filter((row) =>
        [row.label, row.hint, row.preview].some((value) =>
          value.toLowerCase().includes(query.toLowerCase())
        )
      )
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }, [schools, filter, query]);

  if (schools.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No school has started a conversation yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
      <div className="grid min-h-[36rem] lg:grid-cols-[20rem_1fr]">
        <aside className={cn("border-r bg-card", selected && "max-lg:hidden")}>
          <div className="border-b p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Conversations</h2>
              <button
                type="button"
                className="rounded-lg p-2 text-violet hover:bg-violet-soft"
                aria-label="Start a conversation"
                title="Start a conversation"
              >
                <MessageCircle className="size-4" aria-hidden />
              </button>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations..."
                aria-label="Search conversations"
                className="h-10 pl-9 text-sm"
              />
            </label>
            <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
              {([
                ["all", "All"],
                ["school", "School chat"],
                ["admin", "Admin chat"],
                ["unread", "Unread"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === value
                      ? "bg-violet-soft text-violet-soft-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {label}
                  {value === "unread" && (
                    <span className="ml-1.5">{conversations.filter((item) => item.unread).length || ""}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[30rem] overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No conversations match.</p>
            ) : (
              conversations.map((conversation) => (
                <ConversationButton
                  key={conversation.id}
                  conversation={conversation}
                  active={
                    selected?.kind === conversation.kind &&
                    (conversation.kind === "SCHOOL"
                      ? selected.schoolId === conversation.schoolId
                      : selected.kind === "ADMIN_DIRECT" && selected.channelId === conversation.id)
                  }
                  onClick={() => selectConversation(conversation)}
                />
              ))
            )}
          </div>
        </aside>

        <section className={cn("flex min-h-[36rem] min-w-0 flex-col bg-background", !selected && "max-lg:hidden")}>
          {selected ? (
            <>
              <header className="relative flex items-center gap-3 border-b px-5 py-4">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent lg:hidden"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <span className="flex size-10 items-center justify-center rounded-full bg-violet-soft text-violet-soft-foreground">
                  {selected.kind === "SCHOOL" ? <Users className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{selected.label}</h2>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                    Online
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMessageSearchOpen((open) => !open)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                  aria-label="Search messages"
                  aria-pressed={messageSearchOpen}
                >
                  <Search className="size-4" aria-hidden />
                </button>
                <Button type="button" variant="ghost" size="icon" className="rounded-lg text-muted-foreground hover:bg-accent" aria-label="More conversation actions">
                  <MoreVertical className="size-4" aria-hidden />
                </Button>
                {messageSearchOpen && (
                  <Input
                    value={messageQuery}
                    onChange={(event) => setMessageQuery(event.target.value)}
                    placeholder="Search messages"
                    aria-label="Search messages"
                    className="absolute right-14 top-16 z-10 w-56 bg-background shadow-md"
                  />
                )}
              </header>
              <ChatThread
                key={selected.kind === "SCHOOL" ? `s:${selected.schoolId}` : `d:${selected.channelId}`}
                kind={selected.kind}
                schoolId={selected.schoolId}
                memberId={selected.kind === "ADMIN_DIRECT" ? selected.memberId : undefined}
                messageQuery={messageQuery}
                emptyHint={
                  selected.kind === "SCHOOL"
                    ? "Nothing has been said in this staff room yet."
                    : "This member has not asked anything yet."
                }
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-violet-soft text-violet">
                <MessageCircle className="size-6" aria-hidden />
              </span>
              <p className="font-medium">Select a conversation</p>
              <p className="max-w-xs text-sm text-muted-foreground">Choose a school chat or private concern to start helping.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationButton({
  conversation,
  active,
  onClick,
}: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        active ? "bg-violet-soft" : "hover:bg-accent"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {conversation.kind === "SCHOOL" ? <Users className="size-4" aria-hidden /> : conversation.label.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{conversation.label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {conversation.lastMessageAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(conversation.lastMessageAt) : ""}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{conversation.preview}</span>
      </span>
      {conversation.unread && <Badge className="size-5 justify-center rounded-full bg-red-500 p-0 text-[10px] text-white">1</Badge>}
    </button>
  );
}

function findInitial(schools: AdminChatSchool[], channelId?: string): Selected | null {
  if (!channelId) return null;
  for (const school of schools) {
    if (school.staffRoom?.id === channelId) {
      return { kind: "SCHOOL", schoolId: school.schoolId, label: school.schoolName };
    }
    const thread = school.directThreads.find((item) => item.id === channelId);
    if (thread) {
      return {
        kind: "ADMIN_DIRECT",
        schoolId: school.schoolId,
        memberId: thread.memberId,
        channelId: thread.id,
        label: thread.memberName,
      };
    }
  }
  return null;
}
