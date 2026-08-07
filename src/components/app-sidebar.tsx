"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { SignOutButton } from "@/components/sign-out-button";
import { getShellNestedWarmHrefs } from "@/lib/nav/warm-hrefs";
import { logoutAction } from "@/lib/actions/auth";
import { roleHomePath, rolePasswordPath } from "@/lib/auth/roles";
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
  KeyRound,
  Shield,
  CalendarRange,
  Layers,
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
        { label: "Profile", href: "/admin/profile", icon: UserCircle },
      ];
    case "SCHOOL_HEAD":
      return [
        { label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
        { label: "School years", href: "/school-head/school-years", icon: CalendarRange },
        { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
        { label: "Sections", href: "/school-head/sections", icon: Layers },
        { label: "Teachers", href: "/school-head/teachers", icon: Users },
        { label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
        { label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
        { label: "School info", href: "/school-head/school-info", icon: Building2 },
        { label: "Reports", href: "/school-head/reports", icon: FileBarChart },
        { label: "Audit", href: "/school-head/audit", icon: ScrollText },
        { label: "Profile", href: "/school-head/profiling", icon: UserCircle },
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
      items.push({ label: "Profile", href: "/teacher/profiling", icon: UserCircle });
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

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      // force-dynamic + loading.tsx: default prefetch only warms the skeleton.
      // Full prefetch loads the RSC payload (auth + cachedQuery) before click.
      prefetch={true}
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
  const navItems = getNavItems(role, grades);
  const activeHref = resolveActiveHref(pathname, navItems);

  // Background-warm sidebar + shell-discoverable nested routes once per shell
  // (not on each page nav). Grade/ARAL learner nests warm from parent pages.
  const gradesKey =
    grades?.map((g) => `${g.id}:${g.hasAral ? 1 : 0}`).join(",") ?? "";
  const prefetchHrefs = useMemo(() => {
    const sidebarHrefs = getNavItems(role, grades).map((item) => item.href);
    const nestedHrefs = getShellNestedWarmHrefs(role, grades);
    return [...sidebarHrefs, ...nestedHrefs];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gradesKey fingerprints grades
  }, [role, gradesKey]);
  const prefetchKey = `${role}:${prefetchHrefs.join("|")}`;

  const SidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Brand */}
      <div className="border-b border-border/80 px-4 py-5">
        <Link
          href={roleHomePath(role)}
          prefetch={true}
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
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              isActive={item.href === activeHref}
            />
          ))}
        </div>
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
            <Link href={rolePasswordPath(role)} prefetch={true}>
              <KeyRound className="mr-2 h-4 w-4" />
              Change password
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
        {SidebarContent}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 z-50 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 border-r p-0">
          {SidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
