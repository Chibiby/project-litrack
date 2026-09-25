import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ChevronRight, KeyRound, LifeBuoy, Plus, ScrollText, Zap } from "lucide-react";

/**
 * The Super Admin's Quick Actions. Same anatomy as `SchoolQuickActionsPanel`
 * (`src/components/dashboard/school-head/attention-panel.tsx`), which hard-codes
 * the School Head's four destinations and hides itself for a Super Admin.
 */
const ACTIONS = [
  {
    id: "new-school",
    label: "Add a school",
    icon: Plus,
    href: "/admin/schools/new",
    tone: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200",
  },
  {
    id: "accounts",
    label: "Manage accounts",
    icon: KeyRound,
    href: "/admin/accounts",
    tone: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
  {
    id: "support",
    label: "Open support inbox",
    icon: LifeBuoy,
    href: "/admin/support",
    tone: "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200",
  },
  {
    id: "audit",
    label: "Review the audit log",
    icon: ScrollText,
    href: "/admin/audit",
    tone: "bg-muted text-foreground hover:bg-muted/70",
  },
] as const;

export function AdminQuickActionsPanel() {
  return (
    <Surface as="section" className="rounded-2xl">
      <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
        >
          <Zap className="size-5" />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
          Quick Actions
        </h2>
      </div>

      <ul className="grid grid-cols-2 gap-2.5 px-4 pb-4 pt-3 sm:gap-3 sm:px-5 sm:pb-5 lg:grid-cols-4">
        {ACTIONS.map((a) => (
          <li key={a.id}>
            <PrefetchLink
              href={a.href}
              prefetch
              className={cn(
                "flex h-full min-h-12 items-center gap-2.5 rounded-xl px-3 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3 sm:px-4",
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
