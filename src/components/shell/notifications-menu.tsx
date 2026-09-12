"use client";

import { Bell } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RELEASES } from "@/lib/releases";

export interface ShellNotification {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: "violet" | "amber" | "muted";
}

const toneDot: Record<ShellNotification["tone"], string> = {
  violet: "bg-violet",
  amber: "bg-amber-500",
  muted: "bg-muted-foreground/50",
};

/** How many past releases the bell keeps. The full list lives at /releases. */
const RELEASE_HISTORY_LIMIT = 5;

/**
 * The release history, derived from the committed `RELEASES` list — no query,
 * no stored row, the same for every role, Super Admin included. The modal is the
 * read-once announcement; this is where someone finds it again afterwards.
 */
const releaseHistory: ShellNotification[] = RELEASES.slice(
  0,
  RELEASE_HISTORY_LIMIT
).map((r) => ({
  id: `release-${r.version}`,
  title: `LITRACK System updated to v${r.version}`,
  description: `${r.title} · ${r.date}`,
  href: `/releases#v${r.version}`,
  // Amber, the app's secondary accent. Violet is reserved for ARAL.
  tone: "amber",
}));

function NotificationRow({ n }: { n: ShellNotification }) {
  return (
    <li>
      <PrefetchLink
        href={n.href}
        className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted"
      >
        <span
          aria-hidden
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", toneDot[n.tone])}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {n.title}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {n.description}
          </span>
        </span>
      </PrefetchLink>
    </li>
  );
}

/**
 * Derived, non-persisted alerts (pending profiling, due submissions), then the
 * release history. Only the alerts count toward the badge: the history is
 * already-read by the time anyone opens the bell, because the modal announced it.
 */
export function NotificationsMenu({
  notifications,
}: {
  notifications: ShellNotification[];
}) {
  const count = notifications.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={
            count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread"
          }
        >
          <Bell className="h-5 w-5" aria-hidden />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet px-1 text-[10px] font-semibold text-violet-foreground">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="max-h-[28rem] overflow-y-auto">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
          </div>

          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="py-1">
              {notifications.map((n) => (
                <NotificationRow key={n.id} n={n} />
              ))}
            </ul>
          )}

          <div className="border-y border-border/60 px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Updates
            </p>
          </div>
          <ul className="py-1" aria-label="Release history">
            {releaseHistory.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
          <div className="border-t border-border/60 px-4 py-2 text-right">
            <PrefetchLink
              href="/releases"
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              All releases
            </PrefetchLink>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
