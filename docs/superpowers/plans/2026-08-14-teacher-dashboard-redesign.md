# Teacher Dashboard & Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the LITRACK teacher shell (grouped sidebar, header lifted out of the content panel, search + notifications + dark-mode toggle) and rebuild the teacher dashboard to match the supplied design mock, using shadcn/ui primitives and a retuned violet accent.

**Architecture:** `RoleShell` stops wrapping header and children in one rounded panel — the header becomes a sibling bar above a `bg-background` content region whose panels are individually elevated cards. Sidebar nav data moves out of `app-sidebar.tsx` into a shared `src/lib/nav/nav-config.ts` so the header can derive the page title from the same source. The dashboard page composes new presentational components in `src/components/dashboard/` fed by two new read-only aggregates in `src/lib/dashboard/aggregates.ts`. No schema changes, no migrations, no new npm dependencies.

**Tech Stack:** Next.js 15.5 App Router (RSC + `Suspense` streaming), React 19, TypeScript strict, Tailwind + shadcn/ui, Recharts 3, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-teacher-dashboard-redesign.md`

## Global Constraints

- **No new npm dependencies.** `@radix-ui/react-popover`, `-select`, `-separator`, `-tooltip`, `-dialog` are already installed; `lucide-react@^0.454.0` supplies every icon used here.
- **No Prisma schema or migration changes.** Every number on the dashboard comes from existing models (`Learner`, `Attendance`, `ReadingLevelRecord`, `GradeLevel`).
- **Violet is reserved for ARAL** (project convention, `tailwind.config.ts`). Blue `--primary` and amber `--secondary` are unchanged.
- **Tenancy:** every new query filters by the teacher's assigned grade IDs via the existing `teacherGradeFilter` / `teacherLearnerFilter` helpers in `src/lib/dashboard/aggregates.ts`. Never query without that scope.
- **Dates:** use `formatLocalDateKey` / `addDays` from `src/lib/date-keys.ts`. Never `toISOString()` (UTC+8 day shift).
- **All new aggregates** go through `cachedQuery` with `tags: [teacherDashboard(teacherId)]` and `profile: "aggregate"`, matching the existing functions in that file.
- **Shell changes are shared across all three roles.** Admin and School Head must keep working; only the teacher gets grouped nav sections and the new dashboard.
- **Teacher dashboard stays `export const dynamic = "force-dynamic"`** with per-section `<Suspense>`.
- **Accessibility:** icon-only controls carry `aria-label`; segmented bars carry `role="img"` + `aria-label` summary.
- **Header height token:** `--app-chrome-header-height` becomes `4rem` (was `3rem`). Sidebar brand block reads the same token — do not hardcode.
- **Verification gate** for every task: `npm run typecheck` and `npm run lint` must pass before commit. Full `npm run test` and `npm run build` run in the final task.
- **Test conventions — read before writing any test.** `vitest.config.ts` runs `environment: "node"` by default and only maps **`tests/components/**`** to jsdom. So:
  - Component (`.test.tsx`) files go in **`tests/components/`**, flat — never `tests/components/`, which would run under node and fail on `document`.
  - Pure-logic tests go in `tests/unit/**`.
  - **`@testing-library/jest-dom` is NOT installed.** `toBeInTheDocument`, `toHaveAttribute`, `toHaveFocus`, `toHaveTextContent` do not exist. Assert with plain Vitest: `expect(el).not.toBeNull()`, `expect(el.getAttribute("href")).toBe(…)`, `expect(document.activeElement).toBe(el)`, `expect(el.textContent).toContain(…)`.
  - **`@testing-library/user-event` is NOT installed.** Use `fireEvent` from `@testing-library/react`.
  - Every component test file ends its imports with `afterEach(cleanup);` — see `tests/components/surface.test.tsx` for the house idiom.
- **Card chrome:** `src/components/ui/surface.tsx` centralises `rounded-xl border border-border/80 bg-card text-card-foreground shadow-card`. The existing `components/dashboard/*` files (`metric-card`, `chart-card`) still inline that string, and the new dashboard components in this plan follow suit for consistency with their neighbours. Either way, the class string must stay token-only — never `bg-white` or a hardcoded hex, which would break dark mode.

---

### Task 1: Retune the violet accent palette

**Files:**
- Modify: `src/app/globals.css:6-43` (`:root`), `src/app/globals.css:45-73` (`.dark`), `src/app/globals.css:115-119` (`.violet-section`)
- Modify: `tailwind.config.ts:54-66` (violet scale)
- Test: `tests/unit/theme/violet-tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utilities `bg-violet`, `bg-violet-soft`, `text-violet`, `text-violet-soft-foreground`, `border-violet-soft`, plus the retuned numbered scale `violet-50 … violet-950`. CSS variables `--violet`, `--violet-foreground`, `--violet-soft`, `--violet-soft-foreground` are defined in both `:root` and `.dark`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/theme/violet-tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const tw = readFileSync(resolve(process.cwd(), "tailwind.config.ts"), "utf8");

function block(name: ":root" | ".dark"): string {
  const start = css.indexOf(`${name} {`);
  expect(start, `${name} block missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n  }", start));
}

describe("violet accent tokens", () => {
  const VARS = [
    "--violet",
    "--violet-foreground",
    "--violet-soft",
    "--violet-soft-foreground",
  ];

  it("defines every violet var in both themes", () => {
    for (const name of VARS) {
      expect(block(":root")).toContain(`${name}:`);
      expect(block(".dark")).toContain(`${name}:`);
    }
  });

  it("uses the mock's blue-leaning hue 255, not the old 262", () => {
    expect(block(":root")).toMatch(/--violet:\s*255 /);
    expect(tw).not.toMatch(/hsl\(262 /);
  });

  it("wires the vars into the Tailwind violet color", () => {
    expect(tw).toContain('DEFAULT: "hsl(var(--violet))"');
    expect(tw).toContain('soft: "hsl(var(--violet-soft))"');
    expect(tw).toContain('"soft-foreground": "hsl(var(--violet-soft-foreground))"');
  });

  it("keeps the numbered scale so existing ARAL utilities still resolve", () => {
    for (const step of [50, 100, 200, 500, 600, 700, 800, 900, 950]) {
      expect(tw).toContain(`${step}: "hsl(255 `);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/theme/violet-tokens.test.ts`
Expected: FAIL — `--violet: ` not found in `:root`.

- [ ] **Step 3: Add the CSS variables**

In `src/app/globals.css`, inside `:root`, replace the line `--app-chrome-header-height: 3rem;` and its comment with:

```css
    /* ARAL violet accent (design mock #6D4AE0 — blue-leaning, hue 255). */
    --violet: 255 75% 60%;
    --violet-foreground: 0 0% 100%;
    --violet-soft: 255 100% 97%;
    --violet-soft-foreground: 255 60% 40%;
    /* Shared header + sidebar brand height (toolbar h-16; logo h-10) */
    --app-chrome-header-height: 4rem;
```

Inside `.dark`, after `--ring: 217 91% 60%;` add:

```css
    --violet: 255 80% 70%;
    --violet-foreground: 255 60% 12%;
    --violet-soft: 255 45% 17%;
    --violet-soft-foreground: 255 85% 88%;
```

Then update `.violet-section` to use the tokens:

```css
.violet-section {
  background: hsl(var(--violet-soft));
  border-left: 4px solid hsl(var(--violet));
}
```

- [ ] **Step 4: Retune the Tailwind scale**

In `tailwind.config.ts`, replace the whole `violet: { … }` block with:

```ts
        /* ARAL accent. DEFAULT/soft are theme-aware; numbered steps stay
           static so existing violet-200 / violet-950 utilities keep working. */
        violet: {
          DEFAULT: "hsl(var(--violet))",
          foreground: "hsl(var(--violet-foreground))",
          soft: "hsl(var(--violet-soft))",
          "soft-foreground": "hsl(var(--violet-soft-foreground))",
          50: "hsl(255 100% 97%)",
          100: "hsl(255 96% 94%)",
          200: "hsl(255 92% 89%)",
          500: "hsl(255 75% 60%)",
          600: "hsl(255 68% 53%)",
          700: "hsl(255 62% 45%)",
          800: "hsl(255 58% 37%)",
          900: "hsl(255 54% 28%)",
          950: "hsl(255 50% 18%)",
        },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/theme/violet-tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck; if ($?) { npm run lint }`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css tailwind.config.ts tests/unit/theme/violet-tokens.test.ts
git commit -m "style: retune ARAL violet accent to the design mock hue"
```

---

### Task 2: Segmented progress bar primitive

**Files:**
- Create: `src/components/ui/segmented-bar.tsx`
- Test: `tests/components/segmented-bar.test.tsx` (create)

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces:
  ```ts
  export interface BarSegment { label: string; value: number; className: string; dotClassName: string; }
  export function SegmentedBar(props: { segments: BarSegment[]; className?: string }): JSX.Element;
  export function SegmentLegend(props: { segments: BarSegment[]; total: number; className?: string }): JSX.Element;
  export function percentOf(value: number, total: number): number; // rounded, 0 when total <= 0
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/components/segmented-bar.test.tsx`:

```tsx
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SegmentedBar,
  SegmentLegend,
  percentOf,
  type BarSegment,
} from "@/components/ui/segmented-bar";

afterEach(cleanup);

const segments: BarSegment[] = [
  { label: "Present", value: 18, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
  { label: "Absent", value: 6, className: "bg-amber-500", dotClassName: "bg-amber-500" },
  { label: "No Class", value: 0, className: "bg-muted", dotClassName: "bg-muted" },
];

describe("percentOf", () => {
  it("rounds to whole percent", () => {
    expect(percentOf(18, 24)).toBe(75);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("returns 0 for an empty total instead of NaN", () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("SegmentedBar", () => {
  it("renders one sized segment per non-zero value and skips zeroes", () => {
    const { container } = render(<SegmentedBar segments={segments} />);
    const parts = container.querySelectorAll("[data-segment]");
    expect(parts).toHaveLength(2);
    expect((parts[0] as HTMLElement).style.width).toBe("75%");
    expect((parts[1] as HTMLElement).style.width).toBe("25%");
  });

  it("exposes a text summary for screen readers", () => {
    render(<SegmentedBar segments={segments} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Present 18 (75%), Absent 6 (25%), No Class 0 (0%)"
    );
  });

  it("renders an empty track when every value is zero", () => {
    const { container } = render(
      <SegmentedBar segments={segments.map((s) => ({ ...s, value: 0 }))} />
    );
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(0);
  });
});

describe("SegmentLegend", () => {
  it("shows label, count and percent for every segment including zeroes", () => {
    render(<SegmentLegend segments={segments} total={24} />);
    expect(screen.getByText("Present")).not.toBeNull();
    expect(screen.getByText("18 (75%)")).not.toBeNull();
    expect(screen.getByText("0 (0%)")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/segmented-bar.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/segmented-bar`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/segmented-bar.tsx`:

```tsx
import { cn } from "@/lib/utils";

export interface BarSegment {
  label: string;
  value: number;
  /** Fill class for the bar slice, e.g. "bg-emerald-500". */
  className: string;
  /** Dot class for the legend swatch (usually the same color). */
  dotClassName: string;
}

/** Whole-percent share; 0 rather than NaN when the total is empty. */
export function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function sum(segments: BarSegment[]): number {
  return segments.reduce((acc, s) => acc + s.value, 0);
}

export function SegmentedBar({
  segments,
  className,
}: {
  segments: BarSegment[];
  className?: string;
}) {
  const total = sum(segments);
  const summary = segments
    .map((s) => `${s.label} ${s.value} (${percentOf(s.value, total)}%)`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={summary}
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            data-segment
            className={s.className}
            style={{ width: `${percentOf(s.value, total)}%` }}
          />
        ))}
    </div>
  );
}

export function SegmentLegend({
  segments,
  total,
  className,
}: {
  segments: BarSegment[];
  total: number;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-xs">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", s.dotClassName)} />
          <span className="font-medium text-foreground">{s.label}</span>
          <span className="text-muted-foreground">
            {s.value} ({percentOf(s.value, total)}%)
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/segmented-bar.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/ui/segmented-bar.tsx tests/components/segmented-bar.test.tsx
git commit -m "feat: add segmented bar + legend primitive"
```

---

### Task 3: Shared nav config with groups and title resolution

**Files:**
- Create: `src/lib/nav/nav-config.ts`
- Modify: `src/components/app-sidebar.tsx:69-123` (delete `getNavItems` + `resolveActiveHref`, import instead)
- Test: `tests/unit/nav/nav-config.test.ts` (create)

**Interfaces:**
- Consumes: `UserRole` from `@prisma/client`.
- Produces:
  ```ts
  export interface NavItem { label: string; href: string; icon: React.ComponentType<{ className?: string }>; badge?: number; }
  export interface NavGroup { label?: string; items: NavItem[]; }
  export interface NavGrade { id: string; label: string; hasAral?: boolean }
  export function getNavGroups(role: UserRole, grades?: NavGrade[]): NavGroup[];
  export function flattenNavGroups(groups: NavGroup[]): NavItem[];
  export function resolveActiveHref(pathname: string, items: NavItem[]): string | undefined;
  export function resolvePageTitle(pathname: string, groups: NavGroup[]): string;
  ```

> `NavItem` and `resolveActiveHref` move verbatim out of `app-sidebar.tsx`; every later task imports them from here.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nav/nav-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveHref,
  resolvePageTitle,
} from "@/lib/nav/nav-config";

const oneAral = [{ id: "g1", label: "Grade 3", hasAral: true }];
const twoAral = [
  { id: "g1", label: "Grade 3", hasAral: true },
  { id: "g2", label: "Grade 4", hasAral: true },
];

describe("getNavGroups — teacher", () => {
  it("splits nav into MENU, ARAL PROGRAM and a trailing ungrouped item", () => {
    const groups = getNavGroups("TEACHER", oneAral);
    expect(groups.map((g) => g.label)).toEqual(["Menu", "ARAL Program", undefined]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard", "Learners"]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "Weekly Attendance",
      "Monthly Reading Level",
      "End of Terms Reports",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("deep-links ARAL items to the single ARAL grade", () => {
    const [, aral] = getNavGroups("TEACHER", oneAral);
    expect(aral.items[0].href).toBe("/teacher/aral/g1/attendance");
    expect(aral.items[1].href).toBe("/teacher/aral/g1/reading-level");
  });

  it("falls back to the grade picker when there is not exactly one ARAL grade", () => {
    for (const grades of [twoAral, [], undefined]) {
      const [, aral] = getNavGroups("TEACHER", grades);
      expect(aral.items[0].href).toBe("/teacher/aral");
      expect(aral.items[1].href).toBe("/teacher/aral");
    }
  });
});

describe("getNavGroups — other roles", () => {
  it("gives admin and school head a single unlabeled group", () => {
    for (const role of ["SUPER_ADMIN", "SCHOOL_HEAD"] as const) {
      const groups = getNavGroups(role);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBeUndefined();
      expect(groups[0].items[0].href).toBe(
        role === "SUPER_ADMIN" ? "/admin" : "/school-head"
      );
    }
  });
});

describe("resolveActiveHref", () => {
  const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));

  it("prefers the longest matching prefix over the role home", () => {
    expect(resolveActiveHref("/teacher/learners/abc", items)).toBe("/teacher/learners");
  });

  it("matches the role home only exactly", () => {
    expect(resolveActiveHref("/teacher", items)).toBe("/teacher");
  });

  it("returns undefined for an unmatched path", () => {
    expect(resolveActiveHref("/account/set-password", items)).toBeUndefined();
  });
});

describe("resolvePageTitle", () => {
  const groups = getNavGroups("TEACHER", oneAral);

  it("uses the active nav item label", () => {
    expect(resolvePageTitle("/teacher", groups)).toBe("Dashboard");
    expect(resolvePageTitle("/teacher/learners/abc", groups)).toBe("Learners");
  });

  it("falls back to a humanised last segment when nothing matches", () => {
    expect(resolvePageTitle("/teacher/settings/change-password", groups)).toBe(
      "Change password"
    );
  });

  it("falls back to LITRACK at the root", () => {
    expect(resolvePageTitle("/", groups)).toBe("LITRACK");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/nav/nav-config.test.ts`
Expected: FAIL — cannot resolve `@/lib/nav/nav-config`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/nav/nav-config.ts`:

```ts
import {
  ArrowRightLeft,
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  FileBarChart,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  School,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import type { UserRole } from "@prisma/client";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

/** A labelled sidebar section. `label` omitted renders the items with no heading. */
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface NavGrade {
  id: string;
  label: string;
  hasAral?: boolean;
}

/**
 * ARAL weekly/monthly entry is grade-scoped (`/teacher/aral/[gradeId]/…`).
 * With exactly one ARAL grade we can skip the picker; otherwise link to it.
 */
function aralHref(grades: NavGrade[], suffix: string): string {
  const aralGrades = grades.filter((g) => g.hasAral);
  if (aralGrades.length !== 1) return "/teacher/aral";
  return `/teacher/aral/${aralGrades[0].id}/${suffix}`;
}

export function getNavGroups(
  role: UserRole,
  grades: NavGrade[] = []
): NavGroup[] {
  switch (role) {
    case "SUPER_ADMIN":
      return [
        {
          items: [
            { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
            { label: "Schools", href: "/admin/schools", icon: School },
            { label: "Transfers", href: "/admin/transfers", icon: ArrowRightLeft },
            { label: "School years", href: "/admin/school-years", icon: CalendarRange },
            { label: "Audit", href: "/admin/audit", icon: ScrollText },
          ],
        },
      ];
    case "SCHOOL_HEAD":
      return [
        {
          items: [
            { label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
            { label: "School years", href: "/school-head/school-years", icon: CalendarRange },
            { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
            { label: "Teachers", href: "/school-head/teachers", icon: Users },
            { label: "ARAL", href: "/school-head/aral", icon: Sparkles },
            { label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
            { label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
            { label: "School info", href: "/school-head/school-info", icon: Building2 },
            { label: "Reports", href: "/school-head/reports", icon: FileBarChart },
            { label: "Audit", href: "/school-head/audit", icon: ScrollText },
          ],
        },
      ];
    case "TEACHER":
      return [
        {
          label: "Menu",
          items: [
            { label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
            { label: "Learners", href: "/teacher/learners", icon: BookOpen },
          ],
        },
        {
          label: "ARAL Program",
          items: [
            {
              label: "Weekly Attendance",
              href: aralHref(grades, "attendance"),
              icon: CalendarDays,
            },
            {
              label: "Monthly Reading Level",
              href: aralHref(grades, "reading-level"),
              icon: BookOpen,
            },
            {
              label: "End of Terms Reports",
              href: "/teacher/reports",
              icon: FileText,
            },
          ],
        },
        {
          items: [{ label: "Reports", href: "/teacher/reports", icon: FileBarChart }],
        },
      ];
    default:
      return [];
  }
}

export function flattenNavGroups(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}

/** Single active href: exact match preferred; otherwise longest prefix. */
export function resolveActiveHref(
  pathname: string,
  items: NavItem[]
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (!best || item.href.length > best.length) {
      best = item.href;
    }
  }
  return best;
}

function humanise(segment: string): string {
  const words = segment.replaceAll("-", " ").trim();
  if (!words) return "LITRACK";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Header title: the active nav label, else a humanised trailing segment. */
export function resolvePageTitle(pathname: string, groups: NavGroup[]): string {
  const items = flattenNavGroups(groups);
  const active = resolveActiveHref(pathname, items);
  if (active) {
    const match = items.find((i) => i.href === active);
    if (match) return match.label;
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? humanise(last) : "LITRACK";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/nav/nav-config.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Point the sidebar at the shared config**

In `src/components/app-sidebar.tsx`:

1. Delete the local `interface NavItem { … }` (lines ~49-54), the whole `getNavItems` function (~69-109), and the whole `resolveActiveHref` function (~111-123).
2. Delete the now-unused icon imports from `lucide-react` — keep only `Menu` and `Shield`.
3. Add near the other imports:

```tsx
import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveHref,
  type NavItem,
} from "@/lib/nav/nav-config";
```

4. In the `AppSidebar` body, replace:

```tsx
  const navItems = getNavItems(role, grades);
  const activeHref = resolveActiveHref(pathname, navItems);
```

with:

```tsx
  const navGroups = useMemo(() => getNavGroups(role, grades ?? []), [role, grades]);
  const navItems = useMemo(() => flattenNavGroups(navGroups), [navGroups]);
  const activeHref = resolveActiveHref(pathname, navItems);
```

Leave the rendering loop as-is for now (Task 4 replaces it) — it still maps over `navItems`.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm run typecheck; if ($?) { npm run lint }`
Expected: both clean, no unused-import warnings.

- [ ] **Step 7: Commit**

```bash
git add src/lib/nav/nav-config.ts src/components/app-sidebar.tsx tests/unit/nav/nav-config.test.ts
git commit -m "refactor: extract grouped nav config and title resolution"
```

---

### Task 4: Grouped sidebar with section labels and a log-out row

**Files:**
- Modify: `src/components/app-sidebar.tsx` (NavLink active styling, `renderSidebarContent` nav + footer)
- Test: `tests/components/app-sidebar.test.tsx` (create)

**Interfaces:**
- Consumes: `getNavGroups`, `flattenNavGroups`, `resolveActiveHref`, `NavGroup`, `NavItem` from `@/lib/nav/nav-config` (Task 3); `logoutAction` from `@/lib/actions/auth`; `SignOutButton` from `@/components/sign-out-button`.
- Produces: no new exports — `AppSidebar`'s props are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/components/app-sidebar.test.tsx`:

```tsx
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/teacher" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  NavPrefetcher: () => null,
}));
vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }));

import { AppSidebar } from "@/components/app-sidebar";

afterEach(cleanup);

function renderTeacherSidebar() {
  return render(
    <AppSidebar
      role="TEACHER"
      userName="Marivic M. Acibar"
      schoolName="Malandag Central Elementary"
      grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
      expanded
    />
  );
}

describe("AppSidebar — teacher", () => {
  beforeEach(() => {
    pathname.value = "/teacher";
  });

  it("renders both section headings", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("Menu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ARAL Program").length).toBeGreaterThan(0);
  });

  it("renders the ARAL program links", () => {
    renderTeacherSidebar();
    expect(
      screen.getAllByRole("link", { name: "Weekly Attendance" })[0].getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
    expect(
      screen
        .getAllByRole("link", { name: "Monthly Reading Level" })[0]
        .getAttribute("href")
    ).toBe("/teacher/aral/g1/reading-level");
  });

  it("marks only the active item with aria-current", () => {
    renderTeacherSidebar();
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((el) => el.textContent?.includes("Dashboard"))).toBe(true);
  });

  it("shows the brand block with the school name", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("LITRACK").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Malandag Central Elementary").length
    ).toBeGreaterThan(0);
  });

  it("renders a log out control in the footer", () => {
    renderTeacherSidebar();
    // SignOutButton's visible label is "Sign out".
    expect(
      screen.getAllByRole("button", { name: /sign out|log ?out/i }).length
    ).toBeGreaterThan(0);
  });
});

describe("AppSidebar — school head", () => {
  it("renders no section heading for single-group roles", () => {
    pathname.value = "/school-head";
    render(<AppSidebar role="SCHOOL_HEAD" userName="Head" expanded />);
    expect(screen.queryByText("Menu")).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Teachers" })[0].getAttribute("href")
    ).toBe("/school-head/teachers");
  });
});
```

> `AppSidebar` renders inside `TooltipProvider` and a `Sheet`; both mount fine in jsdom. `PrefetchLink` wraps `next/link`, which the mock above replaces with a plain `<a>` — the same shim `tests/components/prefetch-link.test.tsx` uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/app-sidebar.test.tsx`
Expected: FAIL — "ARAL Program" heading not found and no log-out control.

- [ ] **Step 3: Restyle `NavLink` to match the mock**

In `src/components/app-sidebar.tsx`, replace the `link` constant inside `NavLink` with (drops the left accent bar, adds violet active state and `aria-current`):

```tsx
  const link = (
    <PrefetchLink
      href={item.href}
      {...(fullPrefetch ? { prefetch: true as const } : {})}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
        isActive
          ? "bg-violet-soft text-violet-soft-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          isActive ? "text-violet-soft-foreground" : "text-muted-foreground"
        )}
      />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {item.badge ? (
        collapsed ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet"
          />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet text-[10px] font-medium text-violet-foreground">
            {item.badge}
          </span>
        )
      ) : null}
    </PrefetchLink>
  );
```

- [ ] **Step 4: Render grouped nav**

In `renderSidebarContent`, replace the whole `<ScrollArea>…</ScrollArea>` block with:

```tsx
        <ScrollArea className={cn("flex-1 pb-5 pt-2", isCollapsed ? "px-1.5" : "px-3")}>
          <nav aria-label="Primary" className="space-y-5">
            {navGroups.map((group, groupIndex) => (
              <div key={group.label ?? `group-${groupIndex}`} className="space-y-1">
                {group.label && !isCollapsed ? (
                  <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    {group.label}
                  </p>
                ) : null}
                {group.items.map((item) => (
                  <NavLink
                    key={`${group.label ?? "root"}:${item.href}:${item.label}`}
                    item={item}
                    isActive={item.href === activeHref}
                    onNavigate={onNavigate}
                    fullPrefetch={item.href === homeHref}
                    collapsed={isCollapsed}
                  />
                ))}
              </div>
            ))}
          </nav>
        </ScrollArea>
```

> Keys include the label because "End of Terms Reports" and "Reports" share the `/teacher/reports` href.

- [ ] **Step 5: Add the log-out row under the account card**

Replace the sidebar footer block with:

```tsx
        <div className={cn("shrink-0 space-y-1 py-3", isCollapsed ? "px-1.5" : "px-3")}>
          <UserAccountMenu
            role={accountRole}
            userName={userName}
            roleLabel={roleLabel}
            side="top"
            align="start"
            collapsed={isCollapsed}
            className={isCollapsed ? "w-full justify-center" : "w-full justify-start"}
          />
          <form action={logoutAction}>
            <SignOutButton
              className={cn(
                "w-full text-muted-foreground hover:text-foreground",
                isCollapsed ? "justify-center px-2" : "justify-start px-3"
              )}
              iconOnly={isCollapsed}
            />
          </form>
        </div>
```

Add the imports:

```tsx
import { SignOutButton } from "@/components/sign-out-button";
import { logoutAction } from "@/lib/actions/auth";
```

Open `src/components/sign-out-button.tsx` and confirm it accepts `className`. If it does **not** accept an `iconOnly` prop, add one:

```tsx
export function SignOutButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
```

and render `{iconOnly ? <span className="sr-only">Log out</span> : "Log out"}` in place of the current label text, keeping the existing icon and `type="submit"`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/components/app-sidebar.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/app-sidebar.tsx src/components/sign-out-button.tsx tests/components/app-sidebar.test.tsx
git commit -m "feat: grouped sidebar sections with ARAL program links and log out row"
```

---

### Task 5: Header search field

**Files:**
- Create: `src/components/shell/header-search.tsx`
- Test: `tests/components/header-search.test.tsx` (create)

**Interfaces:**
- Consumes: `Input` from `@/components/ui/input`; `useRouter` from `next/navigation`.
- Produces:
  ```ts
  export function HeaderSearch(props: { searchHref: string; placeholder?: string; className?: string }): JSX.Element;
  ```
  `searchHref` is the destination list route (e.g. `/teacher/learners`); submitting pushes `` `${searchHref}?q=${encodeURIComponent(query)}` ``.

- [ ] **Step 1: Write the failing test**

Create `tests/components/header-search.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { HeaderSearch } from "@/components/shell/header-search";

beforeEach(() => push.mockClear());
afterEach(cleanup);

/** Types into a controlled input and submits the enclosing form. */
function search(value: string) {
  const input = screen.getByRole("searchbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  return input;
}

describe("HeaderSearch", () => {
  it("navigates to the search href with an encoded query", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    search("juan dela cruz");
    expect(push).toHaveBeenCalledWith("/teacher/learners?q=juan%20dela%20cruz");
  });

  it("ignores a whitespace-only submit", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    search("   ");
    expect(push).not.toHaveBeenCalled();
  });

  it("labels the input from the placeholder", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    expect(
      screen.getByRole("searchbox").getAttribute("aria-label")
    ).toBe("Search learners...");
  });

  it("focuses the input on Cmd/Ctrl+K and blurs on Escape", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/header-search.test.tsx`
Expected: FAIL — cannot resolve `@/components/shell/header-search`.

- [ ] **Step 3: Write the implementation**

Create `src/components/shell/header-search.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Header quick search. Submits to the role's learner list via `?q=`, which the
 * list pages already parse — no client-side index and no new endpoint.
 */
export function HeaderSearch({
  searchHref,
  placeholder = "Search learners...",
  className,
}: {
  searchHref: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (!trimmed) return;
        router.push(`${searchHref}?q=${encodeURIComponent(trimmed)}`);
      }}
      className={cn("relative", className)}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") inputRef.current?.blur();
        }}
        className="h-9 rounded-lg border-transparent bg-muted pl-9 pr-14 text-sm focus-visible:border-input focus-visible:bg-background"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex"
      >
        ⌘K
      </kbd>
    </form>
  );
}
```

`src/components/ui/input.tsx` is already a `React.forwardRef<HTMLInputElement, …>` component, so `inputRef` works with no change to that file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/header-search.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/shell/header-search.tsx tests/components/header-search.test.tsx
git commit -m "feat: add header quick search with Cmd+K focus"
```

---

### Task 6: Notification bell and popover

**Files:**
- Create: `src/components/shell/notifications-menu.tsx`
- Test: `tests/components/notifications-menu.test.tsx` (create)

**Interfaces:**
- Consumes: `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`; `Button` from `@/components/ui/button`; `PrefetchLink`.
- Produces:
  ```ts
  export interface ShellNotification { id: string; title: string; description: string; href: string; tone: "violet" | "amber" | "muted"; }
  export function NotificationsMenu(props: { notifications: ShellNotification[] }): JSX.Element;
  ```
  Notifications are derived server-side (Task 8 supplies them) — nothing is persisted.

- [ ] **Step 1: Write the failing test**

Create `tests/components/notifications-menu.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import {
  NotificationsMenu,
  type ShellNotification,
} from "@/components/shell/notifications-menu";

afterEach(cleanup);

const items: ShellNotification[] = [
  {
    id: "aral-pending",
    title: "1 ARAL profile incomplete",
    description: "Finish Sections B–E to unlock reporting.",
    href: "/teacher/aral",
    tone: "violet",
  },
  {
    id: "attendance-week",
    title: "Weekly attendance not submitted",
    description: "Due Sunday.",
    href: "/teacher/aral",
    tone: "amber",
  },
];

describe("NotificationsMenu", () => {
  it("shows the unread count in the trigger label and badge", () => {
    render(<NotificationsMenu notifications={items} />);
    const trigger = screen.getByRole("button", { name: "Notifications, 2 unread" });
    expect(trigger.textContent).toContain("2");
  });

  it("renders an empty-state label when there is nothing", () => {
    render(<NotificationsMenu notifications={[]} />);
    const trigger = screen.getByRole("button", { name: "Notifications, none unread" });
    expect(trigger.textContent).not.toContain("0");
  });

  it("lists every notification as a link when opened", async () => {
    render(<NotificationsMenu notifications={items} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const link = await screen.findByRole("link", { name: /ARAL profile incomplete/ });
    expect(link.getAttribute("href")).toBe("/teacher/aral");
    expect(
      screen.getByRole("link", { name: /Weekly attendance not submitted/ })
    ).not.toBeNull();
  });

  it("shows an empty message when opened with no notifications", async () => {
    render(<NotificationsMenu notifications={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText("You're all caught up.")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/notifications-menu.test.tsx`
Expected: FAIL — cannot resolve `@/components/shell/notifications-menu`.

- [ ] **Step 3: Write the implementation**

Create `src/components/shell/notifications-menu.tsx`:

```tsx
"use client";

import { Bell } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ShellNotification {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: "violet" | "amber" | "muted";
}

const toneDot: Record<ShellNotification["tone"], string> = {
  violet: "bg-violet",
  amber: "bg-amber-500",
  muted: "bg-muted-foreground/50",
};

/** Derived, non-persisted alerts (pending profiling, due submissions). */
export function NotificationsMenu({
  notifications,
}: {
  notifications: ShellNotification[];
}) {
  const count = notifications.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={
            count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread"
          }
        >
          <Bell className="h-5 w-5" aria-hidden />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet px-1 text-[10px] font-semibold text-violet-foreground">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>

        {count === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((n) => (
              <li key={n.id}>
                <PrefetchLink
                  href={n.href}
                  className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted"
                >
                  <span
                    aria-hidden
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", toneDot[n.tone])}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {n.description}
                    </span>
                  </span>
                </PrefetchLink>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/notifications-menu.test.tsx`
Expected: PASS (4 tests).

> Radix Popover needs browser APIs jsdom lacks. There is **no** `tests/setup.ts` in this repo, so if the open-popover assertions fail with `ResizeObserver is not defined` or `hasPointerCapture is not a function`, add the stubs at the top of this test file (not a global setup file — the repo has no setup-file convention to follow):
>
> ```ts
> globalThis.ResizeObserver ??= class {
>   observe() {} unobserve() {} disconnect() {}
> } as unknown as typeof ResizeObserver;
> Element.prototype.hasPointerCapture ??= () => false;
> Element.prototype.setPointerCapture ??= () => {};
> Element.prototype.releasePointerCapture ??= () => {};
> Element.prototype.scrollIntoView ??= () => {};
> ```

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/shell/notifications-menu.tsx tests/components/notifications-menu.test.tsx
git commit -m "feat: add shell notifications popover"
```

---

### Task 7: Lift the header out of the content panel

**Files:**
- Create: `src/components/shell/app-header.tsx`
- Modify: `src/components/role-shell.tsx:47-104`
- Modify: `src/components/app-shell.tsx:41-58` and `:103-145`
- Test: `tests/components/app-header.test.tsx` (create)

**Interfaces:**
- Consumes: `resolvePageTitle`, `getNavGroups`, `NavGrade` (Task 3); `HeaderSearch` (Task 5); `NotificationsMenu`, `ShellNotification` (Task 6); existing `ThemeToggle`, `Button`, `Separator`.
- Produces:
  ```ts
  export function AppHeader(props: {
    role: UserRole;
    grades?: NavGrade[];
    notifications?: ShellNotification[];
    expanded: boolean;
    onToggleSidebar: () => void;
  }): JSX.Element;
  ```
  `RoleShell` gains one new optional prop: `notifications?: ShellNotification[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/app-header.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/teacher" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { AppHeader } from "@/components/shell/app-header";
import { ThemeProvider } from "@/components/theme/theme-provider";

afterEach(cleanup);

function renderHeader(onToggle = vi.fn()) {
  render(
    <ThemeProvider>
      <AppHeader
        role="TEACHER"
        grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
        notifications={[]}
        expanded
        onToggleSidebar={onToggle}
      />
    </ThemeProvider>
  );
  return onToggle;
}

describe("AppHeader", () => {
  it("shows the page title from the active nav item", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByRole("heading", { name: "Dashboard" })).not.toBeNull();
  });

  it("updates the title for a nested route", () => {
    pathname.value = "/teacher/learners/abc";
    renderHeader();
    expect(screen.getByRole("heading", { name: "Learners" })).not.toBeNull();
  });

  it("renders search, notifications and the theme toggle", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByRole("searchbox")).not.toBeNull();
    expect(screen.getByRole("button", { name: /notifications/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /switch to (dark|light) mode/i })).not.toBeNull();
  });

  it("calls onToggleSidebar when the collapse button is pressed", () => {
    pathname.value = "/teacher";
    const onToggle = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/app-header.test.tsx`
Expected: FAIL — cannot resolve `@/components/shell/app-header`.

- [ ] **Step 3: Write `AppHeader`**

Create `src/components/shell/app-header.tsx`:

```tsx
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

        <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
          {title}
        </h1>

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
```

- [ ] **Step 4: Restructure `RoleShell`**

In `src/components/role-shell.tsx`:

1. Replace the `Menu`, `Breadcrumbs`, `ThemeToggle`, `Button` imports with:

```tsx
import { AppHeader } from "@/components/shell/app-header";
import type { ShellNotification } from "@/components/shell/notifications-menu";
```

2. Add `notifications?: ShellNotification[];` to `RoleShellProps` and destructure it in the signature.

3. Replace everything from `{/* Inset gutters live INSIDE… */}` through the closing of `{children}`'s wrapper (i.e. the `<div className="lg:p-4">` block) with:

```tsx
        {/* Header sits OUTSIDE the content panel (spec R1): full-bleed bar,
            then page content on the workspace ground with gutters. */}
        <AppHeader
          role={role}
          grades={grades}
          notifications={notifications}
          expanded={expanded}
          onToggleSidebar={toggle}
        />

        <div className="min-h-[calc(100dvh-var(--app-chrome-header-height))] bg-background">
          {children}
        </div>
```

- [ ] **Step 5: Update `AppShell` to match the new spacing**

In `src/components/app-shell.tsx`:

1. In the `inRoleShell` branch, drop the duplicated title block (the header owns the title now) and use the mock's gutters:

```tsx
  if (inRoleShell) {
    return (
      <main id="main-content" className="w-full p-4 lg:p-6">
        {children}
      </main>
    );
  }
```

`title` and `subtitle` stay in the props interface — callers across all roles still pass them, and the fallback path below still renders them. Leave the interface unchanged.

2. In `AppShellFallback`, replace the inline `<header>…</header>` (lines ~111-140) with the shared header, keeping the title block inside `main`:

```tsx
        <AppHeader
          role={role}
          grades={grades}
          expanded={expanded}
          onToggleSidebar={toggle}
        />

        <main id="main-content" className="w-full p-4 lg:p-6">
          <div className="mb-4 lg:mb-6">
            <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {children}
        </main>
```

Update imports: remove `Menu`, `Breadcrumbs`, `ThemeToggle`, `Button` if now unused; add `import { AppHeader } from "@/components/shell/app-header";`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/components/app-header.test.tsx`
Expected: PASS (4 tests).

Run: `npm run test`
Expected: PASS. Any existing test asserting on breadcrumbs inside the shell header must be updated to assert on the header title instead — breadcrumbs intentionally left the header (spec R2). Do not delete such a test; rewrite its expectation.

- [ ] **Step 7: Manual check**

Run `npm run dev`, sign in as a teacher, and confirm: header spans the content column with a bottom border and no rounded panel; content sits on the pale blue-gray ground; collapse toggle, search, bell and theme toggle all work; `/admin` and `/school-head` still render correctly.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/shell/app-header.tsx src/components/role-shell.tsx src/components/app-shell.tsx tests/
git commit -m "refactor: lift shell header out of the content panel"
```

---

### Task 8: Attendance, reading and notification aggregates

**Files:**
- Modify: `src/lib/dashboard/aggregates.ts` (append three exported functions at the end)
- Test: `tests/unit/dashboard/teacher-overview.test.ts` (create)

**Interfaces:**
- Consumes: existing module-private `teacherGradeFilter`, `teacherLearnerFilter`, `cachedQuery`, `teacherDashboard`, `prisma`, and the `TeacherOpts` type already defined in that file.
- Produces:
  ```ts
  export function weekBounds(now: Date): { start: Date; end: Date; schoolDaysElapsed: number };
  export function monthBounds(now: Date): { start: Date; end: Date };

  export async function getTeacherAttendanceOverview(opts: TeacherOpts): Promise<{
    present: number; absent: number; late: number; excused: number;
    noClass: number; totalMarks: number; presentRate: number;
  }>;

  export async function getTeacherReadingOverview(opts: TeacherOpts): Promise<{
    completed: number; pending: number; notAssessed: number;
    submitted: number; aralLearners: number; completionRate: number;
  }>;
  ```

- [ ] **Step 1: Write the failing test for the pure date helpers**

Create `tests/unit/dashboard/teacher-overview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { monthBounds, weekBounds } from "@/lib/dashboard/aggregates";

describe("weekBounds", () => {
  it("starts on Monday local midnight", () => {
    // Wed 13 May 2026, 14:30 local
    const { start } = weekBounds(new Date(2026, 4, 13, 14, 30));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(11);
    expect(start.getHours()).toBe(0);
  });

  it("treats Sunday as the end of the week that began the prior Monday", () => {
    const { start, end } = weekBounds(new Date(2026, 4, 17, 9, 0)); // Sunday
    expect(start.getDate()).toBe(11);
    expect(end.getDate()).toBe(18); // exclusive next Monday
  });

  it("counts weekdays elapsed including today, capped at 5", () => {
    expect(weekBounds(new Date(2026, 4, 11)).schoolDaysElapsed).toBe(1); // Mon
    expect(weekBounds(new Date(2026, 4, 13)).schoolDaysElapsed).toBe(3); // Wed
    expect(weekBounds(new Date(2026, 4, 16)).schoolDaysElapsed).toBe(5); // Sat
    expect(weekBounds(new Date(2026, 4, 17)).schoolDaysElapsed).toBe(5); // Sun
  });
});

describe("monthBounds", () => {
  it("spans the local calendar month, end-exclusive", () => {
    const { start, end } = monthBounds(new Date(2026, 4, 13, 23, 59));
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(1);
  });

  it("rolls over the year in December", () => {
    const { end } = monthBounds(new Date(2026, 11, 20));
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard/teacher-overview.test.ts`
Expected: FAIL — `weekBounds` is not exported.

- [ ] **Step 3: Implement the helpers and aggregates**

Append to `src/lib/dashboard/aggregates.ts`:

```ts
/**
 * Local Monday-start week. `end` is exclusive (next Monday).
 * `schoolDaysElapsed` counts Mon–Fri up to and including today, capped at 5 —
 * the denominator for "expected attendance marks" this week.
 */
export function weekBounds(now: Date): {
  start: Date;
  end: Date;
  schoolDaysElapsed: number;
} {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay(): Sun=0 … Sat=6. Monday-start offset.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const schoolDaysElapsed = Math.min(offset + 1, 5);
  return { start, end, schoolDaysElapsed };
}

/** Local calendar month; `end` is exclusive (first of next month). */
export function monthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/** Attendance mix for the current week across the teacher's assigned grades. */
export async function getTeacherAttendanceOverview(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  const { start, end, schoolDaysElapsed } = weekBounds(new Date());

  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: { id: true },
      });
      const gradeIds = grades.map((g) => g.id);

      const empty = {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        noClass: 0,
        totalMarks: 0,
        presentRate: 0,
      };
      if (gradeIds.length === 0) return empty;

      const careFilter = teacherLearnerFilter(opts);
      const learnerWhere = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
        ...careFilter,
      };

      const [groups, aralLearners] = await Promise.all([
        prisma.attendance.groupBy({
          by: ["status"],
          where: {
            date: { gte: start, lt: end },
            learner: { gradeLevelId: { in: gradeIds }, deletedAt: null, ...careFilter },
          },
          _count: { _all: true },
        }),
        prisma.learner.count({ where: { ...learnerWhere, isAralLearner: true } }),
      ]);

      const byStatus = new Map(groups.map((g) => [g.status, g._count._all]));
      const present = byStatus.get("PRESENT") ?? 0;
      const absent = byStatus.get("ABSENT") ?? 0;
      const late = byStatus.get("LATE") ?? 0;
      const excused = byStatus.get("EXCUSED") ?? 0;
      const totalMarks = present + absent + late + excused;

      // Sessions with no record at all — expected marks minus what was entered.
      const expected = aralLearners * schoolDaysElapsed;
      const noClass = Math.max(expected - totalMarks, 0);
      const denominator = totalMarks + noClass;

      return {
        present,
        absent,
        late,
        excused,
        noClass,
        totalMarks,
        presentRate: denominator > 0 ? Math.round((present / denominator) * 100) : 0,
      };
    },
    {
      keyParts: [
        "teacher-attendance-overview-v1",
        schoolId,
        teacherId,
        String(isSuperAdmin),
        formatLocalDateKey(start),
      ],
      tags: [teacherDashboard(teacherId)],
      profile: "aggregate",
    }
  );
}

/** Monthly reading-level submission progress for ARAL learners. */
export async function getTeacherReadingOverview(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  const { start, end } = monthBounds(new Date());

  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: { id: true },
      });
      const gradeIds = grades.map((g) => g.id);

      const empty = {
        completed: 0,
        pending: 0,
        notAssessed: 0,
        submitted: 0,
        aralLearners: 0,
        completionRate: 0,
      };
      if (gradeIds.length === 0) return empty;

      const careFilter = teacherLearnerFilter(opts);
      const learnerWhere = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
        ...careFilter,
      };

      const [aralLearners, profiledLearners, distinctAssessed, submitted] =
        await Promise.all([
          prisma.learner.count({ where: { ...learnerWhere, isAralLearner: true } }),
          prisma.learner.count({
            where: { ...learnerWhere, isAralLearner: true, aralProfile: { isNot: null } },
          }),
          prisma.readingLevelRecord
            .groupBy({
              by: ["learnerId"],
              where: {
                weekStart: { gte: start, lt: end },
                learner: {
                  gradeLevelId: { in: gradeIds },
                  deletedAt: null,
                  isAralLearner: true,
                  ...careFilter,
                },
              },
            })
            .then((rows) => rows.length),
          prisma.readingLevelRecord.count({
            where: {
              weekStart: { gte: start, lt: end },
              learner: {
                gradeLevelId: { in: gradeIds },
                deletedAt: null,
                isAralLearner: true,
                ...careFilter,
              },
            },
          }),
        ]);

      const completed = distinctAssessed;
      // Profiled but with no record yet this month.
      const pending = Math.max(profiledLearners - completed, 0);
      // Not even ARAL-profiled, so no assessment can exist.
      const notAssessed = Math.max(aralLearners - profiledLearners, 0);

      return {
        completed,
        pending,
        notAssessed,
        submitted,
        aralLearners,
        completionRate:
          aralLearners > 0 ? Math.round((completed / aralLearners) * 100) : 0,
      };
    },
    {
      keyParts: [
        "teacher-reading-overview-v1",
        schoolId,
        teacherId,
        String(isSuperAdmin),
        formatLocalDateKey(start),
      ],
      tags: [teacherDashboard(teacherId)],
      profile: "aggregate",
    }
  );
}
```

Add `formatLocalDateKey` to the file's imports:

```ts
import { formatLocalDateKey } from "@/lib/date-keys";
```

Before writing, open `src/lib/dashboard/aggregates.ts` and confirm the exact names of the private helpers (`teacherGradeFilter`, `teacherLearnerFilter`) and the `TeacherOpts` type; use whatever is actually there rather than redeclaring them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard/teacher-overview.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the derived notification builder**

Create `src/lib/dashboard/teacher-notifications.ts`:

```ts
import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * Derives shell alerts from already-loaded dashboard numbers. Nothing is
 * persisted — there is no Notification model and this pass adds none.
 */
export function buildTeacherNotifications(input: {
  pendingAralProfiling: number;
  attendanceMissingThisWeek: number;
  readingPending: number;
  aralHref: string;
  attendanceHref: string;
  readingHref: string;
}): ShellNotification[] {
  const out: ShellNotification[] = [];

  if (input.pendingAralProfiling > 0) {
    out.push({
      id: "aral-profiling",
      title: `${input.pendingAralProfiling} ARAL profile${
        input.pendingAralProfiling === 1 ? "" : "s"
      } incomplete`,
      description: "Finish Sections B–E to unlock reporting.",
      href: input.aralHref,
      tone: "violet",
    });
  }

  if (input.attendanceMissingThisWeek > 0) {
    out.push({
      id: "attendance-week",
      title: "Weekly attendance incomplete",
      description: `${input.attendanceMissingThisWeek} session${
        input.attendanceMissingThisWeek === 1 ? "" : "s"
      } still unmarked this week.`,
      href: input.attendanceHref,
      tone: "amber",
    });
  }

  if (input.readingPending > 0) {
    out.push({
      id: "reading-month",
      title: "Monthly reading level pending",
      description: `${input.readingPending} learner${
        input.readingPending === 1 ? "" : "s"
      } not yet assessed this month.`,
      href: input.readingHref,
      tone: "amber",
    });
  }

  return out;
}
```

Add `tests/unit/dashboard/teacher-notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTeacherNotifications } from "@/lib/dashboard/teacher-notifications";

const hrefs = {
  aralHref: "/teacher/aral",
  attendanceHref: "/teacher/aral/g1/attendance",
  readingHref: "/teacher/aral/g1/reading-level",
};

describe("buildTeacherNotifications", () => {
  it("returns nothing when everything is done", () => {
    expect(
      buildTeacherNotifications({
        pendingAralProfiling: 0,
        attendanceMissingThisWeek: 0,
        readingPending: 0,
        ...hrefs,
      })
    ).toEqual([]);
  });

  it("builds one entry per outstanding item, in priority order", () => {
    const out = buildTeacherNotifications({
      pendingAralProfiling: 1,
      attendanceMissingThisWeek: 4,
      readingPending: 14,
      ...hrefs,
    });
    expect(out.map((n) => n.id)).toEqual([
      "aral-profiling",
      "attendance-week",
      "reading-month",
    ]);
    expect(out[0].title).toBe("1 ARAL profile incomplete");
    expect(out[1].description).toContain("4 sessions");
    expect(out[2].description).toContain("14 learners");
  });

  it("uses singular wording for a count of one", () => {
    const out = buildTeacherNotifications({
      pendingAralProfiling: 0,
      attendanceMissingThisWeek: 1,
      readingPending: 1,
      ...hrefs,
    });
    expect(out[0].description).toContain("1 session ");
    expect(out[1].description).toContain("1 learner ");
  });
});
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run tests/unit/dashboard/
npm run typecheck
npm run lint
git add src/lib/dashboard/ tests/unit/dashboard/
git commit -m "feat: add teacher attendance/reading overviews and derived notifications"
```

---

### Task 9: Dashboard presentational components

**Files:**
- Create: `src/components/dashboard/stat-card.tsx`
- Create: `src/components/dashboard/overview-panel.tsx`
- Create: `src/components/dashboard/greeting-header.tsx`
- Modify: `src/components/dashboard/index.ts` (re-export the three)
- Test: `tests/components/stat-card.test.tsx`, `tests/components/greeting-header.test.tsx` (create)

**Interfaces:**
- Consumes: `SegmentedBar`, `SegmentLegend`, `percentOf`, `BarSegment` (Task 2); `PrefetchLink`; `cn`.
- Produces:
  ```ts
  export type StatTone = "violet" | "amber" | "emerald" | "blue";
  export function StatCard(props: {
    title: string; value: number | string; caption: string;
    icon: LucideIcon; tone: StatTone; linkLabel: string; href: string;
  }): JSX.Element;

  export function OverviewPanel(props: {
    title: string; qualifier: string; icon: LucideIcon;
    value: number; valueCaption: string;
    chipLabel: string; chipValue: string; chipTone: "emerald" | "violet";
    segments: BarSegment[]; total: number;
    linkLabel: string; href: string; linkTone: "violet" | "primary";
  }): JSX.Element;

  export function greetingFor(hour: number): string;
  export function GreetingHeader(props: { firstName: string; subtitle: string; now?: Date }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/components/stat-card.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { GraduationCap } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { StatCard } from "@/components/dashboard/stat-card";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import type { BarSegment } from "@/components/ui/segmented-bar";

afterEach(cleanup);

describe("StatCard", () => {
  it("renders value, caption and a footer link", () => {
    render(
      <StatCard
        title="Your Grades"
        value={1}
        caption="Assigned grade"
        icon={GraduationCap}
        tone="violet"
        linkLabel="View grade details"
        href="/teacher/learners"
      />
    );
    expect(screen.getByText("Your Grades")).not.toBeNull();
    expect(screen.getByText("1")).not.toBeNull();
    expect(screen.getByText("Assigned grade")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /View grade details/ }).getAttribute("href")
    ).toBe("/teacher/learners");
  });
});

describe("OverviewPanel", () => {
  const segments: BarSegment[] = [
    { label: "Present", value: 18, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
    { label: "Absent", value: 6, className: "bg-amber-500", dotClassName: "bg-amber-500" },
  ];

  it("renders the qualifier, headline value, chip, legend and link", () => {
    render(
      <OverviewPanel
        title="Attendance Overview"
        qualifier="(This Week)"
        icon={GraduationCap}
        value={28}
        valueCaption="Total attendance marks"
        chipLabel="Class average"
        chipValue="87%"
        chipTone="emerald"
        segments={segments}
        total={24}
        linkLabel="View weekly attendance"
        href="/teacher/aral/g1/attendance"
        linkTone="primary"
      />
    );
    expect(screen.getByText("Attendance Overview")).not.toBeNull();
    expect(screen.getByText("(This Week)")).not.toBeNull();
    expect(screen.getByText("28")).not.toBeNull();
    expect(screen.getByText("87%")).not.toBeNull();
    expect(screen.getByText("Class average")).not.toBeNull();
    expect(screen.getByText("Present")).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: /View weekly attendance/ })
        .getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
  });
});
```

Create `tests/components/greeting-header.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GreetingHeader,
  greetingFor,
} from "@/components/dashboard/greeting-header";

afterEach(cleanup);

describe("greetingFor", () => {
  it("maps hours to the right salutation", () => {
    expect(greetingFor(0)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good afternoon");
    expect(greetingFor(18)).toBe("Good evening");
    expect(greetingFor(23)).toBe("Good evening");
  });
});

describe("GreetingHeader", () => {
  it("greets by first name and shows the formatted date", () => {
    render(
      <GreetingHeader
        firstName="Marivic"
        subtitle="Here's what's happening with your class today."
        now={new Date(2026, 4, 13, 9, 0)}
      />
    );
    expect(
      screen.getByRole("heading", { name: /Good morning, Marivic!/ })
    ).not.toBeNull();
    expect(screen.getByText("Wednesday, May 13, 2026")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/stat-card.test.tsx tests/components/greeting-header.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `StatCard`**

Create `src/components/dashboard/stat-card.tsx`:

```tsx
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { cn } from "@/lib/utils";

export type StatTone = "violet" | "amber" | "emerald" | "blue";

const toneStyles: Record<StatTone, { chip: string; link: string }> = {
  violet: {
    chip: "bg-violet-soft text-violet-soft-foreground",
    link: "text-violet-soft-foreground hover:text-violet",
  },
  amber: {
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    link: "text-amber-700 hover:text-amber-600 dark:text-amber-300",
  },
  emerald: {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    link: "text-emerald-700 hover:text-emerald-600 dark:text-emerald-300",
  },
  blue: {
    chip: "bg-primary/10 text-primary",
    link: "text-primary hover:text-primary/80",
  },
};

/** Dashboard KPI tile: icon chip, headline number, caption, footer link. */
export function StatCard({
  title,
  value,
  caption,
  icon: Icon,
  tone,
  linkLabel,
  href,
}: {
  title: string;
  value: number | string;
  caption: string;
  icon: LucideIcon;
  tone: StatTone;
  linkLabel: string;
  href: string;
}) {
  const styles = toneStyles[tone];

  return (
    <div className="flex flex-col rounded-xl border border-border/80 bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            styles.chip
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </div>

      <p className="mt-4 text-3xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{caption}</p>

      <PrefetchLink
        href={href}
        prefetch={true}
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
          styles.link
        )}
      >
        {linkLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </PrefetchLink>
    </div>
  );
}
```

- [ ] **Step 4: Write `OverviewPanel`**

Create `src/components/dashboard/overview-panel.tsx`:

```tsx
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  SegmentedBar,
  SegmentLegend,
  type BarSegment,
} from "@/components/ui/segmented-bar";
import { cn } from "@/lib/utils";

const chipStyles = {
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  violet: "bg-violet-soft text-violet-soft-foreground",
} as const;

const linkStyles = {
  violet: "text-violet-soft-foreground hover:text-violet",
  primary: "text-primary hover:text-primary/80",
} as const;

/** Attendance / reading summary panel: headline, stat chip, segmented bar, legend. */
export function OverviewPanel({
  title,
  qualifier,
  icon: Icon,
  value,
  valueCaption,
  chipLabel,
  chipValue,
  chipTone,
  segments,
  total,
  linkLabel,
  href,
  linkTone,
}: {
  title: string;
  qualifier: string;
  icon: LucideIcon;
  value: number;
  valueCaption: string;
  chipLabel: string;
  chipValue: string;
  chipTone: keyof typeof chipStyles;
  segments: BarSegment[];
  total: number;
  linkLabel: string;
  href: string;
  linkTone: keyof typeof linkStyles;
}) {
  return (
    <section className="rounded-xl border border-border/80 bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {title} <span className="font-normal text-muted-foreground">{qualifier}</span>
        </h3>
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{valueCaption}</p>
        </div>
        <div className={cn("rounded-lg px-3 py-2 text-center", chipStyles[chipTone])}>
          <p className="text-sm font-semibold">{chipValue}</p>
          <p className="text-[11px]">{chipLabel}</p>
        </div>
      </div>

      <SegmentedBar segments={segments} className="mt-4" />
      <SegmentLegend segments={segments} total={total} className="mt-3" />

      <PrefetchLink
        href={href}
        prefetch={true}
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 text-sm font-medium transition-colors",
          linkStyles[linkTone]
        )}
      >
        {linkLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </PrefetchLink>
    </section>
  );
}
```

- [ ] **Step 5: Write `GreetingHeader`**

Create `src/components/dashboard/greeting-header.tsx`:

```tsx
import { CalendarDays } from "lucide-react";

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Dashboard salutation row with a display-only date chip. */
export function GreetingHeader({
  firstName,
  subtitle,
  now = new Date(),
}: {
  firstName: string;
  subtitle: string;
  now?: Date;
}) {
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          {greetingFor(now.getHours())}, {firstName}! <span aria-hidden>👋</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border/80 bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-card">
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
        {formattedDate}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Re-export from the barrel**

Append to `src/components/dashboard/index.ts` (match the file's existing export style):

```ts
export { StatCard, type StatTone } from "./stat-card";
export { OverviewPanel } from "./overview-panel";
export { GreetingHeader, greetingFor } from "./greeting-header";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/components/stat-card.test.tsx tests/components/greeting-header.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/dashboard/ tests/components/
git commit -m "feat: add stat card, overview panel and greeting header"
```

---

### Task 10: Right-rail cards and the info banner

**Files:**
- Create: `src/components/dashboard/upcoming-tasks.tsx`
- Create: `src/components/dashboard/quick-actions.tsx`
- Create: `src/components/dashboard/info-banner.tsx`
- Modify: `src/components/dashboard/index.ts`
- Test: `tests/components/upcoming-tasks.test.tsx`, `tests/components/info-banner.test.tsx` (create)

**Interfaces:**
- Consumes: `Badge`, `Button`, `PrefetchLink`, `cn`.
- Produces:
  ```ts
  export interface UpcomingTask { id: string; title: string; meta: string; badgeLabel: string; badgeTone: "amber" | "blue" | "muted"; }
  export function UpcomingTasks(props: { tasks: UpcomingTask[]; viewAllHref: string }): JSX.Element;

  export interface QuickAction { label: string; href: string; icon: LucideIcon }
  export function QuickActions(props: { actions: QuickAction[] }): JSX.Element;

  export function InfoBanner(props: { storageKey: string }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/components/upcoming-tasks.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarDays } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { UpcomingTasks, type UpcomingTask } from "@/components/dashboard/upcoming-tasks";
import { QuickActions } from "@/components/dashboard/quick-actions";

afterEach(cleanup);

const tasks: UpcomingTask[] = [
  {
    id: "reading",
    title: "Complete Monthly Reading Level",
    meta: "Due: May 31, 2026",
    badgeLabel: "14 pending",
    badgeTone: "amber",
  },
  {
    id: "terms",
    title: "End of Terms Reports",
    meta: "Not yet available",
    badgeLabel: "Locked",
    badgeTone: "muted",
  },
];

describe("UpcomingTasks", () => {
  it("renders each task with its meta line and badge", () => {
    render(<UpcomingTasks tasks={tasks} viewAllHref="/teacher/reports" />);
    expect(screen.getByText("Complete Monthly Reading Level")).not.toBeNull();
    expect(screen.getByText("Due: May 31, 2026")).not.toBeNull();
    expect(screen.getByText("14 pending")).not.toBeNull();
    expect(screen.getByText("Locked")).not.toBeNull();
  });

  it("links to the full task list", () => {
    render(<UpcomingTasks tasks={tasks} viewAllHref="/teacher/reports" />);
    expect(
      screen.getByRole("link", { name: /View all tasks/ }).getAttribute("href")
    ).toBe("/teacher/reports");
  });

  it("shows an empty message when there is nothing due", () => {
    render(<UpcomingTasks tasks={[]} viewAllHref="/teacher/reports" />);
    expect(screen.getByText("Nothing due right now.")).not.toBeNull();
  });
});

describe("QuickActions", () => {
  it("renders one link per action", () => {
    render(
      <QuickActions
        actions={[
          { label: "Weekly Attendance", href: "/teacher/aral/g1/attendance", icon: CalendarDays },
          { label: "Reports", href: "/teacher/reports", icon: CalendarDays },
        ]}
      />
    );
    expect(
      screen.getByRole("link", { name: "Weekly Attendance" }).getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
    expect(screen.getByRole("link", { name: "Reports" })).not.toBeNull();
  });
});
```

Create `tests/components/info-banner.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InfoBanner } from "@/components/dashboard/info-banner";

afterEach(cleanup);

describe("InfoBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders both notices", async () => {
    render(<InfoBanner storageKey="litrack:teacher-info-banner" />);
    expect(await screen.findByText("Automatic Data Lock")).not.toBeNull();
    expect(screen.getByText("Reminder")).not.toBeNull();
  });

  it("hides itself and persists the dismissal", async () => {
    render(<InfoBanner storageKey="litrack:teacher-info-banner" />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Automatic Data Lock")).toBeNull();
    expect(window.localStorage.getItem("litrack:teacher-info-banner")).toBe("dismissed");
  });

  it("stays hidden when already dismissed", () => {
    window.localStorage.setItem("litrack:teacher-info-banner", "dismissed");
    render(<InfoBanner storageKey="litrack:teacher-info-banner" />);
    expect(screen.queryByText("Automatic Data Lock")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/upcoming-tasks.test.tsx tests/components/info-banner.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `UpcomingTasks`**

Create `src/components/dashboard/upcoming-tasks.tsx`:

```tsx
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { cn } from "@/lib/utils";

export interface UpcomingTask {
  id: string;
  title: string;
  meta: string;
  badgeLabel: string;
  badgeTone: "amber" | "blue" | "muted";
}

const badgeStyles: Record<UpcomingTask["badgeTone"], string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  blue: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
};

export function UpcomingTasks({
  tasks,
  viewAllHref,
}: {
  tasks: UpcomingTask[];
  viewAllHref: string;
}) {
  return (
    <section className="rounded-xl border border-border/80 bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-soft text-violet-soft-foreground">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-base font-semibold tracking-tight">Upcoming Tasks</h3>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing due right now.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{task.meta}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  badgeStyles[task.badgeTone]
                )}
              >
                {task.badgeLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      <PrefetchLink
        href={viewAllHref}
        prefetch={true}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
      >
        View all tasks
        <ArrowRight className="h-4 w-4" aria-hidden />
      </PrefetchLink>
    </section>
  );
}
```

- [ ] **Step 4: Write `QuickActions`**

Create `src/components/dashboard/quick-actions.tsx`:

```tsx
import { Zap, type LucideIcon } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";

export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
}

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-soft text-violet-soft-foreground">
          <Zap className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-base font-semibold tracking-tight">Quick Actions</h3>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {actions.map(({ label, href, icon: Icon }) => (
          <PrefetchLink
            key={`${href}:${label}`}
            href={href}
            prefetch={true}
            className="flex flex-col items-center gap-2 rounded-lg border border-border/80 px-2 py-3 text-center text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Icon className="h-4 w-4 text-violet-soft-foreground" aria-hidden />
            {label}
          </PrefetchLink>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Write `InfoBanner`**

Create `src/components/dashboard/info-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Lightbulb, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const NOTICES = [
  {
    id: "lock",
    icon: ShieldCheck,
    title: "Automatic Data Lock",
    body: "Attendance records are locked weekly. Reading level records are locked monthly.",
  },
  {
    id: "reminder",
    icon: Lightbulb,
    title: "Reminder",
    body: "Make sure to complete your assessments before the deadline to keep data accurate.",
  },
] as const;

/**
 * Dismissible footer notices. Rendered only after the localStorage read so a
 * previously dismissed banner never flashes in on hydration.
 */
export function InfoBanner({ storageKey }: { storageKey: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(storageKey) !== "dismissed");
    } catch {
      setVisible(true);
    }
  }, [storageKey]);

  if (!visible) return null;

  return (
    <aside className="relative grid gap-5 rounded-xl bg-violet-soft p-5 sm:grid-cols-2">
      {NOTICES.map(({ id, icon: Icon, title, body }) => (
        <div key={id} className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-violet-soft-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-soft-foreground">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="absolute right-2 top-2 h-8 w-8"
        onClick={() => {
          setVisible(false);
          try {
            window.localStorage.setItem(storageKey, "dismissed");
          } catch {
            /* private mode — dismissal is simply not persisted */
          }
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </aside>
  );
}
```

- [ ] **Step 6: Re-export from the barrel**

Append to `src/components/dashboard/index.ts`:

```ts
export { UpcomingTasks, type UpcomingTask } from "./upcoming-tasks";
export { QuickActions, type QuickAction } from "./quick-actions";
export { InfoBanner } from "./info-banner";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/components/upcoming-tasks.test.tsx tests/components/info-banner.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/components/dashboard/ tests/components/
git commit -m "feat: add upcoming tasks, quick actions and dismissible info banner"
```

---

### Task 11: Assemble the teacher dashboard

**Files:**
- Modify: `src/components/dashboard/teacher-dashboard-sections.tsx` (rewrite the three sections)
- Modify: `src/app/teacher/(app)/page.tsx` (compose greeting + sections)
- Modify: `src/app/teacher/(app)/layout.tsx` (pass notifications into `RoleShell`)
- Modify: `src/components/dashboard/simple-charts.tsx` (bar value labels)
- Test: `tests/unit/dashboard/teacher-task-list.test.ts` (create)

**Interfaces:**
- Consumes: `getTeacherMetricCounts`, `getTeacherGradeChart`, `getTeacherAttendanceOverview`, `getTeacherReadingOverview` (Task 8); `StatCard`, `OverviewPanel`, `GreetingHeader`, `UpcomingTasks`, `QuickActions`, `InfoBanner` (Tasks 9-10); `buildTeacherNotifications` (Task 8); `SegmentedBar` segment shapes (Task 2).
- Produces:
  ```ts
  // in src/lib/dashboard/teacher-tasks.ts
  export function daysUntilWeekEnd(now: Date): number;
  export function buildTeacherTasks(input: {
    readingPending: number; now: Date; monthEnd: Date;
  }): UpcomingTask[];
  ```

- [ ] **Step 1: Write the failing test for task derivation**

Create `tests/unit/dashboard/teacher-task-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTeacherTasks,
  daysUntilWeekEnd,
} from "@/lib/dashboard/teacher-tasks";

describe("daysUntilWeekEnd", () => {
  it("counts days remaining to Sunday inclusive", () => {
    expect(daysUntilWeekEnd(new Date(2026, 4, 14))).toBe(3); // Thu → Sun
    expect(daysUntilWeekEnd(new Date(2026, 4, 17))).toBe(0); // Sunday
    expect(daysUntilWeekEnd(new Date(2026, 4, 11))).toBe(6); // Monday
  });
});

describe("buildTeacherTasks", () => {
  const now = new Date(2026, 4, 14);
  const monthEnd = new Date(2026, 4, 31);

  it("returns the three standing tasks in mock order", () => {
    const tasks = buildTeacherTasks({ readingPending: 14, now, monthEnd });
    expect(tasks.map((t) => t.id)).toEqual(["reading", "attendance", "terms"]);
    expect(tasks[0].title).toBe("Complete Monthly Reading Level");
    expect(tasks[0].meta).toBe("Due: May 31, 2026");
    expect(tasks[0].badgeLabel).toBe("14 pending");
    expect(tasks[1].badgeLabel).toBe("3 days left");
    expect(tasks[2].badgeLabel).toBe("Locked");
  });

  it("marks reading as done when nothing is pending", () => {
    const [reading] = buildTeacherTasks({ readingPending: 0, now, monthEnd });
    expect(reading.badgeLabel).toBe("Complete");
    expect(reading.badgeTone).toBe("blue");
  });

  it("says 'Due today' on Sunday", () => {
    const tasks = buildTeacherTasks({
      readingPending: 1,
      now: new Date(2026, 4, 17),
      monthEnd,
    });
    expect(tasks[1].badgeLabel).toBe("Due today");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard/teacher-task-list.test.ts`
Expected: FAIL — cannot resolve `@/lib/dashboard/teacher-tasks`.

- [ ] **Step 3: Implement task derivation**

Create `src/lib/dashboard/teacher-tasks.ts`:

```ts
import type { UpcomingTask } from "@/components/dashboard/upcoming-tasks";

/** Whole days from `now` to the coming Sunday (0 when today is Sunday). */
export function daysUntilWeekEnd(now: Date): number {
  const day = now.getDay(); // Sun=0
  return day === 0 ? 0 : 7 - day;
}

function formatDue(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** The teacher's three standing deliverables — derived, never persisted. */
export function buildTeacherTasks({
  readingPending,
  now,
  monthEnd,
}: {
  readingPending: number;
  now: Date;
  monthEnd: Date;
}): UpcomingTask[] {
  const daysLeft = daysUntilWeekEnd(now);

  return [
    {
      id: "reading",
      title: "Complete Monthly Reading Level",
      meta: `Due: ${formatDue(monthEnd)}`,
      badgeLabel: readingPending > 0 ? `${readingPending} pending` : "Complete",
      badgeTone: readingPending > 0 ? "amber" : "blue",
    },
    {
      id: "attendance",
      title: "Submit Weekly Attendance",
      meta: `Due: ${formatDue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft))}`,
      badgeLabel:
        daysLeft === 0
          ? "Due today"
          : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      badgeTone: daysLeft <= 1 ? "amber" : "blue",
    },
    {
      id: "terms",
      title: "End of Terms Reports",
      meta: "Not yet available",
      badgeLabel: "Locked",
      badgeTone: "muted",
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard/teacher-task-list.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add value labels to the bar chart**

In `src/components/dashboard/simple-charts.tsx`, change `DashboardBarChart`'s default color and add a `LabelList`:

```tsx
import { LabelList } from "recharts";
```

```tsx
export function DashboardBarChart({
  data,
  color = "hsl(var(--violet))",
  height = 220,
  showValues = false,
}: {
  data: Point[];
  color?: string;
  height?: number;
  showValues?: boolean;
}) {
```

and inside `<Bar …>`:

```tsx
          <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={48}>
            {showValues ? (
              <LabelList
                dataKey="value"
                position="top"
                className="fill-muted-foreground"
                fontSize={11}
              />
            ) : null}
          </Bar>
```

Leave `DashboardLineChart` untouched.

- [ ] **Step 6: Rewrite the teacher dashboard sections**

Replace the entire contents of `src/components/dashboard/teacher-dashboard-sections.tsx` with:

```tsx
import {
  BookOpen,
  CalendarDays,
  FileBarChart,
  GraduationCap,
  Sparkles,
  UserRoundSearch,
  Users,
} from "lucide-react";
import {
  getTeacherAttendanceOverview,
  getTeacherGradeChart,
  getTeacherMetricCounts,
  getTeacherReadingOverview,
  monthBounds,
} from "@/lib/dashboard/aggregates";
import { buildTeacherTasks } from "@/lib/dashboard/teacher-tasks";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { StatCard } from "@/components/dashboard/stat-card";
import { UpcomingTasks } from "@/components/dashboard/upcoming-tasks";
import { DashboardBarChart } from "@/components/dashboard/lazy-charts";
import type { BarSegment } from "@/components/ui/segmented-bar";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export type TeacherOpts = {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
};

/** Grade-scoped ARAL hrefs, mirroring the sidebar's single-grade shortcut. */
export type TeacherHrefs = {
  attendance: string;
  reading: string;
  aral: string;
  learners: string;
  reports: string;
};

export async function TeacherStatsSection(
  opts: TeacherOpts & { hrefs: TeacherHrefs }
) {
  let metrics: Awaited<ReturnType<typeof getTeacherMetricCounts>> | null = null;
  try {
    metrics = await getTeacherMetricCounts(opts);
  } catch (err) {
    console.error("[TeacherStatsSection] failed to load:", err);
  }

  const grades = metrics?.assignedGradeCount ?? 0;

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Your Grades"
        value={grades}
        caption={grades === 1 ? "Assigned grade" : "Assigned grades"}
        icon={GraduationCap}
        tone="violet"
        linkLabel="View grade details"
        href={opts.hrefs.learners}
      />
      <StatCard
        title="Total Learners"
        value={metrics?.totalLearners ?? 0}
        caption="All learners"
        icon={Users}
        tone="amber"
        linkLabel="View all learners"
        href={opts.hrefs.learners}
      />
      <StatCard
        title="ARAL Learners"
        value={metrics?.aralLearners ?? 0}
        caption="With ARAL profiles"
        icon={Sparkles}
        tone="emerald"
        linkLabel="View ARAL learners"
        href={opts.hrefs.aral}
      />
      <StatCard
        title="Pending Profiles"
        value={metrics?.pendingAralProfiling ?? 0}
        caption="Without ARAL profile"
        icon={UserRoundSearch}
        tone="blue"
        linkLabel="Manage profiles"
        href={opts.hrefs.aral}
      />
    </div>
  );
}

export async function TeacherOverviewSection(
  opts: TeacherOpts & { hrefs: TeacherHrefs }
) {
  let attendance: Awaited<ReturnType<typeof getTeacherAttendanceOverview>> | null =
    null;
  let reading: Awaited<ReturnType<typeof getTeacherReadingOverview>> | null = null;
  try {
    [attendance, reading] = await Promise.all([
      getTeacherAttendanceOverview(opts),
      getTeacherReadingOverview(opts),
    ]);
  } catch (err) {
    console.error("[TeacherOverviewSection] failed to load:", err);
  }

  const attendanceSegments: BarSegment[] = [
    { label: "Present", value: attendance?.present ?? 0, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
    { label: "Absent", value: attendance?.absent ?? 0, className: "bg-amber-500", dotClassName: "bg-amber-500" },
    { label: "Late", value: attendance?.late ?? 0, className: "bg-orange-500", dotClassName: "bg-orange-500" },
    { label: "Excused", value: attendance?.excused ?? 0, className: "bg-red-500", dotClassName: "bg-red-500" },
    { label: "No Class", value: attendance?.noClass ?? 0, className: "bg-muted-foreground/30", dotClassName: "bg-muted-foreground/30" },
  ];
  const attendanceTotal = attendanceSegments.reduce((a, s) => a + s.value, 0);

  const readingSegments: BarSegment[] = [
    { label: "Completed", value: reading?.completed ?? 0, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
    { label: "Pending", value: reading?.pending ?? 0, className: "bg-amber-500", dotClassName: "bg-amber-500" },
    { label: "Not Assessed", value: reading?.notAssessed ?? 0, className: "bg-muted-foreground/30", dotClassName: "bg-muted-foreground/30" },
  ];
  const readingTotal = readingSegments.reduce((a, s) => a + s.value, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <OverviewPanel
        title="Attendance Overview"
        qualifier="(This Week)"
        icon={CalendarDays}
        value={attendance?.totalMarks ?? 0}
        valueCaption="Total attendance marks"
        chipLabel="Class average"
        chipValue={`${attendance?.presentRate ?? 0}%`}
        chipTone="emerald"
        segments={attendanceSegments}
        total={attendanceTotal}
        linkLabel="View weekly attendance"
        href={opts.hrefs.attendance}
        linkTone="primary"
      />
      <OverviewPanel
        title="Reading Level Overview"
        qualifier="(This Month)"
        icon={BookOpen}
        value={reading?.submitted ?? 0}
        valueCaption="Reading records submitted"
        chipLabel="Completion rate"
        chipValue={`${reading?.completionRate ?? 0}%`}
        chipTone="violet"
        segments={readingSegments}
        total={readingTotal}
        linkLabel="Go to Monthly Reading Level"
        href={opts.hrefs.reading}
        linkTone="violet"
      />
    </div>
  );
}

export async function TeacherChartRailSection(
  opts: TeacherOpts & { hrefs: TeacherHrefs }
) {
  let gradeBreakdown: Awaited<ReturnType<typeof getTeacherGradeChart>> = [];
  let reading: Awaited<ReturnType<typeof getTeacherReadingOverview>> | null = null;
  try {
    [gradeBreakdown, reading] = await Promise.all([
      getTeacherGradeChart(opts),
      getTeacherReadingOverview(opts),
    ]);
  } catch (err) {
    console.error("[TeacherChartRailSection] failed to load:", err);
  }

  const gradeChart = gradeBreakdown.map((g) => ({
    name: GRADE_LEVEL_LABELS[g.name as keyof typeof GRADE_LEVEL_LABELS] ?? g.name,
    value: g.value,
  }));
  const hasGradeData = gradeChart.some((g) => g.value > 0);

  const now = new Date();
  const { end } = monthBounds(now);
  const monthEnd = new Date(end.getFullYear(), end.getMonth(), 0);
  const tasks = buildTeacherTasks({
    readingPending: reading?.pending ?? 0,
    now,
    monthEnd,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <ChartCard
        className="lg:col-span-2"
        title="Learners by Grade Level"
        description="Distribution of your learners"
      >
        {!hasGradeData ? (
          <EmptyState
            title="No data yet"
            description="Ask your School Head to assign you to a grade level."
            icon={BookOpen}
          />
        ) : (
          <DashboardBarChart data={gradeChart} showValues height={280} />
        )}
      </ChartCard>

      <div className="space-y-5">
        <UpcomingTasks tasks={tasks} viewAllHref={opts.hrefs.reports} />
        <QuickActions
          actions={[
            { label: "Weekly Attendance", href: opts.hrefs.attendance, icon: CalendarDays },
            { label: "Monthly Reading Level", href: opts.hrefs.reading, icon: BookOpen },
            { label: "Reports", href: opts.hrefs.reports, icon: FileBarChart },
          ]}
        />
      </div>
    </div>
  );
}
```

If `src/components/dashboard/lazy-charts.tsx` re-exports `DashboardBarChart` with an explicit prop type, widen it to accept the new `showValues?: boolean`.

- [ ] **Step 7: Rewrite the dashboard page**

Replace the body of `src/app/teacher/(app)/page.tsx` (keep the imports it still needs) with:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { AppShell } from "@/components/app-shell";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { InfoBanner } from "@/components/dashboard/info-banner";
import {
  TeacherStatsSection,
  TeacherOverviewSection,
  TeacherChartRailSection,
  type TeacherHrefs,
} from "@/components/dashboard/teacher-dashboard-sections";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";

export const dynamic = "force-dynamic";

interface TeacherDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherDashboard({
  searchParams,
}: TeacherDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId =
    isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;

  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");
  if (!targetSchoolId) redirect("/login");

  const schoolName = isSuperAdmin ? await getSchoolName(targetSchoolId) : null;

  const sectionOpts = {
    schoolId: targetSchoolId,
    teacherId: user.id,
    isSuperAdmin,
  };

  // Grade-scoped ARAL destinations; fall back to the picker unless exactly one.
  let aralGradeId: string | undefined;
  try {
    const shellGrades = await getTeacherShellGrades(sectionOpts);
    const aralGrades = shellGrades.filter((g) => g.hasAral);
    if (aralGrades.length === 1) aralGradeId = aralGrades[0].id;
  } catch (err) {
    console.error("[TeacherDashboard] shell grades failed:", err);
  }

  const hrefs: TeacherHrefs = {
    attendance: aralGradeId ? `/teacher/aral/${aralGradeId}/attendance` : "/teacher/aral",
    reading: aralGradeId ? `/teacher/aral/${aralGradeId}/reading-level` : "/teacher/aral",
    aral: "/teacher/aral",
    learners: "/teacher/learners",
    reports: "/teacher/reports",
  };

  return (
    <AppShell
      title={
        isSuperAdmin ? `Teacher View - ${schoolName || "Unknown"}` : `Hi, ${user.firstName}`
      }
      subtitle={
        isSuperAdmin ? "Super Admin View - All Grade Levels" : "Your assigned grade levels"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={schoolName ?? undefined}
    >
      <GreetingHeader
        firstName={user.firstName}
        subtitle="Here's what's happening with your class today."
      />

      <div className="space-y-5">
        <Suspense fallback={<MetricsGridSkeleton variant="teacher" />}>
          <TeacherStatsSection {...sectionOpts} hrefs={hrefs} />
        </Suspense>

        <Suspense fallback={<ChartSectionSkeleton columns={2} />}>
          <TeacherOverviewSection {...sectionOpts} hrefs={hrefs} />
        </Suspense>

        <Suspense fallback={<ListCardSkeleton grid items={3} />}>
          <TeacherChartRailSection {...sectionOpts} hrefs={hrefs} />
        </Suspense>

        <InfoBanner storageKey="litrack:teacher-info-banner" />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 8: Feed notifications into the shell**

In `src/app/teacher/(app)/layout.tsx`, after the existing `grades` resolution block, compute notifications and pass them to `RoleShell`:

```tsx
  let notifications: ShellNotification[] = [];

  if (user.role === "TEACHER" && user.schoolId) {
    try {
      const opts = { schoolId: user.schoolId, teacherId: user.id, isSuperAdmin: false };
      const [metrics, attendance, reading] = await Promise.all([
        getTeacherMetricCounts(opts),
        getTeacherAttendanceOverview(opts),
        getTeacherReadingOverview(opts),
      ]);

      const aralGrades = (grades ?? []).filter((g) => g.hasAral);
      const gradeId = aralGrades.length === 1 ? aralGrades[0].id : undefined;

      notifications = buildTeacherNotifications({
        pendingAralProfiling: metrics.pendingAralProfiling,
        attendanceMissingThisWeek: attendance.noClass,
        readingPending: reading.pending,
        aralHref: "/teacher/aral",
        attendanceHref: gradeId ? `/teacher/aral/${gradeId}/attendance` : "/teacher/aral",
        readingHref: gradeId ? `/teacher/aral/${gradeId}/reading-level` : "/teacher/aral",
      });
    } catch (err) {
      // Chrome must never tear down the /teacher tree over a transient pool error.
      console.error("[teacher/layout] notifications failed:", err);
    }
  }
```

Add the imports:

```tsx
import {
  getTeacherAttendanceOverview,
  getTeacherMetricCounts,
  getTeacherReadingOverview,
} from "@/lib/dashboard/aggregates";
import { buildTeacherNotifications } from "@/lib/dashboard/teacher-notifications";
import type { ShellNotification } from "@/components/shell/notifications-menu";
```

and pass `notifications={notifications}` to `<RoleShell>`.

- [ ] **Step 9: Run the full unit suite**

Run: `npm run test`
Expected: PASS. Fix any test that asserted the old teacher-dashboard section names (`TeacherMetricsSection`, `TeacherChartSection`, `TeacherGradeCardsSection`) by pointing it at the new exports.

- [ ] **Step 10: Manual check**

`npm run dev`, sign in as a seeded teacher (`npm run db:seed` prints credentials), open `/teacher`, and compare against the mock: greeting + date chip, four stat cards, two overview panels, chart + right rail, info banner, and the ⌘K search / bell / theme toggle in the header.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add src/app/teacher src/components/dashboard src/lib/dashboard tests/
git commit -m "feat: rebuild teacher dashboard to match the design mock"
```

---

### Task 12: Full verification and doc update

**Files:**
- Modify: `docs/backlog.md` (append a wave entry)
- Modify: `CLAUDE.md` (violet accent note under Domain notes)

- [ ] **Step 1: Run the CI gate locally**

```powershell
npx prisma generate
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all five pass. `npm run build` must succeed with placeholder env values and must not touch Postgres (every app page is `force-dynamic`).

- [ ] **Step 2: Check both themes and the collapsed rail**

With `npm run dev` running, verify on `/teacher`:
- Dark mode: violet surfaces invert (soft violet becomes deep violet, text stays legible); no white card on white ground.
- Collapsed sidebar (click the header hamburger): group labels hide, tooltips appear on hover, log-out shows as an icon.
- Mobile width (<1024px): Sheet trigger opens the full sidebar; the header collapses the search field.
- `/admin` and `/school-head` render with a single unlabeled nav group and a working header.

- [ ] **Step 3: Update the docs**

In `CLAUDE.md`, under **Domain notes → ARAL**, replace the accent sentence with:

```markdown
- **ARAL:** violet is reserved as the ARAL accent — theme-aware tokens `--violet`,
  `--violet-foreground`, `--violet-soft`, `--violet-soft-foreground` in `globals.css`,
  surfaced as `bg-violet` / `bg-violet-soft` / `text-violet-soft-foreground`
  (`tailwind.config.ts`); blue primary and amber secondary elsewhere. ARAL routes live
  under `/teacher/aral/[gradeId]` with weekly grid entry (`src/lib/actions/aral-grid.ts`).
```

In `CLAUDE.md`, under **Architecture**, add after the request-path paragraph:

```markdown
Shell chrome: `RoleShell` mounts `AppSidebar` plus `AppHeader` (`src/components/shell/app-header.tsx`)
as siblings — the header sits *outside* the content region, which renders page panels on
`--background`. Sidebar groups and the header page title both come from
`src/lib/nav/nav-config.ts`; add nav entries there, not in `app-sidebar.tsx`.
```

In `docs/backlog.md`, append:

```markdown
### Teacher dashboard & shell redesign (2026-08-14)

Restructured the role shell (header lifted out of the content panel, grouped sidebar with
ARAL Program section, header search + notifications + theme toggle) and rebuilt the teacher
dashboard from the supplied design mock. Violet accent retuned to hue 255 with theme-aware
tokens. Two new read-only aggregates: `getTeacherAttendanceOverview`,
`getTeacherReadingOverview`. No schema changes.

Spec: `docs/superpowers/specs/2026-08-14-teacher-dashboard-redesign.md`
Plan: `docs/superpowers/plans/2026-08-14-teacher-dashboard-redesign.md`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/backlog.md
git commit -m "docs: record teacher dashboard and shell redesign"
```

---

## Deviations from the mock (deliberate)

Called out so a reviewer does not read these as misses:

1. **"Late" appears in the attendance legend.** The mock shows only Present / Absent / Excused / No Class, but `AttendanceStatus` has a `LATE` value. Folding it silently into another bucket would misreport data, so it gets its own orange segment.
2. **The "This School Year" select on the chart is display-only.** The mock shows no alternative range and the app has no per-range teacher chart query; adding one is out of scope.
3. **Notifications are derived, not stored.** There is no `Notification` model and this pass adds no migration, so the bell reflects live outstanding work rather than a read/unread inbox.
4. **The sidebar avatar stays the existing `UserCircle` chip.** The mock shows a photo; there is no learner/teacher avatar upload in the schema.
