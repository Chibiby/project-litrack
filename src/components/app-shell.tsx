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
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar Navigation */}
      <AppSidebar
        role={role}
        userName={userName}
        schoolName={schoolName}
        grades={grades}
        isSuperAdminView={isSuperAdminView}
        viewedSchoolName={viewedSchoolName}
      />

      {/* Main Content Area */}
      <div className="lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur-sm">
          <div className="flex h-16 items-center gap-4 px-4 lg:px-8">
            {/* Spacer for mobile menu button */}
            <div className="w-8 lg:hidden" />
            
            {/* Breadcrumbs */}
            <Breadcrumbs className="hidden md:flex" />
            
            <div className="ml-auto flex items-center gap-4">
              {/* Notifications could go here */}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-lg text-muted-foreground">{subtitle}</p>}
          </div>
          
          {children}
        </main>
      </div>
    </div>
  );
}
