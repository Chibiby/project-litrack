import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { TabNav, type TabNavItem } from "@/components/school-head/tab-nav";
import type { SchoolHeadView } from "@/lib/school-head/view";

/**
 * A workspace tab. `href` is a plain path; the frame appends `?schoolId=` when
 * the viewer is a Super Admin so tab navigation cannot drop school context.
 */
export type SchoolHeadTab = TabNavItem;

/** Re-exported so a page imports its whole frame contract from one module. */
export type { SchoolHeadView };

/**
 * The page frame for every /school-head route.
 *
 * Before this existed, each page hand-rolled its own frame — `AppShell` title
 * props, an intro paragraph, an optional banner, then an ad-hoc card grid. That
 * is why four amber banners drifted to three different border treatments and
 * why `PageHeader` shipped unused. Each page also passed five props (`role`,
 * `userName`, `schoolName`, `grades`, `viewedSchoolName`) that `AppShell`
 * silently drops on the path it takes inside `RoleShell`.
 *
 * This frame owns the Super Admin drill-down indicator, and owning it here is
 * what makes it work at all. `AppSidebar` has a `Viewing:` chip gated on props
 * the `(app)` layout can never supply: `?schoolId=` is the only signal that an
 * admin is looking at someone else's school, and a Next layout does not receive
 * `searchParams`. The page is the first place in the tree that knows.
 *
 * `RoleShell` renders children in a plain `<div>`, so the `<main>` below is the
 * page's only landmark — the same element `AppShell` used to provide.
 *
 * Server component on purpose — no `"use client"`.
 */
export interface SchoolHeadPageProps {
  title: string;
  description?: string;
  view: SchoolHeadView;
  /** Right-aligned header controls. */
  actions?: React.ReactNode;
  /** Notice rendered between the header and the tabs. */
  callout?: React.ReactNode;
  tabs?: SchoolHeadTab[];
  activeTab?: string;
  /**
   * Replaces the default vertical rhythm outright, e.g. for a top-level grid.
   * A replacement rather than a merge: `space-y-6` and `grid` both applying
   * would put stray top margins on every wrapped grid row.
   */
  contentClassName?: string;
  children: React.ReactNode;
}

/**
 * Carries a Super Admin's `?schoolId=` through an in-page link.
 *
 * Replaces the naive `sh(path)` concatenations duplicated across School Head
 * pages: this one survives a path that already has a query string or a hash.
 */
export function schoolHeadHref(view: SchoolHeadView, path: string): string {
  if (!view.isSuperAdminView) return path;
  const [base, hash] = path.split("#");
  const separator = base.includes("?") ? "&" : "?";
  const withParam = `${base}${separator}schoolId=${encodeURIComponent(view.schoolId)}`;
  return hash ? `${withParam}#${hash}` : withParam;
}

export function SchoolHeadPage({
  title,
  description,
  view,
  actions,
  callout,
  tabs,
  activeTab,
  contentClassName,
  children,
}: SchoolHeadPageProps) {
  return (
    <main id="main-content" className="w-full p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {view.isSuperAdminView ? (
            // The school name belongs here rather than concatenated into the
            // title, which is what every page used to do.
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Super Admin view</Badge>
              <span className="text-xs text-muted-foreground">
                {view.schoolName ?? "Unknown school"} · read-only
              </span>
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {callout ? <div className="mb-6">{callout}</div> : null}

      {tabs && tabs.length > 0 ? (
        <TabNav
          className="mb-6"
          activeKey={activeTab}
          items={tabs.map((tab) => ({
            ...tab,
            href: schoolHeadHref(view, tab.href),
          }))}
        />
      ) : null}

      <div className={contentClassName ?? "space-y-6"}>{children}</div>
    </main>
  );
}
