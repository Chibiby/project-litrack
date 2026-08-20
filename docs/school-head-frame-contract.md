# School Head frame adoption — conversion contract

Working notes for the School Head redesign. Every page under
`src/app/school-head/(app)/` moves onto one shared frame. This file is the
contract each converting agent follows; delete it once the redesign lands.

## Read these first

1. `src/components/school-head/school-head-page.tsx` — the frame. Read the whole
   file including the doc comment; the props are the contract.
2. `src/lib/school-head/view.ts` — `resolveSchoolHeadView`, the one auth call.
3. `src/lib/routes/school-head.ts` — every path lives here.
4. `src/components/school-head/workspace-tabs.ts` — tab definitions.
5. `src/components/school-head/page-skeleton.tsx` — `SchoolHeadPageSkeleton`.
6. `src/components/ui/callout.tsx` — the only banner.
7. `src/components/ui/surface.tsx` — panel chrome.
8. `src/app/school-head/(app)/school/years/page.tsx` — **the reference
   conversion.** Copy this idiom exactly.
9. `src/components/shell/app-shell.tsx` — read it to confirm rule 1 for
   yourself rather than trusting this file.

## Rules

1. **Replace `AppShell` with `SchoolHeadPage`.** Inside `RoleShell`, `AppShell`
   collapses to `<main id="main-content" className="w-full p-4 lg:p-6">` plus a
   title block. `SchoolHeadPage` renders the same `<main>`, so the swap is 1:1
   with no chrome regression. Never render your own `<main>` — that would give
   the page two landmarks. Never touch `AppHeader`; it stays shared.

2. **Replace the four-step auth preamble with `resolveSchoolHeadView`.** It does
   `requireUser("SCHOOL_HEAD")`, the profiling redirect, `resolveSchoolContext`,
   and the school-name lookup. Do not re-add an unconditional `getSchoolName` —
   the helper only fetches it in Super Admin view. Pass the route constant as the
   second argument: that path lands in the `ADMIN_SCHOOL_VIEW` audit row, so a
   wrong value corrupts the audit trail.

3. **`title` / `description`, not `title` / `subtitle`.** Drop the
   `— {schoolName}` title suffix and the "Super Admin View" subtitle: the frame
   renders both as a badge under the heading.

4. **No hand-rolled banners.** Any `rounded-* border-amber-* bg-amber-*` div
   becomes `<Callout>`. Most of them have zero `dark:` coverage today, which is
   the whole reason this rule exists.

5. **No raw `Card` for panel chrome** — use `Surface` / `SurfaceHeader` /
   `SurfaceBody`. Leave `MetricCard` and `ChartCard` alone; they are their own
   components, not generic panels.

6. **Every `/school-head/...` literal goes through `SCHOOL_HEAD_ROUTES`.** Zero
   exceptions, comments included. Several pages currently point at routes that
   have already moved and now only redirect — a literal pointing at a stub still
   renders, and `revalidatePath` on a stub is a silent no-op, so nothing fails
   loudly. The constant turns that class of bug into a compile error.

7. **Super-Admin-aware links go through `schoolHeadHref(view, path)`** so
   `?schoolId=` survives the navigation.

8. **Convert the sibling `loading.tsx`** to `SchoolHeadPageSkeleton` so a soft
   nav does not redraw the header.

## Hard constraints

- **No behaviour or data changes.** Every `where` keeps its `schoolId` and its
  `deletedAt: null`. Cross-tenant leakage is the worst bug shippable here, and a
  visual refactor that quietly drops a `where` clause is how it happens.
- Do not reshape `Suspense` boundaries, `force-dynamic`, cache tags, or
  `revalidate*` calls.
- **No new dependency.** `.npmrc` sets `legacy-peer-deps` and React types are
  pinned via `overrides`; adding a package is effectively forbidden. The frame
  does tabs with links for exactly this reason.
- Edit only your assigned files. `src/components/**` shared primitives and
  `src/lib/**` are read-only for you — if one needs a change, report it instead.
- **Do not run `tsc`, `lint`, `test`, or `build.`** Sibling agents are mid-write
  and you would read half-written files. Be correct by construction.
- `import type { ReactNode } from "react"` — do not write a bare
  `React.ReactNode` in a new file that does not import React.
- Match the surrounding comment density, naming, and idiom.

## Design intent

Evolve today's LITRACK look rather than replacing it: blue primary, amber
secondary, violet reserved for ARAL, Inter throughout. Rebuild the *layout*
language — real page headers, one card chrome, honest density, working dark
mode. Use the HSL token classes (`bg-card`, `text-muted-foreground`,
`border-border`); any hardcoded colour needs an explicit `dark:` variant because
there is no `--warning` token. Keep focus rings visible. Wide content scrolls
inside its own container, never the page body.
