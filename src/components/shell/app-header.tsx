"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { HeaderSearch } from "@/components/shell/header-search";
import {
  NotificationsMenu,
  type ShellNotification,
} from "@/components/shell/notifications-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getNavGroups, resolvePageTitle, type NavGrade } from "@/lib/nav/nav-config";
import type { UserRole } from "@prisma/client";

const SEARCH_HREF: Record<UserRole, string> = {
  SUPER_ADMIN: "/admin/schools",
  SCHOOL_HEAD: "/school-head/teachers",
  TEACHER: "/teacher/learners",
};

const SEARCH_PLACEHOLDER: Record<UserRole, string> = {
  SUPER_ADMIN: "Search schools...",
  SCHOOL_HEAD: "Search teachers...",
  TEACHER: "Search learners...",
};

/**
 * Top bar for role shells. Lives OUTSIDE the content panel (spec R1) so the
 * page below can render independently elevated cards on the workspace ground.
 */
export function AppHeader({
  role,
  grades,
  notifications = [],
  expanded,
  onToggleSidebar,
}: {
  role: UserRole;
  grades?: NavGrade[];
  notifications?: ShellNotification[];
  expanded: boolean;
  onToggleSidebar: () => void;
}) {
  const pathname = usePathname();
  const navGroups = useMemo(() => getNavGroups(role, grades ?? []), [role, grades]);
  const title = resolvePageTitle(pathname, navGroups);

  return (
    <header className="sticky top-0 z-30 h-[var(--app-chrome-header-height)] border-b border-border/80 bg-surface-header">
      <div className="flex h-full w-full items-center gap-3 px-4 lg:gap-4 lg:px-6">
        {/* Mobile: spacer for the floating Sheet trigger. Desktop: collapse toggle. */}
        <div className="w-8 shrink-0 lg:hidden" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden shrink-0 lg:inline-flex"
          onClick={onToggleSidebar}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>

        {/* Chrome label, not the page heading — AppShell's body <h1> is the
            page's single top-level heading (spec a11y: one h1 per view). */}
        <p className="truncate text-base font-semibold tracking-tight text-foreground">
          {title}
        </p>

        <div className="flex-1" />

        <HeaderSearch
          searchHref={SEARCH_HREF[role]}
          placeholder={SEARCH_PLACEHOLDER[role]}
          className="hidden w-full max-w-xs sm:block"
        />

        <NotificationsMenu notifications={notifications} />

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <ThemeToggle />
      </div>
    </header>
  );
}
