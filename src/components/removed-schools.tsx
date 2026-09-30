"use client";

import Link from "next/link";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { restoreSchool } from "@/lib/actions/school";
import { callAction } from "@/lib/ui/call-action";
import { isActionFailure } from "@/lib/errors/client";
import { cn } from "@/lib/utils";

export type RemovedSchoolTableRow = {
  id: string;
  name: string;
  schoolIdCode: string;
  isDemo: boolean;
  /** ISO string: a Date cannot cross into a client component. */
  removedAt: string;
  users: number;
  learners: number;
};

/** "Active" / "Removed" switch for the Super Admin schools list. */
export function SchoolsViewTabs({
  view,
  basePath = "/admin/schools",
}: {
  view: "active" | "removed";
  basePath?: string;
}) {
  const tabs = [
    { key: "active", label: "Active", href: basePath },
    { key: "removed", label: "Removed", href: `${basePath}?view=removed` },
  ] as const;
  return (
    <nav
      aria-label="Schools view"
      className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-1"
    >
      {tabs.map((tab) => {
        const current = tab.key === view;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function formatRemovedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

export function RemovedSchoolsTable({ schools }: { schools: RemovedSchoolTableRow[] }) {
  if (schools.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No removed schools. A school you remove shows up here, and you can restore it.
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Removed schools">
      {schools.map((school) => (
        <li
          key={school.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-card"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{school.name}</span>
              {school.isDemo ? (
                <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                  Demo
                </span>
              ) : null}
            </div>
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <dt>School ID</dt>
                <dd>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{school.schoolIdCode}</code>
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Removed</dt>
                <dd>{formatRemovedDate(school.removedAt)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Users</dt>
                <dd>
                  <Badge variant="secondary">{school.users}</Badge>
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Learners</dt>
                <dd>
                  <Badge variant="outline">{school.learners}</Badge>
                </dd>
              </div>
            </dl>
          </div>
          <ConfirmAction
            title={`Restore ${school.name}?`}
            description="It comes back turned off, so no one can sign in until you turn it on."
            confirmLabel="Restore"
            variant="default"
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-sm:h-11 lg:h-9"
                aria-label={`Restore ${school.name}`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Restore
              </Button>
            }
            onConfirm={async () => {
              const fd = new FormData();
              fd.set("id", school.id);
              const res = await callAction(() => restoreSchool(fd));
              if (isActionFailure(res)) return res;
              toast.success(`${school.name} restored. It is turned off until you turn it on.`);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
