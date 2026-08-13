# UI System & Perceived-Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify LITRACK on shadcn/ui primitives and one token palette, add a light-default dark mode toggle, and make navigation feel instant via hover-intent prefetch, data-layer ISR, narrower refresh boundaries, and far fewer skeletons.

**Architecture:** Four independent layers, applied in order. (1) *Design system* — one `Surface` primitive plus token-only color, so dark mode is a variable swap rather than a per-file edit. (2) *Theme* — a ~40-line context provider writing `.dark` on `<html>`, with a blocking inline script so there is no flash. (3) *Navigation speed* — a `PrefetchLink` that warms the destination on hover/focus/touch, layered on the existing `NavPrefetcher` idle warm. (4) *Data & rendering* — named TTL profiles over the existing `cachedQuery`, route ISR on public routes only, Suspense boundaries so a child's data refresh does not re-render the shell, and a pruned `loading.tsx` set.

**Tech Stack:** Next.js 15.5.23 (App Router) · React 19.2.8 · TypeScript strict · Tailwind 3.4 + shadcn/ui + Radix · Vitest 2.1 + @testing-library/react + jsdom · no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-ui-system-and-performance.md`

## Global Constraints

- No new runtime dependencies. In particular: **do not install `next-themes`** — Task 3 implements the provider directly.
- No edits under `prisma/**`. No changes to auth rules, tenancy checks, or server-action business logic. This plan is presentation + caching only.
- Every school-scoped cache key must include `schoolId` (or `userId`); a cache hit must never be able to cross tenants.
- **Never** add `export const revalidate` to a page that calls `requireUser()` / `requireSchoolUser()`. Those stay `force-dynamic`. See spec R5.
- Zero hardcoded colors in `.tsx`: no `bg-white`, `bg-slate-*`, `bg-gray-*`, `text-gray-*`, `border-gray-*`. Deliberate exceptions that stay: the violet ARAL accent, and amber super-admin impersonation chips.
- Light mode is the default even when the OS prefers dark.
- Gate after every task: `npm run typecheck && npm run lint && npm run test`. Run `npm run build` at Task 12 and after any task that edits `next.config.mjs`.
- Commit after every task. Conventional commit prefixes (`feat:`, `refactor:`, `perf:`, `test:`, `chore:`).

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/components/ui/surface.tsx` | The one card/panel chrome primitive (`Surface`, `SurfaceHeader`, `SurfaceBody`). Server-safe. |
| `src/components/ui/switch.tsx` | shadcn Switch primitive (needed by the theme toggle's menu variant and by settings forms). |
| `src/components/theme/theme-provider.tsx` | `ThemeProvider` context + `useTheme()`. Client. |
| `src/components/theme/theme-script.tsx` | Blocking inline `<script>` that applies the stored theme pre-paint. Server. |
| `src/components/theme/theme-toggle.tsx` | The header button. Client. |
| `src/lib/theme.ts` | Pure theme constants + `resolveInitialTheme` (no DOM, unit-testable). |
| `src/components/nav/prefetch-link.tsx` | `PrefetchLink` — `next/link` + hover/focus/touch intent prefetch. Client. |
| `src/lib/nav/prefetch-intent.ts` | Pure intent-prefetch policy: dedupe set, concurrency cap, save-data check. |
| `src/lib/cache/profiles.ts` | Named TTL profiles (`CACHE_TTL`) used by `cachedQuery` callers. |
| `tests/components/*.test.tsx` | Component tests (jsdom). |
| `tests/unit/theme.test.ts`, `tests/unit/prefetch-intent.test.ts` | Pure-logic tests (node). |

**Modified files**

| File | Change |
|---|---|
| `vitest.config.ts` | Add `.tsx` includes + jsdom for `tests/components/**`. |
| `src/app/globals.css` | Add `--surface` / `--surface-header` tokens; dark values. |
| `src/app/layout.tsx` | Mount `ThemeScript` + `ThemeProvider`. |
| `src/components/role-shell.tsx` | Token colors; `ThemeToggle` upper-right in header. |
| `src/components/app-shell.tsx` | Same. |
| `src/components/onboarding-shell.tsx` | Same. |
| `src/components/app-sidebar.tsx` | Token colors; `NavLink` → `PrefetchLink`; raw `<button>` → `Button`. |
| 20 `.tsx` files listed in Task 2 | Hardcoded color purge. |
| `src/lib/cache/unstable.ts` | Accept a `CacheProfile`; keep `revalidate` escape hatch. |
| `src/lib/dashboard/aggregates.ts`, `src/lib/cache/school.ts`, `src/lib/cache/schools-list.ts` | Use named profiles. |
| `src/app/login/page.tsx`, `src/app/pending-approval/page.tsx`, `src/app/account/created/page.tsx`, `src/app/auth/reset/page.tsx` | Route ISR (public only). |
| ~24 `loading.tsx` files | Deleted or reduced to `ContentRouteLoading` (Task 10). |
| `src/app/admin/audit/page.tsx`, `src/app/admin/school-years/page.tsx`, `src/app/school-head/(app)/audit/page.tsx` | Raw `<table>` → `ui/table` primitives. |

---

### Task 1: Component test harness + the `Surface` primitive

The repo has `@testing-library/react` and `jsdom` installed but `vitest.config.ts` runs `environment: "node"` and only matches `**/*.test.ts` — so no component test can run today. This task turns that on, because every later task needs it, and delivers the first reusable primitive.

**Files:**
- Modify: `vitest.config.ts`
- Create: `src/components/ui/surface.tsx`
- Create: `tests/components/surface.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces:
  - `Surface(props: React.HTMLAttributes<HTMLDivElement> & { as?: "div" | "section" | "article" })` → `JSX.Element`
  - `SurfaceHeader(props: React.HTMLAttributes<HTMLDivElement>)` → `JSX.Element`
  - `SurfaceBody(props: React.HTMLAttributes<HTMLDivElement>)` → `JSX.Element`
  - All three are server components (no `"use client"`).

- [ ] **Step 1: Enable `.tsx` tests and jsdom**

Replace `vitest.config.ts` entirely:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Component tests need a DOM; pure-logic tests stay on the faster node env.
    environmentMatchGlobs: [["tests/components/**", "jsdom"]],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `tests/components/surface.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";

afterEach(cleanup);

describe("Surface", () => {
  it("renders the shared card chrome from tokens only", () => {
    render(<Surface data-testid="s">content</Surface>);
    const el = screen.getByTestId("s");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("bg-card");
    expect(el.className).toContain("border-border/80");
    expect(el.className).toContain("rounded-xl");
    // Hardcoded colors would break dark mode.
    expect(el.className).not.toContain("bg-white");
  });

  it("renders as the requested element", () => {
    render(<Surface as="section" data-testid="s">x</Surface>);
    expect(screen.getByTestId("s").tagName).toBe("SECTION");
  });

  it("merges caller classes over defaults", () => {
    render(<Surface className="p-0" data-testid="s">x</Surface>);
    expect(screen.getByTestId("s").className).toContain("p-0");
  });

  it("renders header and body slots", () => {
    render(
      <Surface>
        <SurfaceHeader data-testid="h">Title</SurfaceHeader>
        <SurfaceBody data-testid="b">Body</SurfaceBody>
      </Surface>
    );
    expect(screen.getByTestId("h").className).toContain("border-b");
    expect(screen.getByTestId("b").className).toContain("p-5");
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```powershell
npx vitest run tests/components/surface.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/ui/surface"`.

- [ ] **Step 4: Implement `Surface`**

Create `src/components/ui/surface.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The single card/panel chrome for the app.
 *
 * Replaces the `rounded-xl border border-border/80 bg-card ... shadow-card`
 * string that was duplicated across ~24 files. Token-only so dark mode is a
 * CSS-variable swap, never a per-file edit.
 *
 * Server component on purpose — no `"use client"`. It ships zero JS.
 */
export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "article";
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, as = "div", ...props }, ref) => {
    const Comp = as;
    return (
      <Comp
        ref={ref}
        className={cn(
          "rounded-xl border border-border/80 bg-card text-card-foreground shadow-card",
          className
        )}
        {...props}
      />
    );
  }
);
Surface.displayName = "Surface";

const SurfaceHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4",
      className
    )}
    {...props}
  />
));
SurfaceHeader.displayName = "SurfaceHeader";

const SurfaceBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5", className)} {...props} />
));
SurfaceBody.displayName = "SurfaceBody";

export { Surface, SurfaceHeader, SurfaceBody };
```

- [ ] **Step 5: Run the test and confirm it passes**

```powershell
npx vitest run tests/components/surface.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Adopt `Surface` in the loading skeletons**

In `src/components/loading/chart-section-skeleton.tsx`, replace the `<section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-card ...">` wrapper and its header `<div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">` and body `<div className="p-5">`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export function ChartCardSkeleton({
  className,
  chartHeight = 192,
}: {
  className?: string;
  chartHeight?: number;
}) {
  return (
    <Surface as="section" className={className} aria-hidden>
      <SurfaceHeader>
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-[18px] w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      </SurfaceHeader>
      <SurfaceBody>
        <Skeleton className="w-full" style={{ height: chartHeight }} />
      </SurfaceBody>
    </Surface>
  );
}
```

Leave `ChartSectionSkeleton` below it unchanged.

Then do the same substitution in `src/components/loading/list-card-skeleton.tsx`, `src/components/loading/table-section-skeleton.tsx`, and `src/components/loading/metrics-grid-skeleton.tsx`: anywhere the literal `rounded-xl border border-border/80 bg-card` chrome appears, swap it for `<Surface>` and drop those classes from the `className`.

- [ ] **Step 7: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add vitest.config.ts src/components/ui/surface.tsx src/components/loading tests/components/surface.test.tsx
git commit -m "feat: add Surface primitive and enable component tests"
```

---

### Task 2: Purge hardcoded colors

26 occurrences across 20 files hardcode `bg-white` / `bg-slate-50`. Each is a dark-mode bug. This task removes all of them before the theme lands, so dark mode is correct the moment it ships.

**Files:**
- Modify: `src/app/globals.css`
- Modify: the 20 files listed in Step 3
- Create: `tests/unit/no-hardcoded-colors.test.ts`

**Interfaces:**
- Consumes: `Surface` from Task 1.
- Produces: CSS tokens `--surface` and `--surface-header`, and Tailwind colors `surface` / `surface-header`, usable as `bg-surface` and `bg-surface-header`.

- [ ] **Step 1: Write the failing guard test**

Create `tests/unit/no-hardcoded-colors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/** Literal colors that break dark mode when written into a .tsx file. */
const BANNED = /\b(?:bg-white|bg-slate-\d{2,3}|bg-gray-\d{2,3}|text-gray-\d{2,3}|border-gray-\d{2,3})\b/;

/**
 * Deliberate exceptions (spec R2): the violet ARAL accent and the amber
 * super-admin impersonation chips are design decisions, not palette drift.
 * Neither uses a banned class, so this list stays empty — it exists so a
 * future exception must be argued for explicitly here.
 */
const ALLOWED_FILES = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("palette discipline", () => {
  it("has no hardcoded colors in .tsx files", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (BANNED.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/no-hardcoded-colors.test.ts
```

Expected: FAIL, listing 26 offenders across 20 files.

- [ ] **Step 3: Add surface tokens**

In `src/app/globals.css`, inside the `:root` block, after the `--popover-foreground` line, add:

```css
    /* Elevated chrome (shell panel, sidebar, sticky header). Distinct from
       --card so panels can differ from content cards in dark mode. */
    --surface: 0 0% 100%;
    --surface-header: 0 0% 100%;
```

Inside the `.dark` block, after its `--popover-foreground` line, add:

```css
    /* Panels sit slightly above --background so the inset shell reads as raised. */
    --surface: 222 44% 10%;
    --surface-header: 222 42% 12%;
```

In `tailwind.config.ts`, inside `theme.extend.colors`, after the `popover` entry, add:

```ts
        surface: "hsl(var(--surface))",
        "surface-header": "hsl(var(--surface-header))",
```

- [ ] **Step 4: Replace every occurrence**

Apply these exact substitutions.

*Shell chrome → `bg-surface` / `bg-surface-header`:*

- `src/components/role-shell.tsx:71` — `lg:bg-white` → `lg:bg-surface`
- `src/components/role-shell.tsx:72` — `bg-white` → `bg-surface-header`
- `src/components/app-shell.tsx:110` — `bg-white/90` → `bg-surface-header/90`
- `src/components/onboarding-shell.tsx:22` — `bg-white/90` → `bg-surface-header/90`
- `src/components/app-sidebar.tsx:215` — `bg-white` → `bg-surface`
- `src/components/app-sidebar.tsx:316` — `bg-white` → `bg-surface`

*Card wrappers → drop the class (the `Card` primitive already paints `bg-card`):*

In each of these, delete just the ` bg-white` token from the `className`, leaving the rest:

- `src/app/account/created/page.tsx:69`
- `src/app/auth/reset/page.tsx:57`
- `src/app/pending-approval/page.tsx:63`
- `src/components/forms/admin-login-form.tsx:42`
- `src/components/forms/change-email-form.tsx:47`
- `src/components/forms/create-school-form.tsx:59`
- `src/components/forms/forgot-password-form.tsx:37`
- `src/components/forms/forgot-password-form.tsx:50`
- `src/components/forms/login-form.tsx:247`
- `src/components/forms/login-form.tsx:310`
- `src/components/forms/password-form.tsx:78`
- `src/components/forms/password-form.tsx:184`

So for example `src/app/account/created/page.tsx:69` becomes:

```tsx
        <Card className="rounded-xl border border-border/80 shadow-sm">
```

*Error pages → `bg-muted`:*

- `src/app/admin/error.tsx:19` — `bg-slate-50` → `bg-muted`
- `src/app/school-head/(app)/error.tsx:28` — `bg-slate-50` → `bg-muted`

*Inline code/credential boxes → `bg-card`:*

- `src/components/forms/create-school-form.tsx:33` — `bg-white` → `bg-card`
- `src/components/schools-table.tsx:202` — `bg-white` → `bg-card`

*Chart surfaces → `bg-card`:*

- `src/components/dashboard/admin-dashboard-sections.tsx:183` — `className="bg-white"` → `className="bg-card"`
- `src/components/dashboard/school-head-dashboard-sections.tsx:118` — same
- `src/components/dashboard/teacher-dashboard-sections.tsx:141` — same

*Metric card chip → translucent foreground:*

- `src/components/dashboard/metric-card.tsx:34` — `chip: "bg-white/20 text-primary-foreground"` → `chip: "bg-primary-foreground/20 text-primary-foreground"`

- [ ] **Step 5: Run the guard test and confirm it passes**

```powershell
npx vitest run tests/unit/no-hardcoded-colors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add -A
git commit -m "refactor: replace hardcoded colors with surface tokens"
```

---

### Task 3: Theme provider with light default and no flash

**Files:**
- Create: `src/lib/theme.ts`
- Create: `src/components/theme/theme-provider.tsx`
- Create: `src/components/theme/theme-script.tsx`
- Create: `tests/unit/theme.test.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Theme = "light" | "dark"`
  - `THEME_STORAGE_KEY = "litrack.theme"` (string const)
  - `DEFAULT_THEME: Theme` (`"light"`)
  - `resolveInitialTheme(stored: string | null): Theme`
  - `ThemeProvider({ children }: { children: React.ReactNode })` — client component
  - `useTheme(): { theme: Theme; setTheme(t: Theme): void; toggleTheme(): void; hydrated: boolean }`
  - `ThemeScript()` — server component emitting a blocking inline script

- [ ] **Step 1: Write the failing test for the pure resolver**

Create `tests/unit/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveInitialTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("resolveInitialTheme", () => {
  it("defaults to light when nothing is stored, even on a dark-preferring OS", () => {
    expect(resolveInitialTheme(null)).toBe("light");
  });

  it("honours a stored dark choice", () => {
    expect(resolveInitialTheme("dark")).toBe("dark");
  });

  it("honours a stored light choice", () => {
    expect(resolveInitialTheme("light")).toBe("light");
  });

  it("falls back to the default on a corrupt value", () => {
    expect(resolveInitialTheme("solarized")).toBe("light");
    expect(resolveInitialTheme("")).toBe("light");
  });

  it("exposes stable constants", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(THEME_STORAGE_KEY).toBe("litrack.theme");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/theme.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/theme"`.

- [ ] **Step 3: Implement the pure module**

Create `src/lib/theme.ts`:

```ts
/**
 * Theme constants and pure resolution logic.
 *
 * Deliberately DOM-free so it is unit-testable in the node vitest env and
 * importable from both server and client components.
 *
 * Light is the default even when the OS prefers dark (spec R9) — LITRACK is
 * used on shared school desktops whose OS theme is not the user's choice.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "litrack.theme";

export const DEFAULT_THEME: Theme = "light";

/** Narrow an untrusted localStorage value to a Theme. */
export function resolveInitialTheme(stored: string | null): Theme {
  return stored === "dark" || stored === "light" ? stored : DEFAULT_THEME;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```powershell
npx vitest run tests/unit/theme.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing provider test**

Create `tests/components/theme-provider.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme} data-testid="probe">
      {theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(cleanup);

describe("ThemeProvider", () => {
  it("starts light with no stored preference", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("probe").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads a stored dark preference and applies the class", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("probe").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggles, applies the class, and persists", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByTestId("probe").click());
    expect(screen.getByTestId("probe").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => screen.getByTestId("probe").click());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```powershell
npx vitest run tests/components/theme-provider.test.tsx
```

Expected: FAIL — cannot resolve `@/components/theme/theme-provider`.

- [ ] **Step 7: Implement the provider**

Create `src/components/theme/theme-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  type Theme,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** False until the stored preference has been read; use to defer transitions. */
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Applies `.dark` on <html> and persists the choice.
 *
 * `ThemeScript` already set the class before first paint, so this effect is a
 * no-op on the happy path — it exists to reconcile React state with the DOM
 * the script produced, and to cover storage-blocked browsers.
 *
 * Mirrors the useSidebarExpanded pattern: SSR renders the default, mount syncs
 * from localStorage, `hydrated` gates transitions to avoid an animated flash.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — keep the default.
    }
    const next = resolveInitialTheme(stored);
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setHydrated(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, hydrated }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
```

- [ ] **Step 8: Run the provider test and confirm it passes**

```powershell
npx vitest run tests/components/theme-provider.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 9: Implement the no-flash script**

Create `src/components/theme/theme-script.tsx`:

```tsx
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Blocking inline script that applies the stored theme before first paint.
 *
 * Without this, a dark-mode user sees a white flash on every hard navigation:
 * the server renders light (it cannot read localStorage) and React only
 * corrects it after hydration. Must stay synchronous and in <head> order —
 * do not add `defer` or `async`, and do not move it below <body> content.
 *
 * Deliberately does NOT consult prefers-color-scheme: light is the default
 * regardless of OS (spec R9).
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
  )});if(t!=="dark"&&t!=="light")t=${JSON.stringify(
    DEFAULT_THEME
  )};if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
```

- [ ] **Step 10: Mount both in the root layout**

In `src/app/layout.tsx`, add the imports:

```tsx
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
```

Then change the returned JSX so that `<html>` carries a `<head>` with the script, and `ThemeProvider` wraps the body contents:

```tsx
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <ThemeProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to main content
          </a>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
```

Note `suppressHydrationWarning` on `<html>` is already present and is required — the script mutates `className` before React hydrates.

- [ ] **Step 11: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/lib/theme.ts src/components/theme src/app/layout.tsx tests/unit/theme.test.ts tests/components/theme-provider.test.tsx
git commit -m "feat: add theme provider with light default and no-flash script"
```

---

### Task 4: Dark mode toggle in the header, upper right

**Files:**
- Create: `src/components/theme/theme-toggle.tsx`
- Create: `tests/components/theme-toggle.test.tsx`
- Modify: `src/components/role-shell.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/onboarding-shell.tsx`

**Interfaces:**
- Consumes: `useTheme()` from `@/components/theme/theme-provider` (Task 3); `Button` from `@/components/ui/button`; `Tooltip`/`TooltipTrigger`/`TooltipContent` from `@/components/ui/tooltip`.
- Produces: `ThemeToggle({ className }: { className?: string })` — client component.

- [ ] **Step 1: Write the failing test**

Create `tests/components/theme-toggle.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(cleanup);

function setup() {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
  return screen.getByRole("button", { name: /switch to (dark|light) mode/i });
}

describe("ThemeToggle", () => {
  it("offers dark mode while light is active", () => {
    const btn = setup();
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to dark on click and relabels itself", () => {
    const btn = setup();
    act(() => btn.click());
    expect(btn.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches back to light", () => {
    const btn = setup();
    act(() => btn.click());
    act(() => btn.click());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/components/theme-toggle.test.tsx
```

Expected: FAIL — cannot resolve `@/components/theme/theme-toggle`.

- [ ] **Step 3: Implement the toggle**

Create `src/components/theme/theme-toggle.tsx`:

```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

/**
 * Header light/dark switch (spec R9).
 *
 * Both icons render at all times, cross-faded with opacity, so the button
 * never changes size and there is no layout shift on toggle. Before hydration
 * the label reflects the light default, which matches what ThemeScript painted
 * for the overwhelming majority of visits.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, hydrated } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={cn("shrink-0", className)}
    >
      <span className="relative block h-5 w-5">
        <Sun
          aria-hidden
          className={cn(
            "absolute inset-0 h-5 w-5",
            hydrated && "transition-opacity duration-200",
            isDark ? "opacity-0" : "opacity-100"
          )}
        />
        <Moon
          aria-hidden
          className={cn(
            "absolute inset-0 h-5 w-5",
            hydrated && "transition-opacity duration-200",
            isDark ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
    </Button>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```powershell
npx vitest run tests/components/theme-toggle.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Mount it upper-right in `RoleShell`**

In `src/components/role-shell.tsx`, add the import:

```tsx
import { ThemeToggle } from "@/components/theme/theme-toggle";
```

The header's flex row currently ends with the breadcrumbs `<div className="min-w-0 flex-1">`. That `flex-1` already pushes anything after it to the right edge. Add the toggle immediately after that closing `</div>`, still inside `<div className="flex h-full w-full items-center gap-3 px-4 lg:gap-4 lg:px-8">`:

```tsx
                  <div className="min-w-0 flex-1">
                    <Breadcrumbs className="min-w-0 justify-start" />
                  </div>

                  <ThemeToggle />
```

- [ ] **Step 6: Mount it in `AppShell`'s fallback header**

In `src/components/app-shell.tsx`, add the same import, then add `<ThemeToggle />` after the `<div className="min-w-0 flex-1">…</div>` block inside `<div className="flex w-full items-center gap-3 px-4 py-4 lg:gap-4 lg:px-8">`:

```tsx
            <div className="min-w-0 flex-1">
              <Breadcrumbs className="mb-1 min-w-0 justify-start" />
              <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>

            <ThemeToggle className="self-start" />
```

- [ ] **Step 7: Mount it in `OnboardingShell`**

Open `src/components/onboarding-shell.tsx`. Inside the `<header className="sticky top-0 z-30 border-b border-border/80 bg-surface-header/90 backdrop-blur-md">` element, the inner row wraps the brand. Make that row a flex container that ends with the toggle — if the inner element is not already `flex items-center`, add those classes, then add `<div className="flex-1" />` and `<ThemeToggle />` as its last two children. Add the import at the top.

- [ ] **Step 8: Verify visually**

```powershell
npm run dev
```

Open http://localhost:3000/login, sign in with a seeded account (`npm run db:seed` prints one), and confirm on a teacher page:
1. The toggle sits at the upper right of the header.
2. Clicking it switches the whole shell — sidebar, panel, cards — to dark.
3. Hard-refresh: the page loads dark with **no white flash**.
4. Clear `localStorage` and reload: it loads light even if your OS is dark.

- [ ] **Step 9: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/components/theme src/components/role-shell.tsx src/components/app-shell.tsx src/components/onboarding-shell.tsx tests/components/theme-toggle.test.tsx
git commit -m "feat: add dark mode toggle to shell headers"
```

---

### Task 5: Hover-intent prefetch policy

The pure decision logic lives apart from React so it can be tested in the fast node env and reasoned about independently: *should we prefetch this href right now?*

**Files:**
- Create: `src/lib/nav/prefetch-intent.ts`
- Create: `tests/unit/prefetch-intent.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `INTENT_DELAY_MS = 80`
  - `MAX_INTENT_PREFETCHES = 12`
  - `createIntentTracker(): IntentTracker`
  - `type IntentTracker = { shouldPrefetch(href: string): boolean; markPrefetched(href: string): void; reset(): void; size(): number }`
  - `isSaveDataConnection(conn: NetworkInfo | undefined): boolean`
  - `type NetworkInfo = { saveData?: boolean; effectiveType?: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/prefetch-intent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createIntentTracker,
  isSaveDataConnection,
  MAX_INTENT_PREFETCHES,
  INTENT_DELAY_MS,
} from "@/lib/nav/prefetch-intent";

describe("createIntentTracker", () => {
  it("allows a first-seen href", () => {
    const t = createIntentTracker();
    expect(t.shouldPrefetch("/teacher")).toBe(true);
  });

  it("refuses an href already prefetched this session", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    expect(t.shouldPrefetch("/teacher")).toBe(false);
  });

  it("treats different hrefs independently", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    expect(t.shouldPrefetch("/teacher/reports")).toBe(true);
  });

  it("refuses empty and non-navigational hrefs", () => {
    const t = createIntentTracker();
    expect(t.shouldPrefetch("")).toBe(false);
    expect(t.shouldPrefetch("#section")).toBe(false);
    expect(t.shouldPrefetch("https://deped.gov.ph")).toBe(false);
    expect(t.shouldPrefetch("mailto:a@b.c")).toBe(false);
  });

  it("stops once the per-page budget is spent", () => {
    const t = createIntentTracker();
    for (let i = 0; i < MAX_INTENT_PREFETCHES; i++) {
      expect(t.shouldPrefetch(`/teacher/${i}`)).toBe(true);
      t.markPrefetched(`/teacher/${i}`);
    }
    expect(t.size()).toBe(MAX_INTENT_PREFETCHES);
    expect(t.shouldPrefetch("/teacher/overflow")).toBe(false);
  });

  it("reset clears the budget", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    t.reset();
    expect(t.size()).toBe(0);
    expect(t.shouldPrefetch("/teacher")).toBe(true);
  });
});

describe("isSaveDataConnection", () => {
  it("is false when the API is unavailable", () => {
    expect(isSaveDataConnection(undefined)).toBe(false);
  });

  it("is true when the user asked to save data", () => {
    expect(isSaveDataConnection({ saveData: true })).toBe(true);
  });

  it("is true on 2g-class connections", () => {
    expect(isSaveDataConnection({ effectiveType: "2g" })).toBe(true);
    expect(isSaveDataConnection({ effectiveType: "slow-2g" })).toBe(true);
  });

  it("is false on fast connections", () => {
    expect(isSaveDataConnection({ effectiveType: "4g" })).toBe(false);
    expect(isSaveDataConnection({ saveData: false, effectiveType: "3g" })).toBe(false);
  });
});

describe("constants", () => {
  it("delays long enough to filter pass-over hovers", () => {
    expect(INTENT_DELAY_MS).toBeGreaterThanOrEqual(50);
    expect(INTENT_DELAY_MS).toBeLessThanOrEqual(150);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/prefetch-intent.test.ts
```

Expected: FAIL — cannot resolve `@/lib/nav/prefetch-intent`.

- [ ] **Step 3: Implement the policy**

Create `src/lib/nav/prefetch-intent.ts`:

```ts
/**
 * Policy for hover/focus-intent prefetching (spec R6).
 *
 * DOM-free on purpose: `PrefetchLink` owns the event wiring, this owns the
 * decision. Kept separate because the failure mode here is expensive — every
 * FULL prefetch of a force-dynamic route re-runs middleware auth plus the
 * layout's Prisma queries, so an unbudgeted hover storm across a 200-row
 * roster can exhaust the pooler `connection_limit` and surface as error.tsx.
 * That is the same reasoning behind NavPrefetcher's concurrency cap.
 */

export const INTENT_DELAY_MS = 80;

/** Per-page-view prefetch budget. Roughly "the nav plus a screen of rows". */
export const MAX_INTENT_PREFETCHES = 12;

export type NetworkInfo = {
  saveData?: boolean;
  effectiveType?: string;
};

export type IntentTracker = {
  shouldPrefetch(href: string): boolean;
  markPrefetched(href: string): void;
  reset(): void;
  size(): number;
};

/** Only same-origin app paths are worth an RSC prefetch. */
function isNavigational(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function createIntentTracker(): IntentTracker {
  const seen = new Set<string>();

  return {
    shouldPrefetch(href) {
      if (!isNavigational(href)) return false;
      if (seen.has(href)) return false;
      if (seen.size >= MAX_INTENT_PREFETCHES) return false;
      return true;
    },
    markPrefetched(href) {
      seen.add(href);
    },
    reset() {
      seen.clear();
    },
    size() {
      return seen.size;
    },
  };
}

/** Respect Data Saver and slow links — speculative fetches cost real money. */
export function isSaveDataConnection(conn: NetworkInfo | undefined): boolean {
  if (!conn) return false;
  if (conn.saveData === true) return true;
  return conn.effectiveType === "2g" || conn.effectiveType === "slow-2g";
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```powershell
npx vitest run tests/unit/prefetch-intent.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/lib/nav/prefetch-intent.ts tests/unit/prefetch-intent.test.ts
git commit -m "feat: add hover-intent prefetch policy"
```

---

### Task 6: `PrefetchLink` component

**Files:**
- Create: `src/components/nav/prefetch-link.tsx`
- Create: `tests/components/prefetch-link.test.tsx`

**Interfaces:**
- Consumes: `createIntentTracker`, `isSaveDataConnection`, `INTENT_DELAY_MS` from `@/lib/nav/prefetch-intent` (Task 5).
- Produces:
  - `PrefetchLink(props: PrefetchLinkProps)` — client component wrapping `next/link`
  - `type PrefetchLinkProps = React.ComponentProps<typeof Link> & { href: string; intent?: boolean }`
  - `resetIntentBudget(): void` — clears the module-level tracker

- [ ] **Step 1: Write the failing test**

Create `tests/components/prefetch-link.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";

const prefetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { PrefetchLink, resetIntentBudget } from "@/components/nav/prefetch-link";
import { INTENT_DELAY_MS } from "@/lib/nav/prefetch-intent";

beforeEach(() => {
  prefetch.mockClear();
  resetIntentBudget();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("PrefetchLink", () => {
  it("prefetches after the intent delay on hover", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText("Reports"));
    expect(prefetch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).toHaveBeenCalledWith("/teacher/reports", { kind: "full" });
  });

  it("does not prefetch on a pass-over hover", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    const el = screen.getByText("Reports");
    fireEvent.mouseEnter(el);
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS - 20); });
    fireEvent.mouseLeave(el);
    act(() => { vi.advanceTimersByTime(200); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("prefetches on keyboard focus", () => {
    render(<PrefetchLink href="/teacher/learners">Learners</PrefetchLink>);
    fireEvent.focus(screen.getByText("Learners"));
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).toHaveBeenCalledWith("/teacher/learners", { kind: "full" });
  });

  it("prefetches immediately on touchstart (no hover on mobile)", () => {
    render(<PrefetchLink href="/teacher/aral">ARAL</PrefetchLink>);
    fireEvent.touchStart(screen.getByText("ARAL"));
    expect(prefetch).toHaveBeenCalledWith("/teacher/aral", { kind: "full" });
  });

  it("prefetches an href at most once", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    const el = screen.getByText("Reports");
    for (let i = 0; i < 3; i++) {
      fireEvent.mouseEnter(el);
      act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
      fireEvent.mouseLeave(el);
    }
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("skips intent prefetch when intent is false", () => {
    render(<PrefetchLink href="/teacher/reports" intent={false}>Reports</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText("Reports"));
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("still renders a working anchor", () => {
    render(<PrefetchLink href="/teacher" className="nav">Home</PrefetchLink>);
    const a = screen.getByText("Home");
    expect(a.getAttribute("href")).toBe("/teacher");
    expect(a.className).toContain("nav");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/components/prefetch-link.test.tsx
```

Expected: FAIL — cannot resolve `@/components/nav/prefetch-link`.

- [ ] **Step 3: Implement the component**

Create `src/components/nav/prefetch-link.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import {
  INTENT_DELAY_MS,
  createIntentTracker,
  isSaveDataConnection,
  type NetworkInfo,
} from "@/lib/nav/prefetch-intent";

/**
 * `next/link` plus hover / focus / touch intent prefetch (spec R6).
 *
 * Layering: NavPrefetcher warms a small set of shell routes on idle;
 * this warms whatever the user is actually pointing at, a few hundred
 * milliseconds before the click. Between them the Client Router Cache
 * (staleTimes.static = 600s in next.config.mjs) usually has the Flight
 * payload ready, so the destination swaps without a loading.tsx flash —
 * which is what makes the skeleton reduction in Task 10 safe.
 *
 * The tracker is module-level, not per-instance, so 200 roster rows share
 * one budget rather than each claiming their own.
 */

const tracker = createIntentTracker();

/** Next App Router PrefetchKind.FULL — full Flight data for dynamic routes. */
const PREFETCH_FULL = { kind: "full" } as NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;

/** Clear the per-page-view prefetch budget (used by tests and on route change). */
export function resetIntentBudget(): void {
  tracker.reset();
}

function connectionInfo(): NetworkInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInfo }).connection;
}

export type PrefetchLinkProps = React.ComponentProps<typeof Link> & {
  href: string;
  /** Set false for links that should keep default Link behaviour only. */
  intent?: boolean;
};

export function PrefetchLink({
  href,
  intent = true,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onTouchStart,
  children,
  ...rest
}: PrefetchLinkProps) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const runPrefetch = useCallback(() => {
    if (!tracker.shouldPrefetch(href)) return;
    if (isSaveDataConnection(connectionInfo())) return;
    tracker.markPrefetched(href);
    try {
      router.prefetch(href, PREFETCH_FULL);
    } catch {
      // Prefetch is best-effort; never surface into the UI.
    }
  }, [href, router]);

  const schedulePrefetch = useCallback(() => {
    if (!intent) return;
    if (!tracker.shouldPrefetch(href)) return;
    clearTimer();
    // Delay filters cursors merely passing over on the way somewhere else.
    timerRef.current = setTimeout(runPrefetch, INTENT_DELAY_MS);
  }, [intent, href, clearTimer, runPrefetch]);

  return (
    <Link
      href={href}
      onMouseEnter={(e) => {
        schedulePrefetch();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        clearTimer();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        schedulePrefetch();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        // No hover on touch — the tap is already committed, so go now.
        if (intent) runPrefetch();
        onTouchStart?.(e);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```powershell
npx vitest run tests/components/prefetch-link.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/components/nav/prefetch-link.tsx tests/components/prefetch-link.test.tsx
git commit -m "feat: add PrefetchLink with hover and focus intent prefetch"
```

---

### Task 7: Adopt `PrefetchLink` across navigation surfaces

**Files:**
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/user-account-menu.tsx`
- Modify: `src/components/breadcrumbs.tsx`
- Modify: `src/components/dashboard/teacher-dashboard-sections.tsx`
- Modify: `src/components/dashboard/school-head-dashboard-sections.tsx`
- Modify: `src/components/dashboard/admin-dashboard-sections.tsx`

**Interfaces:**
- Consumes: `PrefetchLink` from `@/components/nav/prefetch-link` (Task 6).
- Produces: no new exports.

- [ ] **Step 1: Convert the sidebar `NavLink`**

In `src/components/app-sidebar.tsx`, find the `NavLink` component definition. Replace its `import Link from "next/link"` usage inside `NavLink` with `PrefetchLink`, keeping every existing prop. Add at the top of the file:

```tsx
import { PrefetchLink } from "@/components/nav/prefetch-link";
```

In `NavLink`'s JSX, change `<Link ... >` / `</Link>` to `<PrefetchLink ... >` / `</PrefetchLink>`. Keep the existing `prefetch={fullPrefetch ? true : undefined}` prop as-is — `PrefetchLink` forwards unknown props straight to `next/link`, so the existing idle-warm behaviour for the home link is preserved and hover intent is added on top.

Leave the brand `<Link href={homeHref} prefetch={true}>` alone — it is already fully prefetched, so intent adds nothing.

- [ ] **Step 2: Replace the two raw `<button>` elements in the sidebar**

`src/components/app-sidebar.tsx:~262` uses a raw `<button type="button" className="mt-3 flex w-full items-center justify-center rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700">` as a `TooltipTrigger`. Per spec R1 that becomes a `Button`:

```tsx
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-3 h-auto w-full justify-center rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                    aria-label={`Viewing: ${viewedSchoolName}`}
                  >
                    <Shield className="h-3.5 w-3.5 shrink-0" />
                  </Button>
```

Give the sibling non-collapsed `<div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">` the same dark variants so the impersonation chip stays legible:

```tsx
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
```

- [ ] **Step 3: Convert menu and dashboard links**

In `src/components/user-account-menu.tsx`, `src/components/breadcrumbs.tsx`, and the three `src/components/dashboard/*-dashboard-sections.tsx` files: replace `import Link from "next/link"` with `import { PrefetchLink } from "@/components/nav/prefetch-link"` and rename every `<Link>` / `</Link>` to `<PrefetchLink>` / `</PrefetchLink>`.

Where a `Button` navigates via `asChild`, the wrapped anchor is the link, so the same rename applies:

```tsx
<Button asChild variant="outline" size="sm">
  <PrefetchLink href={`/teacher/grade/${grade.id}`}>Open</PrefetchLink>
</Button>
```

- [ ] **Step 4: Confirm nothing was missed**

```powershell
npx eslint src/components --ext .tsx
npm run typecheck
```

Then check no converted file still imports `next/link`:

```powershell
Select-String -Path src/components/app-sidebar.tsx,src/components/user-account-menu.tsx,src/components/breadcrumbs.tsx,src/components/dashboard/*-dashboard-sections.tsx -Pattern 'from "next/link"'
```

Expected: only `src/components/app-sidebar.tsx` still matches (the brand link).

- [ ] **Step 5: Verify in the browser**

```powershell
npm run dev
```

Open DevTools → Network, filter to `_rsc`. Hover a sidebar item without clicking: an RSC request fires ~80ms in. Hover it again: no second request. Click it: the page swaps with no skeleton.

- [ ] **Step 6: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/components
git commit -m "perf: prefetch nav destinations on hover and focus"
```

---

### Task 8: Named cache TTL profiles (data-layer ISR)

`cachedQuery` takes a raw `revalidate` number defaulting to 60s, applied uniformly. Different data changes at very different rates: a school's name is near-immutable, a dashboard aggregate churns daily. Named profiles make the TTL a documented decision.

**Files:**
- Create: `src/lib/cache/profiles.ts`
- Modify: `src/lib/cache/unstable.ts`
- Modify: `src/lib/dashboard/aggregates.ts`
- Modify: `src/lib/cache/school.ts`
- Modify: `src/lib/cache/schools-list.ts`
- Create: `tests/unit/cache-profiles.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type CacheProfile = "static" | "reference" | "aggregate" | "volatile"`
  - `CACHE_TTL: Record<CacheProfile, number>`
  - `resolveRevalidate(opts: { profile?: CacheProfile; revalidate?: number }): number`
  - `cachedQuery` gains an optional `profile?: CacheProfile` in `CachedOptions`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cache-profiles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CACHE_TTL, resolveRevalidate } from "@/lib/cache/profiles";

describe("CACHE_TTL", () => {
  it("orders profiles from longest-lived to shortest", () => {
    expect(CACHE_TTL.static).toBeGreaterThan(CACHE_TTL.reference);
    expect(CACHE_TTL.reference).toBeGreaterThan(CACHE_TTL.aggregate);
    expect(CACHE_TTL.aggregate).toBeGreaterThan(CACHE_TTL.volatile);
  });

  it("keeps every profile bounded so a missed tag self-heals", () => {
    for (const ttl of Object.values(CACHE_TTL)) {
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
    }
  });
});

describe("resolveRevalidate", () => {
  it("resolves a named profile", () => {
    expect(resolveRevalidate({ profile: "reference" })).toBe(CACHE_TTL.reference);
  });

  it("lets an explicit number win over a profile", () => {
    expect(resolveRevalidate({ profile: "static", revalidate: 15 })).toBe(15);
  });

  it("defaults to the aggregate profile", () => {
    expect(resolveRevalidate({})).toBe(CACHE_TTL.aggregate);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/cache-profiles.test.ts
```

Expected: FAIL — cannot resolve `@/lib/cache/profiles`.

- [ ] **Step 3: Implement the profiles**

Create `src/lib/cache/profiles.ts`:

```ts
/**
 * Named Data Cache TTLs (spec R5, Tier B).
 *
 * This is LITRACK's ISR. Route-level ISR is unavailable — every role page is
 * force-dynamic because requireUser() reads cookies, and a Full Route Cache
 * entry is shared across users, so caching rendered HTML would leak one
 * school's data to another tenant. Instead the *data* is incrementally
 * revalidated: served from Next's Data Cache until its TTL lapses or a
 * mutation busts its tag, while the page itself still renders per-request
 * under the caller's own auth.
 *
 * Every TTL is bounded so that a mutation which forgets to bust a tag
 * self-heals within a known window rather than serving stale data forever.
 */

export type CacheProfile =
  /** Effectively immutable within a session (school name, enum-ish lookups). */
  | "static"
  /** Reference data changed by deliberate admin action (school lists, years). */
  | "reference"
  /** Rolled-up counts and charts — a minute of staleness is invisible. */
  | "aggregate"
  /** Anything a user expects to see change right after their own write. */
  | "volatile";

export const CACHE_TTL: Record<CacheProfile, number> = {
  static: 900,
  reference: 300,
  aggregate: 60,
  volatile: 15,
};

/** Explicit `revalidate` wins; otherwise the profile; otherwise `aggregate`. */
export function resolveRevalidate(opts: {
  profile?: CacheProfile;
  revalidate?: number;
}): number {
  if (typeof opts.revalidate === "number") return opts.revalidate;
  return CACHE_TTL[opts.profile ?? "aggregate"];
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```powershell
npx vitest run tests/unit/cache-profiles.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire profiles into `cachedQuery`**

Replace `src/lib/cache/unstable.ts` entirely:

```ts
import "server-only";
import { unstable_cache } from "next/cache";
import { resolveRevalidate, type CacheProfile } from "@/lib/cache/profiles";

export type CachedOptions = {
  /**
   * Cache key segments (must be serializable / stable).
   *
   * Tenant safety: any school-scoped query MUST include its `schoolId` (or
   * `userId`) here. Two tenants sharing a key part is a cross-tenant leak.
   */
  keyParts: string[];
  /** Tags for `revalidateTag` invalidation. */
  tags: string[];
  /** Named TTL profile — see `@/lib/cache/profiles`. Defaults to "aggregate". */
  profile?: CacheProfile;
  /** Explicit TTL override in seconds. Wins over `profile`. */
  revalidate?: number;
};

/**
 * Cross-request Data Cache wrapper around Next `unstable_cache`.
 * Works on `force-dynamic` pages (auth) — bypasses Full Route Cache limits.
 */
export function cachedQuery<T>(
  fn: () => Promise<T>,
  options: CachedOptions
): Promise<T> {
  const { keyParts, tags, profile, revalidate } = options;
  return unstable_cache(fn, keyParts, {
    tags,
    revalidate: resolveRevalidate({ profile, revalidate }),
  })();
}
```

This is backwards-compatible: existing callers passing `revalidate` keep their exact TTL, and callers passing neither move from a hardcoded 60 to `CACHE_TTL.aggregate`, which is also 60.

- [ ] **Step 6: Assign profiles to existing callers**

In `src/lib/cache/school.ts` (`getSchoolName`), replace any `revalidate: <n>` in the `cachedQuery` options with `profile: "static"` — a school's name does not change during a session, and `revalidateSchoolDashboard` already busts it on the rare rename.

In `src/lib/cache/schools-list.ts`, replace the `revalidate` option with `profile: "reference"`.

In `src/lib/dashboard/aggregates.ts`, add `profile: "aggregate"` to each `cachedQuery` call that does not already pass an explicit `revalidate`, and delete any `revalidate: 60` in favour of the profile.

- [ ] **Step 7: Verify tenant keying**

Confirm every `cachedQuery` call site puts a tenant discriminator in `keyParts`:

```powershell
Select-String -Path src/lib/**/*.ts -Pattern "keyParts" -Context 0,4
```

Read each result. Any school-scoped query whose `keyParts` lacks `schoolId` (or `userId` for teacher-scoped data) is a cross-tenant leak — add it. If you find one, note it in the commit message.

- [ ] **Step 8: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/lib/cache src/lib/dashboard/aggregates.ts tests/unit/cache-profiles.test.ts
git commit -m "perf: add named cache TTL profiles for data-layer ISR"
```

---

### Task 9: Route-level ISR on public routes

The only routes that can legally hold a Full Route Cache entry are those that render no per-user data.

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/pending-approval/page.tsx`
- Modify: `src/app/account/created/page.tsx`
- Modify: `src/app/auth/reset/page.tsx`
- Create: `tests/unit/route-isr-safety.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — this task adds route segment config and a guard test.

- [ ] **Step 1: Write the failing guard test**

Create `tests/unit/route-isr-safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../src/app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx" || entry === "layout.tsx") out.push(full);
  }
  return out;
}

/**
 * A Full Route Cache entry is shared across all users. Caching a rendered page
 * that read the session would serve one tenant's data to another — the worst
 * bug shippable in this repo (CLAUDE.md). This test makes that unshippable.
 */
describe("route ISR safety", () => {
  it("never puts `revalidate` on a route that reads the session", () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = readFileSync(file, "utf8");
      const hasRevalidate = /export\s+const\s+revalidate\s*=/.test(text);
      const readsSession = /require(?:School)?User\s*\(|getCurrentUser\s*\(/.test(text);
      if (hasRevalidate && readsSession) {
        offenders.push(path.relative(APP, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("marks the public routes as revalidating", () => {
    const publicPages = [
      "login/page.tsx",
      "pending-approval/page.tsx",
      "account/created/page.tsx",
      "auth/reset/page.tsx",
    ];
    for (const rel of publicPages) {
      const text = readFileSync(path.join(APP, rel), "utf8");
      expect(text, rel).toMatch(/export\s+const\s+revalidate\s*=\s*\d+/);
      expect(text, rel).not.toMatch(/export\s+const\s+dynamic\s*=\s*"force-dynamic"/);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/route-isr-safety.test.ts
```

Expected: FAIL on the second test — the public pages have no `revalidate` export.

- [ ] **Step 3: Confirm each page is genuinely session-free**

Read all four files. Each must contain **no** call to `requireUser`, `requireSchoolUser`, `getCurrentUser`, `cookies()`, or `headers()`. If any of them does, **stop and do not add `revalidate` to that file** — remove it from the list in the test instead and note why in the commit message. A page that only renders a client form (`LoginForm`, `PasswordForm`) is safe.

- [ ] **Step 4: Add the segment config**

At the top of each of the four page files, below the imports, replace any existing `export const dynamic = "force-dynamic";` with:

```tsx
/**
 * Public route — renders no session data, so a shared Full Route Cache entry
 * is safe. One hour: the copy changes only on deploy, and a deploy busts it.
 */
export const revalidate = 3600;
```

- [ ] **Step 5: Run the guard test and confirm it passes**

```powershell
npx vitest run tests/unit/route-isr-safety.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Confirm the build prerenders them**

```powershell
$env:NEXT_BUILD_DIST_DIR=".next-verify"; npm run build
```

In the route table, `/login`, `/pending-approval`, `/account/created`, and `/auth/reset` should be marked `● (ISR)` or `○ (Static)` rather than `ƒ (Dynamic)`. Then clean up the dist-dir churn Next writes into your tsconfig:

```powershell
Remove-Item Env:\NEXT_BUILD_DIST_DIR
git checkout -- tsconfig.json next-env.d.ts
```

- [ ] **Step 7: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/app tests/unit/route-isr-safety.test.ts
git commit -m "perf: enable route ISR on session-free public routes"
```

---

### Task 10: Narrow the refresh boundaries (parent vs child)

Today a teacher dashboard page awaits all of its data before rendering anything, so a single slow aggregate blocks the whole page and any refresh re-renders every section. Splitting each independent data region into its own `Suspense` boundary means slow sections stream in separately and a mutation that busts one tag re-renders only that section.

**Files:**
- Modify: `src/app/teacher/(app)/page.tsx`
- Modify: `src/app/school-head/(app)/page.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: skeleton components from `@/components/loading` (`MetricsGridSkeleton`, `ChartSectionSkeleton`, `ListCardSkeleton`).
- Produces: no new exports. Each dashboard page gains async sub-components named `<Role>MetricsSection`, `<Role>ChartsSection`, `<Role>ListSection`, colocated in the same page file.

- [ ] **Step 1: Read the current teacher dashboard**

```powershell
Get-Content "src/app/teacher/(app)/page.tsx"
```

Note which `await`ed call feeds which rendered region. The refactor must not change a single query or its arguments — only *where* it is awaited.

- [ ] **Step 2: Split the teacher dashboard into streamed sections**

Restructure `src/app/teacher/(app)/page.tsx` to this shape, substituting the real query and component names you just read:

```tsx
import { Suspense } from "react";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";

export const dynamic = "force-dynamic";

/**
 * Each section is its own async component inside its own Suspense boundary.
 *
 * Two wins over one big `await` at the top: a slow aggregate no longer blocks
 * the whole page (fast sections paint first), and because each section has its
 * own cache tag, a mutation that busts one tag re-renders only that subtree —
 * RoleShell, sidebar, and the untouched sections stay mounted (spec R7).
 */
export default async function TeacherDashboardPage() {
  const user = await requireSchoolUser("TEACHER");

  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <Suspense fallback={<MetricsGridSkeleton variant="teacher" />}>
        <TeacherMetricsSection userId={user.id} schoolId={user.schoolId} />
      </Suspense>

      <Suspense fallback={<ChartSectionSkeleton columns={1} />}>
        <TeacherChartsSection userId={user.id} schoolId={user.schoolId} />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton grid items={3} />}>
        <TeacherGradesSection userId={user.id} schoolId={user.schoolId} />
      </Suspense>
    </div>
  );
}

async function TeacherMetricsSection({
  userId,
  schoolId,
}: {
  userId: string;
  schoolId: string;
}) {
  const metrics = await getTeacherMetrics({ teacherId: userId, schoolId });
  return <TeacherMetricsCards metrics={metrics} />;
}
```

Then write `TeacherChartsSection` and `TeacherGradesSection` the same way, each awaiting exactly the query that fed its region before.

Two rules that must hold:
- The auth guard stays in the **page**, above all boundaries. Never move `requireSchoolUser` into a section — a section could then render before the guard resolves.
- Pass `schoolId` down as a prop rather than re-calling `requireSchoolUser` per section.

- [ ] **Step 3: Verify the sections stream independently**

```powershell
npm run dev
```

Load `/teacher` with DevTools → Network throttled to "Slow 4G". The metrics row should paint before the charts. Confirm the sidebar and breadcrumbs never blank out.

- [ ] **Step 4: Repeat for the school-head dashboard**

Apply the identical treatment to `src/app/school-head/(app)/page.tsx`, naming the sections `SchoolHeadMetricsSection`, `SchoolHeadChartsSection`, `SchoolHeadListSection`, and using `<MetricsGridSkeleton variant="school-head" />` if that variant exists (check the component's prop type; otherwise omit `variant`).

- [ ] **Step 5: Repeat for the admin dashboard**

Apply the identical treatment to `src/app/admin/page.tsx`, naming the sections `AdminMetricsSection`, `AdminChartsSection`, `AdminListSection`.

- [ ] **Step 6: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add src/app/teacher src/app/school-head src/app/admin
git commit -m "perf: stream dashboard sections in independent Suspense boundaries"
```

---

### Task 11: Prune the skeletons

41 `loading.tsx` files produce skeleton-over-skeleton flashes. With hover-intent prefetch (Task 7) filling the Client Router Cache and Suspense boundaries (Task 10) covering slow sections, most nested `loading.tsx` files now show a skeleton for a route whose payload has already arrived — pure flash.

**Files:**
- Delete: 12 nested `loading.tsx` files (Step 2)
- Modify: 12 nested `loading.tsx` files → `ContentRouteLoading` (Step 3)
- Keep unchanged: 5 segment-root `loading.tsx` files (Step 1)

**Interfaces:**
- Consumes: `ContentRouteLoading` from `@/components/loading`.
- Produces: nothing.

- [ ] **Step 1: Identify and keep the segment roots**

These five stay exactly as they are — they are the first paint after a hard navigation, where there is genuinely nothing on screen:

```
src/app/loading.tsx
src/app/admin/loading.tsx
src/app/school-head/(app)/loading.tsx
src/app/teacher/(app)/loading.tsx
src/app/login/loading.tsx
```

- [ ] **Step 2: Delete the redundant nested skeletons**

These sit below a segment root whose `RoleShell` stays mounted, and are reached only by soft navigation from a warmed link:

```powershell
git rm "src/app/account/password/loading.tsx" `
       "src/app/account/set-password/loading.tsx" `
       "src/app/admin/login/loading.tsx" `
       "src/app/admin/password/loading.tsx" `
       "src/app/admin/profile/loading.tsx" `
       "src/app/admin/settings/loading.tsx" `
       "src/app/school-head/(app)/password/loading.tsx" `
       "src/app/school-head/(app)/settings/loading.tsx" `
       "src/app/school-head/(app)/school-info/loading.tsx" `
       "src/app/teacher/(app)/password/loading.tsx" `
       "src/app/teacher/(app)/settings/loading.tsx" `
       "src/app/school-head/(onboarding)/profiling/loading.tsx"
```

- [ ] **Step 3: Reduce mid-weight routes to the progress bar**

For each of these twelve files, replace the entire contents with the minimal bar — the destination is a table or form that renders fast once its data arrives, so a full structural skeleton is more motion than information:

```tsx
import { ContentRouteLoading } from "@/components/loading";

export default function Loading() {
  return <ContentRouteLoading />;
}
```

Files:
```
src/app/admin/audit/loading.tsx
src/app/admin/school-years/loading.tsx
src/app/admin/transfers/loading.tsx
src/app/school-head/(app)/announcements/loading.tsx
src/app/school-head/(app)/audit/loading.tsx
src/app/school-head/(app)/school-years/loading.tsx
src/app/school-head/(app)/transfer/loading.tsx
src/app/teacher/(app)/grade/[id]/import/loading.tsx
src/app/teacher/(app)/grade/[id]/learners/[learnerId]/edit/loading.tsx
src/app/teacher/(app)/aral/[gradeId]/learners/[id]/attendance/loading.tsx
src/app/teacher/(app)/aral/[gradeId]/learners/[id]/reading-level/loading.tsx
src/app/teacher/(app)/aral/[gradeId]/learners/[id]/update/loading.tsx
```

- [ ] **Step 4: Leave the remaining list/roster skeletons alone**

The rest (`admin/schools`, `school-head/teachers`, `teacher/learners`, `teacher/grade/[id]`, `teacher/aral`, and the reports routes) keep their structural skeletons: they are heavy tables reachable by direct URL, where a matching shape genuinely reduces perceived wait.

- [ ] **Step 5: Verify no orphaned imports**

```powershell
npm run lint
```

Expected: clean. If any deleted file was the only consumer of a `@/components/loading` export, lint will flag it as unused in `src/components/loading/index.ts` — leave the export, it is a public module surface.

- [ ] **Step 6: Verify the navigation feel**

```powershell
npm run dev
```

Click through the sidebar of each role twice. On the second pass every destination should swap with no skeleton at all (warm Client Router Cache). Confirm no route now hangs on a blank screen — if one does, it needs its `loading.tsx` restored from git.

- [ ] **Step 7: Verify and commit**

```powershell
npm run typecheck; if ($?) { npm run lint }; if ($?) { npm run test }
git add -A
git commit -m "perf: reduce loading.tsx count from 41 to 29 and cut skeleton flash"
```

---

### Task 12: shadcn primitive coverage for tables, and final verification

Three pages build audit and school-year tables from raw `<table>` markup instead of the `ui/table` primitives.

**Files:**
- Modify: `src/app/admin/audit/page.tsx`
- Modify: `src/app/admin/school-years/page.tsx`
- Modify: `src/app/school-head/(app)/audit/page.tsx`
- Create: `tests/unit/shadcn-coverage.test.ts`

**Interfaces:**
- Consumes: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` from `@/components/ui/table`; `Surface` from Task 1.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing guard test**

Create `tests/unit/shadcn-coverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/**
 * `src/components/ui` holds the primitives themselves, and the printable
 * report is a deliberate plain-HTML document for the browser print pipeline —
 * shadcn wrappers there would fight the print stylesheet.
 */
const EXEMPT = [
  "components/ui/",
  "components/reports/printable-learners-report.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("shadcn coverage", () => {
  it("uses ui primitives instead of raw table and button elements", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (EXEMPT.some((e) => rel.startsWith(e) || rel === e)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/<table[\s>]/.test(line) || /<button[\s>]/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
npx vitest run tests/unit/shadcn-coverage.test.ts
```

Expected: FAIL, listing the three page files plus the remaining raw `<button>` sites in `src/components/forms/form-error-summary.tsx`, `src/components/forms/login-form.tsx`, and `src/components/learners/learner-search-select.tsx`.

- [ ] **Step 3: Convert the three tables**

In each of `src/app/admin/audit/page.tsx`, `src/app/admin/school-years/page.tsx`, and `src/app/school-head/(app)/audit/page.tsx`, add:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Surface } from "@/components/ui/surface";
```

Then replace the raw markup element-for-element, dropping the hand-rolled classNames the primitives already provide:

```tsx
<Surface className="overflow-hidden">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>When</TableHead>
        <TableHead>Actor</TableHead>
        <TableHead>Action</TableHead>
        <TableHead>Resource</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell>{formatWhen(row.createdAt)}</TableCell>
          <TableCell>{row.actorName}</TableCell>
          <TableCell>{row.action}</TableCell>
          <TableCell>{row.resourceId}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</Surface>
```

Keep each page's existing column set, cell contents, empty state, and pagination controls exactly as they are — this is a markup swap, not a redesign.

- [ ] **Step 4: Convert the remaining raw buttons**

- `src/components/forms/form-error-summary.tsx` — the error-jump control becomes `<Button type="button" variant="link" size="sm" className="h-auto p-0 text-left" onClick={…}>`.
- `src/components/forms/login-form.tsx` — the show/hide or role-switch control becomes `<Button type="button" variant="ghost" size="sm" …>`, keeping its existing `onClick`, `aria-*`, and label.
- `src/components/learners/learner-search-select.tsx` — the combobox trigger becomes `<Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between" …>`. Preserve every existing ARIA attribute; a combobox that loses `aria-expanded` or `role` is a regression.
- `src/components/ui/password-input.tsx` is exempt (it lives under `components/ui`), but convert its reveal toggle to `Button variant="ghost" size="icon"` anyway for visual consistency with the rest of the system.

- [ ] **Step 5: Run the guard test and confirm it passes**

```powershell
npx vitest run tests/unit/shadcn-coverage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Full CI-equivalent verification**

Run the exact gate CI runs, in order:

```powershell
npx prisma generate; if ($?) { npm run typecheck }; if ($?) { npm run lint }; if ($?) { npm run test }
```

Then the build, in a scratch dist dir:

```powershell
$env:NEXT_BUILD_DIST_DIR=".next-verify"; npm run build
Remove-Item Env:\NEXT_BUILD_DIST_DIR
git checkout -- tsconfig.json next-env.d.ts
```

All five must pass. Do not proceed while any is failing.

- [ ] **Step 7: Manual acceptance pass**

```powershell
npm run dev
```

Walk the spec requirements as a checklist, in both light and dark, for each of the three roles:

1. **R9** — toggle at upper right of the header on every page; light on a cleared profile; dark survives a hard refresh with no white flash.
2. **R2** — no white-on-white or black-on-black anywhere in dark mode. Check specifically: sidebar, sticky header, cards, tables, the amber impersonation chip, and the violet ARAL sections.
3. **R6** — DevTools Network filtered to `_rsc`: hovering a sidebar item fires one request; hovering it again fires none.
4. **R8** — second pass through the sidebar shows no skeletons at all.
5. **R7** — submit a form (e.g. edit a learner); confirm the sidebar and breadcrumbs do not blank out and only the affected section re-renders.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "refactor: complete shadcn primitive coverage for tables and buttons"
```

---

## Self-Review

**Spec coverage**

| Req | Tasks |
|---|---|
| R1 shadcn everywhere | 12 (tables, buttons), 7 (sidebar button) |
| R2 one palette | 2 (token purge + guard test), 1 (`Surface`) |
| R3 reusable elements | 1 (`Surface` replaces 24 duplications) |
| R4 faster to fetch | 1 (`Surface` is a server component), 12 (primitives over hand-rolled markup) |
| R5 ISR | 8 (Tier B data ISR), 9 (Tier A route ISR + safety guard) |
| R6 prefetch/preload | 5 (policy), 6 (`PrefetchLink`), 7 (adoption) |
| R7 parent/child refresh | 10 (Suspense boundaries per section) |
| R8 fewer skeletons | 11 (41 → 29 files) |
| R9 dark mode, light default | 3 (provider + no-flash script), 4 (header toggle) |

No gaps.

**Type consistency check**

- `Theme`, `THEME_STORAGE_KEY`, `DEFAULT_THEME`, `resolveInitialTheme` — defined in Task 3 Step 3, used identically in Tasks 3 and 4.
- `useTheme()` returns `{ theme, setTheme, toggleTheme, hydrated }` in Task 3; Task 4 consumes exactly `theme`, `toggleTheme`, `hydrated`.
- `createIntentTracker`, `isSaveDataConnection`, `INTENT_DELAY_MS`, `NetworkInfo` — defined Task 5, consumed Task 6 with matching signatures.
- `Surface` / `SurfaceHeader` / `SurfaceBody` — defined Task 1, consumed Tasks 1, 2, 12.
- `CacheProfile`, `CACHE_TTL`, `resolveRevalidate` — defined Task 8 Step 3, consumed Task 8 Step 5.
- `PrefetchLink`, `resetIntentBudget` — defined Task 6, consumed Tasks 6 (test) and 7.

**Known ordering dependencies**

Tasks 1 → 2 (Surface before the purge), 3 → 4 (provider before toggle), 5 → 6 → 7 (policy → component → adoption), 10 → 11 (Suspense boundaries must exist before the skeletons they replace are deleted). Tasks 8, 9, and 12 are independent of the rest and may be reordered.

**Places the implementer must read before editing**

Tasks 10 and 12 deliberately do not paste the current page bodies — those files are long and their query names must be read from source rather than guessed. Both tasks open with an explicit read step and state the invariant the refactor must preserve.
