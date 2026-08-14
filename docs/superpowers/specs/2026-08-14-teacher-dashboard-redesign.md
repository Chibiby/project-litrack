# Teacher Dashboard & Shell Redesign — Spec

**Source of truth:** `C:\Users\PC5\Downloads\2bad42ee-96fd-4f29-9f05-84cc3bedfc0c.jpg` (design mock, teacher role).

**Scope:** Presentational restructure of the teacher shell (sidebar + header) and the teacher
dashboard page, plus two new read-only dashboard aggregates. No schema changes, no new
Prisma models, no migrations.

---

## R1 — Shell layout: header outside the child panel

Today `RoleShell` (`src/components/role-shell.tsx`) wraps header **and** page content in a single
rounded `bg-surface` panel inset by `lg:p-4`. The mock instead shows:

- A full-bleed header bar across the top of the content column, `bg-surface`, bottom border only,
  no rounded corners, no outer inset.
- Below it, the page content sits directly on `--background` (pale blue-gray) with each panel a
  separate white card. Panels are separated by visible background gutters.

**Required:** the header becomes a sibling *above* the content region, not a child of the content
panel. Page content renders on `bg-background` with `p-6` outer padding and `gap-5` between panels.

Header height increases from `3rem` to `4rem` (`--app-chrome-header-height`).

## R2 — Header contents

Left → right, single row:
1. Sidebar toggle (hamburger) — desktop collapse toggle; mobile spacer for the existing Sheet trigger.
2. Page title (e.g. "Dashboard") — plain text, `text-base font-semibold`, derived from the active nav item.
3. Flexible spacer.
4. Search input — rounded pill, muted background, magnifier icon, right-aligned `⌘K` kbd hint,
   placeholder "Search learners…". Submitting navigates to the role's learners list with `?q=`.
   `⌘K` / `Ctrl+K` focuses it; `Escape` blurs.
5. Notification bell — icon button with a count badge (violet) at the top-right when count > 0.
   Opens a popover listing derived, actionable items. No new persistence layer.
6. Vertical separator.
7. Theme toggle (existing `ThemeToggle`) — light/dark switch, upper right.

Breadcrumbs move out of the header (the title replaces them).

## R3 — Sidebar structure

Match the mock:

- **Brand header:** logo, "LITRACK" bold, school name beneath in muted small text. Same block as today;
  height must match the new 4rem header so the brand baseline lines up with the header title.
- **Grouped nav with section labels.** Teacher role gets two groups:
  - `MENU` — Dashboard, Learners
  - `ARAL PROGRAM` — Weekly Attendance, Monthly Reading Level, End of Terms Reports
  - then an ungrouped trailing item — Reports
- Active item: violet text + violet-tinted pill background (mock shows no left accent bar — remove it).
- **Footer:** the existing user account card (avatar, name, role, chevron), then a separate
  **Log out** row beneath it with a `LogOut` icon.
- Collapsed (icon-rail) desktop mode must keep working: group labels hide, tooltips show labels.

ARAL Program links are grade-scoped in this app (`/teacher/aral/[gradeId]/…`). When the teacher has
exactly one ARAL grade, link directly to that grade's page; otherwise link to `/teacher/aral` (the
grade picker). "End of Terms Reports" links to `/teacher/reports`.

## R4 — Dashboard: greeting row

- `Good morning, {firstName}! 👋` — time-of-day aware (morning < 12, afternoon < 18, else evening),
  `text-2xl font-bold`.
- Sub-line: "Here's what's happening with your class today."
- Right side: a date chip showing today's date (`Thursday, May 13, 2026` format), calendar icon,
  bordered pill. Display-only.

## R5 — Dashboard: four stat cards

One row, `lg:grid-cols-4`. Each card: soft tinted square icon chip, title, big number, one-line
caption, and a footer link with a `→` arrow in the card's accent color.

| Card | Value | Caption | Link |
|---|---|---|---|
| Your Grades (violet, GraduationCap) | assigned grade count | "Assigned grade" / "Assigned grades" | View grade details → `/teacher/learners` |
| Total Learners (amber, Users) | total learners | "All learners" | View all learners → `/teacher/learners` |
| ARAL Learners (green, Sparkles) | ARAL learners | "With ARAL profiles" | View ARAL learners → `/teacher/aral` |
| Pending Profiles (blue, UserRoundSearch) | pending ARAL profiling | "Without ARAL profile" | Manage profiles → `/teacher/aral` |

All four values already exist in `getTeacherMetricCounts`.

## R6 — Dashboard: two overview panels

Side-by-side (`lg:grid-cols-2`), each a white card with a title where the parenthetical
qualifier is muted, and a muted icon in the top-right.

**Attendance Overview (This Week)** — total attendance marks as a big number, a right-aligned
tinted stat chip with the present-rate percentage, a segmented horizontal bar, a legend row of
`● Label N (P%)`, and a footer link "View weekly attendance →".

Segments/legend, in order: Present (green), Absent (amber), Late (orange), Excused (red),
No Class (gray). The mock omits Late because its sample data had none; the schema
(`AttendanceStatus`) has it, so it is included rather than silently folded into another bucket.
"No Class" = the remainder of expected marks (ARAL learners × school days elapsed this week)
not covered by any record.

**Reading Level Overview (This Month)** — records submitted as the big number, a violet stat chip
with completion rate, segmented bar, legend: Completed (green), Pending (amber), Not Assessed (gray),
footer link "Go to Monthly Reading Level →".

## R7 — Dashboard: chart + right rail

Two-column row, `lg:grid-cols-3` with the chart spanning 2 columns:

- **Learners by Grade Level** card — violet heading, "Distribution of your learners" subtitle,
  a disabled-looking "This School Year" select on the right, and the existing
  `DashboardBarChart` recolored to the new violet accent with value labels above each bar.
- **Upcoming Tasks** card — icon + title, then rows of task name / due sub-line / right-aligned
  status badge. Tasks are derived, not stored: "Complete Monthly Reading Level" (badge = N pending),
  "Submit Weekly Attendance" (badge = days left until Sunday), "End of Terms Reports"
  (badge = "Locked"). Footer link "View all tasks →" → `/teacher/reports`.
- **Quick Actions** card — icon + title, then three equal buttons: Weekly Attendance,
  Monthly Reading Level, Reports.

## R8 — Dashboard: info banner

Full-width violet-tinted rounded panel at the bottom with two columns and a dismiss `×`:

- Shield icon + "Automatic Data Lock" + "Attendance records are locked weekly. Reading level records are locked monthly."
- Lightbulb icon + "Reminder" + "Make sure to complete your assessments before the deadline to keep data accurate."

Dismissal persists per-user in `localStorage`.

## R9 — Color palette: revised purple accent

The mock's purple is a blue-leaning violet (~`#6D4AE0`), lighter and less magenta than the current
`hsl(262 83% 58%)`. Retune the `violet` scale to hue **255** and expose theme-aware tokens so violet
surfaces invert correctly in dark mode:

- `--violet` — the accent itself
- `--violet-foreground` — text on the accent
- `--violet-soft` — tinted surface (light: near-white violet; dark: deep violet)
- `--violet-soft-foreground` — text on the tinted surface

Existing numbered `violet-*` utilities keep working (retuned to hue 255) so current ARAL UI does not
break. Violet remains reserved for ARAL per project convention; blue primary and amber secondary
are unchanged.

## R10 — Constraints

- shadcn/ui primitives only for new interactive UI (Button, Input, Card, Badge, Popover, Select,
  Separator, Tooltip). New primitives go in `src/components/ui/` matching existing file style.
- No new npm dependencies. Everything needed is already installed.
- The shell restructure applies to **all three roles** (RoleShell is shared); the grouped nav and
  dashboard redesign are teacher-only in this pass. Admin and School Head sidebars keep a single
  unlabeled group and must not regress.
- Teacher dashboard stays `force-dynamic` with `Suspense` streaming per section.
- Super Admin impersonation of teacher pages must keep working.
- Accessibility: every icon-only control keeps an `aria-label`; the notification count is announced;
  the segmented bars carry `role="img"` with a text `aria-label` summary.
