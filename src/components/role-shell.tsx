"use client";

import { createContext, useContext } from "react";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "@/components/shell/app-header";
import type { ShellNotification } from "@/components/shell/notifications-menu";
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
  notifications?: ShellNotification[];
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
  notifications,
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
          {/* Header sits OUTSIDE the content panel (spec R1): full-bleed bar,
              then page content on the workspace ground with gutters. */}
          <AppHeader
            role={role}
            grades={grades}
            notifications={notifications}
            expanded={expanded}
            onToggleSidebar={toggle}
          />

          <div className="min-h-[calc(100dvh-var(--app-chrome-header-height))] bg-background">
            {children}
          </div>
        </div>
      </div>
    </RoleShellContext.Provider>
  );
}
