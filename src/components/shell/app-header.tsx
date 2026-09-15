"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Menu } from "lucide-react";
import { UserAccountMenu } from "@/components/user-account-menu";
import { roleHomePath, type AppRole } from "@/lib/auth/roles";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";
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

/**
 * What each role can actually match, named honestly. The box searches records
 * and pages now, and a placeholder that says "Search learners" on a field that
 * also finds teachers, sections and pages under-sells it — while one that says
 * "everything" over-sells it, since `globalSearch` scopes results by role.
 */
const SEARCH_PLACEHOLDER: Record<UserRole, string> = {
  SUPER_ADMIN: "Search schools, learners, pages…",
  SCHOOL_HEAD: "Search learners, teachers, pages…",
  TEACHER: "Search your learners and pages…",
};

/**
 * Top bar for role shells. Lives OUTSIDE the content panel (spec R1) so the
 * page below can render independently elevated cards on the workspace ground.
 */
export function AppHeader({
  role,
  userName,
  schoolName,
  roleLabel,
  grades,
  notifications = [],
  isAralVolunteer,
  isFloating,
  advisoryPlacements,
  expanded,
  onToggleSidebar,
}: {
  role: UserRole;
  /** Phone top bar only: avatar initials and account menu (v2). */
  userName?: string;
  /** Phone top bar only: shown under the wordmark (v2). */
  schoolName?: string;
  roleLabel?: string;
  grades?: NavGrade[];
  notifications?: ShellNotification[];
  /**
   * Renders the advisory-only `Learners` nav item inert and drops the search box,
   * whose target is that roster; see `NavOptions.isAralVolunteer`.
   */
  isAralVolunteer?: boolean;
  /**
   * Same treatment as `isAralVolunteer` — inert nav items and a dropped search
   * box — for a DepEd teacher whose `advisoryMode` is FLOATING; see
   * `NavOptions.isFloating`.
   */
  isFloating?: boolean;
  /**
   * Every advisory section this teacher holds. Lets the "End of Terms Reports"
   * row match the grade-scoped sheet it deep-links to, so the title
   * reads the item's label instead of the URL segment; see
   * `NavOptions.advisoryPlacements`.
   */
  advisoryPlacements?: { sectionId: string; gradeLevelId: string }[];
  expanded: boolean;
  onToggleSidebar: () => void;
}) {
  // The optimistic nav path, not the committed pathname — the same source the
  // sidebar's highlight reads. The two are the only chrome that names the current
  // page, and a rail that jumps to Teachers while this bar still says Dashboard
  // is worse than both of them waiting. See `@/components/nav/nav-path`.
  const { navPath } = useNavPath();
  const navGroups = useMemo(
    () =>
      getNavGroups(role, grades ?? [], {
        isAralVolunteer,
        isFloating,
        advisoryPlacements,
      }),
    [role, grades, isAralVolunteer, isFloating, advisoryPlacements]
  );
  const title = resolvePageTitle(navPath, navGroups);

  // The pages the header search can jump to are exactly the rows this role's nav
  // renders — derived from it rather than listed again, so a nav item that is
  // hidden or made inert for a role can never be reachable through search.
  const searchPages = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.items
          // `soon` and `unavailable` are the two inert states, and every other
          // resolver skips them too — a row that cannot be clicked in the rail
          // must not become clickable through search.
          .filter((item) => !item.soon && !item.unavailable)
          .map((item) => ({ label: item.label, href: item.href }))
      ),
    [navGroups]
  );

  // v2: the dashboard opens with its own greeting hero, so the bar carries no
  // page title there (mockup image 3).
  const showTitle = navPath !== roleHomePath(role as AppRole);

  // Today in the school's zone, e.g. "Sunday, September 13, 2026". Rendered on
  // the client, so hydration may differ by a render at midnight — hence
  // suppressHydrationWarning on the element.
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  return (
    <header className="sticky top-0 z-30 h-[var(--app-chrome-header-height)] border-b border-border/80 bg-surface-header">
      <div className="flex h-full w-full items-center gap-3 px-4 lg:gap-4 lg:px-6">
        {/* Mobile: spacer for the floating Sheet trigger. Desktop: collapse toggle. */}
        <div className="w-8 shrink-0 lg:hidden" />

        {/* Phone brand block (mockup image 4): logo, wordmark and school. */}
        <Link
          href={roleHomePath(role)}
          aria-label="LITRACK home"
          className="flex min-w-0 flex-1 items-center justify-center gap-2 lg:hidden"
        >
          <Image src="/logo.png" alt="" width={30} height={40} className="h-9 w-auto shrink-0" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-base font-extrabold tracking-tight text-foreground">LITRACK</span>
            {schoolName ? (
              <span className="truncate text-xs text-muted-foreground">{schoolName}</span>
            ) : null}
          </span>
        </Link>
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
        {showTitle ? (
          <p className="hidden truncate text-base font-semibold tracking-tight text-foreground lg:block">
            {title}
          </p>
        ) : null}

        {/* The teacher target is the advisory roster, so a volunteer — or a
            floating teacher, who has declared they will not advise one — has
            nothing to search. Hidden rather than pointed at the ARAL roster,
            which does not read `?q=` — a box that silently drops the query is
            worse than no box. The flex-1 spacer after it absorbs the width.
            Deliberately not symmetric with the nav, which keeps `Learners` as an
            inert row: a labelled row can carry the reason it is shut, an empty
            input cannot, and typing into one only to be turned away is a worse
            answer than its absence. */}
        {!isAralVolunteer && !isFloating && (
          <HeaderSearch
            searchHref={SEARCH_HREF[role]}
            placeholder={SEARCH_PLACEHOLDER[role]}
            pages={searchPages}
            className="hidden w-full max-w-xl lg:block"
          />
        )}

        <div className="hidden flex-1 lg:block" />
        <div className="hidden lg:contents">
          <NotificationsMenu notifications={notifications} />
          <ThemeToggle />
          <Separator orientation="vertical" className="h-6" />
          <p
            className="hidden items-center gap-2 whitespace-nowrap text-sm font-medium text-foreground xl:flex"
            suppressHydrationWarning
          >
            <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
            {todayLabel}
          </p>
        </div>

        {/* Phone: account avatar in place of the desktop cluster (image 4). */}
        {userName ? (
          <UserAccountMenu
            role={role as AppRole}
            userName={userName}
            roleLabel={roleLabel ?? role.toLowerCase().replaceAll("_", " ")}
            variant="avatar"
            className="lg:hidden"
          />
        ) : (
          <div className="w-8 shrink-0 lg:hidden" />
        )}
      </div>
    </header>
  );
}
