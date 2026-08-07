"use client";

import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { useRoleShell } from "./role-shell";
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
      <>
        {/* Match RoleShell header: full column width, shared px-4 / lg:px-8. */}
        <div className="w-full px-4 pt-4 lg:px-8 lg:pt-6">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>

        <main className="w-full p-4 lg:p-8">{children}</main>
      </>
    );
  }

  return (
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
          {/* Match RoleShell: full-bleed in content column, no mx-auto centering. */}
          <div className="flex w-full items-center gap-4 px-4 py-4 lg:px-8">
            <div className="w-8 shrink-0 lg:hidden" />

            <div className="min-w-0 flex-1">
              <Breadcrumbs className="mb-1 hidden justify-start md:flex" />
              <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        {/* Match header padding; no max-w so content fills the main column. */}
        <main className="w-full p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
