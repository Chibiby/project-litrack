import { CheckCheck, ChevronDown } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import {
  DISCREPANCY_LIST_LIMIT,
  DISCREPANCY_META,
  type DiscrepancySummary,
} from "@/lib/monitoring/discrepancy-kinds";

/**
 * Monitoring > Discrepancies. One collapsible card per check, open when it has
 * rows. A server component: `<details>` needs no client state, and the anchor
 * `#KIND` the dashboard links to lands on the right card.
 */
export function DiscrepancyList({
  summary,
  learnersHref,
  setupHref,
  aralHref,
}: {
  summary: DiscrepancySummary;
  /** Learners page; the learner's name is appended as `q`. */
  learnersHref: (name: string) => string;
  setupHref: string;
  /** Where a tutor-week row leads: the tutor's Weekly Attendance is checked there. */
  aralHref: string;
}) {
  const withIssues = summary.groups.filter((g) => g.count > 0);
  const clean = summary.groups.filter((g) => g.count === 0);

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="Discrepancies by check">
        {summary.groups.map((g) => (
          <li key={g.kind}>
            <a
              href={`#${g.kind}`}
              className={cn(
                "flex h-full flex-col gap-0.5 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                g.count > 0 && "border-warning-300 dark:border-warning-700"
              )}
            >
              <span className="text-xs text-muted-foreground">{DISCREPANCY_META[g.kind].title}</span>
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  g.count > 0 ? "text-warning-800 dark:text-warning-200" : "text-foreground"
                )}
              >
                {g.count}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {!summary.hasActiveYear ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          There is no active school year, so enrollment checks are skipped.
        </p>
      ) : null}

      {withIssues.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="No discrepancies found"
          description="Every learner has an adviser, a section and a matching enrollment, every section has an active adviser, and every finished ARAL week has at least 2 attendance days."
        />
      ) : null}

      {withIssues.map((g) => {
        const meta = DISCREPANCY_META[g.kind];
        return (
          <Surface as="section" key={g.kind} id={g.kind} className="scroll-mt-24 rounded-lg">
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">{meta.title}</h2>
                    <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium tabular-nums text-warning-800 dark:bg-warning-900/30 dark:text-warning-200">
                      {g.count}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{meta.description}</span>
                  <span className="mt-0.5 block text-sm text-foreground">
                    <span className="font-medium">How to fix: </span>
                    {meta.fix}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <ul className="border-t border-border/60">
                {g.items.map((item) => (
                  <li key={item.id} className="border-b border-border/60 last:border-0">
                    <PrefetchLink
                      href={
                        meta.subject === "learner"
                          ? learnersHref(item.name)
                          : meta.subject === "tutor-week"
                            ? aralHref
                            : setupHref
                      }
                      className="flex flex-col gap-0.5 px-4 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-muted-foreground sm:w-56 sm:truncate" title={item.placement}>
                        {item.placement}
                      </span>
                      <span className="text-muted-foreground sm:w-52 sm:truncate" title={item.teacher ?? undefined}>
                        {item.teacher ?? (
                          <>
                            —<span className="sr-only">No teacher</span>
                          </>
                        )}
                      </span>
                    </PrefetchLink>
                  </li>
                ))}
              </ul>
              {g.count > g.items.length ? (
                <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground sm:px-5">
                  Showing the first {DISCREPANCY_LIST_LIMIT} of {g.count}. Fix these and reload to see the rest.
                </p>
              ) : null}
            </details>
          </Surface>
        );
      })}

      {clean.length > 0 && withIssues.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">No issues: </span>
          {clean.map((g) => DISCREPANCY_META[g.kind].title).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
