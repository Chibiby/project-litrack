# LITRACK v2.0.0 Teacher Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the teacher dashboard and shared shell to the owner's v2 mockups, with a gender-selected hero banner, shipped as release 2.0.0.

**Architecture:** Restyle in place. Pure helpers (banner choice, quote picker, month grid) are unit-tested modules under `src/lib/dashboard/`. Dashboard components under `src/components/dashboard/teacher/` are reworked, not duplicated. One additive migration adds `TeacherProfile.gender`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Prisma 5, Zod, Tailwind + shadcn/ui, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-litrack-v2-teacher-dashboard-design.md`

## Global Constraints

- Work only in `.claude/worktrees/litrack-v2` on branch `feat/litrack-v2`.
- Never run `prisma migrate deploy|dev|reset` or `db push`. The migration is applied by the main session only after the owner approves the exact SQL in chat (Task 12).
- Reference images (owner-supplied): image 1 female banner, image 2 male banner, image 3 desktop dashboard at ~1672px, image 4 mobile dashboard at ~390px. Follow layout and formatting strictly.
- No trend lines ("+2 this month") on stat cards.
- No "Overdue" badge; task badges stay "N pending" / "Complete" / "Open".
- "Pending Profiles" card stays read-only: no `action` prop (enforced by `tests/unit/aral-profile-dormant.test.ts`).
- No "Learner Profiling" nav item.
- Gender field reuses enum `Gender { MALE FEMALE }`; label "Gender" from `GENDER_LABELS` in `src/lib/constants/enum-labels.ts`.
- Banner: `MALE` → `/brand/banner-teacher-male.png`; anything else → `/brand/banner-teacher-female.png`.
- Dates via `src/lib/date-keys.ts` (`parseLocalDateKey`, `formatLocalDateKey`), never `toISOString()`.
- Dark mode must keep working.
- Release `2.0.0` in `src/lib/releases.ts`, `package.json`, `package-lock.json` (top-level and `packages."".version`).
- Gates: `npm run typecheck`, `npm run test`, `npm run build`. `npm run lint` fails inside worktrees for a plugin-root conflict; lint from the main checkout before merge.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | add `gender Gender?` to `TeacherProfile` |
| `prisma/migrations/20260915000003_teacher_profile_gender/migration.sql` | additive column |
| `src/lib/validators/profile.schema.ts` | `gender` optional enum on teacher schema |
| `src/lib/actions/teacher.ts` | persist `gender` (null on clear) |
| `src/components/forms/teacher-profile-form.tsx` | Gender select |
| `src/lib/dashboard/banner.ts` (new) | `teacherBannerSrc(gender)` |
| `src/lib/dashboard/quotes.ts` (new) | `DASHBOARD_QUOTES`, `pickQuote(random)` |
| `src/lib/dashboard/month-grid.ts` (new) | `buildMonthGrid(todayKey)` |
| `src/components/dashboard/teacher/greeting-hero.tsx` (new, replaces greeting-header.tsx) | hero banner |
| `src/components/dashboard/teacher/calendar-card.tsx` (new) | right-rail calendar |
| `src/components/dashboard/teacher/stat-cards.tsx` | v2 card style, mobile chevron |
| `src/components/dashboard/teacher/overview-panels.tsx` | donut + legend + tip box |
| `src/components/dashboard/teacher/tasks-panel.tsx` | v2 tasks + 4 quick actions |
| `src/components/dashboard/teacher/dashboard-body.tsx` | new grid |
| `src/components/dashboard/teacher/dashboard-skeleton.tsx` | match new grid |
| `src/app/teacher/(app)/(dashboard)/page.tsx` | load gender, pass banner |
| `src/components/app-sidebar.tsx`, `src/components/shell/app-header.tsx` | v2 shell |
| `src/lib/releases.ts`, `package.json`, `package-lock.json` | 2.0.0 |
| `public/brand/banner-teacher-{female,male}.png` | owner-supplied art |

---

### Task 1: Gender column on TeacherProfile

**Files:**
- Modify: `prisma/schema.prisma` (model `TeacherProfile`, after `employmentType`)
- Create: `prisma/migrations/20260915000003_teacher_profile_gender/migration.sql`

**Interfaces:**
- Produces: `TeacherProfile.gender: Gender | null` on the generated Prisma client.

- [ ] **Step 1: Edit schema** — insert after the `employmentType EmploymentType?` line:

```prisma
  /// Chooses the teacher dashboard banner art (MALE → male banner, else female).
  /// Nullable: every profile saved before v2 has none, and it stays optional.
  gender                  Gender?
```

- [ ] **Step 2: Write migration**

```sql
-- Additive, nullable: no backfill, no lock beyond a catalog update.
ALTER TABLE "TeacherProfile" ADD COLUMN "gender" "Gender";
```

- [ ] **Step 3: Verify offline**

Run: `npx prisma validate && npx prisma format && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid", client generated.

- [ ] **Step 4: Verify SQL matches schema (file inputs only)**

Run (write the old schema to the session scratchpad, never /tmp): `git show HEAD:prisma/schema.prisma > "$SCRATCH/old.prisma"; npx prisma migrate diff --from-schema-datamodel "$SCRATCH/old.prisma" --to-schema-datamodel prisma/schema.prisma --script`
Expected: exactly `ALTER TABLE "TeacherProfile" ADD COLUMN "gender" "Gender";`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260915000003_teacher_profile_gender
git commit -m "feat(db): optional TeacherProfile.gender for dashboard banner"
```

### Task 2: Gender in validator, action and profile form

**Files:**
- Modify: `src/lib/validators/profile.schema.ts` (`teacherProfileObject.extend`)
- Modify: `src/lib/actions/teacher.ts:~105-117` (`profileData`)
- Modify: `src/components/forms/teacher-profile-form.tsx` (form schema, `Defaults`, `TeacherFormValues`, `buildPayload`, field list, label map, JSX next to Ethnicity)
- Modify: `src/app/teacher/(app)/settings/profile/page.tsx` only if defaults are mapped field-by-field
- Test: `tests/unit/validators/teacher-profile-gender.test.ts`

**Interfaces:**
- Consumes: Task 1 `gender` column.
- Produces: `TeacherProfileInput.gender?: "MALE" | "FEMALE"`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { teacherProfileSchema } from "@/lib/validators/profile.schema";

// Minimal valid teacher payload; copy the shape used by existing
// tests/unit/validators teacher-profile tests if one exists.
const base = {
  firstName: "Ana",
  lastName: "Cruz",
  designation: "Teacher",
  educationalAttainment: "BACHELORS",
  fieldOfSpecialization: "ENGLISH",
  yearsInService: 3,
  hasReadingTraining: false,
  readingTrainings: [],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "SCHOOL",
  advisoryMode: "FLOATING",
};

describe("teacherProfileSchema gender", () => {
  it("accepts no gender", () => {
    expect(teacherProfileSchema.safeParse(base).success).toBe(true);
  });
  it.each(["MALE", "FEMALE"])("accepts %s", (g) => {
    const r = teacherProfileSchema.safeParse({ ...base, gender: g });
    expect(r.success && r.data.gender).toBe(g);
  });
  it("rejects an unknown value", () => {
    expect(teacherProfileSchema.safeParse({ ...base, gender: "X" }).success).toBe(false);
  });
});
```

If `base` fails the first case for an unrelated required field, fix `base` by reading the schema's required fields — do not loosen the schema.

- [ ] **Step 2: Run** `npx vitest run tests/unit/validators/teacher-profile-gender.test.ts` — Expected: FAIL on the MALE/FEMALE and reject cases.

- [ ] **Step 3: Implement validator** — in `teacherProfileObject.extend({ ... })` after `...ethnicityFields,`:

```ts
    /** Optional; only chooses the dashboard banner art. */
    gender: z.enum(["MALE", "FEMALE"]).optional(),
```

If `teacherProfileUpdateSchema` is built separately, add the same line there.

- [ ] **Step 4: Persist in action** — in `profileData` in `src/lib/actions/teacher.ts`, add:

```ts
    // Cleared in Settings → write null, since Prisma skips undefined.
    gender: parsed.data.gender ?? null,
```

- [ ] **Step 5: Form** — in `teacher-profile-form.tsx`:
  - `teacherWizardFormSchema`: add `gender: z.string().optional(),`
  - `Defaults` type: add `gender: string | null;`
  - `TeacherFormValues`: add `gender: string | undefined;`
  - default-values mapping: `gender: defaults.gender ?? undefined,`
  - `buildPayload`: add `gender: values.gender || undefined,`
  - Section I field-name list: add `"gender",` after `"contactNumber",`
  - label map: add `gender: "Gender",`
  - JSX: directly above the Ethnicity `FormSelectField`, add

```tsx
              <FormSelectField
                control={form.control}
                name="gender"
                label="Gender"
                description="Optional. Sets the artwork on your dashboard."
                options={toOptions(GENDER_LABELS)}
                allowEmpty
                emptyLabel="Not specified"
              />
```

  and import `GENDER_LABELS` from `@/lib/constants/enum-labels`.

- [ ] **Step 6: Run** `npx vitest run tests/unit/validators/teacher-profile-gender.test.ts` then `npm run typecheck` — Expected: PASS, no type errors (fix every call site typecheck flags for the new `Defaults.gender`).

- [ ] **Step 7: Commit** `git commit -am "feat(teachers): optional gender on teacher profile"` (add the new test file first).

### Task 3: Pure dashboard helpers

**Files:**
- Create: `src/lib/dashboard/banner.ts`, `src/lib/dashboard/quotes.ts`, `src/lib/dashboard/month-grid.ts`
- Test: `tests/unit/dashboard/v2-helpers.test.ts`

**Interfaces:**
- Produces:
  - `teacherBannerSrc(gender: "MALE" | "FEMALE" | null | undefined): string`
  - `type DashboardQuote = { text: string; author: string }`
  - `DASHBOARD_QUOTES: readonly DashboardQuote[]`
  - `pickQuote(random?: () => number): DashboardQuote`
  - `buildMonthGrid(todayKey: string): { monthLabel: string; weeks: ({ day: number; key: string; isToday: boolean } | null)[][] }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { buildMonthGrid } from "@/lib/dashboard/month-grid";

describe("teacherBannerSrc", () => {
  it("uses the male banner for MALE", () => {
    expect(teacherBannerSrc("MALE")).toBe("/brand/banner-teacher-male.png");
  });
  it.each(["FEMALE", null, undefined] as const)("uses the female banner for %s", (g) => {
    expect(teacherBannerSrc(g)).toBe("/brand/banner-teacher-female.png");
  });
});

describe("pickQuote", () => {
  it("has several attributed quotes", () => {
    expect(DASHBOARD_QUOTES.length).toBeGreaterThanOrEqual(8);
    for (const q of DASHBOARD_QUOTES) {
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.author.length).toBeGreaterThan(0);
    }
  });
  it("maps the random source onto the list", () => {
    expect(pickQuote(() => 0)).toBe(DASHBOARD_QUOTES[0]);
    expect(pickQuote(() => 0.9999)).toBe(DASHBOARD_QUOTES[DASHBOARD_QUOTES.length - 1]);
  });
});

describe("buildMonthGrid", () => {
  it("lays out September 2026 starting on Tuesday and marks today", () => {
    const g = buildMonthGrid("2026-09-13");
    expect(g.monthLabel).toBe("September 2026");
    expect(g.weeks[0].slice(0, 2)).toEqual([null, null]); // Sun, Mon blank
    expect(g.weeks[0][2]).toEqual({ day: 1, key: "2026-09-01", isToday: false });
    const today = g.weeks.flat().find((c) => c?.isToday);
    expect(today).toEqual({ day: 13, key: "2026-09-13", isToday: true });
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/dashboard/v2-helpers.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `banner.ts`**

```ts
/** Dashboard hero art. Anything but MALE — including unset — gets the female art. */
export function teacherBannerSrc(gender: "MALE" | "FEMALE" | null | undefined): string {
  return gender === "MALE"
    ? "/brand/banner-teacher-male.png"
    : "/brand/banner-teacher-female.png";
}
```

- [ ] **Step 4: Implement `quotes.ts`**

```ts
export type DashboardQuote = { text: string; author: string };

/** Short, attributed lines. The page is force-dynamic, so a server-side pick per request never mismatches on hydration. */
export const DASHBOARD_QUOTES: readonly DashboardQuote[] = [
  { text: "A good teacher can inspire hope, ignite the imagination, and instill a love of learning.", author: "Brad Henry" },
  { text: "Once you learn to read, you will be forever free.", author: "Frederick Douglass" },
  { text: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
  { text: "Education is not preparation for life; education is life itself.", author: "John Dewey" },
  { text: "It is easier to build strong children than to repair broken men.", author: "Frederick Douglass" },
  { text: "Children are the living messages we send to a time we will not see.", author: "Neil Postman" },
  { text: "Every child deserves a champion.", author: "Rita Pierson" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
  { text: "Small progress each day leads to big results.", author: "Unknown" },
  { text: "Reading is to the mind what exercise is to the body.", author: "Joseph Addison" },
];

export function pickQuote(random: () => number = Math.random): DashboardQuote {
  const i = Math.min(Math.floor(random() * DASHBOARD_QUOTES.length), DASHBOARD_QUOTES.length - 1);
  return DASHBOARD_QUOTES[i];
}
```

- [ ] **Step 5: Implement `month-grid.ts`**

```ts
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

export type MonthCell = { day: number; key: string; isToday: boolean } | null;

/** Sunday-first weeks for the month containing `todayKey`, padded with nulls. */
export function buildMonthGrid(todayKey: string): { monthLabel: string; weeks: MonthCell[][] } {
  const today = parseLocalDateKey(todayKey);
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: MonthCell[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = formatLocalDateKey(new Date(year, month, day));
    cells.push({ day, key, isToday: key === todayKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabel = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(first);
  return { monthLabel, weeks };
}
```

- [ ] **Step 6: Run** tests — Expected: PASS. If `monthLabel` formats differently under `en-PH`, switch the locale to `en-US` and keep the test.

- [ ] **Step 7: Commit** `git add src/lib/dashboard tests/unit/dashboard/v2-helpers.test.ts && git commit -m "feat(dashboard): banner, quote and month-grid helpers"`

### Task 4: Banner assets

**Files:**
- Create: `public/brand/banner-teacher-female.png`, `public/brand/banner-teacher-male.png`

- [ ] **Step 1:** Copy the owner-supplied files from the main checkout: `cp ../../../public/brand/banner-teacher-*.png public/brand/`. If they are absent, STOP and ask the owner to save images 1 and 2 there. Do not generate stand-in art.
- [ ] **Step 2:** Confirm dimensions are about 2000×668: `node -e "const s=require('fs').readFileSync('public/brand/banner-teacher-female.png');console.log(s.readUInt32BE(16),s.readUInt32BE(20))"`
- [ ] **Step 3: Commit** `git add public/brand && git commit -m "chore(brand): v2 teacher dashboard banners"`

### Task 5: Greeting hero

**Files:**
- Create: `src/components/dashboard/teacher/greeting-hero.tsx`
- Delete: `src/components/dashboard/teacher/greeting-header.tsx` (after Task 9 swaps callers; `grep -rn greeting-header src tests` must return nothing)

**Interfaces:**
- Consumes: `DashboardQuote` (Task 3).
- Produces: `GreetingHero(props: { firstName: string; todayKey: string; subtitle?: string; bannerSrc: string; quote: DashboardQuote })`

- [ ] **Step 1: Implement**

```tsx
import Image from "next/image";
import { CalendarDays } from "lucide-react";
import { SCHOOL_TIME_ZONE, parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * v2 hero (mockup images 3 and 4). The banner art sits right-anchored behind
 * the text; its left half is soft cloud, so the greeting stays legible there.
 * Desktop shows the quote; mobile shows the date chip instead.
 */
export function GreetingHero({
  firstName,
  todayKey,
  subtitle,
  bannerSrc,
  quote,
}: {
  firstName: string;
  todayKey: string;
  subtitle?: string;
  bannerSrc: string;
  quote: DashboardQuote;
}) {
  const hour = Number(
    new Intl.DateTimeFormat("en-PH", { timeZone: SCHOOL_TIME_ZONE, hour: "numeric", hour12: false }).format(new Date())
  );
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(parseLocalDateKey(todayKey));

  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-violet-50/60 dark:bg-slate-900/60 lg:rounded-none lg:bg-transparent">
      <Image
        src={bannerSrc}
        alt=""
        aria-hidden
        fill
        priority
        sizes="(min-width: 1024px) 70vw, 100vw"
        className="-z-10 object-cover object-right dark:opacity-80"
      />
      <div className="flex min-h-[15rem] flex-col justify-center px-5 py-6 sm:min-h-[12rem] lg:min-h-[13.5rem] lg:px-1 lg:py-4">
        <p className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300 lg:block">
          {greetingFor(hour)},
        </p>
        <p className="text-xl font-semibold text-blue-600 dark:text-blue-300 lg:hidden">
          {greetingFor(hour)},
        </p>
        <h1 className="mt-0.5 text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white lg:text-5xl">
          {firstName}! <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 max-w-[14rem] text-base text-slate-600 dark:text-slate-300 sm:max-w-md lg:text-lg lg:text-slate-800">
          {subtitle ?? "Here's what's happening with your class today."}
        </p>
        <blockquote className="mt-4 hidden max-w-lg text-sm italic text-slate-600 dark:text-slate-300 lg:block">
          “{quote.text}”
          <footer className="mt-0.5 not-italic">— {quote.author}</footer>
        </blockquote>
        <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-card/90 px-3 py-2 text-sm font-medium text-foreground lg:hidden">
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          {dateLabel}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2:** `npm run typecheck` — Expected: pass.
- [ ] **Step 3: Commit** `git add src/components/dashboard/teacher/greeting-hero.tsx && git commit -m "feat(dashboard): v2 greeting hero"`

### Task 6: Stat cards v2

**Files:**
- Modify: `src/components/dashboard/teacher/stat-cards.tsx`

**Interfaces:**
- Produces: unchanged `StatCardProps`; `StatCard` gains optional `href?: string` (mobile: whole card links there when no `action`, and shows a chevron in the title row).

- [ ] **Step 1: Restyle to mockup** — keep the tone maps; change the card body to:

```tsx
export function StatCard({ title, value, hint, icon: Icon, tone, action, href }: StatCardProps & { href?: string }) {
  const target = action?.href ?? href;
  return (
    <Surface as="section" className="relative flex flex-col overflow-hidden rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TILE[tone])}>
          <Icon className="size-5" />
        </span>
        <h2 className="flex-1 text-sm font-semibold text-foreground sm:text-base">{title}</h2>
        {target ? <ChevronRight aria-hidden className={cn("size-4 lg:hidden", LINK[tone])} /> : null}
      </div>
      <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      {action ? (
        <PrefetchLink
          href={action.href}
          prefetch
          className={cn(
            "mt-4 hidden w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium lg:inline-flex",
            PILL[tone]
          )}
        >
          {action.label}
          <ArrowRight aria-hidden className="size-4" />
        </PrefetchLink>
      ) : null}
      {target ? (
        <PrefetchLink href={target} prefetch aria-label={title} className="absolute inset-0 lg:hidden" />
      ) : null}
    </Surface>
  );
}
```

with a new map:

```ts
const PILL: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200",
  emerald: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200",
  primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200",
};
```

Import `ChevronRight`. `StatCardRow` becomes `grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4`.

- [ ] **Step 2:** `npx vitest run tests/unit/aral-profile-dormant.test.ts` — Expected: PASS (Pending Profiles still has no `action`; do not pass `href` to it either).
- [ ] **Step 3: Commit** `git commit -am "feat(dashboard): v2 stat cards"`

### Task 7: Overview panels v2

**Files:**
- Modify: `src/components/dashboard/teacher/overview-panels.tsx`

**Interfaces:** unchanged exports `AttendanceOverviewPanel({ data, href })`, `ReadingOverviewPanel({ data, href })`.

- [ ] **Step 1:** Read the file fully. Keep data mapping and donut. Change layout to mockup image 3:
  - Header row: tinted icon tile (size-11 rounded-xl) + title "Attendance Overview" with muted "(This Week)" + subtitle; right side a static chip `This Week` / `This Month` (`rounded-lg border px-3 py-1.5 text-xs`), not a select — no historical view exists.
  - Body `lg:grid-cols-[auto_1fr_12rem]`: donut (percentage + "Present rate" / "Completion rate"), legend rows `label ····· N (P%)`, tip box `rounded-xl bg-violet-50 p-4` (attendance: calendar icon, "Let's keep them coming!", "Take attendance daily to track learners' progress and engagement.") / `bg-amber-50` (reading: book icon, "Keep reading!", "Help learners build a brighter future through reading.").
  - Footer: pill action `rounded-full bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700` with ArrowRight, right-aligned under the tip box on desktop, full width on mobile.
  - Mobile (`< lg`): title + chevron link, subtitle "This Week", centered donut, compact 2-column legend (`Present 0 · Late 0 · Absent 0 · Unmarked 75` — Excused hidden on mobile, as in image 4), tip box hidden, pill full width.
  - Reading donut ring uses amber for pending as in the mockup.
- [ ] **Step 2:** `npm run typecheck && npx vitest run tests/unit/dashboard` — Expected: pass.
- [ ] **Step 3: Commit** `git commit -am "feat(dashboard): v2 overview panels"`

### Task 8: Tasks, quick actions, calendar card

**Files:**
- Modify: `src/components/dashboard/teacher/tasks-panel.tsx`
- Create: `src/components/dashboard/teacher/calendar-card.tsx`

**Interfaces:**
- Consumes: `buildMonthGrid`, `DashboardQuote` (Task 3).
- Produces: `CalendarCard({ todayKey: string; quote: DashboardQuote })`; `QuickActionsPanel({ attendanceHref, addLearnerHref, reportsHref })`; `UpcomingTasksPanel` unchanged props.

- [ ] **Step 1: Calendar card**

```tsx
import { Surface } from "@/components/ui/surface";
import { buildMonthGrid } from "@/lib/dashboard/month-grid";
import { parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Decorative month view for the right rail. Not a picker: nothing on the dashboard is date-navigable. */
export function CalendarCard({ todayKey, quote }: { todayKey: string; quote: DashboardQuote }) {
  const { weeks } = buildMonthGrid(todayKey);
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(parseLocalDateKey(todayKey));

  return (
    <Surface as="section" aria-label="Calendar" className="overflow-hidden rounded-2xl">
      <svg viewBox="0 0 280 64" aria-hidden className="block h-16 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cal-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dbeafe" />
            <stop offset="1" stopColor="#ede9fe" />
          </linearGradient>
        </defs>
        <rect width="280" height="64" fill="url(#cal-sky)" />
        <circle cx="190" cy="26" r="11" fill="#fde68a" />
        <path d="M0 64 L0 44 Q40 20 80 40 T160 34 T240 38 T280 30 L280 64 Z" fill="#a5b4fc" opacity=".7" />
        <path d="M0 64 L0 52 Q60 36 120 50 T280 46 L280 64 Z" fill="#818cf8" opacity=".55" />
      </svg>
      <div className="px-4 pb-4 pt-3">
        <p className="border-l-2 border-violet-500 pl-2 text-sm font-semibold text-foreground">{dateLabel}</p>
        <table className="mt-3 w-full table-fixed text-center text-xs">
          <thead>
            <tr>{WEEKDAYS.map((d, i) => <th key={i} className="pb-1.5 font-medium text-muted-foreground">{d}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((w, wi) => (
              <tr key={wi}>
                {w.map((c, ci) => (
                  <td key={ci} className="py-1">
                    {c ? (
                      <span
                        aria-current={c.isToday ? "date" : undefined}
                        className={cn(
                          "mx-auto flex size-7 items-center justify-center rounded-full tabular-nums text-foreground",
                          c.isToday && "bg-violet-600 font-semibold text-white"
                        )}
                      >
                        {c.day}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm italic text-muted-foreground">— “{quote.text}”</p>
      </div>
    </Surface>
  );
}
```

The mockup shows three weeks around today; show the full month (simpler and correct); if it makes the rail taller than the stat row plus panels at 1672px, render only the weeks containing today −1/+1 by slicing `weeks` around the index of today's week.

- [ ] **Step 2: Tasks panel** — header: violet tile with `ClipboardCheck`, "Upcoming Tasks", right-aligned "View all" link (with `ArrowRight` on mobile only). Rows: hollow circle `size-5 rounded-full border-2 border-muted-foreground/40` + label + due line, badge pill on the right (keep `BADGE` map). Remove the footer "View all tasks" link.

- [ ] **Step 3: Quick actions** — replace `actions` with:

```ts
  const actions = [
    { id: "attendance", label: "Take Attendance", icon: CalendarCheck, href: attendanceHref, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200" },
    { id: "add-learner", label: "Add Learner", icon: UserPlus, href: addLearnerHref, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" },
    { id: "reports", label: "View Reports", icon: BarChart3, href: reportsHref, tone: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200" },
    { id: "generate", label: "Generate Report", icon: FileText, href: reportsHref, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200" },
  ];
```

Grid `grid-cols-2 gap-3`; each tile `flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-semibold` + tone, `ChevronRight` at the end on mobile only. Props change: drop `readingHref`, add `addLearnerHref`.

- [ ] **Step 4:** Find the add-learner entry: read `src/components/learners/learner-add-menu.tsx` and `src/app/teacher/(app)/learners/page.tsx`. If the page supports a query param that opens the add dialog, use it (e.g. `/teacher/learners?add=1`); if not, use `/teacher/learners`. Do not add a new param in this task.

- [ ] **Step 5:** `npm run typecheck` (fails until Task 9 updates the caller — acceptable only if the sole error is in `dashboard-body.tsx`). Commit `git add -A src/components/dashboard/teacher && git commit -m "feat(dashboard): v2 tasks, quick actions, calendar card"`

### Task 9: Dashboard body grid and page wiring

**Files:**
- Modify: `src/components/dashboard/teacher/dashboard-body.tsx`
- Modify: `src/components/dashboard/teacher/dashboard-skeleton.tsx`
- Modify: `src/app/teacher/(app)/(dashboard)/page.tsx`
- Delete: `src/components/dashboard/teacher/greeting-header.tsx`, and `notice-strip.tsx` if no other importer (`grep -rn notice-strip src`)

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7, 8.
- Produces: `TeacherDashboardBody` gains `bannerSrc: string`.

- [ ] **Step 1: Page** — after `requireUser`, load gender for real teachers only:

```ts
  const gender = isSuperAdmin
    ? null
    : (await prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { gender: true } }))?.gender ?? null;
```

Import `prisma` from `@/lib/prisma` and `teacherBannerSrc` from `@/lib/dashboard/banner`; pass `bannerSrc={teacherBannerSrc(gender)}`.

- [ ] **Step 2: Body** — `const quote = pickQuote();` at the top. Replace both `GreetingHeader` usages with `<GreetingHero firstName todayKey subtitle bannerSrc quote />`. New main return:

```tsx
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <GreetingHero firstName={firstName} todayKey={data.todayKey} subtitle={subtitle} bannerSrc={bannerSrc} quote={quote} />
        <StatCardRow>{/* four StatCards as today; Pending Profiles keeps no action/href */}</StatCardRow>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <AttendanceOverviewPanel data={data} href={attendanceHref} />
          <ReadingOverviewPanel data={data} href={readingHref} />
        </div>
        <div className="xl:hidden"><UpcomingTasksPanel tasks={tasks} viewAllHref={reportsHref} /></div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <GradeChartCard data={data} chartData={chartData} className="hidden lg:flex" />
          <QuickActionsPanel attendanceHref={attendanceHref} addLearnerHref={ADD_LEARNER_HREF} reportsHref={reportsHref} />
        </div>
      </div>
      <aside className="hidden flex-col gap-4 xl:flex">
        <CalendarCard todayKey={data.todayKey} quote={pickQuote()} />
        <UpcomingTasksPanel tasks={tasks} viewAllHref={reportsHref} />
      </aside>
    </div>
  );
```

Move the existing "Learners by Grade Level" `Surface` into a local `GradeChartCard` component in the same file, adding the mockup's summary tile beside the chart: `rounded-xl bg-violet-50 p-4` with users icon, "**{data.totalLearners} learners**", "across {data.gradeCount} grade level(s)", and the line "Each learner is a unique story waiting to be written. ♥". Remove `NoticeStrip`. Overview panels grid is `grid-cols-2` on mobile per image 4; at `sm`–`lg` if a panel's legend overflows, fall back to `grid-cols-1 sm:grid-cols-2`.

- [ ] **Step 3: Skeleton** — mirror the new grid (hero block `h-56 rounded-2xl`, 2×2 / 4 stat blocks, 2 panels, right rail on xl).
- [ ] **Step 4:** `npm run typecheck && npm run test` — Expected: pass. Update `tests/unit/aral-profile-dormant.test.ts` only if it reads a path that moved; never relax its assertions.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(dashboard): v2 teacher dashboard layout"`

### Task 10: Shell v2 (sidebar + header)

**Files:**
- Modify: `src/components/app-sidebar.tsx`, `src/components/shell/app-header.tsx`

- [ ] **Step 1: Sidebar (image 3)** —
  - Brand block: logo `h-12`, "LITRACK" `text-lg font-extrabold`, school name `text-sm text-muted-foreground`.
  - Active `NavLink`: `rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm` with white icon; inactive: `text-foreground/80 hover:bg-muted`, icon `text-foreground/70`, row `py-3 text-[15px]`.
  - Group labels: `text-xs font-semibold uppercase tracking-wider text-muted-foreground`. Rename labels to match the mockup — "Menu" → "Learners", unnamed reports group → "Analytics" — in `src/lib/nav/nav-config.ts` for the TEACHER branch only; update `tests/unit/nav*` expectations for those two labels.
  - Keep the motto image, version link, `UserAccountMenu`, `SignOutButton` (Sign out row gets `text-destructive` icon per mockup).
- [ ] **Step 2: Header (image 3)** — remove the title `<p>` on the dashboard route only (`navPath === "/teacher"`); search `max-w-xl rounded-xl` placed left after the collapse toggle; right cluster: bell, theme toggle, `Separator`, date (`CalendarDays` + `Sunday, September 13, 2026`, from `formatLocalDateKey(schoolToday())` parsed with `parseLocalDateKey`), `hidden md:flex`.
- [ ] **Step 3: Mobile top bar (image 4)** — below `lg`: hamburger (existing Sheet trigger), centered logo + "LITRACK" + school name, avatar initials circle (`size-10 rounded-full bg-violet-200 text-violet-800`) with `ChevronDown`, opening `UserAccountMenu`. Search, bell and date hidden below `sm`. School name reaches the header through the same prop the sidebar already receives; add it to `AppHeader` props from `role-shell.tsx`.
- [ ] **Step 4:** `npm run typecheck && npm run test` — pass.
- [ ] **Step 5: Commit** `git commit -am "feat(shell): v2 sidebar and header"`

### Task 11: Visual verification against mockups

- [ ] **Step 1:** Add `litrack-v2-dev` to `.claude/launch.json` in the worktree: `npm run dev -- --port 3001`, port 3001. Copy `.env.local` from the main checkout (it is gitignored; never commit it). Warn: it points at production data — read-only browsing only.
- [ ] **Step 2:** Start it with `preview_start`, sign in as a teacher (owner provides credentials or signs in themselves in the pane — never type passwords).
- [ ] **Step 3:** At `resize_window` 1672×941, screenshot `/teacher`; compare to image 3 region by region (sidebar, header, hero, stat row, panels, chart + quick actions, right rail). List every visible difference, fix, re-screenshot. Repeat until only data-driven differences remain.
- [ ] **Step 4:** At 390×844 (`preset: mobile`), compare to image 4 the same way.
- [ ] **Step 5:** Dark mode (`colorScheme: dark`) at both sizes — nothing unreadable.
- [ ] **Step 6:** Set gender to Male in Settings → Profile on a test teacher only with owner approval (it writes production data); otherwise verify the male banner by temporarily passing `teacherBannerSrc("MALE")` locally, then revert.
- [ ] **Step 7:** Floating teacher (0 grades) and Super Admin `?schoolId=` view still render.
- [ ] **Step 8: Commit** fixes as `fix(dashboard): v2 visual parity`.

### Task 12: Migration apply (owner-gated) and release

- [ ] **Step 1:** Show the owner the SQL from Task 1 and the target (`.env.local` production Supabase). Wait for an explicit yes in chat.
- [ ] **Step 2 (after yes only):** Apply with `npx prisma migrate deploy` using `DIRECT_URL`, then `npx prisma migrate status` — expect "Database schema is up to date".
- [ ] **Step 3:** Release entry at top of `RELEASES` in `src/lib/releases.ts`:

```ts
  {
    version: "2.0.0",
    date: "2026-09-15",
    title: "A fresh new look for your dashboard",
    announce: true,
    fixes: [
      "Your dashboard has a brand-new design, with a welcome banner and a calendar.",
      "A new encouraging quote greets you each time you open your dashboard.",
      "You can set your gender in your profile to choose your dashboard artwork.",
      "Quick actions now let you take attendance, add a learner and open reports in one tap.",
      "The dashboard is easier to use on phones.",
    ],
  },
```

Match the existing entries' field names exactly (read the top entry first).
- [ ] **Step 4:** Set `"version": "2.0.0"` in `package.json`, and both `version` fields in `package-lock.json`.
- [ ] **Step 5:** `npm run typecheck && npm run test && npm run build` — all pass. Lint from main checkout on this branch before merge.
- [ ] **Step 6: Commit** `git commit -am "feat: LITRACK v2.0.0 teacher dashboard redesign (2.0.0)"`. Do not push or merge without the owner's instruction.

---

## Open item for the owner

The mockups use violet for the active nav pill and dashboard action pills. `CLAUDE.md` reserves violet as the ARAL accent. Tasks 6–10 follow the mockup; confirm before merge, or switch those pills to the blue primary.
