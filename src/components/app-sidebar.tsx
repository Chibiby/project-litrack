"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { PrefetchLink } from "@/components/nav/prefetch-link";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { UserAccountMenu } from "@/components/user-account-menu";
import { getShellWarmHrefs } from "@/lib/nav/warm-hrefs";
import {
  roleHomePath,
  type AppRole,
} from "@/lib/auth/roles";
import { SIDEBAR_WIDTH_CLASS } from "@/lib/sidebar-layout";
import type { UserRole } from "@prisma/client";
import {
  LayoutDashboard,
  School,
  GraduationCap,
  Users,
  BookOpen,
  Sparkles,
  Menu,
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
  /** Desktop only — mobile Sheet always shows the full expanded chrome. */
  expanded?: boolean;
  /** Skip width transition until localStorage sync (avoids hydrate flash). */
  transitionsEnabled?: boolean;
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
        { label: "ARAL", href: "/school-head/aral", icon: Sparkles },
        { label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
        { label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
        { label: "School info", href: "/school-head/school-info", icon: Building2 },
        { label: "Reports", href: "/school-head/reports", icon: FileBarChart },
        { label: "Audit", href: "/school-head/audit", icon: ScrollText },
      ];
    case "TEACHER": {
      const hasAral = grades?.some((g) => g.hasAral) ?? false;
      return [
        { label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
        { label: "Learners", href: "/teacher/learners", icon: BookOpen },
        {
          label: "Aral",
          href: "/teacher/aral",
          icon: Sparkles,
          badge: hasAral ? 1 : undefined,
        },
        { label: "Reports", href: "/teacher/reports", icon: FileBarChart },
      ];
    }
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
  fullPrefetch = false,
  collapsed = false,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: () => void;
  fullPrefetch?: boolean;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <PrefetchLink
      href={item.href}
      {...(fullPrefetch ? { prefetch: true as const } : {})}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center rounded-xl text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {isActive && !collapsed && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {item.badge ? (
        collapsed ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet"
          />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet text-[10px] font-medium text-white">
            {item.badge}
          </span>
        )
      ) : null}
    </PrefetchLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({
  role,
  userName,
  schoolName,
  grades,
  isSuperAdminView,
  viewedSchoolName,
  expanded = true,
  transitionsEnabled = true,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = getNavItems(role, grades);
  const activeHref = resolveActiveHref(pathname, navItems);
  const roleLabel = role.toLowerCase().replaceAll("_", " ");
  const collapsed = !expanded;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const homeHref = roleHomePath(role);
  const accountRole = role as AppRole;
  const prefetchHrefs = useMemo(() => getShellWarmHrefs(role), [role]);
  const prefetchKey = `${role}:${prefetchHrefs.join("|")}`;

  const renderSidebarContent = (onNavigate?: () => void, opts?: { collapsed?: boolean }) => {
    const isCollapsed = opts?.collapsed ?? false;

    return (
      <div className="flex h-full flex-col bg-surface">
        <div
          className={cn(
            "flex min-h-[calc(var(--app-chrome-header-height)+1rem)] shrink-0 flex-col justify-center pt-4",
            isCollapsed ? "px-2" : "px-4"
          )}
        >
          <Link
            href={homeHref}
            prefetch={true}
            onClick={onNavigate}
            className={cn(
              "flex items-center font-semibold",
              isCollapsed ? "justify-center" : "gap-3"
            )}
            aria-label="LITRACK home"
          >
            <Image
              src="/logo.png"
              alt="ARAL Program logo"
              width={36}
              height={48}
              className="h-10 w-auto shrink-0"
            />
            {!isCollapsed && (
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-bold tracking-tight text-foreground">LITRACK</span>
                {schoolName && (
                  <span className="max-w-[150px] truncate text-xs text-muted-foreground">
                    {schoolName}
                  </span>
                )}
              </div>
            )}
          </Link>

          {isSuperAdminView && viewedSchoolName && (
            isCollapsed ? (
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-3 h-auto w-full justify-center rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                    aria-label={`Viewing: ${viewedSchoolName}`}
                  >
                    <Shield className="h-3.5 w-3.5 shrink-0" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Viewing: {viewedSchoolName}</TooltipContent>
              </Tooltip>
            ) : (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                <Shield className="h-3 w-3 shrink-0" />
                <span className="truncate">Viewing: {viewedSchoolName}</span>
              </div>
            )
          )}
        </div>

        <ScrollArea className={cn("flex-1 pb-5 pt-2", isCollapsed ? "px-1.5" : "px-3")}>
          {!isCollapsed && (
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              Menu
            </p>
          )}
          <nav aria-label="Primary" className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={item.href === activeHref}
                onNavigate={onNavigate}
                fullPrefetch={item.href === homeHref}
                collapsed={isCollapsed}
              />
            ))}
          </nav>
        </ScrollArea>

        <div className={cn("shrink-0 py-3", isCollapsed ? "px-1.5" : "px-3")}>
          <UserAccountMenu
            role={accountRole}
            userName={userName}
            roleLabel={roleLabel}
            side="top"
            align="start"
            collapsed={isCollapsed}
            className={isCollapsed ? "w-full justify-center" : "w-full justify-start"}
          />
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <NavPrefetcher cacheKey={prefetchKey} hrefs={prefetchHrefs} />

      {/* Desktop — width paired with CONTENT_OFFSET_CLASS in role-shell / app-shell */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border/80 bg-surface lg:flex",
          transitionsEnabled && "transition-[width] duration-200",
          collapsed ? SIDEBAR_WIDTH_CLASS.collapsed : SIDEBAR_WIDTH_CLASS.expanded
        )}
      >
        {renderSidebarContent(undefined, { collapsed })}
      </aside>

      {/* Mobile Sheet — always full labels; collapse is desktop-only */}
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
          {renderSidebarContent(() => setMobileOpen(false), { collapsed: false })}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
