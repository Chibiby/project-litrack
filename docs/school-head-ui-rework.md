# School Head UI rework — implementation spec

Status: **approved scope, not started.** Supersedes `docs/school-head-frame-contract.md`
for presentation concerns; every *hard constraint* in that file still binds (no
behaviour changes, no dropped `where` clauses, no new dependency,
`SCHOOL_HEAD_ROUTES` for every path, `schoolHeadHref` for every Super-Admin-aware
link).

## 0a. Operator decisions (binding — these amend the sections below)

Answered by the project owner after this spec was written. Where a decision
below contradicts a later section, **the decision wins** and the later section is
stale.

1. **Hero reach.** Audit (page 16), Term Subjects (page 13) and Reports (page 14)
   do **not** get a hero. They keep a compact title block, following the teacher
   side's own precedent at `/teacher/reports`. Their per-page rows in section 2
   are amended accordingly; every other page in the table is unchanged. The
   controls those pages were to move into `topRight` stay in `actions` instead.
2. **Art.** School Heads reuse the teacher character art through
   `teacherBannerSrc`. No new asset, no rename.
3. **The stale pending count is fixed, not worked around.**
   `revalidateSchoolHeadTeachers` now busts the school dashboard tag, so
   `getSchoolHeadOverview` does not need the uncached pending-count read that
   section 3.1 proposes. That workaround is withdrawn.
4. **Extra controls approved**, beyond the reorganisation itself:
   - Audit gains a name/action search and a date range, server-side and
     tenancy-scoped. **No CSV export** — an audit export is a PII surface
     governed by `docs/privacy.md` and needs its own decision.
   - The missing empty states and loading boundaries are added
     (Teachers > Inactive, `/school-head/ip-learners`), and every zero-row empty
     state carries a CTA linking to the action that resolves it.
   - The dashboard gains the quick-action and attention panels.
   - The dashboard gains a school-wide weekly attendance donut. Its aggregate is
     new work in `src/lib/dashboard/aggregates.ts`, returning raw counts and the
     denominator so the UI stays honest at a zero denominator.
   - The Teachers > Pending count appears as a sidebar badge.
   - The attention panel sorts by severity: no active school year outranks
     adviserless sections, which outrank pending approvals.
   - Every dashboard stat card is a link, not a dead number.
5. **Open questions 4 and 5** in section 7 are resolved: question 4 is decision 3
   above; question 5 (hoisting the person-art placement strings into
   `page-hero.tsx`) stays deferred, because it would edit teacher components this
   task must not touch.

## 0. The problem

A School Head opens LITRACK and lands on a different product than a teacher does.

The teacher side was rebuilt to the owner's v2 mockups: a banner that greets the
person by name over character art, four figures they can act on, two donut
panels, a calendar and a task rail, and only then the charts. Every teacher page
opens with the same banded hero, the same card rhythm, the same skeleton
geometry.

The School Head side is still the v1 layout: a plain h1 and a paragraph, six
flat `MetricCard`s, then four Recharts panels stacked down the page, then a
`Card`-based activity rail. Nothing on that page says "here is what needs you
today" — the one thing a head actually opens the app to find out. The setup
nudges are a wrapped row of outline buttons inside an amber callout; the pending
teacher queue, the only genuinely blocking decision a head owns, is not on the
dashboard at all.

The same gap runs through the other nineteen pages: no hero, no stat strip, a
`MetricCard`/`ChartCard` vocabulary the teacher side no longer uses, and
skeletons that draw a header the frame is already drawing.

Three consequences this spec fixes:

1. A head who also teaches (common in small DepEd schools) sees two visual
   languages in one login.
2. The head's own hero cannot show the male/female character art the teacher's
   does, because `SchoolHeadProfile` never collected a gender.
3. Four of the head's most important facts — pending teacher approvals,
   adviserless sections, incomplete setup, no active school year — are scattered
   across a callout, a second callout, and a page the head has to remember to
   visit.

## 1. Design contract

Every `/school-head` page after this rework is assembled from the pieces below.
Nothing else. If a page needs a shape not on this list, that is a spec bug —
report it rather than inventing a seventh card style.

### 1.1 The frame stays

`src/components/school-head/school-head-page.tsx` remains the frame for every
live page: it owns the `main id="main-content"` landmark, the Super Admin
drill-down badge, the `callout` slot, the `TabNav`, and the content rhythm. It
gains exactly one prop and one internal move (section 1.3). It is **not** replaced.

### 1.2 The hero primitive

Every hero goes through `PageHero` (`src/components/shell/page-hero.tsx`). No
page composes its own banner section. Read the geometry comment at the top of
that file before touching `artClassName`, `phoneMaskClassName` or
`headClassName` — the 108.83% / 8.83% / 136.04% numbers are derived from the
2172x579 art, not tuned by eye.

Two art families exist in `public/brand/`, and only two:

| Family | Files | Means |
| --- | --- | --- |
| **Person** | `/brand/banner-teacher-male.webp`, `/brand/banner-teacher-female.webp` | "This page is about *you*." |
| **Learner** | `/brand/banner-learner.webp` | "This page is about the school's work." |

Rule, one line, no exception list: **the dashboard, Settings, and the profiling
wizard use person art; every other School Head page uses learner art.**

Person art is selected by `teacherBannerSrc(gender)`
(`src/lib/dashboard/banner.ts`), called unchanged. `MALE` gives male art; anything
else including `null`/`undefined` gives female art. That function already
documents itself as "Dashboard hero art" and the two files are literally the same
assets the head would get; a second function would be a second place to change
when the art moves.

> **Rejected:** rename `teacherBannerSrc` to `staffBannerSrc`. Correct name, but
> it edits three `/teacher` page files (`(dashboard)/page.tsx`,
> `settings/profile/page.tsx`, `settings/security/page.tsx`), which this rework
> is explicitly forbidden to touch. Add a one-line doc comment to
> `banner.ts` saying School Heads share the art, and move on.

### 1.3 SchoolHeadPage — the two changes

**(a) New prop `hero?: React.ReactNode`.** When present, the frame renders it in
place of the default title block. `title` is still required (it is the page's
accessible name in code review, and the fallback for any caller that omits
`hero`); `description` and `actions` are ignored when `hero` is set, because the
hero carries them.

**(b) The Super Admin badge moves out of the title block into its own row.**

Today the badge lives *inside* the `!hideTitle` branch. That is why
`/school-head/terms-reports/kinder` — the one page that already has a hero and
passes `hideTitle` — silently drops its "Super Admin view / school name /
read-only" caption. Move it to a row of its own, rendered unconditionally
whenever `view.isSuperAdminView`, between the hero (or title block) and
`callout`:

```tsx
// src/components/school-head/school-head-page.tsx
export function SuperAdminViewBadge(props: {
  view: SchoolHeadView;
  caption?: string;
}): JSX.Element
```

Exported so it has exactly one definition, but **only `SchoolHeadPage` calls
it.** No hero renders its own badge. This is the single enforcement point for
"a Super Admin always knows whose school they are looking at, and whether they
may write."

`superAdminCaption` keeps its current contract verbatim: default `"read-only"`,
overridden only by `/school-head/term-subjects` with
`"editable — every change is audited"`. Wave 4 must not lose that string.

`hideTitle` stays in the props for one wave and is deleted in Wave 4 T4.11 once
the Kinder page moves to the `hero` prop.

### 1.4 The School Head hero

New: `src/components/school-head/school-head-hero.tsx`, exporting
`SchoolHeadHero`.

```tsx
export function SchoolHeadHero(props: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  subtitle: string;
  /** Optional third line, e.g. "SY 2025-2026 · 7 grade levels". */
  meta?: string;
  /** Person art for the three personal pages; defaults to learner art. */
  bannerSrc?: string;
  /** Floated top-right over the art — page actions, pickers. */
  topRight?: React.ReactNode;
  /** Two or three compact StatCards inside the band, as KinderChecklistHero does. */
  stats?: React.ReactNode;
}): JSX.Element
```

It is a thin wrapper over `PageHero`, exactly the relationship `AralPageHero`,
`TermsReportHero` and `KinderChecklistHero` already have to it, and it copies
their proven art placement verbatim:

```
artClassName        max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]
phoneMaskClassName  max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]
headClassName       max-lg:hidden
contentClassName    justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8
```

Text column caps match `AralPageHero` (`max-w-[60%] sm:max-w-[55%]
lg:max-w-[46%]`) so the title never runs under the handwriting in the art.

> **Why not reuse `AralPageHero`?** It has no slot for `topRight`, `stats`, or a
> third meta line, and it is owned by the teacher ARAL surface, where violet is
> the reserved accent. Adding three optional props to it would make an ARAL
> component branch for a role that has nothing to do with ARAL. Two thin
> wrappers over one documented primitive is the cheaper shape.

> **Why not put the tab bar inside the hero, as `TermsReportHero` does with its
> three term tabs?** The Teachers workspace has five tabs, each carrying a count
> badge. `TermsReportHero` caps its tab nav at `max-w-[36rem]`; five counted tabs
> exceed that and would collide with the art at the `lg:max-w-[46%]` text column.
> Tabs stay in the frame, under the hero, rendered by `TabNav` unchanged.

### 1.5 Card and section rhythm

| Need | Use | Source |
| --- | --- | --- |
| A figure with an action | `StatCard` | `src/components/dashboard/teacher/stat-cards.tsx` |
| A row of 2 to 4 figures | `StatCardRow` | same file |
| A row of 5 to 6 figures | `SchoolHeadStatRow` (new) | `src/components/dashboard/school-head/stat-row.tsx` |
| Any panel / card chrome | `Surface` / `SurfaceHeader` / `SurfaceBody` | `src/components/ui/surface.tsx` |
| A banner notice | `Callout` (`info`, `warning`, `aral`) | `src/components/ui/callout.tsx` |
| Empty list / no data | `EmptyState` | `src/components/dashboard/empty-state.tsx` |
| A Recharts panel | `ChartCard` plus `src/components/dashboard/lazy-charts.tsx` | unchanged |
| Tabular data | the `Table` family, inside an `overflow-x-auto` div | `src/components/ui/table.tsx` |

`MetricCard` (`src/components/dashboard/metric-card.tsx`) is **retired from
`/school-head`** by this rework. Do not delete the file — `/admin` still uses it
(`src/components/dashboard/admin-dashboard-sections.tsx`), and `/admin` is out of
scope.

Importing `StatCard` and `CalendarCard` from `@/components/dashboard/teacher/`
into School Head files is correct and has precedent:
`src/components/terms/kinder-checklist-hero.tsx` already imports `StatCard` from
that path. Do not move those files.

> **Rejected:** promote `stat-cards.tsx` and `calendar-card.tsx` to
> `src/components/dashboard/`. Better name, zero behavioural gain, and it rewrites
> imports in six teacher files plus the assertion target in
> `tests/components/route-loading-shape.test.tsx`. Not worth the blast radius in
> a presentation rework.

Section gaps: `SchoolHeadPage`'s default `contentClassName` is `space-y-6`.
The dashboard replaces it with `flex flex-col gap-4` to match the teacher
dashboard's tighter rhythm (the teacher body is `gap-4`, and the stat row
deliberately rises into the hero with `lg:-mt-16`). Every other page keeps
`space-y-6`.

### 1.6 Empty states

One pattern, already in use: `EmptyState` with `title`, `description`, an
`icon`, and — where there is somewhere useful to go — `actionHref` plus
`actionLabel`. Two rules this rework adds:

- **Never render an empty panel.** A tab or panel with zero rows renders
  `EmptyState` inside a `Surface`, never nothing. `/school-head/teachers/declined`
  and `/school-head/teachers/removed` already do this correctly; copy their shape.
- **`actionHref` goes through `schoolHeadHref(view, path)`** whenever the page has
  a `view`, so a Super Admin's drill-down survives the click. Today's dashboard
  activity rail uses a local `schoolPath()` helper for this; that helper is
  deleted in Wave 2 in favour of `schoolHeadHref`, which already handles a path
  that carries a query string or a hash.

### 1.7 Skeletons

Two rules, both already enforced by
`tests/components/route-loading-shape.test.tsx`:

1. A route's `loading.tsx` draws the same geometry as that page's first paint.
2. A boundary that covers several routes draws nothing route-shaped.

`src/components/school-head/page-skeleton.tsx` (`SchoolHeadPageSkeleton`) gains
one prop:

```tsx
export function SchoolHeadPageSkeleton(props: {
  tabs?: number;
  /** Draws a banded hero block instead of the title + description pair. */
  hero?: boolean;
  children?: React.ReactNode;
})
```

`hero` renders a single `Skeleton` with
`mt-2 h-60 w-full rounded-2xl lg:h-[19rem]` — the same block
`TeacherDashboardSkeleton` uses for its hero — instead of the title and
description skeleton pair. Every page-level `loading.tsx` under
`src/app/school-head/(app)/` passes `hero` once its page gains one.

The dashboard gets its own full-geometry skeleton,
`src/components/dashboard/school-head/dashboard-skeleton.tsx`, mirroring
`TeacherDashboardSkeleton` (section 3.7).

### 1.8 What is genuinely new

| New file | Why an existing component cannot serve |
| --- | --- |
| `src/components/school-head/school-head-hero.tsx` | Section 1.4 — no existing hero has `topRight` plus `stats` plus `meta`, and adding them to `AralPageHero` makes an ARAL component branch for a non-ARAL role. |
| `src/components/dashboard/school-head/stat-row.tsx` | `StatCardRow` is hard-coded `grid-cols-2 xl:grid-cols-4`. The head has six headline figures. Adding a `columns` prop puts a role-shaped branch in a component eight teacher call sites depend on; a three-line sibling is cheaper. |
| `src/components/dashboard/school-head/greeting-hero.tsx` | The teacher greeting hero hard-codes "Here's what's happening with your class today." and takes no meta chip. Copied, not shared — see section 3.3 for the branch count sharing would cost. |
| `src/components/dashboard/school-head/overview-panels.tsx` | The teacher panels take a `TeacherOverview` and are shaped around attendance statuses and reading completion. The head's two panels are coverage ratios over a different type. |
| `src/components/dashboard/school-head/attention-panel.tsx` | `UpcomingTasksPanel` renders a `DashboardTask[]` whose semantics are program cadence ("due Friday"). The head's list is state, not cadence ("3 waiting on you"). Same visual shape, different type, different copy. |
| `src/lib/dashboard/school-head-overview.ts` | A composer, not a query. See section 3.1. |
| `src/components/dashboard/school-head/dashboard-skeleton.tsx` | Must mirror the new dashboard geometry exactly, per rule 1 in section 1.7. |
| `src/components/dashboard/school-head/hrefs.ts` | Deep links that must carry `?schoolId=`; mirrors `src/components/dashboard/teacher/hrefs.ts`. |
| `src/components/settings/school-head-settings-shell.tsx` | `SettingsShell` is a plain title plus text sidebar **shared with `/admin`**; giving it a hero would change the admin Settings pages, which are out of scope. |

## 2. Per-page table

Twenty live pages. The six redirect stubs
(`src/app/school-head/(app)/grade-levels|school-info|school-years|sections|password|profile/page.tsx`),
the `school/grade-levels` alias, the `settings` index redirect,
`[...missing]/page.tsx`, `error.tsx` and `not-found.tsx` are **out of scope and
untouched.**

Owner legend: **FE** = `frontend-developer`, **BE** = `backend-developer`,
**DB** = `database-engineer`, **QA** = `qa-test-engineer`.

| # | Route | Current | Target | Owner | Files |
| --- | --- | --- | --- | --- | --- |
| 1 | `/school-head` | title block, six `MetricCard`s, four chart panels, `Card` activity rail, two header buttons | Full restructure per section 3: greeting hero (person art), six `StatCard`s, two coverage panels beside a calendar/attention rail, quick actions, then the charts | FE + BE | `src/app/school-head/(app)/page.tsx`, `src/app/school-head/(app)/loading.tsx`, `src/components/dashboard/school-head/*` (new), `src/components/dashboard/school-head-dashboard-sections.tsx`, `src/lib/dashboard/school-head-overview.ts` (new) |
| 2 | `/school-head/school` (Grade levels) | title, `SCHOOL_WORKSPACE_TABS`, `GradeLevelsClient` grid | `SchoolHeadHero` (learner art, eyebrow "School", icon `School`, stats: active grades / sections / active SY) above the unchanged tab bar | FE | `src/app/school-head/(app)/school/page.tsx`, `src/app/school-head/(app)/school/loading.tsx` |
| 3 | `/school-head/school/years` | title, tabs, two `Surface` panels, `CreateSchoolYearDialog` in `actions` | Same hero; `CreateSchoolYearDialog` moves to `topRight`; the long "Correcting a school year" prose panel becomes a collapsed disclosure so it stops dominating the page | FE | `src/app/school-head/(app)/school/years/page.tsx` |
| 4 | `/school-head/school/info` | title, tabs, one `Surface` at `max-w-2xl` | Same hero; both branches of the Super Admin / edit fork untouched | FE | `src/app/school-head/(app)/school/info/page.tsx` |
| 5 | `/school-head/teachers` (Active) | title, five tabs, three-way `Callout`, `TeachersActiveTable` | `SchoolHeadHero` (learner art, eyebrow "Staff", icon `Users`); the three advisory-capacity callouts stay exactly as they are — they are the tab's content, not chrome | FE | `src/app/school-head/(app)/teachers/page.tsx`, `src/app/school-head/(app)/teachers/loading.tsx` |
| 6 | `/school-head/teachers/pending` | title, tabs, explanatory paragraph, table | Same hero; the bare paragraph becomes `Callout variant="info"` | FE | `src/app/school-head/(app)/teachers/pending/page.tsx` |
| 7 | `/school-head/teachers/inactive` | title, tabs, table, **no empty state** | Same hero; add the missing `Surface` plus `EmptyState` for zero rows (section 1.6) | FE | `src/app/school-head/(app)/teachers/inactive/page.tsx` |
| 8 | `/school-head/teachers/declined` | title, tabs, table, `EmptyState` | Same hero; body unchanged | FE | `src/app/school-head/(app)/teachers/declined/page.tsx` |
| 9 | `/school-head/teachers/removed` | title, tabs, table, `EmptyState` | Same hero; body unchanged | FE | `src/app/school-head/(app)/teachers/removed/page.tsx` |
| 10 | `/school-head/aral` | title, `Callout variant="aral"`, `AralTeacherTable` | `SchoolHeadHero` (learner art, eyebrow "ARAL Program", icon `Sparkles`) with stats: ARAL learners / with a tutor / awaiting a tutor. The `aral` callout stays. Needs one new page-local count (T3.1) | FE + BE | `src/app/school-head/(app)/aral/page.tsx`, `src/app/school-head/(app)/aral/loading.tsx` |
| 11 | `/school-head/transfer` | title, `Callout`, one `Surface` at `max-w-xl` | `SchoolHeadHero` (learner art, icon `ArrowRightLeft`); form panel widened to `max-w-2xl` to line up with the hero's text column | FE | `src/app/school-head/(app)/transfer/page.tsx`, `src/app/school-head/(app)/transfer/loading.tsx` |
| 12 | `/school-head/announcements` | title, two-column grid of `Surface`s | `SchoolHeadHero` (learner art, icon `Megaphone`); the `contentClassName` grid override is preserved | FE | `src/app/school-head/(app)/announcements/page.tsx`, `src/app/school-head/(app)/announcements/loading.tsx` |
| 13 | `/school-head/term-subjects` | title, `superAdminCaption` override, grade picker, manager | `SchoolHeadHero` (learner art, icon `ListOrdered`); `ResetTermSubjectsButton` moves to `topRight`. **The `superAdminCaption` override must survive** (risk R2) | FE | `src/app/school-head/(app)/term-subjects/page.tsx`, `src/app/school-head/(app)/term-subjects/loading.tsx` |
| 14 | `/school-head/reports` | title, `ReportSettingsButton` in `actions`, `ReportsHub` | `SchoolHeadHero` (learner art, icon `FileBarChart`); button moves to `topRight`; `ReportsHub` untouched | FE | `src/app/school-head/(app)/reports/page.tsx`, `src/app/school-head/(app)/reports/loading.tsx` |
| 15 | `/school-head/terms-reports/kinder` | `hideTitle` plus `KinderChecklistHero` — already v2, but **loses the Super Admin badge** | Keep `KinderChecklistHero` verbatim; pass it through the new `hero` prop; drop `hideTitle`; the badge returns for free via section 1.3(b) | FE | `src/app/school-head/(app)/terms-reports/kinder/page.tsx`, `src/app/school-head/(app)/terms-reports/kinder/loading.tsx` |
| 16 | `/school-head/audit` | title, one `Surface`, table | `SchoolHeadHero` (learner art, icon `ScrollText`); the "Timestamps are UTC" sentence moves from `description` into the panel header, next to the column it explains | FE | `src/app/school-head/(app)/audit/page.tsx`, `src/app/school-head/(app)/audit/loading.tsx` |
| 17 | `/school-head/ip-learners` | title, two `Surface` plus table blocks | `SchoolHeadHero` (learner art, icon `Users`) with stats: IP learners / share of enrolled / learners per teacher — all three already in `getSchoolHeadIpMetrics` | FE | `src/app/school-head/(app)/ip-learners/page.tsx`; **new** `src/app/school-head/(app)/ip-learners/loading.tsx` (this route has none today) |
| 18 | `/school-head/settings/profile` | `SettingsShell` (plain title plus text sidebar), `SchoolHeadProfileForm` | New `SchoolHeadSettingsShell`: person-art hero plus nav card, mirroring `TeacherSettingsShell`; the form gains the Gender control (section 4) | FE + BE + DB | `src/app/school-head/(app)/settings/profile/page.tsx`, `src/app/school-head/(app)/settings/layout.tsx`, `src/components/settings/school-head-settings-shell.tsx` (new), `src/components/forms/sh-profile-form.tsx` |
| 19 | `/school-head/settings/security` | `SettingsShell`, two stacked forms in `max-w-md` | Same new shell; forms in `xl:grid-cols-2` with `className="rounded-2xl"`, exactly as `/teacher/settings/security` does | FE | `src/app/school-head/(app)/settings/security/page.tsx` |
| 20 | `/school-head/profiling` | `OnboardingShell`, bare title and paragraph, wizard | Person-art `PageHero` above the wizard (a first-run head has no stored gender, so the documented female fallback applies). Gender control added to step I | FE | `src/app/school-head/(onboarding)/profiling/page.tsx`, `src/components/forms/sh-profile-form.tsx` |

**Shared-file collisions to schedule around.**
`src/components/forms/sh-profile-form.tsx` serves pages 18 and 20 — one task, not
two. `src/app/school-head/(app)/settings/layout.tsx` serves 18 and 19 — one task.
`src/components/school-head/page-skeleton.tsx` is read by every `loading.tsx`
task, so it lands in Wave 1, before any of them.

## 3. The dashboard

Route `/school-head`. Page `src/app/school-head/(app)/page.tsx`.
Body `src/components/dashboard/school-head/dashboard-body.tsx`.

### 3.1 Where the data comes from

The teacher dashboard reads one cached snapshot so no two panels can disagree.
The head's figures already live in four separately-cached functions in
`src/lib/dashboard/aggregates.ts`. Re-querying them into a fifth snapshot would
duplicate SQL that is already cached under the same `schoolDashboard(schoolId)`
tag.

**Decision: a composer, not a new query.** New file
`src/lib/dashboard/school-head-overview.ts`:

```ts
export type SchoolHeadOverview = { /* field list below */ };

export async function getSchoolHeadOverview(
  schoolId: string
): Promise<SchoolHeadOverview>;

export function buildSchoolHeadAttention(
  data: SchoolHeadOverview,
  hrefs: { teachers: string; gradeLevels: string; years: string; profiling: string }
): AttentionItem[];
```

`getSchoolHeadOverview` is one `Promise.all` over functions that already exist,
plus one uncached count and one date:

| Field | Source |
| --- | --- |
| `learnerCount`, `teacherCount`, `gradeCount`, `sectionCount`, `aralCount`, `activeYear`, `setupTasks` | `getSchoolHeadMetricCounts(schoolId)` — existing, cached, unchanged |
| `ipLearners`, `totalLearners`, `ipPercent`, `learnersPerTeacher`, `activeTeachers` | `getSchoolHeadIpMetrics(schoolId)` — existing, cached, unchanged |
| `adviserlessSections` | `getAdviserlessSections(schoolId)` in `src/lib/teachers/adviserless.ts` — existing, cached, unchanged |
| `pendingTeacherCount` | **new, deliberately uncached** — see below |
| `todayKey` | `formatLocalDateKey(schoolToday())` from `src/lib/date-keys.ts`. Not a query. |

`buildSchoolHeadAttention` is a **pure function**: plain facts in, the whole list
out. It is the only place that decides what counts as needing the head's
attention, and it is unit-testable without a database — the same shape as
`buildDashboardTasks` in `src/lib/dashboard/teacher-overview.ts`.

**Why `pendingTeacherCount` is read outside the cache.**
`revalidateSchoolHeadTeachers` (`src/lib/cache/revalidate.ts`, line 34) busts five
paths and `schoolTeachers(schoolId)`. It does **not** call
`revalidateSchoolDashboard`. A count folded into `getSchoolHeadMetricCounts`
would therefore keep telling a head "3 teachers waiting on you" for up to 60
seconds after they approved all three — a lie on the one card whose entire job is
to prompt an action. The precedent is in the same aggregates file:
`getSchoolHeadRecentActivity` reads `recentAudit` outside its own cache, with a
doc comment explaining that it has no invalidation path. Read it as a single
`prismaFresh.user.count` whose where clause spreads `teacherRosterScope(schoolId)`
and `TEACHER_ROSTER_STATE.pending`, both already exported from
`src/lib/teachers/roster.ts`. It is one indexed count against the existing
`[schoolId, approvalStatus]` index on `User`.

> **Rejected:** add `revalidateSchoolDashboard(schoolId)` inside
> `revalidateSchoolHeadTeachers`. Arguably a real bug fix — `teacherCount` on the
> dashboard is stale for the same reason today — but it changes cache
> invalidation behaviour, and this is a presentation rework. Logged as open
> question 4.

> **Rejected:** call `teacherTabCounts(schoolId)`. It returns all five roster
> states at the cost of five counts; the dashboard needs one.

**Explicitly out of scope, named so nobody invents it silently.** A school-wide
weekly attendance mix (present / late / absent / excused / unmarked), the
equivalent of the teacher's donut, does not exist and would be a new grouped
query over `Attendance`. It is excluded: the charts row below the fold already
carries `attendanceTrend` (seven-day present plus late), and a donut over the
same rows would report one fact twice. If the owner wants it, it is a separate BE
task — `getSchoolHeadAttendanceMix(schoolId)` in
`src/lib/dashboard/aggregates.ts`, tagged `schoolDashboard(schoolId)`, cache
profile `aggregate`.

### 3.2 Section order

Top to bottom. "Above the fold" is the block that rises into the hero.

1. `SchoolHeadGreetingHero` — person art.
2. Super Admin badge row — rendered by the frame, not the hero.
3. `AdviserlessSectionsNotice` and the no-active-year `Callout` — unchanged components.
4. The two-column block: left column holds `SchoolHeadStatRow` (six `StatCard`s)
   then `AralCoveragePanel` beside `IpCoveragePanel`; the right rail holds
   `CalendarCard` then `SchoolAttentionPanel`.
5. `SchoolQuickActionsPanel` — full width, two-by-four grid.
6. `SchoolHeadChartsSection` — existing, restyled. **The charts start here**, below the fold.
7. `SchoolHeadIpSection` — existing, restyled.
8. `SchoolHeadRecentActivitySection` — existing, restyled.

The block in step 4 uses the teacher's grid verbatim:
`grid gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]`, with the rail as
`flex min-w-0 flex-col gap-4 xl:relative xl:z-10 xl:-mt-4` and the calendar
`hidden xl:block`. Do not re-derive these numbers.

**Steps 6 to 8 stay in their current Suspense boundaries.** They already stream
independently and already have skeletons. Restyling them means: `MetricCard`
becomes `StatCard`; `Card` / `CardHeader` / `CardTitle` become `Surface` /
`SurfaceHeader`; the local `schoolPath()` helper becomes `schoolHeadHref(view, ...)`.
No query, no boundary and no tag changes.

### 3.3 The greeting hero

`src/components/dashboard/school-head/greeting-hero.tsx`, exporting
`SchoolHeadGreetingHero`.

Copied from `src/components/dashboard/teacher/greeting-hero.tsx`, not shared.
Sharing would force the teacher component to branch on four things: the default
subtitle ("your class" versus "your school"), the meta chip (the teacher has
none), the Super Admin subtitle override, and the quote pool. Four branches in a
component whose whole job is to render one greeting is worse than two files.

Props: `firstName`, `todayKey`, `bannerSrc`, `quote`, `subtitle?`, `meta?`.
Renders, at the teacher's exact type scale:

- eyebrow "Good morning / afternoon / evening," derived from `SCHOOL_TIME_ZONE`
  and an `Intl` hour only. Copy the eight-line `greetingFor` helper rather than
  extracting a shared module for it.
- an h1 reading the head's first name with the waving-hand emoji.
- the subtitle, defaulting to "Here's what your school needs today."
- a `meta` chip reading the active school year label, the grade-level count and
  the section count, or "No active school year" when there is none. **This is
  where the School year metric goes** — it is context, not a figure to act on.
- the desktop-only rotating quote and the mobile-only date chip, at the same
  breakpoints the teacher hero uses.

Art placement for **person art** differs from learner art and must copy the
teacher greeting hero's values, not `AralPageHero`'s:

```
artClassName        right-[calc(18%-272px)] sm:right-[calc(23%-272px)]
phoneMaskClassName  max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_63%,black_65%),linear-gradient(to_bottom,transparent_49%,black_53%)]
```

These two strings will now exist in two files. That is a knowing duplication of a
visual constant, accepted because the alternative edits
`src/components/dashboard/teacher/greeting-hero.tsx`, the reference
implementation this whole rework is defined against. Put a comment in the new
file naming the teacher file as the origin. Hoisting both into `page-hero.tsx` as
exported constants is a clean follow-up once this ships (open question 5).

Quotes: reuse `DASHBOARD_QUOTES` and `pickQuote` from
`src/lib/dashboard/quotes.ts` unchanged, and use the same next-in-list trick the
teacher body uses so the calendar quote never repeats the hero's.

### 3.4 Stat row — six cards

`src/components/dashboard/school-head/stat-row.tsx`:

```tsx
export function SchoolHeadStatRow(props: { children: React.ReactNode })
// grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6
```

Two-up on phones, three-up from `md` (preserving the `md:max-lg:grid-cols-3`
intent already sitting uncommitted in the working tree), six-up only at `2xl`
where six cards each have room for their action pill.

| # | Title | Value | Hint | Icon | Tone | Decor | Action target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Learners | `learnerCount` | All learners in the school | `ListChecks` | `amber` | `bars` | `ipLearners` — the only school-wide learner list a head has |
| 2 | Teachers | `teacherCount` | Active teaching accounts | `Users` | `primary` | `people` | `teachers` |
| 3 | Grade levels | `gradeCount` | Grades this school offers | `GraduationCap` | `emerald` | `sprout` | `schoolGradeLevels` |
| 4 | Sections | `sectionCount` | Across all grades | `Layers` | `emerald` | `wave` | `schoolGradeLevels` |
| 5 | ARAL learners | `aralCount` | In the ARAL program | `Sparkles` | `violet` | `sprout` | `aral` |
| 6 | Pending approvals | `pendingTeacherCount` | Waiting on your decision | `UserPlus` | `amber` when above zero, `neutral` at zero | `clock` | `teachersPending` |

Violet appears on card 5 only: it is the reserved ARAL accent
(`tailwind.config.ts`), and that is the one card about ARAL. Card 6 is the only
tone that varies with data, because "nothing waiting" and "three waiting" are
different states and a head scanning the row must be able to tell them apart
without reading the number.

Every `href` comes from `src/components/dashboard/school-head/hrefs.ts`, which
wraps `schoolHeadHref(view, SCHOOL_HEAD_ROUTES.x)` so a Super Admin's drill-down
survives every card click. That file is the single decision point for "does this
dashboard link carry `?schoolId=`"; no component concatenates a path.

The "School year" `MetricCard` is deliberately dropped from the row. Its value
was a label, not a figure, and it now appears where it is more useful: the hero
meta chip (section 3.3) and the existing "No active school year" `Callout`.

### 3.5 Coverage panels

`src/components/dashboard/school-head/overview-panels.tsx`. Two panels side by
side in `grid flex-1 grid-cols-2 gap-3 sm:gap-4`, the teacher's exact wrapper.
Both use the donut / legend / tip / pill anatomy of
`src/components/dashboard/teacher/overview-panels.tsx`. That file's `Donut`,
`PanelShell`, `Legend` and `TipTile` are module-private; **copy them into the new
file rather than exporting them**, because exporting four internal helpers to
serve one new caller freezes the teacher panel's internals as a public API for no
gain. This is the one place the spec accepts duplicated markup.

**Panel A — ARAL Coverage.** Icon `Sparkles`, violet tile, period chip "This
school year". Segments: "In ARAL" (`aralCount`, emerald) and "Not enrolled"
(`learnerCount` minus `aralCount`, slate). Headline rate is
`aralCount / learnerCount` as a rounded percentage, caption "ARAL coverage",
honest at a zero denominator (renders 0%). Pill goes to `/school-head/aral`,
labelled "Designate ARAL teachers". Zero-learner footnote: "ARAL coverage appears
once learners are enrolled."

**Panel B — IP Learners.** Icon `Users`, blue tile, period chip "Active
enrolment". Segments: "IP" (`ipLearners`, amber) and "Non-IP" (`totalLearners`
minus `ipLearners`, slate). Headline rate is `ipPercent`, already a formatted
share out of `shapeSchoolIpMetrics`, caption "of enrolled". Pill goes to
`/school-head/ip-learners`, labelled "View IP learners". Zero footnote reuses the
existing string: "Appears once learners are enrolled in the active school year."

Both panels print each segment as a count **and** a percentage beside a labelled
dot, so no state is conveyed by colour alone — the accessibility rule the teacher
panels already document.

### 3.6 Attention panel and quick actions

`src/components/dashboard/school-head/attention-panel.tsx` exports
`SchoolAttentionPanel` and `SchoolQuickActionsPanel`.

`SchoolAttentionPanel` is visually `UpcomingTasksPanel` — violet `ClipboardCheck`
tile, "View all" link, bordered list rows, trailing badge — but typed on
`AttentionItem`, not `DashboardTask`:

```ts
export type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  badge: string | null;
  tone: "amber" | "primary" | "muted";
};
```

Title: **"Needs your attention"**. Items, in this order, produced by
`buildSchoolHeadAttention` and nowhere else:

| id | Condition | Label and detail | Badge | Tone |
| --- | --- | --- | --- | --- |
| `approvals` | `pendingTeacherCount` above zero | Approve teacher registrations / "They cannot sign in until you decide" | "N waiting" | `amber` |
| `adviserless` | `adviserlessSections` non-empty | Assign advisers / "N section(s) have learners but no adviser" | "N section(s)" | `amber` |
| `year` | no `activeYear` | Set an active school year / "New learners get no enrolment record without one" | "Not set" | `amber` |
| `setup:*` | one per remaining `setupTasks` entry | the task's own label / "Finish setting up your school" | none | `primary` |
| `allclear` | the list would otherwise be empty | "Nothing needs you right now" / "Your school is fully set up" | "All clear" | `muted` |

`setupTasks` already contains a "Set an active school year" entry, so the `year`
row above supersedes it: `buildSchoolHeadAttention` must drop the element whose
`id` is `year` from `setupTasks` rather than render the same nudge twice. That
de-duplication lives in the pure function and is tested there (T6.1), not in the
component.

`SchoolQuickActionsPanel` is the teacher's two-by-four tinted grid, retargeted:

| Label | Icon | Target |
| --- | --- | --- |
| Post an announcement | `Megaphone` | `announcements` |
| Transfer a learner | `ArrowRightLeft` | `transfer` |
| Manage teachers | `Users` | `teachers` |
| Generate a report | `FileBarChart` | `reports` |

The first two are the header buttons the current dashboard carries; the other two
are the next-most-used destinations. The header buttons are removed — the hero
has no `actions` row.

Both panels sit in the right rail below `CalendarCard`; on phones and tablets the
rail stacks after the coverage panels, which is where the teacher mockup puts
them.

`CalendarCard` is imported unchanged from
`@/components/dashboard/teacher/calendar-card`. It takes a `todayKey` and a
`DashboardQuote` and is entirely decorative — nothing in it is role-specific.
This is the clearest share-rather-than-copy call on the page.

### 3.7 Loading skeleton

`src/components/dashboard/school-head/dashboard-skeleton.tsx`, exporting
`SchoolHeadDashboardSkeleton`, mirrors `TeacherDashboardSkeleton` block for
block:

- hero: one `Skeleton` at `mt-2 h-60 w-full rounded-2xl lg:h-[19rem]`
- the two-column grid at `gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]`
  - left: six stat skeletons in `grid-cols-2 md:grid-cols-3 2xl:grid-cols-6`,
    then two panel skeletons in `grid-cols-2`
  - rail: a `h-72` block `hidden xl:block` for the calendar, then a `Surface`
    holding five `h-10` rows for the attention panel
- a `Surface` holding four `h-12 rounded-xl` tiles in `grid-cols-2` for quick actions
- two `h-64 rounded-2xl` blocks in `lg:grid-cols-2` for the charts row

Each stat skeleton keeps `data-slot="stat-card-skeleton"` so the existing
`tests/components/route-loading-shape.test.tsx` idiom extends to this route
(T6.2).

`src/app/school-head/(app)/loading.tsx` renders `PostLoginLoadingBridge` wrapping
`RouteLoadingOverlay` wrapping `SchoolHeadDashboardSkeleton` — bridge outside,
overlay inside, for the reason its current comment gives. It must **not** wrap in
`SchoolHeadPageSkeleton`, which would draw a title block above the hero block.
The current `MetricsGridSkeleton variant="school-head"` usage goes away; leave
`src/components/loading/metrics-grid-skeleton.tsx` in place for `/admin`.

### 3.8 The Super Admin view of the dashboard

`resolveSchoolHeadView` already hands the page both `user` and `view`. Keep
today's rule: when `view.isSuperAdminView` the page does not greet anybody — a
Super Admin drilling in is inspecting, not being welcomed. Concretely the hero
renders:

- the eyebrow as "Super Admin view" and the h1 as the school's name rather than a
  first name;
- the subtitle as "Every figure below is this school's.";
- `bannerSrc` as `teacherBannerSrc(null)`, the documented fallback, because a
  Super Admin has no `SchoolHeadProfile`.

`SchoolQuickActionsPanel` is **hidden** when `isSuperAdminView`, matching today's
behaviour of suppressing the two header buttons. The attention panel stays
visible but reads as context: every item links to a page that already renders
read-only under the same flag, so no extra gate is needed.

## 4. The gender change

### 4.1 Prisma field

`prisma/schema.prisma`, `model SchoolHeadProfile` (around line 831), at the end of
the "I. Respondent Information" block, immediately after `position`:

```prisma
/// Chooses the School Head dashboard banner art (MALE gives the male banner,
/// anything else the female one). Nullable: every profile saved before this
/// existed has none, and it stays optional. Mirrors `TeacherProfile.gender`.
gender Gender?
```

**Nullable, no default, no backfill, and never tightened.** Four reasons:

1. Every existing `SchoolHeadProfile` row was written before the question was
   asked. A NOT NULL column with a default would make those rows claim an answer
   nobody gave — the rule this schema already states on `Learner.ethnicity`,
   `TeacherProfile.employmentType` and `NutritionalStatus`.
2. NULL already has a defined, correct meaning at the only read site.
   `teacherBannerSrc` treats "anything but MALE, including unset" as female, so an
   untouched row renders exactly what the app would have rendered for it anyway.
   The migration is a genuine no-op for existing data.
3. No constraint, no index and no unique key involves this column, so
   NULL-compares-as-distinct cannot silently defeat anything.
4. It is optional by design, not by transition. The additive-first ladder stops
   at step one on purpose; there is no later tighten migration. Say so in the
   migration comment so a future reader does not go looking for step two.

### 4.2 Migration

File: `prisma/migrations/20260919000001_school_head_profile_gender/migration.sql`

One statement, a verbatim mirror of
`prisma/migrations/20260915000003_teacher_profile_gender/migration.sql`:

```sql
-- Additive, nullable: no backfill. Chooses the School Head dashboard banner art.
-- Deliberately never tightened to NOT NULL; the field is permanently optional.
ALTER TABLE "SchoolHeadProfile" ADD COLUMN "gender" "Gender";
```

The `Gender` Postgres enum already exists (created in `0_init`, used by
`Learner.gender` and `TeacherProfile.gender`), so nothing creates a type here.

The timestamp `20260919000001` sorts after the current head
`20260917000001_term_grade_letter_mark`.

**This migration is authored, not applied.** Per `CLAUDE.md`, `prisma migrate
deploy`, `migrate dev`, `migrate reset` and `db push` are forbidden against any
remote or shared database. The only commands the implementer runs are
`npx prisma validate`, `npx prisma format` and `npx prisma generate`. A human
applies it following `docs/migrate-checklist.md`, against `DIRECT_URL` (port
5432).

`prisma/rls-policies.sql` needs no change — its policies are row-level and the
`SchoolHeadProfile` policy does not enumerate columns. `src/lib/db/schema-order.ts`
needs no change — `SNAPSHOT_MODELS` lists models, not columns, and
`tests/unit/db/schema-order.test.ts` asserts model coverage only. The backup path
selects whole rows, so the new column rides along.

### 4.3 Zod

`src/lib/validators/profile.schema.ts`, inside the `.extend` call on
`schoolHeadProfileSchema` (around line 338), beside `designation` and `position`:

```ts
/** Optional; only chooses the School Head dashboard banner art. */
gender: z.enum(["MALE", "FEMALE"]).optional(),
```

**Do not** add it to `baseProfile`. `teacherProfileObject` already declares
`gender` explicitly (line 356); putting it in the shared base would give the
teacher schema two declarations of the same key and couple two schemas the
codebase has deliberately kept apart.

### 4.4 Server action

`src/lib/actions/school-head.ts`, `saveSchoolHeadProfile`. `profileData` is
currently the parsed data minus the names and `contactEmail`, so `gender` reaches
the upsert for free — but **Prisma skips undefined on update**, so a head who
clears the field in Settings would not have it cleared in the database. Apply the
same explicit normalisation the file already applies to `contactEmail`, and that
`src/lib/actions/teacher.ts` line 111 applies to the teacher's own gender:
destructure `gender` out of the parsed data alongside `contactEmail`, coerce it
with a null fallback, and pass it explicitly in both the create and the update
branch so the spread cannot overwrite it.

This action is one of the roughly thirty legacy hand-rolled result-shaped
modules. **Do not migrate it to the `action()` wrapper in this rework** — that is
a separate slice with its own error-code surface.

### 4.5 Form controls

`src/components/forms/sh-profile-form.tsx` — one task serving both entry points
(`/school-head/profiling` and `/school-head/settings/profile`), since both render
`SchoolHeadProfileForm` and both already spread the stored profile into
`defaultValues`.

Seven edits, mirroring `src/components/forms/teacher-profile-form.tsx` exactly:

1. Import `GENDER_LABELS` from `@/lib/constants/enum-labels`. `toOptions` is
   already imported there.
2. `shWizardFormSchema` (around line 93): add a `gender` string field.
3. The `Defaults` type (around line 120): add an optional nullable `gender`.
4. `useAppForm` defaults (around line 236): seed `gender` from the default, or
   the empty string.
5. `buildPayload` (around line 160): emit `gender` when non-empty, undefined
   otherwise.
6. Render, in the "I. Respondent Information" card beside `contactNumber` (around
   line 523), the identical control from `teacher-profile-form.tsx` line 1071: a
   `FormSelectField` named `gender`, label "Gender", description
   "Optional. Sets the artwork on your dashboard.", options from
   `toOptions(GENDER_LABELS)`, with `allowEmpty` and the empty label
   "Not specified".
7. Review step, the `ReviewBlock` titled "Respondent Information" (around line
   716): add a Gender row, resolved through the file's own `labelOf` helper,
   after "Contact number".

No step-validation change: the field is optional, so it needs no entry in the
per-step guards at lines 304 to 309.

### 4.6 Existing School Heads with no value

Nothing breaks and nothing is asked of them.

- Their `gender` column is NULL. `teacherBannerSrc(null)` returns
  `/brand/banner-teacher-female.webp`, the documented fallback, identical to what
  the teacher side does for an unset teacher.
- The dashboard read must not be able to take the page down. Copy the teacher
  dashboard's defensive read verbatim
  (`src/app/teacher/(app)/(dashboard)/page.tsx`, lines 39 to 44): a `findUnique`
  whose result is mapped to a nullable gender and whose rejection is caught and
  mapped to null. A database the migration has not reached yet then renders the
  default art instead of a 500 — which matters here because a human applies
  migrations on their own schedule, so there **will** be a window where the code
  is deployed and the column is not.
- Settings and Profile show "Not specified" until they choose. Nothing gates on
  the value; no workflow reads it but the banner.

### 4.7 Write paths not controlled by the form

Audited. This is the complete list of code that touches `SchoolHeadProfile`:

| Path | Effect of the new column |
| --- | --- |
| `src/lib/actions/school-head.ts`, `saveSchoolHeadProfile` | The only writer. Handled in section 4.4. |
| `src/lib/demo/teardown.ts` line 81 | A `deleteMany`. Unaffected. |
| `scripts/data-uniformity-snapshot.ts` line 44 | A `findMany`. Picks the column up automatically. |
| `prisma/seed.ts` | Does not create `SchoolHeadProfile` rows; heads are seeded unprofiled and complete the wizard. No change. |
| `scripts/import-schools.ts` | Creates `User` rows with `mustChangePassword` set; never touches `SchoolHeadProfile`. No change. |

**No importer or seeder rewrites this column**, so nothing can silently undo a
head's choice. If one is ever added it must carry `gender` explicitly or omit it,
never write NULL as part of a wholesale profile refresh.

## 5. Ordered waves

Rule: two tasks that touch the same file are never parallel. Each task's
definition of done is one sentence and is verifiable on its own.

### Wave 0 — schema (serialized; DB owns `prisma/` alone)

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T0.1** Add `gender Gender?` to `SchoolHeadProfile` and author the migration | DB | `prisma validate`, `prisma format` and `prisma generate` all pass, the migration file holds exactly the one ALTER TABLE, and **nothing was applied to any database** | `prisma/schema.prisma`, `prisma/migrations/20260919000001_school_head_profile_gender/migration.sql` | nothing |

### Wave 1 — shared primitives (all parallel; disjoint files)

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T1.1** Add the `hero` prop, hoist the Super Admin badge into its own row, export `SuperAdminViewBadge` | FE | every existing caller still compiles unchanged, and a page passing `hero` renders hero, badge, callout, tabs, children in that order | `src/components/school-head/school-head-page.tsx` | T1.2 to T1.6 |
| **T1.2** Build `SchoolHeadHero` | FE | it renders through `PageHero` with the section 1.4 class strings, its `topRight` and `stats` slots work, and no page uses it yet | `src/components/school-head/school-head-hero.tsx` (new) | T1.1, T1.3 to T1.6 |
| **T1.3** Add a `hero` boolean to `SchoolHeadPageSkeleton` | FE | it draws the banded block instead of the title pair, and existing callers are unchanged | `src/components/school-head/page-skeleton.tsx` | T1.1, T1.2, T1.4 to T1.6 |
| **T1.4** Add `gender` to the School Head Zod schema | BE | `SchoolHeadProfileInput` carries an optional gender and `npm run typecheck` passes | `src/lib/validators/profile.schema.ts` | T1.1 to T1.3, T1.5, T1.6 |
| **T1.5** School Head dashboard deep-link helpers | FE | every dashboard target is a named function wrapping `schoolHeadHref` and `SCHOOL_HEAD_ROUTES`, with no raw path string anywhere | `src/components/dashboard/school-head/hrefs.ts` (new) | T1.1 to T1.4, T1.6 |
| **T1.6** Note in the banner helper that School Heads share the art | FE | one doc-comment line added, no behaviour change | `src/lib/dashboard/banner.ts` | T1.1 to T1.5 |

### Wave 2 — the dashboard

T2.1 first (everything else needs its type), then T2.2 to T2.5 in parallel, then
T2.6 to T2.8, then T2.9.

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T2.1** `getSchoolHeadOverview` and `buildSchoolHeadAttention` | BE | it composes the three existing cached reads plus one uncached pending count, adds no `cachedQuery` of its own, and the attention builder is pure and de-dupes the year nudge | `src/lib/dashboard/school-head-overview.ts` (new) | nothing |
| **T2.2** Greeting hero | FE | greeting, name, meta chip, quote and mobile date chip all render, with the Super Admin variant per section 3.8 | `src/components/dashboard/school-head/greeting-hero.tsx` (new) | T2.3, T2.4, T2.5 |
| **T2.3** Stat row and six cards | FE | six stat cards per section 3.4, every href from T1.5, and card six's tone varies with the count | `src/components/dashboard/school-head/stat-row.tsx` (new) | T2.2, T2.4, T2.5 |
| **T2.4** Coverage panels | FE | two donuts, honest at a zero denominator, with a count and a percentage beside every dot | `src/components/dashboard/school-head/overview-panels.tsx` (new) | T2.2, T2.3, T2.5 |
| **T2.5** Attention and quick-action panels | FE | it renders an attention list, shows the All clear row when empty, and hides quick actions in Super Admin view | `src/components/dashboard/school-head/attention-panel.tsx` (new) | T2.2 to T2.4 |
| **T2.6** Dashboard body | FE | it assembles section 3.2 in order and degrades to the teacher body's could-not-be-loaded panel on a read failure | `src/components/dashboard/school-head/dashboard-body.tsx` (new) | T2.7, T2.8 |
| **T2.7** Restyle the three surviving sections | FE | metric cards become stat cards, cards become surfaces, the local `schoolPath()` helper is deleted in favour of `schoolHeadHref`, and every where clause, cache tag and Suspense boundary is byte-identical | `src/components/dashboard/school-head-dashboard-sections.tsx` | T2.6, T2.8 |
| **T2.8** Dashboard skeleton | FE | its geometry matches section 3.7 and each stat block carries the stat-card-skeleton data slot | `src/components/dashboard/school-head/dashboard-skeleton.tsx` (new) | T2.6, T2.7 |
| **T2.9** Wire the page and its boundary | FE | the page renders hero plus body, reads gender defensively per section 4.6, keeps `resolveSchoolHeadView` and the adviserless notice, and its loading boundary renders the new skeleton with no title block | `src/app/school-head/(app)/page.tsx` and its sibling `loading.tsx` | nothing |

### Wave 3 — learner-facing pages

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T3.1 then T3.2** ARAL page: the untutored count, then the hero and stats | BE then FE | the page counts learners with no ARAL tutor inside its existing parallel read under the same where scope, and the hero shows three stat cards while the aral callout and the table stay untouched | `src/app/school-head/(app)/aral/page.tsx` and its `loading.tsx` | T3.3 to T3.6 |
| **T3.3** Transfer page | FE | hero added, form panel widened to `max-w-2xl`, no-active-year callout untouched | `src/app/school-head/(app)/transfer/page.tsx` and its `loading.tsx` | T3.1, T3.2, T3.4 to T3.6 |
| **T3.4** IP learners page | FE | hero with three stat cards drawn from the existing metrics, and a new loading boundary exists for the route | `src/app/school-head/(app)/ip-learners/page.tsx` plus a new sibling `loading.tsx` | T3.1 to T3.3, T3.5, T3.6 |
| **T3.5** Reports Hub | FE | hero added, the report-settings button moved into `topRight`, `ReportsHub` untouched | `src/app/school-head/(app)/reports/page.tsx` and its `loading.tsx` | T3.1 to T3.4, T3.6 |
| **T3.6** Kindergarten checklist | FE | `hideTitle` is gone, `KinderChecklistHero` is passed through the `hero` prop, and the Super Admin badge now renders on this route | `src/app/school-head/(app)/terms-reports/kinder/page.tsx` and its `loading.tsx` | T3.1 to T3.5 |

### Wave 4 — workspace and administrative pages

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T4.1** School workspace root, grade levels | FE | hero and stats sit above the unchanged tab bar, and the loading boundary passes hero while keeping three tabs | `src/app/school-head/(app)/school/page.tsx` and its `loading.tsx` | T4.2 to T4.10 |
| **T4.2** School years | FE | same hero, the create dialog in `topRight`, the prose panel collapsed | `src/app/school-head/(app)/school/years/page.tsx` | every other Wave 4 task |
| **T4.3** School information | FE | same hero, both branches of the Super Admin and edit fork untouched | `src/app/school-head/(app)/school/info/page.tsx` | every other Wave 4 task |
| **T4.4** Teachers, Active | FE | hero added, the three capacity callouts and the table untouched, the loading boundary passes hero and keeps five tabs | `src/app/school-head/(app)/teachers/page.tsx` and its `loading.tsx` | every other Wave 4 task |
| **T4.5** Teachers, Pending | FE | same hero, and the explanatory paragraph is now an info callout | `src/app/school-head/(app)/teachers/pending/page.tsx` | every other Wave 4 task |
| **T4.6** Teachers, Inactive | FE | same hero, and a surface plus empty state now renders at zero rows | `src/app/school-head/(app)/teachers/inactive/page.tsx` | every other Wave 4 task |
| **T4.7** Teachers, Declined and Removed | FE | same hero on both, bodies untouched | `src/app/school-head/(app)/teachers/declined/page.tsx`, `src/app/school-head/(app)/teachers/removed/page.tsx` | every other Wave 4 task |
| **T4.8** Announcements | FE | hero added and the two-column content grid preserved | `src/app/school-head/(app)/announcements/page.tsx` and its `loading.tsx` | every other Wave 4 task |
| **T4.9** Term Subjects | FE | hero added, the reset button in `topRight`, and the editable-and-audited Super Admin caption still renders | `src/app/school-head/(app)/term-subjects/page.tsx` and its `loading.tsx` | every other Wave 4 task |
| **T4.10** Audit | FE | hero added and the UTC note now sits in the panel header beside the column it explains | `src/app/school-head/(app)/audit/page.tsx` and its `loading.tsx` | every other Wave 4 task |
| **T4.11** Remove `hideTitle` from `SchoolHeadPage` | FE | the prop and its branch are gone and no caller references it | `src/components/school-head/school-head-page.tsx` | nothing; must follow T3.6, its last user |

### Wave 5 — settings and profiling (where gender lands)

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T5.1** Persist gender on save | BE | clearing Gender in Settings writes NULL rather than leaving the column alone | `src/lib/actions/school-head.ts` | T5.2, T5.3 |
| **T5.2** Gender control in the profile form | FE | the select appears in step I and in the review block, in both the wizard and the flat Settings presentation | `src/components/forms/sh-profile-form.tsx` | T5.1, T5.3 |
| **T5.3** Build `SchoolHeadSettingsShell` | FE | a person-art hero plus nav card mirroring `TeacherSettingsShell`, with `SettingsShell` left untouched for `/admin` | `src/components/settings/school-head-settings-shell.tsx` (new) | T5.1, T5.2 |
| **T5.4** Wire Settings, Profile | FE | it reads gender defensively per section 4.6 and passes the resolved banner into the new shell | `src/app/school-head/(app)/settings/profile/page.tsx`, `src/app/school-head/(app)/settings/layout.tsx` | T5.5 |
| **T5.5** Wire Settings, Security | FE | same shell, forms in a two-column grid from `xl` with rounded-2xl panels | `src/app/school-head/(app)/settings/security/page.tsx` | T5.4 |
| **T5.6** Profiling wizard hero | FE | a person-art `PageHero` replaces the bare title and paragraph, with the wizard itself untouched | `src/app/school-head/(onboarding)/profiling/page.tsx` | T5.1 to T5.5 |

### Wave 6 — verification and release

| Task | Layer | Done when | Files | Parallel with |
| --- | --- | --- | --- | --- |
| **T6.1** Unit-test the attention builder | QA | it covers zero pending, N pending, adviserless sections present, no active school year, the year de-duplication, and the All clear row | `tests/unit/dashboard/school-head-overview.test.ts` (new) | T6.2, T6.3 |
| **T6.2** Extend the loading-shape guard | QA | it asserts the School Head dashboard boundary draws six stat skeletons and no table, and that each tabbed boundary still draws its tab count | `tests/components/route-loading-shape.test.tsx` | T6.1, T6.3 |
| **T6.3** Gender round-trip test | QA | it asserts the save action writes a null gender when the field is submitted empty | `tests/unit/actions/school-head-profile-save.test.ts` | T6.1, T6.2 |
| **T6.4** Local gates | any | `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` all pass on one HEAD snapshot | none | nothing |
| **T6.5** Release entry and version bump | any | a `RELEASES` entry at 2.3.0 with user-language fixes, and the same string in `package.json` and `package-lock.json` at both the top level and the empty-string package key | `src/lib/releases.ts`, `package.json`, `package-lock.json` | nothing |

Version note: the last release is 2.2.1 and this push holds features, so the
middle number moves, giving **2.3.0**. If another session has already renumbered,
renumber above whatever main now holds; never reuse a number.

## 6. Risks

**R1 — the Super Admin badge disappears from a converted page.** The badge is the
only thing telling a Super Admin they are inside somebody else's school. Section
1.3(b) moves it to an unconditional row, which *fixes* today's silent loss on the
Kinder route, but every Wave 3 and Wave 4 task must confirm it still renders.
Mitigation: the badge has exactly one render site, `SchoolHeadPage`, so this is
one review check rather than twenty. Add it to every task's acceptance — open the
page as a Super Admin with a `?schoolId=` for another school and see the badge.

**R2 — `superAdminCaption` regressing to read-only on Term Subjects.** That page
is the single deliberate exception: a Super Admin *may* write there, and the
caption says so. A hero rework that forgets to thread `superAdminCaption` through
would claim a lock that does not exist. Mitigation: T4.9's definition of done
names the exact behaviour, and the prop stays on `SchoolHeadPage`, never on the
hero.

**R3 — tenancy.** Every task in Waves 3 to 5 edits a page that carries
`schoolId: view.schoolId` in its where clause. The hard rule from
`docs/school-head-frame-contract.md` still binds: a presentation change must not
move, merge or drop a where clause. Mitigation: the per-page tasks say
"table and body untouched" for exactly this reason — the change surface is the
frame call and the hero, not the query. T2.7 is the one task that edits a file
containing queries, and its definition of done says every where clause, tag and
Suspense boundary is byte-identical.

**R4 — cache key or tag drift.** T2.1 introduces a composer. If an implementer
tidies it into a single `cachedQuery` wrapping all four reads, the pending count
becomes cached, defeating section 3.1, and a new cache key appears that must
carry `schoolId` or it is a cross-tenant leak. Mitigation:
`getSchoolHeadOverview` must add **no** `cachedQuery` call of its own. Its
callees are already cached; it is glue.

**R5 — a dashboard link dropping `?schoolId=`.** Six stat cards, four quick
actions and up to five attention rows are new links, all of which must carry the
drill-down parameter. Mitigation: T1.5 makes
`src/components/dashboard/school-head/hrefs.ts` the only place a dashboard href is
built; no component concatenates a path.

**R6 — existing tests.** Audited:

| Test | Risk | Note |
| --- | --- | --- |
| `tests/components/route-loading-shape.test.tsx` | Medium — it asserts teacher boundaries today, and T2.8 and T2.9 change School Head boundary shapes | Extend it in T6.2 rather than weaken it |
| `tests/unit/dashboard/school-head-charts.test.ts` | Low — it tests `getSchoolHeadCharts` data shaping, which this rework does not touch | — |
| `tests/unit/actions/school-head-profile-save.test.ts` | Medium — T5.1 changes the upsert payload shape | Update in T6.3 |
| `tests/components/sh-profile-contact-position.test.tsx` | Medium — it renders the School Head profile form, so a new step-I control can break a query-by-index or a select-count assertion | Check it before T5.2 lands |
| `tests/unit/db/schema-order.test.ts` | None — it asserts model coverage, not columns | — |
| `tests/unit/nav/pending-nav.test.ts`, `tests/unit/teachers/removed-roster.test.ts` | None — route constants and scope helpers, both unchanged | — |
| `e2e/school-head-login.spec.ts` | Low to medium — if it asserts on the dashboard heading text, the greeting changes from "Welcome, name" to "name!" | Verify before Wave 2 merges |

**R7 — the deploy-before-migrate window.** The release rule ships on push; the
migration rule says a human applies SQL separately. Production will therefore
briefly run code that reads `SchoolHeadProfile.gender` against a database that
lacks the column. Mitigation: the defensive read in section 4.6 is not optional —
it is what keeps the dashboard and Settings up during that window. Preferred
ordering is still apply-migration-first, then push; the defensive read is the
seatbelt for when that ordering slips.

**R8 — uncommitted work in the tree.** At spec time the working tree holds
uncommitted tablet-grid and webp tweaks to
`src/components/dashboard/school-head-dashboard-sections.tsx`,
`src/app/school-head/(app)/page.tsx`,
`src/components/loading/metrics-grid-skeleton.tsx` and
`src/lib/dashboard/banner.ts`. T2.7 and T2.9 rewrite two of those files.
Mitigation: commit or discard that work before Wave 2 starts, so a rewrite does
not silently revert somebody's webp switch. Several sessions share this one
worktree, so snapshot HEAD around the Wave 6 gate run.

**R9 — two copies of the person-art class strings.** Section 3.3 knowingly
duplicates `artClassName` and `phoneMaskClassName` between the teacher and School
Head greeting heroes. If the character art is ever re-cut, both must move or the
two heroes diverge. Mitigation: the comment in the new file names the teacher file
as its origin, and open question 5 logs the hoist.

## 7. Open questions for the operator

1. **A hero on Audit and Term Subjects.** This spec puts a learner-art hero on
   every non-personal page, including the audit log and the subject configuration
   screen, on the strength of "every school-head page, full rework". The teacher
   side does *not* do this — `/teacher/reports` keeps a plain title block. If a
   banner over a log table reads as noise, say so and pages 13 and 16 drop back to
   the title block; nothing else in the spec changes.

2. **A school-wide attendance donut.** Section 3.1 deliberately excludes it: it
   would be a new grouped query over `Attendance`, and the seven-day trend chart
   below the fold already tells that story. Confirm the head does not want a
   weekly present-rate ring above the fold. If they do, it is one extra BE task.

3. **Does the School Head hero need its own character art?** It currently borrows
   the teacher art. That reads fine — the character is a DepEd educator — but a
   head may expect something distinct. Distinct art must be supplied at 2172x579
   with the transparent top strip (rows 0 to 46) the `PageHero` geometry requires,
   and `src/lib/dashboard/banner.ts` splits into two functions at that point.

4. **Should `revalidateSchoolHeadTeachers` also bust the school dashboard tag?**
   Approving a teacher already leaves `teacherCount` stale on the dashboard for up
   to sixty seconds today. Section 3.1 works around it rather than fixing it,
   because the fix changes cache behaviour and this is a presentation rework.
   Confirm you want a follow-up ticket filed.

5. **May a follow-up hoist the person-art placement constants into
   `page-hero.tsx`?** That is the right home — the file already owns the geometry
   documentation — but it means editing
   `src/components/dashboard/teacher/greeting-hero.tsx` and
   `src/components/settings/teacher-settings-shell.tsx`, which this rework was
   told to leave alone.
