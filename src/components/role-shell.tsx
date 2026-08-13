"use client";

import { createContext, useContext } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { useSidebarExpanded } from "@/hooks/use-sidebar-expanded";
import { CONTENT_OFFSET_CLASS } from "@/lib/sidebar-layout";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const RoleShellContext = createContext(false);

/** True when rendered inside a role layout that already mounts the sidebar. */
export function useRoleShell() {
  return useContext(RoleShellContext);
}

interface RoleShellProps {
  role: UserRole;
  userName: string;
  schoolName?: string;
  grades?: { id: string; label: string; hasAral?: boolean }[];
  isSuperAdminView?: boolean;
  viewedSchoolName?: string;
  children: React.ReactNode;
}

/**
 * Persistent dashboard chrome for role route segments.
 * Desktop content uses CONTENT_OFFSET_CLASS (margin) paired 1:1 with sidebar width
 * so the inset panel never underlaps the fixed rail.
 */
export function RoleShell({
  role,
  userName,
  schoolName,
  grades,
  isSuperAdminView,
  viewedSchoolName,
  children,
}: RoleShellProps) {
  const { expanded, toggle, hydrated } = useSidebarExpanded();

  return (
    <RoleShellContext.Provider value={true}>
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

        {/* Exact ml match to sidebar width — no underlap (do not use smaller pl). */}
        <div
          className={cn(
            hydrated && "transition-[margin] duration-200",
            expanded
              ? CONTENT_OFFSET_CLASS.expanded
              : CONTENT_OFFSET_CLASS.collapsed
          )}
        >
          {/* Inset gutters live INSIDE the offset column so the panel stays clear of the rail. */}
          <div className="lg:p-4">
            <div className="min-h-dvh shadow-sm lg:min-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border lg:border-border/80 lg:bg-surface">
              <header className="h-[var(--app-chrome-header-height)] border-b border-border/80 bg-surface-header lg:rounded-t-xl">
                <div className="flex h-full w-full items-center gap-3 px-4 lg:gap-4 lg:px-8">
                  {/* Mobile: spacer for floating Sheet trigger. Desktop: collapse toggle. */}
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
                    <Breadcrumbs className="min-w-0 justify-start" />
                  </div>

                  <ThemeToggle />
                </div>
              </header>

              {children}
            </div>
          </div>
        </div>
      </div>
    </RoleShellContext.Provider>
  );
}
