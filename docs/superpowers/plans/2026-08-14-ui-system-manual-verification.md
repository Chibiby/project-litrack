# Manual Verification Checklist — UI System & Performance branch

**Branch:** `feat/ui-system-and-performance` (`75ad933..66ffd7a`, 17 commits)
**Plan:** `2026-08-14-ui-system-and-performance.md` · **Spec:** `../specs/2026-08-14-ui-system-and-performance.md`

Automated gates all pass — `prisma generate`, `typecheck`, `lint`, `test` (236/236), `build`.
Nothing below is covered by those gates. Two classes of defect on this branch are
**invisible to every test in the repo**, so they can only be caught by eye:

- A Tailwind class that does not exist in the config generates nothing, silently.
  (One such bug — `violet-300` against a custom partial scale — shipped and was
  caught only by a reviewer reading `tailwind.config.ts`.)
- A missing or mismatched `loading.tsx` fallback.

Start the app with `npm run dev`, sign in with an account from `npm run db:seed`.

---

## Priority 1 — dark mode legibility

The theme toggle is at the **upper right of the header**. Light is the default even
on a dark-preferring OS; that is deliberate (shared school desktops).

- [ ] **Every role dashboard** (`/admin`, `/school-head`, `/teacher`) in dark mode.
      Look for light-coloured blocks that did not get dark treatment, and for
      dark-on-dark text.
- [ ] **Native `<select>` dropdowns in dark mode** — open one on the learner form,
      the transfer form, and an ARAL reading-level grid. The *popup* is drawn by the
      OS, not by CSS. `color-scheme` was added to fix this; confirm it worked.
      Also check checkboxes, date inputs, and scrollbars.
- [ ] **Amber/violet accent blocks** on `create-school-form`, `schools-table`,
      `learner-form`, `teacher-profile-form`, `user-account-menu`. These are legible
      (light block, dark text) but may read as glaring against a dark page. Judge
      whether they need dark variants too — they were left alone deliberately
      because they are legible, unlike the six that were fixed.
- [ ] **Post-login splash in dark mode.** `post-login-splash.tsx` and
      `post-login-loading-bridge.tsx` hardcode cream `#FDFBF5` via inline `style`.
      Pre-existing, untouched by this branch — a dark-mode user gets a full-screen
      cream flash on every login. Confirm whether that bothers you.
- [ ] **Hard reload as a stored-dark user**, on all three shells. There must be **no
      white flash** before the dark paint, and no animated icon cross-fade on load.
- [ ] **Sticky header in both themes** — `bg-surface-header/90` + `backdrop-blur-md`
      in the `AppShell` fallback. Confirm it is neither fully opaque nor transparent.

## Priority 2 — loading states

`loading.tsx` went 41 → 30. The safety argument is that hover-intent prefetch keeps
destinations warm. That argument does **not** apply to routes reached cold.

- [ ] **`/admin/login` by direct URL, hard reload.** Must NOT flash the admin
      dashboard skeleton. Compare with `/login`, which should stay blank.
- [ ] **`/account/set-password`** (reached by forced redirect when
      `mustChangePassword` is set) — must NOT flash a teacher metrics grid.
- [ ] **`/teacher/settings`, `/school-head/settings`, `/admin/settings`** by hard
      reload. These now inherit their role dashboard skeleton. Warm on soft nav from
      the account menu; judge whether the cold case is tolerable.
- [ ] **Second pass through each role's sidebar** — destinations should swap with no
      skeleton at all once warmed.

## Priority 3 — prefetch behaviour

- [ ] DevTools → Network, filter `_rsc`. **Hover a sidebar item without clicking** —
      one request fires after ~80ms. Hover again — no second request.
- [ ] Repeat with the sidebar **collapsed** (tooltip mode). Static analysis says the
      `TooltipTrigger asChild` wrapper does not interfere, but confirm.
- [ ] Sweep the sidebar quickly and **count concurrent in-flight RSC requests**.
      Worst case should be ~3 against a PgBouncer `connection_limit` floored at 3.
      If you see `P2024` pool timeouts or the error page, lower
      `MAX_INTENT_PREFETCHES` in `src/lib/nav/prefetch-intent.ts`.

## Priority 4 — converted markup

- [ ] **`/admin/audit`, `/admin/school-years`, `/school-head/audit`** — tables were
      converted to shadcn primitives wrapped in `Surface`. Confirm columns, empty
      states, and horizontal scroll at narrow viewports. Note: `Surface` now nests
      inside `CardContent` on these three, so you may see doubled border/shadow.
- [ ] **Learner search dropdown** — option rows became `Button variant="ghost"`;
      confirm hover state matches the old `hover:bg-muted`, in both themes.
- [ ] **Password reveal toggle** — confirm the focus ring still shows on keyboard
      focus after moving to `Button`'s built-in focus styles.
- [ ] **Onboarding header** — sign-out and theme toggle flush right with correct
      spacing (`justify-between` was replaced by a `flex-1` spacer).

---

## Known gaps, deliberately deferred

| Gap | Why deferred |
|---|---|
| ~23 raw `<select>` and ~14 raw `<input>` remain | Spec R1 names four element types; only `<table>`/`<button>` were converted. Converting form controls across learner/transfer/ARAL forms is substantial work with real regression risk, and no browser verification was available during the build-out. The guard test's docstring now states its own limits. |
| Route-level ISR delivers nothing | Three candidate public routes read the session; `/login` reads `searchParams`, which forces dynamic rendering regardless of `revalidate`. The inert export was removed. Making `/login` truly static is viable — move the `?error` read into the client `LoginForm` behind Suspense — but it would bake the school dropdown at build time, up to an hour stale. **That trade-off is yours to make.** |
| `Surface` and `Card` are byte-identical at the root | Spec R3 asked the chrome to collapse to one primitive; it collapsed to two. Six literal copies of the chrome string also remain in `error.tsx`, `not-found.tsx`, `chart-card.tsx`, `data-table.tsx`, `schools-table.tsx`. |
| `PREFETCH_FULL` duplicated | Same const + type derivation in `nav-prefetcher.tsx` and `prefetch-link.tsx`. |
| `route-isr-safety` guard doesn't walk `route.ts` | A Route Handler `revalidate` would slip past it. |
| `ThemeScript` uses inline `dangerouslySetInnerHTML` | Another blocker for the CSP work tracked in `next.config.mjs`. Worth noting in `docs/backlog.md`. |
