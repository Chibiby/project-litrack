"use client";

import { useState } from "react";
import { MessageSquare, School, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ChatThread } from "@/components/chat/chat-thread";
import { cn } from "@/lib/utils";
import type { AdminChatSchool } from "@/lib/chat/queries";

/**
 * The admin's two-pane chat browser: schools on the left, the thread on the
 * right. On a phone the list becomes the page and picking a thread replaces it,
 * because 360px cannot hold both and a split neither pane can use is worse than
 * one that works.
 */

type Selected =
  | { kind: "SCHOOL"; schoolId: string; label: string }
  | { kind: "ADMIN_DIRECT"; schoolId: string; memberId?: string; channelId: string; label: string };

export function AdminChatBrowser({
  schools,
  initialChannelId,
}: {
  schools: AdminChatSchool[];
  initialChannelId?: string;
}) {
  // A notification links straight to a channel, so the browser opens on it.
  const initial = findInitial(schools, initialChannelId);
  const [selected, setSelected] = useState<Selected | null>(initial);

  if (schools.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No school has started a conversation yet. A staff room appears here the
          first time somebody at that school opens theirs.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card className={cn(selected && "max-lg:hidden")}>
        <CardContent className="space-y-4 p-3">
          {schools.map((school) => (
            <div key={school.schoolId} className="space-y-1">
              <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <School className="size-3.5" aria-hidden />
                {school.schoolName}
              </p>

              <ThreadButton
                label="Staff room"
                icon={<MessageSquare className="size-4" aria-hidden />}
                unread={school.staffRoom?.unread ?? false}
                active={selected?.kind === "SCHOOL" && selected.schoolId === school.schoolId}
                onClick={() =>
                  setSelected({
                    kind: "SCHOOL",
                    schoolId: school.schoolId,
                    label: `${school.schoolName} · Staff room`,
                  })
                }
              />

              {school.directThreads.map((thread) => (
                <ThreadButton
                  key={thread.id}
                  label={thread.memberName}
                  hint={thread.memberRole}
                  icon={<Lock className="size-4" aria-hidden />}
                  unread={thread.unread}
                  active={
                    selected?.kind === "ADMIN_DIRECT" && selected.channelId === thread.id
                  }
                  onClick={() =>
                    setSelected({
                      kind: "ADMIN_DIRECT",
                      schoolId: school.schoolId,
                      channelId: thread.id,
                      label: `${thread.memberName} · private`,
                    })
                  }
                />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={cn("flex min-h-[32rem] flex-col", !selected && "max-lg:hidden")}>
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-muted-foreground hover:text-foreground lg:hidden"
              >
                ← Back
              </button>
              <p className="truncate text-sm font-semibold">{selected.label}</p>
            </div>
            <ChatThread
              // Remount on channel change: the thread holds its transcript in
              // state, and a prop change without a remount would show one
              // school's messages under another school's heading.
              key={selected.kind === "SCHOOL" ? `s:${selected.schoolId}` : `d:${selected.channelId}`}
              kind={selected.kind}
              schoolId={selected.schoolId}
              memberId={selected.kind === "ADMIN_DIRECT" ? selected.memberId : undefined}
              emptyHint={
                selected.kind === "SCHOOL"
                  ? "Nothing has been said in this staff room yet."
                  : "This member has not asked anything yet."
              }
            />
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Pick a conversation to read it.
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function findInitial(schools: AdminChatSchool[], channelId?: string): Selected | null {
  if (!channelId) return null;
  for (const school of schools) {
    if (school.staffRoom?.id === channelId) {
      return {
        kind: "SCHOOL",
        schoolId: school.schoolId,
        label: `${school.schoolName} · Staff room`,
      };
    }
    const thread = school.directThreads.find((t) => t.id === channelId);
    if (thread) {
      return {
        kind: "ADMIN_DIRECT",
        schoolId: school.schoolId,
        channelId: thread.id,
        label: `${thread.memberName} · private`,
      };
    }
  }
  return null;
}

function ThreadButton({
  label,
  hint,
  icon,
  unread,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  icon: React.ReactNode;
  unread: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm transition-colors",
        active ? "bg-violet-soft text-violet-soft-foreground" : "hover:bg-accent"
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {unread && <span className="size-2 shrink-0 rounded-full bg-violet" aria-label="Unread" />}
    </button>
  );
}
