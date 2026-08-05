import { AppSidebar } from "./app-sidebar";
import { Breadcrumbs } from "./breadcrumbs";
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
  schoolIdQuery?: string;
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
  schoolIdQuery,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        role={role}
        userName={userName}
        schoolName={schoolName}
        grades={grades}
        isSuperAdminView={isSuperAdminView}
        viewedSchoolName={viewedSchoolName}
        schoolIdQuery={schoolIdQuery}
      />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="flex h-16 items-center gap-4 px-4 lg:px-8">
            <div className="w-8 lg:hidden" />

            {/* Desktop breadcrumb trail */}
            <Breadcrumbs className="hidden md:flex" />

            {/* Mobile page context */}
            <p className="truncate text-sm font-medium text-foreground md:hidden" aria-live="polite">
              {title}
            </p>

            <div className="ml-auto flex items-center gap-4" />
          </div>
        </header>

        <main className="p-4 lg:p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle ? <p className="mt-1 text-lg text-muted-foreground">{subtitle}</p> : null}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
