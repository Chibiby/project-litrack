"use client";

import { useEffect, useState } from "react";
import { BookOpenCheck, ChevronRight, ClipboardCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";
import type { AttentionItem } from "@/lib/dashboard/school-head-overview";
import { cn } from "@/lib/utils";

const POLL_MS = 300;
const WAIT_CAP_MS = 15_000;

/** One key per school per school-local day: the pop-up shows at most once a day. */
export const attentionSeenKey = (schoolId: string, todayKey: string) =>
  `litrack:attention-seen:${schoolId}:${todayKey}`;

function seenToday(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Private mode or blocked storage: the pop-up may show again, nothing breaks.
  }
}

/** Another dialog (the update notes, a confirmation) is up: wait for it to close. */
function anotherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export type AttentionFigure = {
  id: string;
  label: string;
  value: string;
  href: string;
  icon: "teachers" | "aral" | "discrepancies";
};

const ICONS = { teachers: ClipboardCheck, aral: BookOpenCheck, discrepancies: TriangleAlert };

/**
 * "Needs your attention" — the School Head's daily summary pop-up, shaped like
 * the "LITRACK System updated" notes. Opens on the dashboard once per school-local
 * day, after the sign-in cover and after any other dialog has closed.
 * Every row links to the page that lists who or what it counts.
 */
export function SchoolAttentionModal({
  schoolId,
  todayKey,
  figures,
  items,
}: {
  schoolId: string;
  todayKey: string;
  figures: AttentionFigure[];
  items: AttentionItem[];
}) {
  const [open, setOpen] = useState(false);
  const key = attentionSeenKey(schoolId, todayKey);
  const hasSomething = items.length > 0;

  useEffect(() => {
    if (!hasSomething || seenToday(key)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + WAIT_CAP_MS;
    const tryOpen = () => {
      if (cancelled) return;
      const blocked = isPostLoginLoadingCover() || anotherDialogOpen();
      if (blocked) {
        // Past the cap, give up for this visit rather than interrupt something.
        if (Date.now() < deadline) timer = setTimeout(tryOpen, POLL_MS);
        return;
      }
      setOpen(true);
    };
    // A beat after mount, so the update notes (mounted in the shell) open first.
    timer = setTimeout(tryOpen, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasSomething, key]);

  if (!hasSomething) return null;

  const close = () => {
    markSeen(key);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Needs your attention</DialogTitle>
          <DialogDescription>
            What your school&apos;s teachers and records still need today. Open a row to see who.
          </DialogDescription>
        </DialogHeader>

        {figures.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {figures.map((f) => {
              const Icon = ICONS[f.icon];
              return (
                <li key={f.id}>
                  <PrefetchLink
                    href={f.href}
                    onClick={close}
                    className="flex h-full flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon aria-hidden className="size-3.5" />
                      {f.label}
                    </span>
                    <span className="text-xl font-semibold tabular-nums text-foreground">{f.value}</span>
                  </PrefetchLink>
                </li>
              );
            })}
          </ul>
        ) : null}

        <ul className="divide-y divide-border/60 rounded-lg border">
          {items.map((item) => (
            <li key={item.id}>
              <PrefetchLink
                href={item.href}
                onClick={close}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                {item.badge ? (
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                      item.tone === "amber"
                        ? "bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-200"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </PrefetchLink>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type="button" onClick={close}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
