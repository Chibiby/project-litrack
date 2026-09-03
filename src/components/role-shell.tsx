"use client";

import { createContext, useContext } from "react";
import { AppSidebar } from "./app-sidebar";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { NavPathProvider } from "@/components/nav/nav-path";
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
  /** Account-menu label when the role enum is not what the person is called. */
  roleLabel?: string;
  /**
   * Renders the advisory-only `Learners` item inert rather than dropping it, and
   * drops the header search that targets it; see `NavOptions.isAralVolunteer`.
   */
  isAralVolunteer?: boolean;
  /**
   * Points the "End of Terms Reports" row at the grade-scoped sheet the teacher
   * actually lands on; see `NavOptions.advisoryGradeLevelId`.
   */
  advisoryGradeLevelId?: string | null;
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
  roleLabel,
  isAralVolunteer,
  advisoryGradeLevelId,
  notifications,
  children,
}: RoleShellProps) {
  const { expanded, toggle, hydrated } = useSidebarExpanded();

  return (
    <RoleShellContext.Provider value={true}>
      {/* Wraps the rail and the header together: they are the two consumers of
          the optimistic nav path and this is the deepest node containing both.
          {children} stays server-rendered either way — the provider is a client
          boundary, not a client subtree. */}
      <NavPathProvider>
        <div className="min-h-screen bg-background">
          <AppSidebar
            role={role}
            userName={userName}
            schoolName={schoolName}
            grades={grades}
            isSuperAdminView={isSuperAdminView}
            viewedSchoolName={viewedSchoolName}
            roleLabel={roleLabel}
            isAralVolunteer={isAralVolunteer}
            advisoryGradeLevelId={advisoryGradeLevelId}
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
              isAralVolunteer={isAralVolunteer}
              advisoryGradeLevelId={advisoryGradeLevelId}
              expanded={expanded}
              onToggleSidebar={toggle}
            />

            <div className="min-h-[calc(100dvh-var(--app-chrome-header-height))] bg-background">
              {children}
            </div>
          </div>

          {/* Outside the offset wrapper: the widget is fixed to the viewport, so
              it must not sit inside a node whose margin animates with the rail. */}
          <AssistantWidget role={role} userName={userName} />
        </div>
      </NavPathProvider>
    </RoleShellContext.Provider>
  );
}
