# UI System & Perceived-Performance Spec

**Date:** 2026-08-14
**Status:** Approved for planning

## Goal

Make LITRACK's UI one consistent, reusable shadcn/ui design system, add a dark
mode toggle, and make navigation feel instant — without weakening tenant
isolation.

## Requirements

### R1 — shadcn/ui everywhere
Every interactive control and surface renders through a `src/components/ui/*`
primitive. No raw `<button>`, `<table>`, `<input>`, or `<select>` in feature
code. Missing primitives get added to `src/components/ui/` following the
existing shadcn conventions (cva variants, `cn()` merge, `forwardRef`).

### R2 — one palette, one set of design elements
All color comes from the CSS custom properties in `src/app/globals.css`
(`--background`, `--card`, `--primary`, …) surfaced through the Tailwind theme.
Zero hardcoded `bg-white`, `bg-slate-*`, `text-gray-*`, `bg-gray-*`,
`border-gray-*`, or literal hex/hsl colors in `.tsx` files. Exceptions, which
are deliberate design decisions already in the codebase and stay:
- The violet ARAL accent (`tailwind.config.ts` `colors.violet`, `.violet-section`).
- Amber semantic chips for super-admin impersonation banners.
Both must still be legible in dark mode.

### R3 — reusable UI elements
Repeated markup becomes a named component. Specifically the card chrome string
`rounded-xl border border-border/80 bg-card ... shadow-card`, which currently
appears 24 times across `.tsx` files, collapses to one primitive.

### R4 — faster to fetch
Reduce client JavaScript shipped for UI: primitives stay server-renderable
(no `"use client"`) unless they need state or an event handler.

### R5 — incremental revalidation (ISR)
Data that is not per-request-sensitive is served from Next's Data Cache with a
TTL and tag-based invalidation, rather than re-querying Postgres on every
navigation.

> **Correction to the original request.** Route-level ISR (`export const
> revalidate = N`, Full Route Cache) is *forbidden* on the 51 `force-dynamic`
> role pages. Those pages call `requireUser()`, which reads cookies; a Full
> Route Cache entry is shared across all users, so caching rendered HTML would
> serve one school's data to another tenant. That is the cross-tenant leak
> `CLAUDE.md` names as the worst bug shippable in this repo.
>
> Therefore ISR is delivered in two tiers:
> - **Tier A (route ISR)** — only on routes with no per-user data:
>   `/login`, `/pending-approval`, `/account/created`, `/auth/reset`.
> - **Tier B (data ISR)** — `unstable_cache` via the existing `cachedQuery`
>   helper, with named TTL profiles and tag invalidation. Every cache key
>   includes the tenant discriminator (`schoolId` or `userId`) so a cache hit
>   can never cross tenants.

### R6 — prefetching and preloading
- Nav destinations warm in the background after first paint (exists today via
  `NavPrefetcher`; keep).
- **Hover/focus intent prefetch:** pointing at any control that navigates —
  link, button, or menu item — prefetches that destination's RSC payload
  before the click. Must also fire on keyboard focus (accessibility) and on
  `touchstart` (mobile has no hover).
- Intent prefetch must respect the existing concurrency guard rationale: it
  must not stampede the Prisma pool. Debounce, dedupe, and cap.
- Honor `navigator.connection.saveData` and `effectiveType` of `2g`/`slow-2g`
  by skipping intent prefetch.

### R7 — parent/child refresh boundaries
Where only part of a page changes, only that part re-renders. Layout chrome
(`RoleShell`, sidebar, breadcrumbs) must never be torn down by a child
mutation. Server data that changes at different rates lives in different
Suspense boundaries with different cache tags, so a mutation revalidates the
narrow tag rather than the whole page.

### R8 — fix excessive skeletons
41 `loading.tsx` files is too many; nested ones cause skeleton-over-skeleton
flashes on soft navigation. Rules:
- One substantial skeleton per role segment root (the first paint after a hard
  navigation).
- Nested routes below a segment root use the minimal `ContentRouteLoading`
  progress bar, or no `loading.tsx` at all when the parent's Client Router
  Cache entry is warm.
- A skeleton must structurally match what replaces it (same row count, same
  grid shape) or it is a flash, not a placeholder.

### R9 — dark mode
- Toggle button in the **upper right of the header**, on every shell
  (`RoleShell`, `AppShell` fallback, `OnboardingShell`).
- **Light mode is the default** — including for a first-time visitor whose OS
  is set to dark.
- Choice persists across reloads and is applied before first paint (no
  white-flash-then-dark).
- Three states are not required; a light/dark toggle is sufficient.

## Non-goals

- No redesign of information architecture, navigation structure, or page
  layouts. This is a systems pass, not a visual redesign.
- No changes to `prisma/**`, server actions' business logic, auth rules, or
  tenancy checks.
- No new runtime dependencies beyond shadcn-generated primitives and their
  Radix peers.

## Constraints

- Next.js 15.5.23 / React 19.2.8 / Tailwind 3.4 / TypeScript strict.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` must all
  pass. CI gates on exactly these.
- No `next-themes` dependency — a ~40-line provider covers the requirement and
  avoids adding a package to a repo that pins peers via `overrides`.
- Tenant isolation rules in `CLAUDE.md` are inviolable.
