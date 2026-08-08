"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { SignOutButton } from "@/components/sign-out-button";
import { getShellWarmHrefs } from "@/lib/nav/warm-hrefs";
import { logoutAction } from "@/lib/actions/auth";
import { roleHomePath, roleSettingsPath } from "@/lib/auth/roles";
import type { UserRole } from "@prisma/client";
import {
  LayoutDashboard,
  School,
  GraduationCap,
  Users,
  UserCircle,
  BookOpen,
  Sparkles,
  Menu,
  Settings,
  Shield,
  CalendarRange,
  Megaphone,
  ScrollText,
  ArrowRightLeft,
  Building2,
  FileBarChart,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface AppSidebarProps {
  role: UserRole;
  userName: string;
  schoolName?: string;
  grades?: { id: string; label: string; hasAral?: boolean }[];
  isSuperAdminView?: boolean;
  viewedSchoolName?: string;
}

function getNavItems(role: UserRole, grades: AppSidebarProps["grades"] = []): NavItem[] {
  switch (role) {
    case "SUPER_ADMIN":
      return [
        { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
        { label: "Schools", href: "/admin/schools", icon: School },
        { label: "Transfers", href: "/admin/transfers", icon: ArrowRightLeft },
        { label: "School years", href: "/admin/school-years", icon: CalendarRange },
        { label: "Audit", href: "/admin/audit", icon: ScrollText },
      ];
    case "SCHOOL_HEAD":
      return [
        { label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
        { label: "School years", href: "/school-head/school-years", icon: CalendarRange },
        { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
        { label: "Teachers", href: "/school-head/teachers", icon: Users },
        { label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
        { label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
        { label: "School info", href: "/school-head/school-info", icon: Building2 },
        { label: "Reports", href: "/school-head/reports", icon: FileBarChart },
        { label: "Audit", href: "/school-head/audit", icon: ScrollText },
      ];
    case "TEACHER":
      const items: NavItem[] = [
        { label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
      ];
      // Add assigned grades as menu items
      grades?.forEach((grade) => {
        items.push({
          label: grade.label,
          href: `/teacher/grade/${grade.id}`,
          icon: BookOpen,
          badge: grade.hasAral ? 1 : undefined,
        });
        if (grade.hasAral) {
          items.push({
            label: `${grade.label} ARAL`,
            href: `/teacher/aral/${grade.id}`,
            icon: Sparkles,
          });
        }
      });
      items.push({ label: "Reports", href: "/teacher/reports", icon: FileBarChart });
      return items;
    default:
      return [];
  }
}

/** Single active nav href: exact match preferred; otherwise longest prefix (so `/teacher` ≠ nested). */
function resolveActiveHref(pathname: string, items: NavItem[]): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (!best || item.href.length > best.length) {
      best = item.href;
    }
  }
  return best;
}

function NavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      // force-dynamic + loading.tsx: default prefetch only warms the skeleton.
      // Full prefetch loads the RSC payload (auth + cachedQuery) before click.
      prefetch={true}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet text-[10px] font-medium text-white">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppSidebar({
  role,
  userName,
  schoolName,
  grades,
  isSuperAdminView,
  viewedSchoolName,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = getNavItems(role, grades);
  const activeHref = resolveActiveHref(pathname, navItems);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // FULL-warm only cheap shell routes (dashboard / settings profile + security).
  // Reports, grade rosters, and other sidebar items keep default Link prefetch
  // (loading.tsx only) so background RSC does not stampede the Prisma pool.
  const prefetchHrefs = useMemo(() => getShellWarmHrefs(role), [role]);
  const prefetchKey = `${role}:${prefetchHrefs.join("|")}`;

  const renderSidebarContent = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white">
      {/* Brand — height matches RoleShell sticky header via --app-chrome-header-height */}
      <div className="flex min-h-[var(--app-chrome-header-height)] shrink-0 flex-col justify-center border-b border-border/80 px-4">
        <Link
          href={roleHomePath(role)}
          prefetch={true}
          onClick={onNavigate}
          className="flex items-center gap-3 font-semibold"
        >
          <Image
            src="/logo.png"
            alt="ARAL Program logo"
            width={36}
            height={48}
            className="h-10 w-auto shrink-0"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-bold tracking-tight text-foreground">LITRACK</span>
            {schoolName && (
              <span className="max-w-[150px] truncate text-xs text-muted-foreground">
                {schoolName}
              </span>
            )}
          </div>
        </Link>

        {/* Super Admin View Indicator */}
        {isSuperAdminView && viewedSchoolName && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="truncate">Viewing: {viewedSchoolName}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-5">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Menu
        </p>
        <nav aria-label="Primary" className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              isActive={item.href === activeHref}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border/80 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <UserCircle className="h-5 w-5" />
          </div>
          <div className="flex min-w-0 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-foreground">{userName}</span>
            <span className="text-xs capitalize text-muted-foreground">
              {role.toLowerCase().replace("_", " ")}
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <Link href={roleSettingsPath(role)} prefetch={true} onClick={onNavigate}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <form action={logoutAction}>
            <SignOutButton />
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <NavPrefetcher cacheKey={prefetchKey} hrefs={prefetchHrefs} />

      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-border/80 bg-white lg:flex">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed left-4 top-[calc(var(--app-chrome-header-height)/2)] z-50 -translate-y-1/2 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-r p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {renderSidebarContent(() => setMobileOpen(false))}
        </SheetContent>
      </Sheet>
    </>
  );
}
