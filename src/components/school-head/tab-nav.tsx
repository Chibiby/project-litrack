import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tab bar for a School Head workspace.
 *
 * Each tab is a real route segment, so tabs are `<Link>`s rather than local
 * state: the URL is shareable, the back button works, and Next prefetches each
 * panel independently. There is no `tabs.tsx` under `components/ui` and adding
 * `@radix-ui/react-tabs` is off the table, so this is also the only option that
 * ships no JavaScript.
 *
 * Server component on purpose. Active state arrives as a prop from the page
 * rather than from `usePathname()`, which would force a client boundary — and a
 * workspace `layout.tsx` could not supply it anyway, because a Next layout
 * never receives `searchParams` and so cannot resolve the `?schoolId=` that
 * tells a Super Admin's drill-down apart from a School Head's own school.
 */
export interface TabNavItem {
  key: string;
  label: string;
  href: string;
  /** Rendered as a trailing numeral. Omit where a count carries no meaning. */
  count?: number;
  /** Draws a non-zero count in the accent colour — for states awaiting action. */
  emphasizeCount?: boolean;
}

export function TabNav({
  items,
  activeKey,
  className,
  label = "Sections",
}: {
  items: TabNavItem[];
  activeKey?: string;
  className?: string;
  /** Accessible name for the nav landmark. */
  label?: string;
}) {
  if (items.length === 0) return null;

  return (
    <nav aria-label={label} className={cn("overflow-x-auto", className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-border/70">
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                prefetch={true}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // -mb-px lifts the 2px active underline over the ul's 1px rule.
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                      item.emphasizeCount && item.count > 0
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
