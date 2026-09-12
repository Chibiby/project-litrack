"use client";

import { createContext, useContext } from "react";
import { AppSidebar } from "./app-sidebar";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { NavPathProvider } from "@/components/nav/nav-path";
import { AppHeader } from "@/components/shell/app-header";
import { ReleaseNotesModal } from "@/components/release-notes-modal";
import type { ShellNotification } from "@/components/shell/notifications-menu";
import { useSidebarExpanded } from "@/hooks/use-sidebar-expanded";
import { CONTENT_OFFSET_CLASS } from "@/lib/sidebar-layout";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";
import { TeacherPresenceHeartbeat } from "@/components/presence/teacher-presence-heartbeat";

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
   * Renders the same two class-bound items inert with a "Floating teacher" pill
   * for a DepEd teacher whose `advisoryMode` is FLOATING; see
   * `NavOptions.isFloating`. Also drops the header search, same as
   * `isAralVolunteer`.
   */
  isFloating?: boolean;
  /**
   * Points the "End of Terms Reports" row at the grade-scoped sheet the teacher
   * actually lands on; see `NavOptions.advisoryGradeLevelId`.
   */
  advisoryGradeLevelId?: string | null;
  notifications?: ShellNotification[];
  /**
   * Whether a model backend is configured, read from server env by the layout.
   *
   * Drives one thing: whether the assistant tells people their question is sent
   * to Google. With no key nothing is sent, and saying otherwise would be a
   * false privacy notice — which is worse than none.
   */
  aiEnabled?: boolean;
  /**
   * The release this user has acknowledged — `User.lastSeenReleaseVersion`,
   * taken from the row the layout already loaded, so the common path (nothing
   * to show) costs no extra query. `null` means they have acknowledged none.
   */
  lastSeenReleaseVersion?: string | null;
  /** Mount the active-app heartbeat for a real, non-impersonated teacher. */
  trackTeacherPresence?: boolean;
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
  isFloating,
  advisoryGradeLevelId,
  notifications,
  aiEnabled,
  lastSeenReleaseVersion,
  trackTeacherPresence = false,
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
            isFloating={isFloating}
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
              isFloating={isFloating}
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
          <AssistantWidget role={role} userName={userName} aiEnabled={aiEnabled} />

          {trackTeacherPresence ? <TeacherPresenceHeartbeat /> : null}

          {/* Last, after the page: a dialog portals out of this tree so its
              place here does not affect layout, but it does set tab order, and
              the notes should not sit between the nav and the page in it.
              `undefined` — a layout that has not been taught to pass the stamp —
              renders nothing, rather than announcing to everyone as if they had
              seen no release. */}
          {lastSeenReleaseVersion !== undefined ? (
            // `role` is the shell's own role, which is what an admin
            // impersonating a School Head reads as — and that shell is not
            // handed a stamp at all, so no note crosses a role boundary here.
            <ReleaseNotesModal lastSeenVersion={lastSeenReleaseVersion} role={role} />
          ) : null}
        </div>
      </NavPathProvider>
    </RoleShellContext.Provider>
  );
}
