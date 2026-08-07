"use client";

import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { useRoleShell } from "./role-shell";
import type { UserRole } from "@prisma/client";
import { Search } from "lucide-react";

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
        <div className="mx-auto max-w-7xl px-4 pt-4 lg:px-8 lg:pt-6">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>

        <main className="mx-auto max-w-7xl p-4 lg:p-8">{children}</main>
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
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 lg:px-8">
            <div className="flex items-center gap-4">
              <div className="w-8 shrink-0 lg:hidden" />

              <div className="min-w-0 flex-1">
                <Breadcrumbs className="mb-1 hidden md:flex" />
                <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                ) : null}
              </div>

              <div className="ml-auto hidden items-center gap-3 sm:flex">
                <div
                  className="flex h-10 w-48 items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 text-sm text-muted-foreground xl:w-64"
                  aria-hidden
                >
                  <Search className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="truncate">Search…</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
