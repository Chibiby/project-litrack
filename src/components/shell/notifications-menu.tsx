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
import { useReleaseAlert } from "@/components/shell/use-release-alert";

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

/**
 * Derived, non-persisted alerts (pending profiling, due submissions), plus the
 * one persisted row the release channel adds when `releaseAlerts` is on.
 */
export function NotificationsMenu({
  notifications,
  releaseAlerts = false,
}: {
  notifications: ShellNotification[];
  /**
   * Fetch this user's unread release row after paint and list it first. Off by
   * default, so the bell's other callers — and its own tests — pay nothing.
   */
  releaseAlerts?: boolean;
}) {
  const release = useReleaseAlert(releaseAlerts);
  const items = release.alert ? [release.alert, ...notifications] : notifications;
  const count = items.length;

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
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>

        {count === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <PrefetchLink
                  href={n.href}
                  // Opening the release row is reading it. Every other row is
                  // derived from live state and clears when that state does.
                  onClick={
                    n.id === release.alert?.id
                      ? () => release.dismiss(n.id)
                      : undefined
                  }
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
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
