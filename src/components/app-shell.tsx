"use client";

import { Menu } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { useRoleShell } from "./role-shell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
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
}: AppShellProps) {
  const inRoleShell = useRoleShell();

  // Role layouts already mount sidebar + breadcrumb chrome; page only supplies
  // the title block and main content (so loading.tsx never replaces breadcrumbs).
  if (inRoleShell) {
    return (
      <div className="w-full p-4 lg:p-8">
        <div className="mb-4 lg:mb-6">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>

        <main id="main-content">{children}</main>
      </div>
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
    >
      {children}
    </AppShellFallback>
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
}: AppShellProps) {
  const { expanded, toggle, hydrated } = useSidebarExpanded();

  return (
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
        <header className="sticky top-0 z-30 border-b border-border/80 bg-surface-header/90 shadow-sm backdrop-blur-md">
          <div className="flex w-full items-center gap-3 px-4 py-4 lg:gap-4 lg:px-8">
            <div className="w-8 shrink-0 lg:hidden" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden shrink-0 lg:inline-flex"
              onClick={toggle}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={expanded}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="min-w-0 flex-1">
              <Breadcrumbs className="mb-1 min-w-0 justify-start" />
              <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>

            <ThemeToggle className="self-start" />
          </div>
        </header>

        <main id="main-content" className="w-full p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
