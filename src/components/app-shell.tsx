"use client";

import { AppSidebar } from "./app-sidebar";
import { useRoleShell } from "./role-shell";
import { NavPathProvider } from "@/components/nav/nav-path";
import { AppHeader } from "@/components/shell/app-header";
import { useSidebarExpanded } from "@/hooks/use-sidebar-expanded";
import { CONTENT_OFFSET_CLASS } from "@/lib/sidebar-layout";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  role: UserRole;
  userName: string;
  schoolName?: string;
  grades?: { id: string; label: string; hasAral?: boolean }[];
  isSuperAdminView?: boolean;
  viewedSchoolName?: string;
  /** Suppresses the page title block — used by pages whose own header replaces it. */
  hideTitle?: boolean;
  /** Right-aligned controls on the title line. Ignored when `hideTitle` is set. */
  actions?: React.ReactNode;
}

export function AppShell({
  title,
  subtitle,
  children,
  role,
  userName,
  schoolName,
  grades,
  isSuperAdminView,
  viewedSchoolName,
  hideTitle,
  actions,
}: AppShellProps) {
  const inRoleShell = useRoleShell();

  // Role layouts already mount sidebar + header chrome; page only supplies
  // the title block and main content.
  if (inRoleShell) {
    return (
      <main id="main-content" className="w-full p-4 lg:p-6">
        {!hideTitle ? (
          <PageTitleBlock title={title} subtitle={subtitle} actions={actions} />
        ) : null}
        {children}
      </main>
    );
  }

  return (
    <AppShellFallback
      title={title}
      subtitle={subtitle}
      role={role}
      userName={userName}
      schoolName={schoolName}
      grades={grades}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={viewedSchoolName}
      hideTitle={hideTitle}
      actions={actions}
    >
      {children}
    </AppShellFallback>
  );
}

/** Title, optional subtitle, and optional right-aligned actions on the same line. */
function PageTitleBlock({
  title,
  subtitle,
  actions,
}: Pick<AppShellProps, "title" | "subtitle" | "actions">) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 lg:mb-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** Non–RoleShell path: owns sidebar expand state + matching content offset. */
function AppShellFallback({
  title,
  subtitle,
  children,
  role,
  userName,
  schoolName,
  grades,
  isSuperAdminView,
  viewedSchoolName,
  hideTitle,
  actions,
}: AppShellProps) {
  const { expanded, toggle, hydrated } = useSidebarExpanded();

  return (
    // Same pairing as RoleShell: the rail and the header both read the optimistic
    // nav path, so the provider has to sit above both of them.
    <NavPathProvider>
      <div className="min-h-screen bg-background">
        <AppSidebar
          role={role}
          userName={userName}
          schoolName={schoolName}
          grades={grades}
          isSuperAdminView={isSuperAdminView}
          viewedSchoolName={viewedSchoolName}
          expanded={expanded}
          transitionsEnabled={hydrated}
        />

        <div
          className={cn(
            hydrated && "transition-[margin] duration-200",
            expanded
              ? CONTENT_OFFSET_CLASS.expanded
              : CONTENT_OFFSET_CLASS.collapsed
          )}
        >
          <AppHeader
            role={role}
            grades={grades}
            expanded={expanded}
            onToggleSidebar={toggle}
          />

          <main id="main-content" className="w-full p-4 lg:p-6">
            {!hideTitle ? (
              <PageTitleBlock
                title={title}
                subtitle={subtitle}
                actions={actions}
              />
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </NavPathProvider>
  );
}
