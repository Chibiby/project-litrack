"use client";

import { createContext, useContext } from "react";
import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
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
 * Keeps sidebar + breadcrumb header mounted while `loading.tsx` / page
 * content swaps in `children`. Layout chrome is set up once when this shell
 * mounts; AppSidebar's NavPrefetcher then full-prefetches cheap shell routes
 * (dashboard / settings profile + security) so those navigations reuse Flight data.
 * Heavy sidebar destinations keep default Link prefetch only. Deeper nests
 * warm from learner detail pages, not mass roster lists. Keep account/settings
 * under the role prefix so this shell is not unmounted (see roleSettingsPath /
 * rolePasswordPath → settings/security).
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
        />
        <div className="lg:pl-64">
          <header className="sticky top-0 z-30 h-[var(--app-chrome-header-height)] border-b border-border/80 bg-white/90 backdrop-blur-md">
            {/* No mx-auto/max-w — keep breadcrumbs flush-left beside the sidebar. */}
            <div className="flex h-full w-full items-center gap-4 px-4 lg:px-8">
              {/* Spacer for mobile menu button */}
              <div className="w-8 shrink-0 lg:hidden" />

              <div className="min-w-0 flex-1">
                <Breadcrumbs className="min-w-0 justify-start" />
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>
    </RoleShellContext.Provider>
  );
}
