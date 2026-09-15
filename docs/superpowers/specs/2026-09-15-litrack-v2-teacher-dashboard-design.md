# LITRACK v2.0.0 — Teacher Dashboard and Shell Redesign

Date: 2026-09-15
Branch / worktree: `feat/litrack-v2` at `.claude/worktrees/litrack-v2`
Status: approved in conversation, awaiting spec review

## Goal

Restyle the teacher dashboard and the shared app shell to match the four
reference images supplied by the owner (female banner, male banner, desktop
dashboard, mobile dashboard). Follow the images' layout and formatting
strictly; deviate only where the image conflicts with data or product rules
already in the system (decisions below). Ship as release `2.0.0`.

## Scope

In scope:
- Teacher dashboard (`/teacher`) — desktop and mobile layouts.
- Shared shell: sidebar, header, mobile top bar. Other pages inherit the new
  look only through shared tokens and shell components.
- Optional teacher gender field that selects the dashboard banner.

Out of scope:
- Restyling other teacher pages (learners, ARAL grids, reports) page by page.
- School Head and Super Admin dashboards.
- Reviving the dormant ARAL Profile.

## Approach

Restyle in place. Update design tokens (`globals.css`, `tailwind.config.ts`)
first, then rework the existing components under
`src/components/dashboard/teacher/` and `src/components/shell/`. No parallel
v2 component tree and no feature flag.

## Decisions on conflicts

| Image shows | Decision |
| --- | --- |
| Female vs male banner | Add nullable `gender Gender?` to `TeacherProfile`, reusing the existing `Gender` enum (`MALE`/`FEMALE`). UI label "Gender". Banner is male when `gender = MALE`, female otherwise (including null). |
| "Learner Profiling" nav item | Not added. ARAL Profile stays dormant (`docs/aral-profile.md`). |
| "Pending Profiles — Without ARAL profile" card | Kept as the existing read-only card (owner exception in `docs/aral-profile.md`, approved 2026-09-14), restyled. No "Manage profiles" link — the exception forbids a call to action, and `tests/unit/aral-profile-dormant.test.ts` enforces it. |
| "+2 this month" / "+3 this month" trend lines | Omitted. Cards keep icon, title, figure, hint, action. |
| "Overdue" task badge | Not used. Existing honest badges ("N pending", "Complete", "Open") restyled to the image's pill look. |
| "Generate Report" quick action | Links to the Reports page; there is no separate generation flow. |
| Calendar card, mountain art, quote | Built: calendar grid and scenery drawn in code, highlighting today; static footer quote. |
| Greeting quote | Chosen at random per page load from a list of about 10 short, attributed quotes. Selected server-side (page is `force-dynamic`), so no hydration mismatch. |
| Sidebar "Stronger Readers" card | Reuses existing `public/brand/sidebar-motto.webp`. |

## Data change

Migration `YYYYMMDDNNNNNN_teacher_profile_gender`:

```sql
ALTER TABLE "TeacherProfile" ADD COLUMN "gender" "Gender";
```

Additive and nullable; no backfill. Authored offline. Applied to the
production Supabase database only after the owner approves the exact SQL in
chat, and before the code that reads it is deployed.

Touch points: `prisma/schema.prisma`, teacher profile Zod validator, teacher
profile action (persist + audit), teacher profile form (Gender select with
labels from `enum-labels.ts`), dashboard data loader (read gender for banner).

## Assets

- `public/brand/banner-teacher-female.png` — image 1 (owner to supply file).
- `public/brand/banner-teacher-male.png` — image 2 (owner to supply file).
Rendered with `next/image`, art anchored right so the greeting text sits on
the soft left side of the banner.

## Layout

### Desktop (reference: image 3, ~1672px wide)

- Sidebar: logo + school name; highlighted pill for active item; groups
  Learners / ARAL Program / Analytics following the current nav config
  (no Learner Profiling); motto card; user card and Sign out at the bottom.
- Header: search field, notification bell, theme toggle, date with calendar
  icon.
- Main grid, two columns (content | right rail ~300px):
  - Hero banner spanning content column: "GOOD EVENING," eyebrow, large
    first name with wave emoji, subtitle, rotating italic quote.
  - Four stat cards: Your Grades, Total Learners, ARAL Learners,
    Pending Profiles (read-only, no action) — each with tinted icon tile, big figure, hint,
    pill action link.
  - Attendance Overview and Reading Level Overview panels side by side, donut
    + legend + tip box + pill action.
  - Learners by Grade Level chart with school-year chip and summary tile;
    Quick Actions 2×2 (Take Attendance, Add Learner, View Reports,
    Generate Report).
  - Right rail: calendar card (scenery, date, month grid, quote) above
    Upcoming Tasks.

### Mobile (reference: image 4, ~390px wide)

- Top bar: hamburger (opens existing sidebar sheet), logo + school, avatar
  with chevron.
- Hero card with greeting, subtitle, date chip, banner art at right.
- Stat cards 2×2 with chevron in title row; action pills hidden (card is the
  link).
- Attendance and Reading panels side by side, compact legend, pill action.
- Upcoming Tasks, then Quick Actions 2×2 with chevrons.
- Calendar card and grade chart hidden on mobile.

### Theme

Light mode matches the images. Dark mode kept by mapping the same tokens.
Violet remains the ARAL accent; the images' violet primary pills are applied
to dashboard actions per the mockup — confirm during implementation that this
does not collide with ARAL-only violet usage elsewhere, and raise it if so.

## Release

`src/lib/releases.ts` entry `2.0.0`, `announce: true`, user-language fixes
list; `package.json` and `package-lock.json` versions set to `2.0.0`. No push
to main without owner instruction; migration applied first.

## Verification

- Visual: Browser pane at 1672×941 and 390×844 against images 3 and 4, for
  female and male teachers, floating teacher (0 grades), and empty data.
- Gates: `npm run typecheck`, `npm run test`, `npm run build`. `npm run lint`
  is known to fail inside `.claude/worktrees/*` for a plugin-root conflict;
  run lint from a non-worktree checkout before merge.
- Unit tests: banner selection by gender, random quote picker returns a
  listed quote, gender validator accepts null/MALE/FEMALE.
