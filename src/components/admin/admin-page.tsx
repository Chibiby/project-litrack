import type * as React from "react";
import type { UserRole } from "@prisma/client";
import { AppShell } from "@/components/app-shell";

/**
 * The page frame for Super Admin routes — the `/admin` counterpart of
 * `SchoolHeadPage` (`src/components/school-head/school-head-page.tsx`): either a
 * banded hero (`SchoolHeadHero`, as the School Head list pages and the admin
 * Division Summary use) or, for the dense tool pages (audit, error log,
 * database), the same compact title block School Head's own audit page opens
 * with. `AppShell` still provides the `<main>` landmark and the fallback
 * chrome outside `RoleShell`; its own title block is suppressed.
 *
 * Server component on purpose — no `"use client"`.
 */
export interface AdminPageProps {
  /** Accessible name in review and the heading when no `hero` is given. */
  title: string;
  description?: string;
  role: UserRole;
  userName: string;
  /** Right-aligned controls beside the compact title. Ignored with `hero`. */
  actions?: React.ReactNode;
  /** Replaces the compact title block, e.g. `SchoolHeadHero`. */
  hero?: React.ReactNode;
  /** Notice between the header and the content. */
  callout?: React.ReactNode;
  /** Replaces the default vertical rhythm outright. */
  contentClassName?: string;
  children: React.ReactNode;
}

export function AdminPage({
  title,
  description,
  role,
  userName,
  actions,
  hero,
  callout,
  contentClassName,
  children,
}: AdminPageProps) {
  return (
    <AppShell title={title} role={role} userName={userName} hideTitle>
      {hero ? (
        <div className="mb-6">{hero}</div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap sm:items-center">
              {actions}
            </div>
          ) : null}
        </div>
      )}

      {callout ? <div className="mb-6">{callout}</div> : null}

      <div className={contentClassName ?? "min-w-0 space-y-6"}>{children}</div>
    </AppShell>
  );
}
