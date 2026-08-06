"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { logoutAction } from "@/lib/actions/auth";
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
        { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
        { label: "Teachers", href: "/school-head/teachers", icon: Users },
        { label: "Profile", href: "/admin/profile", icon: UserCircle },
      ];
    case "SCHOOL_HEAD":
      return [
        { label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
        { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
        { label: "Teachers", href: "/school-head/teachers", icon: Users },
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
      items.push({ label: "Profile", href: "/teacher/profiling", icon: UserCircle });
      return items;
    default:
      return [];
  }
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
          {item.badge}
        </span>
      )}
      {isActive && <ChevronRight className="h-4 w-4 opacity-50" />}
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

  const SidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image
            src="/logo.png"
            alt="ARAL Program logo"
            width={36}
            height={48}
            className="h-10 w-auto shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm leading-none">LITRACK</span>
            {schoolName && (
              <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                {schoolName}
              </span>
            )}
          </div>
        </Link>
        
        {/* Super Admin View Indicator */}
        {isSuperAdminView && viewedSchoolName && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700 border border-amber-200">
            <Shield className="h-3 w-3" />
            <span className="truncate">Viewing: {viewedSchoolName}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-medium truncate">{userName}</span>
            <span className="text-xs text-muted-foreground capitalize">{role.toLowerCase().replace("_", " ")}</span>
          </div>
        </div>
        <form action={logoutAction}>
          <Button variant="ghost" size="sm" className="w-full justify-start" type="submit">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r">
        {SidebarContent}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden absolute left-4 top-4 z-50"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          {SidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
