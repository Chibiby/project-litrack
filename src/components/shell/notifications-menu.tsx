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

/** Derived, non-persisted alerts (pending profiling, due submissions). */
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
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>

        {count === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((n) => (
              <li key={n.id}>
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
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
