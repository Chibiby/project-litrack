import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  Zap,
} from "lucide-react";
import type { DashboardTask } from "@/lib/dashboard/teacher-overview";

/**
 * Upcoming tasks and quick actions — the dashboard's right-hand column.
 *
 * Task due dates are the program's own cadence (attendance weekly, reading
 * level monthly), computed from the calendar. LITRACK stores no deadline and
 * no lock, so no badge here claims a record is locked or overdue-by-policy;
 * a badge only ever counts real outstanding work or reports it complete.
 */

const BADGE: Record<DashboardTask["tone"], string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  muted: "bg-muted text-muted-foreground",
};

export function UpcomingTasksPanel({
  tasks,
  viewAllHref,
}: {
  tasks: DashboardTask[];
  viewAllHref: string;
}) {
  return (
    <Surface as="section" className="flex flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <ClipboardCheck className="size-4.5" />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Upcoming Tasks
        </h2>
      </div>

      <ul className="flex-1 px-5 pt-4">
        {tasks.map((t) => (
          <li key={t.id} className="border-b border-border/50 py-3 first:pt-0 last:border-0">
            <PrefetchLink
              href={t.href}
              prefetch
              className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {t.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t.detail}
                </span>
              </span>
              {t.badge ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    BADGE[t.tone]
                  )}
                >
                  {t.badge}
                </span>
              ) : null}
            </PrefetchLink>
          </li>
        ))}
      </ul>

      <div className="px-5 pb-5 pt-3">
        <PrefetchLink
          href={viewAllHref}
          prefetch
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-violet-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card dark:text-violet-300"
        >
          View all tasks
          <ArrowRight aria-hidden className="size-4" />
        </PrefetchLink>
      </div>
    </Surface>
  );
}

export function QuickActionsPanel({
  attendanceHref,
  readingHref,
  reportsHref,
}: {
  attendanceHref: string;
  readingHref: string;
  reportsHref: string;
}) {
  const actions = [
    { id: "attendance", label: "Weekly\nAttendance", icon: CalendarDays, href: attendanceHref },
    { id: "reading", label: "Monthly\nReading Level", icon: BookOpen, href: readingHref },
    { id: "reports", label: "Reports", icon: FileBarChart, href: reportsHref },
  ];

  return (
    <Surface as="section">
      <div className="flex items-center gap-2.5 px-5 pt-5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
        >
          <Zap className="size-4.5" />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Quick Actions
        </h2>
      </div>

      <ul className="grid gap-3 px-5 pb-5 pt-4 sm:grid-cols-3">
        {actions.map((a) => (
          <li key={a.id}>
            <PrefetchLink
              href={a.href}
              prefetch
              className="flex h-full items-center gap-2.5 rounded-xl border border-border/80 p-3 transition-colors hover:border-violet/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <a.icon
                aria-hidden
                className="size-4.5 shrink-0 text-violet-700 dark:text-violet-300"
              />
              <span className="whitespace-pre-line text-xs font-medium leading-snug text-foreground">
                {a.label}
              </span>
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
