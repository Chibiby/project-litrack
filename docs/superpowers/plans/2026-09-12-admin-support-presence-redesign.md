# Admin Support Presence Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Super Admin support page into the approved compact two-pane workspace and add trustworthy teacher online/last-online labels.

**Architecture:** Store a single nullable `User.lastOnlineAt` timestamp and update it through a throttled, impersonation-aware teacher heartbeat. Extend the existing admin chat query with that timestamp, derive presentation through a pure presence formatter, and retain the existing polling chat and ticket workflows inside a reference-mapped responsive layout.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma/PostgreSQL, Tailwind CSS, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-admin-support-presence-redesign.md`

## Global Constraints

- The screenshot is a layout reference only; do not copy its sample accounts, messages, dates, or counts.
- Presence is active-app presence: online for three minutes after eligible activity, one-minute heartbeat throttling, and no claim that a teacher is viewing a conversation.
- Only real authenticated teacher sessions write presence; bound Super-Admin impersonation sessions do not.
- Existing chat authorization, polling, ticket response, unlock-grant, decline, and revoke behavior remains intact.
- No external realtime service or new dependency.
- Super Admins do not receive a `New Ticket` action.
- Release version increments from `1.9.0` to `1.10.0`.
- Preserve unrelated working-tree files and push only verified commits to `main`.

---

### Task 1: Persist and record teacher presence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260912000002_add_teacher_presence/migration.sql`
- Create: `src/lib/actions/presence.ts`
- Create: `tests/unit/actions/presence.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `createSupabaseServerClient`, and `readBoundImpersonationSession`.
- Produces: `recordTeacherPresence(): Promise<{ ok: true } | { ok: false; error: string }>` and nullable `User.lastOnlineAt`.

- [ ] **Step 1: Write failing action tests**

Test that `recordTeacherPresence` updates only the session teacher with an atomic
`updateMany` predicate, skips a timestamp less than 60 seconds old, refuses a
non-teacher, and performs no write when `readBoundImpersonationSession` returns a
bound context. Mock server time so the expected `lastOnlineAt` and cutoff are
exact.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/unit/actions/presence.test.ts`

Expected: FAIL because `@/lib/actions/presence` and `lastOnlineAt` do not exist.

- [ ] **Step 3: Add the additive schema and migration**

Add to `User`:

```prisma
lastOnlineAt DateTime?
```

Create an idempotent additive migration:

```sql
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastOnlineAt" TIMESTAMP(3);
```

Do not add an index: the admin query reaches the timestamp through already
selected direct-thread members and never filters or sorts the estate by it.

- [ ] **Step 4: Implement the server action**

In `src/lib/actions/presence.ts`, export:

```ts
export type PresenceActionResult = { ok: true } | { ok: false; error: string };
export async function recordTeacherPresence(): Promise<PresenceActionResult>;
```

Use `requireUser("TEACHER", false)`, create the request Supabase client, return
`{ ok: true }` without a write when the session is bound impersonation, then run:

```ts
await prisma.user.updateMany({
  where: {
    id: user.id,
    role: "TEACHER",
    deletedAt: null,
    isActive: true,
    OR: [{ lastOnlineAt: null }, { lastOnlineAt: { lt: cutoff } }],
  },
  data: { lastOnlineAt: now },
});
```

Presence is best-effort: catch database failures and return a generic failure
without logging timestamp activity into `AuditLog`.

- [ ] **Step 5: Generate Prisma Client and pass the focused test**

Run: `npm run prisma:generate`

Run: `npm test -- tests/unit/actions/presence.test.ts`

Expected: PASS.

---

### Task 2: Mount a visible, activity-driven heartbeat

**Files:**
- Create: `src/components/presence/teacher-presence-heartbeat.tsx`
- Modify: `src/components/role-shell.tsx`
- Modify: `src/app/teacher/(app)/layout.tsx`
- Create: `tests/components/teacher-presence-heartbeat.test.tsx`
- Modify: `tests/unit/impersonation-notice-wiring.test.ts`

**Interfaces:**
- Consumes: `recordTeacherPresence()` from Task 1 and the teacher layout's existing `impersonating` boolean.
- Produces: `TeacherPresenceHeartbeat({ disabled?: boolean })` mounted once for the real teacher shell.

- [ ] **Step 1: Write failing heartbeat tests**

With fake timers and a mocked action, assert that the component records once on a
visible mount, does not record while hidden, records when visibility returns,
coalesces pointer/keyboard/touch/focus activity inside 60 seconds, records after
the throttle expires, and makes no calls when `disabled`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/components/teacher-presence-heartbeat.test.tsx tests/unit/impersonation-notice-wiring.test.ts`

Expected: FAIL because the component and layout wiring are absent.

- [ ] **Step 3: Implement the heartbeat component**

Create a client component with `HEARTBEAT_MS = 60_000`. Keep the last attempted
time in a ref. A stable `pulse()` checks visibility and throttle before calling
`void recordTeacherPresence()`. Register `pointerdown`, `keydown`, `touchstart`,
`focus`, and `visibilitychange`, use `usePathname()` to pulse after navigation,
and remove every listener on cleanup. Errors remain silent.

- [ ] **Step 4: Wire only the real teacher shell**

Add an optional `trackTeacherPresence?: boolean` prop to `RoleShell` and render
`<TeacherPresenceHeartbeat />` only when true. In the teacher layout pass
`trackTeacherPresence={!impersonating}`. Other role layouts remain unchanged.

- [ ] **Step 5: Pass focused tests**

Run: `npm test -- tests/components/teacher-presence-heartbeat.test.tsx tests/unit/impersonation-notice-wiring.test.ts`

Expected: PASS.

---

### Task 3: Expose and render truthful presence

**Files:**
- Create: `src/lib/presence/status.ts`
- Modify: `src/lib/chat/queries.ts`
- Create: `src/components/chat/presence-label.tsx`
- Modify: `src/components/chat/admin-chat-browser.tsx`
- Create: `tests/unit/presence-status.test.ts`
- Create: `tests/unit/chat-queries.test.ts`
- Modify: `tests/components/admin-chat-browser.test.tsx`

**Interfaces:**
- Consumes: `User.lastOnlineAt` from Task 1.
- Produces: `getPresenceStatus(lastOnlineAt: Date | null, now?: Date): PresenceStatus`, `PresenceLabel`, and `AdminChatSchool.directThreads[].lastOnlineAt`.

- [ ] **Step 1: Write failing presence and query tests**

Cover `Online` at exactly three minutes, `Last online 4m ago`, `50m ago`, `3h
ago`, `2d ago`, localized old dates, and `Last online unavailable`. Assert the
chat query selects `member.lastOnlineAt`, maps it only onto direct threads, and
preserves unread ordering. Extend the component fixture and assert direct headers
show real status while school headers show `School conversation`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/unit/presence-status.test.ts tests/unit/chat-queries.test.ts tests/components/admin-chat-browser.test.tsx`

Expected: FAIL because the formatter, query field, and status component are absent.

- [ ] **Step 3: Implement pure presence derivation**

Create a discriminated result:

```ts
export type PresenceStatus = {
  online: boolean;
  label: string;
};
```

Use an inclusive 180-second online boundary, floor completed minutes/hours/days,
switch to a localized month/day label at seven days, and return the unavailable
label for null or invalid dates.

- [ ] **Step 4: Extend the server query**

Select `lastOnlineAt` from each channel member and add the nullable value to each
direct-thread result. Do not calculate status server-side because the label must
age while the support page remains open.

- [ ] **Step 5: Add the live label and header behavior**

`PresenceLabel` recalculates every 30 seconds, renders an emerald dot only when
online, and uses muted styling otherwise. The selected direct thread carries its
timestamp into the header. Selected school rooms use the neutral school label.
Missing members never render `Online`.

- [ ] **Step 6: Pass focused tests**

Run: `npm test -- tests/unit/presence-status.test.ts tests/unit/chat-queries.test.ts tests/components/admin-chat-browser.test.tsx`

Expected: PASS.

---

### Task 4: Apply the strict support workspace layout and release metadata

**Files:**
- Modify: `src/app/admin/support/page.tsx`
- Modify: `src/components/admin/admin-support-hub.tsx`
- Modify: `src/components/chat/admin-chat-browser.tsx`
- Modify: `src/components/chat/chat-thread.tsx`
- Modify: `tests/components/admin-support-hub.test.tsx`
- Modify: `tests/components/admin-chat-browser.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/releases.ts`

**Interfaces:**
- Consumes: existing `AdminChatBrowser`, `ChatThread`, and `SupportInbox` behavior plus Task 3 presence props.
- Produces: the reference-mapped responsive `/admin/support` workspace and release `1.10.0`.

- [ ] **Step 1: Write failing layout regression tests**

Assert the compact `Chat`/`Support Tickets` tablist, no `New Ticket` action, no
support-tip block, conversation search/filter controls, selected-thread Back
control, message-search toggle, and ticket switching with preserved query-string
behavior.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- tests/components/admin-support-hub.test.tsx tests/components/admin-chat-browser.test.tsx tests/components/chat-thread-empty.test.tsx`

Expected: FAIL on the new structural assertions.

- [ ] **Step 3: Restyle the hub and browser**

Remove `PageTip`; wrap the tab buttons in a compact bordered white toolbar; use
accessible `role="tablist"`, `role="tab"`, `aria-selected`, and labelled panels.
Tune the existing chat grid to match the reference's density, separators,
selected-row state, header alignment, transcript spacing, and fixed composer.
Keep the existing mobile drill-in behavior and make the Back control explicit.

- [ ] **Step 4: Preserve chat and ticket behavior**

Do not alter channel access, message polling, mentions, ticket mutations, or
unlock-grant actions. Keep every control wired to its existing handler and avoid
decorative dead buttons; remove or disable any compose/menu affordance that has
no supported action.

- [ ] **Step 5: Add release notes and version bump**

Prepend release `1.10.0` dated `2026-09-12` to `RELEASES` with an announced
Super-Admin note for the redesigned support workspace and a teacher-facing note
that active-app presence is shown as online or last online. Set `package.json`
and lockfile version to `1.10.0`.

- [ ] **Step 6: Pass focused tests**

Run: `npm test -- tests/components/admin-support-hub.test.tsx tests/components/admin-chat-browser.test.tsx tests/components/chat-thread-empty.test.tsx tests/unit/releases.test.ts`

Expected: PASS.

---

### Task 5: Verify, review, commit, and publish

**Files:**
- Verify all modified files from Tasks 1–4.

**Interfaces:**
- Consumes: completed implementation.
- Produces: evidence-backed release commit pushed to `origin/main`.

- [ ] **Step 1: Run the complete quality gates**

Run in order:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Perform visual verification**

Run the existing local app and inspect `/admin/support` at approximately 1440px
desktop and 390px mobile widths. Confirm the hierarchy matches the screenshot,
real data is used, direct teacher presence changes appearance correctly, school
rooms do not claim a single user is online, and both Chat/Tickets remain usable.

- [ ] **Step 3: Review the final diff**

Run `git diff --check`, inspect `git diff --stat`, confirm unrelated dirty and
untracked files are absent from the staged set, and perform an adversarial
correctness/security review of heartbeat authorization, impersonation handling,
timers, accessibility, and chat/ticket regression risk.

- [ ] **Step 4: Commit the implementation**

Stage only the implementation, tests, migration, release metadata, and plan.
Commit with:

```text
feat(admin): redesign support with teacher presence
```

- [ ] **Step 5: Push the verified commit to main**

Push the current verified commit explicitly with:

```powershell
git push origin HEAD:main
```

Confirm the remote main ref resolves to the new commit.
