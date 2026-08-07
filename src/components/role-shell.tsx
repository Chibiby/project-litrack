"use client";

import { createContext, useContext } from "react";
import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import type { UserRole } from "@prisma/client";
import { Search } from "lucide-react";

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
 * mounts; AppSidebar's NavPrefetcher then full-prefetches sidebar + nested
 * shell routes (concurrency-limited) so later navigations reuse Flight data
 * instead of flashing loading.tsx. Deeper nests warm from learner detail
 * pages, not mass roster lists. Keep account/settings under the role prefix
 * so this shell is not unmounted (see rolePasswordPath).
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
          <header className="sticky top-0 z-30 border-b border-border/80 bg-white/90 backdrop-blur-md">
            {/* No mx-auto/max-w — keep breadcrumbs flush-left beside the sidebar. */}
            <div className="flex w-full items-center gap-4 px-4 py-4 lg:px-8">
              {/* Spacer for mobile menu button */}
              <div className="w-8 shrink-0 lg:hidden" />

              <div className="min-w-0 flex-1">
                <Breadcrumbs className="hidden justify-start md:flex" />
              </div>

              <div className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
                <div
                  className="flex h-10 w-48 items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 text-sm text-muted-foreground xl:w-64"
                  aria-hidden
                >
                  <Search className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="truncate">Search…</span>
                </div>
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>
    </RoleShellContext.Provider>
  );
}
