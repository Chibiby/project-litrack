import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  ChevronRight,
  ClipboardCheck,
  FileBarChart,
  Megaphone,
  Users,
  Zap,
} from "lucide-react";
import type { AttentionItem } from "@/lib/dashboard/school-head-overview";

/**
 * Visually `UpcomingTasksPanel` / `QuickActionsPanel`
 * (`src/components/dashboard/teacher/tasks-panel.tsx`), but typed on
 * `AttentionItem` rather than `DashboardTask` — the head's list is state
 * ("3 waiting on you"), not the teacher's program cadence ("due Friday"). Same
 * visual shape, different type, different copy; a new file per
 * `docs/school-head-ui-rework.md` section 3.6.
 */

const BADGE: Record<AttentionItem["tone"], string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  muted: "bg-muted text-muted-foreground",
};

export function SchoolAttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Surface as="section" className="flex flex-col rounded-2xl">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <ClipboardCheck className="size-5" />
        </span>
        <h2 className="flex-1 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
          Needs your attention
        </h2>
      </div>

      <ul className="px-4 pb-2 pt-2 sm:px-5">
        {items.map((item) => {
          const row = (
            <>
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full border-2 border-muted-foreground/40"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug text-foreground">
                  {item.label}
                </span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              {item.badge ? (
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    BADGE[item.tone]
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={item.id} className="border-b border-border/60 last:border-0">
              {item.href ? (
                <PrefetchLink
                  href={item.href}
                  prefetch
                  className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row}
                </PrefetchLink>
              ) : (
                // The "all clear" row: nothing to drill into, so it is not a link.
                <div className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}

export function SchoolQuickActionsPanel({
  isSuperAdminView,
  announcementsHref,
  transferHref,
  teachersHref,
  reportsHref,
}: {
  /** Hidden entirely when true — a Super Admin drilling in does not act, matching today's suppressed header buttons (section 3.8). */
  isSuperAdminView: boolean;
  announcementsHref: string;
  transferHref: string;
  teachersHref: string;
  reportsHref: string;
}) {
  if (isSuperAdminView) return null;

  const actions = [
    {
      id: "announcement",
      label: "Post an announcement",
      icon: Megaphone,
      href: announcementsHref,
      tone: "bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-200",
    },
    {
      id: "transfer",
      label: "Transfer a learner",
      icon: ArrowRightLeft,
      href: transferHref,
      tone: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200",
    },
    {
      id: "teachers",
      label: "Manage teachers",
      icon: Users,
      href: teachersHref,
      tone: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200",
    },
    {
      id: "reports",
      label: "Generate a report",
      icon: FileBarChart,
      href: reportsHref,
      tone: "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200",
    },
  ];

  return (
    <Surface as="section" className="rounded-2xl">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <Zap className="size-5" />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
          Quick Actions
        </h2>
      </div>

      <ul className="grid grid-cols-2 gap-2.5 px-4 pb-4 pt-3 sm:gap-3 sm:px-5 sm:pb-5">
        {actions.map((a) => (
          <li key={a.id}>
            <PrefetchLink
              href={a.href}
              prefetch
              className={cn(
                "flex h-full items-center gap-2.5 rounded-xl px-3 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3 sm:px-4",
                a.tone
              )}
            >
              <a.icon aria-hidden className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 leading-snug">{a.label}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 xl:hidden" />
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
