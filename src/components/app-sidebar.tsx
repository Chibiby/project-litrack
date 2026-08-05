"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { logoutAction } from "@/lib/actions/auth";
import { isNavItemActive } from "@/lib/nav-active";
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
  LogOut,
  ChevronRight,
  Shield,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  /** When true, only pathname === href is active (dashboard roots). */
  exact?: boolean;
}

interface AppSidebarProps {
  role: UserRole;
  userName: string;
  schoolName?: string;
  grades?: { id: string; label: string; hasAral?: boolean }[];
  isSuperAdminView?: boolean;
  viewedSchoolName?: string;
  /** Appended as ?schoolId= for school-head links when Super Admin is in a school context. */
  schoolIdQuery?: string;
}

function withSchoolId(href: string, schoolId?: string): string {
  if (!schoolId) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}schoolId=${encodeURIComponent(schoolId)}`;
}

function getNavItems(
  role: UserRole,
  grades: AppSidebarProps["grades"] = [],
  schoolIdQuery?: string
): NavItem[] {
  switch (role) {
    case "SUPER_ADMIN":
      return [
        { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
        { label: "Schools", href: "/admin/schools", icon: School },
        ...(schoolIdQuery
          ? [
              {
                label: "Grade Levels",
                href: withSchoolId("/school-head/grade-levels", schoolIdQuery),
                icon: GraduationCap,
              },
              {
                label: "Teachers",
                href: withSchoolId("/school-head/teachers", schoolIdQuery),
                icon: Users,
              },
            ]
          : []),
      ];
    case "SCHOOL_HEAD":
      return [
        { label: "Dashboard", href: "/school-head", icon: LayoutDashboard, exact: true },
        { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
        { label: "Teachers", href: "/school-head/teachers", icon: Users },
        { label: "Profile", href: "/school-head/profiling", icon: UserCircle },
      ];
    case "TEACHER": {
      const items: NavItem[] = [
        { label: "Dashboard", href: "/teacher", icon: LayoutDashboard, exact: true },
      ];
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
      items.push({ label: "Profile", href: "/teacher/profiling", icon: UserCircle });
      return items;
    }
    default:
      return [];
  }
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4", isActive && "text-primary")} aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        <Badge variant={isActive ? "outline" : "amber"} className="h-5 px-1.5 text-[10px]">
          ARAL
        </Badge>
      ) : null}
      {isActive ? <ChevronRight className="h-4 w-4 opacity-50" aria-hidden="true" /> : null}
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
  schoolIdQuery,
}: AppSidebarProps) {
  const pathname = usePathname();
  const navItems = getNavItems(role, grades, schoolIdQuery);

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <School className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm leading-none">LITRACK</span>
            {schoolName && (
              <span className="max-w-[140px] truncate text-xs text-muted-foreground">
                {schoolName}
              </span>
            )}
          </div>
        </Link>

        {isSuperAdminView && viewedSchoolName && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-amber-muted px-2 py-1.5 text-xs text-amber-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            <span className="truncate">Viewing: {viewedSchoolName}</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav aria-label="Primary" className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              isActive={isNavItemActive(pathname, navItems, item)}
            />
          ))}
        </nav>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <UserCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-medium">{userName}</span>
            <span className="text-xs capitalize text-muted-foreground">
              {role.toLowerCase().replace("_", " ")}
            </span>
          </div>
        </div>
        <form action={logoutAction}>
          <Button variant="ghost" size="sm" className="w-full justify-start" type="submit">
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-border bg-card lg:flex">
        {SidebarContent}
      </aside>

      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 z-50 lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-card p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {SidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
