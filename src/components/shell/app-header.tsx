"use client";

import { useMemo } from "react";
import { Menu } from "lucide-react";
import { useNavPath } from "@/components/nav/nav-path";
import { HeaderSearch } from "@/components/shell/header-search";
import {
  NotificationsMenu,
  type ShellNotification,
} from "@/components/shell/notifications-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getNavGroups, resolvePageTitle, type NavGrade } from "@/lib/nav/nav-config";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import type { UserRole } from "@prisma/client";

const SEARCH_HREF: Record<UserRole, string> = {
  SUPER_ADMIN: "/admin/schools",
  SCHOOL_HEAD: SCHOOL_HEAD_ROUTES.teachers,
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
  isAralVolunteer,
  advisoryGradeLevelId,
  expanded,
  onToggleSidebar,
}: {
  role: UserRole;
  grades?: NavGrade[];
  notifications?: ShellNotification[];
  /**
   * Renders the advisory-only `Learners` nav item inert and drops the search box,
   * whose target is that roster; see `NavOptions.isAralVolunteer`.
   */
  isAralVolunteer?: boolean;
  /**
   * Lets the "End of Terms Reports" row match the grade-scoped sheet, so the title
   * reads the item's label instead of the URL segment; see
   * `NavOptions.advisoryGradeLevelId`.
   */
  advisoryGradeLevelId?: string | null;
  expanded: boolean;
  onToggleSidebar: () => void;
}) {
  // The optimistic nav path, not the committed pathname — the same source the
  // sidebar's highlight reads. The two are the only chrome that names the current
  // page, and a rail that jumps to Teachers while this bar still says Dashboard
  // is worse than both of them waiting. See `@/components/nav/nav-path`.
  const { navPath } = useNavPath();
  const navGroups = useMemo(
    () => getNavGroups(role, grades ?? [], { isAralVolunteer, advisoryGradeLevelId }),
    [role, grades, isAralVolunteer, advisoryGradeLevelId]
  );
  const title = resolvePageTitle(navPath, navGroups);

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

        {/* The teacher target is the advisory roster, so a volunteer has nothing
            to search. Hidden rather than pointed at the ARAL roster, which does
            not read `?q=` — a box that silently drops the query is worse than no
            box. The flex-1 spacer above absorbs the width.
            Deliberately not symmetric with the nav, which keeps `Learners` as an
            inert row: a labelled row can carry the reason it is shut, an empty
            input cannot, and typing into one only to be turned away is a worse
            answer than its absence. */}
        {!isAralVolunteer && (
          <HeaderSearch
            searchHref={SEARCH_HREF[role]}
            placeholder={SEARCH_PLACEHOLDER[role]}
            className="hidden w-full max-w-xs sm:block"
          />
        )}

        <NotificationsMenu notifications={notifications} />

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <ThemeToggle />
      </div>
    </header>
  );
}
