# Release Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a version number it knows about, a page listing what changed, and a one-time announcement of a release to each user who has not seen it.

**Architecture:** A committed array in `src/lib/releases.ts` is the source of truth; `package.json` mirrors it and a test keeps the two honest. Announcement is lazy per-user: nothing is written until a user arrives, and then only their own row. `User.lastSeenReleaseVersion` stamps what they acknowledged, so the modal cannot re-interrupt them and a rollback cannot either.

**Tech Stack:** Next.js 15.5 App Router · React 19 · TypeScript strict · Prisma 5 → Supabase Postgres · Zod · Tailwind + shadcn/ui · Vitest

**Spec:** `docs/superpowers/specs/2026-09-10-version-1-0-0-and-ten-concerns-design.md` (§1 and §2)

## Global Constraints

- **Migrations are authored only.** A human applies them (`docs/migrate-checklist.md`). Never run `prisma migrate deploy`, `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`. Offline only: `prisma validate`, `prisma format`, `prisma generate`.
- Migration files live in `prisma/migrations/YYYYMMDDNNNNNN_short_description/migration.sql`. The latest existing is `20260910000003_chat_channels`, so this plan's migrations start at `20260910000004`.
- Additive-first: nullable column → backfill → tighten. Never a bare `NOT NULL` add.
- Adding a Prisma enum value means adding its label to `src/lib/constants/enum-labels.ts` in the same change. House rule.
- Server actions return `ActionResult` (`{ ok: true; data?: T } | { ok: false; error: string }`) and never throw at the boundary. Order: auth guard → Zod `safeParse` → ownership check scoped to `user.schoolId` → mutate → `writeAudit` → revalidate.
- Every school-scoped query carries `schoolId`. `Notification.schoolId` is non-nullable.
- Soft delete: filter `deletedAt: null` on reads unless archived rows are wanted.
- No server action may run during render.
- `writeAudit` metadata carries resource ids and counts only — never passwords, tokens, invite secrets, or learner PII.
- Gates before any commit is considered done: `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
- Known-flaky test, not a regression: `tests/unit/actions/term-grades-export.test.ts` can time out at 5s in the full suite and passes alone. Confirm with `npx vitest run tests/unit/actions/term-grades-export.test.ts` before blaming your change.
- On Windows, `prisma generate` can fail with `EPERM` renaming `query_engine-windows.dll.node` while `next dev` holds it. Stop the dev server, or run `npx next build` directly against the existing client.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/releases.ts` | The release history and `APP_VERSION`. Pure data + derivation, no I/O, no `server-only` — imported by both server and client. |
| `src/lib/actions/release.ts` | The two server actions: `announceRelease`, `acknowledgeRelease`. |
| `src/components/release-notes-modal.tsx` | Client component: renders the newest release, calls the two actions. |
| `src/app/releases/page.tsx` | The full history, readable by any signed-in user. |
| `prisma/migrations/20260910000004_release_channel/migration.sql` | `User.lastSeenReleaseVersion` + `NotificationType.RELEASE_PUBLISHED`. |
| `tests/unit/releases.test.ts` | The five invariants of the release array. |
| `tests/unit/actions/release.test.ts` | Announcement gating and acknowledgement idempotency. |

**Modified:**

| File | Change |
|---|---|
| `package.json:3` | `0.1.0` → `1.0.0`. |
| `prisma/schema.prisma:387` | Add `RELEASE_PUBLISHED` to `NotificationType`. |
| `prisma/schema.prisma:569` area | Add `lastSeenReleaseVersion String?` to `User`. |
| `src/lib/constants/enum-labels.ts` | Label for `RELEASE_PUBLISHED`. |
| `src/components/app-sidebar.tsx` | Version string in the footer, linking to `/releases`. |

`releases.ts` is deliberately free of `import "server-only"`: the modal is a client component and needs the same array the server reads. It holds no secrets and no I/O, so this is safe — and it is why `APP_VERSION` is derived there rather than read from `process.env`.

---

### Task 1: The release array and its invariants

**Files:**
- Create: `src/lib/releases.ts`
- Modify: `package.json:3`
- Test: `tests/unit/releases.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Release = { version: string; date: string; title: string; announce: boolean; fixes: string[] }`
  - `const RELEASES: readonly Release[]` — newest first
  - `const APP_VERSION: string` — `RELEASES[0].version`
  - `function compareVersions(a: string, b: string): number` — negative when `a` sorts before `b`
  - `function latestRelease(): Release` — `RELEASES[0]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/releases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_VERSION,
  RELEASES,
  compareVersions,
  latestRelease,
} from "@/lib/releases";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. This is the bug the test exists to catch.
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
  });
});

describe("RELEASES", () => {
  it("is not empty", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it("is strictly descending by version, newest first", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(
        compareVersions(RELEASES[i - 1].version, RELEASES[i].version)
      ).toBeGreaterThan(0);
    }
  });

  it("has no duplicate versions", () => {
    const seen = new Set(RELEASES.map((r) => r.version));
    expect(seen.size).toBe(RELEASES.length);
  });

  it("carries a YYYY-MM-DD date on every entry", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Rejects 2026-13-01 and 2026-02-30, which the regex alone accepts.
      expect(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(r.date);
    }
  });

  it("carries a semver version with no leading v on every entry", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("lists at least one fix per entry, none of them blank", () => {
    for (const r of RELEASES) {
      expect(r.fixes.length).toBeGreaterThan(0);
      for (const fix of r.fixes) expect(fix.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries a non-blank title on every entry", () => {
    for (const r of RELEASES) {
      expect(r.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("APP_VERSION", () => {
  it("is the newest release", () => {
    expect(APP_VERSION).toBe(RELEASES[0].version);
    expect(latestRelease()).toBe(RELEASES[0]);
  });

  it("matches package.json, so the two can never drift", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/releases.test.ts`
Expected: FAIL — cannot resolve `@/lib/releases`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/releases.ts`:

```ts
/**
 * What version this app is, and what changed in each one.
 *
 * This file is the source of truth. `package.json` mirrors it and a test in
 * `tests/unit/releases.test.ts` fails if the two drift, because the version a
 * user is shown and the version npm reports must be the same string.
 *
 * Deliberately NOT `server-only`: the "what's new" modal is a client component
 * and reads the same array the server does. There is nothing here but committed
 * copy — no I/O, no secrets — so both sides sharing it is safe and keeps one
 * list rather than two that can disagree.
 *
 * Bumping a version means adding an entry here in the same commit as the work.
 * No migration, no admin screen, no separate CHANGELOG to fall out of date.
 *
 * Semver, as this project uses it:
 *   patch  a bundle of fixes
 *   minor  a feature
 *   major  a revision that changes how the app is used
 */
export type Release = {
  /** Semver, no leading "v". */
  version: string;
  /** `YYYY-MM-DD`. Local calendar date of the release, not a timestamp. */
  date: string;
  /** One line, sentence case. */
  title: string;
  /**
   * Whether to interrupt the user with the modal.
   *
   * Independent of the semver level on purpose. "Big revision" is an editorial
   * judgement, not an arithmetic one: a patch that changes what a teacher sees
   * on Monday may deserve the modal, and a minor that only touches the admin
   * console may not. Decided per release.
   */
  announce: boolean;
  /** What changed, in the user's language, not the codebase's. */
  fixes: string[];
};

/**
 * Newest first. The order is load-bearing — `APP_VERSION` is the head, and a
 * test enforces strict descending order so it cannot quietly stop being true.
 */
export const RELEASES: readonly Release[] = [
  {
    version: "1.0.0",
    date: "2026-09-10",
    title: "LITRACK 1.0",
    announce: false,
    fixes: [
      "First numbered release. Everything the app does today, gathered under one version number.",
      "You can see which version you are running in the sidebar, and what changed on the Releases page.",
    ],
  },
];

/** The version the running app reports. Mirrored in `package.json`. */
export const APP_VERSION = RELEASES[0].version;

/**
 * Compare two semver strings numerically.
 *
 * Written out rather than pulled from a library because string comparison gets
 * this wrong in a way that looks right: `"1.0.10" < "1.0.9"` as strings, so a
 * tenth patch would sort behind the ninth and the modal would stop firing.
 *
 * Returns negative when `a` is older, positive when `a` is newer, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The release the app is currently running. */
export function latestRelease(): Release {
  return RELEASES[0];
}
```

Then edit `package.json` line 3: `"version": "0.1.0"` → `"version": "1.0.0"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/releases.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck` then `npm run lint`
Expected: both clean. Lint has 3 pre-existing warnings (`learner-search-select.tsx`, two `_contactEmail`) — those are not yours.

- [ ] **Step 6: Commit**

```bash
git add src/lib/releases.ts tests/unit/releases.test.ts package.json
git commit -m "feat: the app knows which version it is

A committed array is the source of truth and package.json mirrors it,
with a test that fails if the two drift. 1.0.0 is what exists today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

---

### Task 2: Migration — the stamp column and the notification type

**Files:**
- Create: `prisma/migrations/20260910000004_release_channel/migration.sql`
- Modify: `prisma/schema.prisma` (`NotificationType` enum at line 387; `User` model near line 569)
- Modify: `src/lib/constants/enum-labels.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `User.lastSeenReleaseVersion: string | null` on the Prisma client; `NotificationType.RELEASE_PUBLISHED`.

**This task authors SQL. It does not run it.** No `migrate dev`, no `db push`. Validation is `prisma validate` and `prisma format` only.

- [ ] **Step 1: Add the enum value to the schema**

In `prisma/schema.prisma`, inside `enum NotificationType` (line 387), after the `CHAT_DIRECT_MESSAGE` entry:

```prisma
  /// A new release was published and the recipient had not seen it yet. Written
  /// lazily by `announceRelease` when that user next arrives — never fanned out
  /// to every row at release time.
  RELEASE_PUBLISHED
```

- [ ] **Step 2: Add the column to the User model**

In `prisma/schema.prisma`, in `model User`, directly below the `advisorySectionId` line (569):

```prisma
  /// The release version this user acknowledged, or null for a user who has
  /// acknowledged none. A version string rather than a boolean or timestamp on
  /// purpose: it survives a rollback (someone who saw 1.1.0 and is then served
  /// 1.0.9 is not re-interrupted) and it records WHICH release they saw, which a
  /// boolean cannot. Written on acknowledgement, never on display.
  lastSeenReleaseVersion    String?
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260910000004_release_channel/migration.sql`:

```sql
-- Release channel: a per-user stamp for what they have seen, and a notification
-- type for the bell row.
--
-- Both are additive and nullable. Every existing row has acknowledged nothing,
-- and NULL is the honest representation of that — not a backfill to the current
-- version, which would silently mark the whole user base as having read release
-- notes they have never been shown.

-- Postgres allows adding an enum value inside a transaction, but the new value
-- cannot be USED in the same transaction. Nothing here writes it, so this is
-- safe; the first write happens later, from the application.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RELEASE_PUBLISHED';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenReleaseVersion" TEXT;
```

- [ ] **Step 4: Add the enum label**

In `src/lib/constants/enum-labels.ts`, find the `NOTIFICATION_TYPE_LABELS` map (or whichever map holds `CHAT_DIRECT_MESSAGE`) and add, preserving the file's existing formatting:

```ts
  RELEASE_PUBLISHED: "New release",
```

If the notification labels map does not exist in that file, do not invent one — check how `CHAT_DIRECT_MESSAGE` is labelled and follow that, then note in the commit message where the label went.

- [ ] **Step 5: Validate offline**

Run: `npx prisma format && npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`.

Run: `npx prisma generate`
Expected: generated client. If it fails with `EPERM` on `query_engine-windows.dll.node`, stop `next dev` and retry — that is a Windows file lock, not a schema error.

- [ ] **Step 6: Confirm the client picked up the column**

Run: `npm run typecheck`
Expected: clean. This is what proves `lastSeenReleaseVersion` and `RELEASE_PUBLISHED` exist on the generated client.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260910000004_release_channel/migration.sql src/lib/constants/enum-labels.ts
git commit -m "feat: a column for what release a user has seen

Nullable, and not backfilled: every existing row has acknowledged
nothing, and NULL says so honestly. Authored only — a human applies it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

- [ ] **Step 8: Record it for the human who applies it**

Append to `docs/migrate-checklist.md` under its existing pending-migrations section, matching the file's format:

```markdown
### 20260910000004_release_channel

Adds `User.lastSeenReleaseVersion` (nullable TEXT) and the
`NotificationType.RELEASE_PUBLISHED` enum value. Both additive; no backfill, no
data movement, no downtime. Safe to apply before the app code that reads them.
```

Commit that with the same message style.

---

### Task 3: The two server actions

**Files:**
- Create: `src/lib/actions/release.ts`
- Test: `tests/unit/actions/release.test.ts`

**Interfaces:**
- Consumes: `APP_VERSION`, `latestRelease` from `@/lib/releases` (Task 1); `User.lastSeenReleaseVersion` and `NotificationType.RELEASE_PUBLISHED` from Task 2.
- Produces:
  - `async function announceRelease(): Promise<ActionResult>`
  - `async function acknowledgeRelease(): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/actions/release.test.ts`. Follow the mocking shape used by `tests/unit/actions/learner-profile.test.ts` — mock only Prisma and the session, and let the real `releases.ts` run:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUser = vi.fn();
const mockNotificationFindFirst = vi.fn();
const mockNotificationCreate = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => mockUser(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findFirst: (...a: unknown[]) => mockNotificationFindFirst(...a),
      create: (...a: unknown[]) => mockNotificationCreate(...a),
    },
    user: {
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));

vi.mock("@/lib/releases", () => ({
  APP_VERSION: "1.1.0",
  latestRelease: () => ({
    version: "1.1.0",
    date: "2026-09-11",
    title: "A test release",
    announce: true,
    fixes: ["Something was fixed"],
  }),
}));

import { acknowledgeRelease, announceRelease } from "@/lib/actions/release";

const TEACHER = { id: "u1", schoolId: "s1", role: "TEACHER", lastSeenReleaseVersion: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(TEACHER);
  mockNotificationFindFirst.mockResolvedValue(null);
  mockNotificationCreate.mockResolvedValue({ id: "n1" });
  mockUserUpdate.mockResolvedValue({});
});

describe("announceRelease", () => {
  it("writes one bell row for a user who has not seen this release", async () => {
    const res = await announceRelease();
    expect(res.ok).toBe(true);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    const arg = mockNotificationCreate.mock.calls[0][0] as {
      data: { recipientId: string; schoolId: string; type: string; learnerIds: string[] };
    };
    expect(arg.data.recipientId).toBe("u1");
    expect(arg.data.schoolId).toBe("s1");
    expect(arg.data.type).toBe("RELEASE_PUBLISHED");
    // No learners are involved in a release. The column is non-nullable.
    expect(arg.data.learnerIds).toEqual([]);
  });

  it("writes nothing when the user already acknowledged this version", async () => {
    mockUser.mockResolvedValue({ ...TEACHER, lastSeenReleaseVersion: "1.1.0" });
    const res = await announceRelease();
    expect(res.ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("is idempotent — a second mount does not produce a second row", async () => {
    mockNotificationFindFirst.mockResolvedValue({ id: "existing" });
    const res = await announceRelease();
    expect(res.ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("writes nothing for a user with no school", async () => {
    mockUser.mockResolvedValue({ ...TEACHER, schoolId: null });
    const res = await announceRelease();
    expect(res.ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("degrades rather than failing when the write throws", async () => {
    mockNotificationCreate.mockRejectedValue(new Error("pool timeout"));
    const res = await announceRelease();
    // A courtesy bell row is not worth surfacing an error over.
    expect(res.ok).toBe(true);
  });
});

describe("acknowledgeRelease", () => {
  it("stamps the current version on the caller", async () => {
    const res = await acknowledgeRelease();
    expect(res.ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastSeenReleaseVersion: "1.1.0" },
    });
  });

  it("is idempotent — stamping twice is the same as once", async () => {
    await acknowledgeRelease();
    await acknowledgeRelease();
    expect(mockUserUpdate).toHaveBeenCalledTimes(2);
    // Both writes set the same value, so the end state is identical.
    for (const call of mockUserUpdate.mock.calls) {
      expect((call[0] as { data: { lastSeenReleaseVersion: string } }).data
        .lastSeenReleaseVersion).toBe("1.1.0");
    }
  });

  it("reports failure when the stamp cannot be written", async () => {
    mockUserUpdate.mockRejectedValue(new Error("pool timeout"));
    const res = await acknowledgeRelease();
    // Unlike the bell row, this one matters: without the stamp the user is
    // interrupted again on the next page, so they must be told it did not stick.
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/release.test.ts`
Expected: FAIL — cannot resolve `@/lib/actions/release`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/actions/release.ts`:

```ts
"use server";

import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { APP_VERSION, latestRelease } from "@/lib/releases";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Record that this user has a release waiting, once.
 *
 * Lazy per-user, never a fan-out. Publishing a release writes nothing: a
 * deployment does not touch the database at all. The row appears the first time
 * that particular user arrives, and only for them, so announcing to a division
 * of ten thousand teachers costs ten thousand rows spread over the days they
 * each next sign in — not one write storm at deploy time, most of it for people
 * who will not log in this month.
 *
 * Idempotent by lookup rather than by unique constraint: `Notification` has no
 * unique on (recipient, type, version) and adding one would need a column to put
 * the version in. A double-mount racing itself could still slip two rows past
 * the check; that is a cosmetic duplicate in a bell menu, weighed against a
 * migration, and the check catches every non-racing case including a re-render.
 *
 * Never surfaces a failure. The bell row is a courtesy — the modal has already
 * been shown by the time this resolves, and telling the user their notification
 * failed to save would be noise about something they did not ask for.
 */
export async function announceRelease(): Promise<ActionResult> {
  const user = await requireUser();

  // Nothing to announce: they have already acknowledged this exact version.
  if (user.lastSeenReleaseVersion === APP_VERSION) return { ok: true };

  // A release with `announce: false` is visible at /releases and in the sidebar
  // and interrupts nobody. That is the whole purpose of the flag.
  if (!latestRelease().announce) return { ok: true };

  // `Notification.schoolId` is non-nullable and every read is school-scoped. A
  // Super Admin holds no school, so there is no row to write for them — they see
  // the modal, which needs no persistence.
  if (!user.schoolId) return { ok: true };

  try {
    const existing = await prisma.notification.findFirst({
      where: {
        recipientId: user.id,
        schoolId: user.schoolId,
        type: "RELEASE_PUBLISHED",
      },
      select: { id: true },
    });
    if (existing) return { ok: true };

    await prisma.notification.create({
      data: {
        schoolId: user.schoolId,
        recipientId: user.id,
        // No actor: a release is published by the project, not by a person in
        // this school. The column is nullable for exactly this kind of row.
        actorId: null,
        type: "RELEASE_PUBLISHED",
        // Non-nullable array, and a release is about no learners.
        learnerIds: [],
      },
    });
  } catch (err) {
    console.error("[release] announce failed:", err);
  }

  return { ok: true };
}

/**
 * Stamp the version this user just read.
 *
 * Called from the modal's dismiss button — on acknowledgement, never on display.
 * A user who opens the app, sees the modal and closes the tab mid-sentence has
 * not read it, and will be shown it again. Writing the stamp when the modal
 * mounts would silently swallow the announcement for exactly the person who was
 * interrupted at the wrong moment.
 *
 * Unlike `announceRelease`, a failure here IS surfaced: without the stamp the
 * modal reappears on the next navigation, and a user who clicked "Got it" and
 * gets interrupted again should be told why rather than left thinking the app is
 * broken.
 */
export async function acknowledgeRelease(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenReleaseVersion: APP_VERSION },
    });
  } catch (err) {
    console.error("[release] acknowledge failed:", err);
    return { ok: false, error: "Could not save that you have seen this. Try again." };
  }

  return { ok: true };
}
```

No `writeAudit` call in either action: an audit row records a decision someone
made about someone else's data, and "a user read the release notes" is neither.
The bell row and the stamp already record it where it is useful.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/actions/release.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Check `requireUser` returns the column**

`getCurrentUser` must select `lastSeenReleaseVersion`, or `user.lastSeenReleaseVersion` is `undefined` at runtime and the guard in `announceRelease` never fires.

Run: `grep -n "select" src/lib/auth/session.ts | head -20`

If the user query uses an explicit `select`, add `lastSeenReleaseVersion: true` to it. If it selects the whole row (no `select`), nothing to do. Do not guess — read the file.

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck` then `npm run test`
Expected: typecheck clean; tests pass except the known `term-grades-export` flake.

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions/release.ts tests/unit/actions/release.test.ts
git commit -m "feat: a release announces itself to each user once

Lazy per-user: a deployment writes nothing, and the bell row appears
when that user next arrives. The stamp is written on acknowledgement,
not on display, so closing the tab mid-read does not swallow it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

---

### Task 4: The "what's new" modal

**Files:**
- Create: `src/components/release-notes-modal.tsx`
- Test: `tests/components/release-notes-modal.test.tsx`

**Interfaces:**
- Consumes: `latestRelease` from `@/lib/releases` (Task 1); `announceRelease`, `acknowledgeRelease` from `@/lib/actions/release` (Task 3).
- Produces: `<ReleaseNotesModal lastSeenVersion={string | null} />` — a client component.

Before writing the component, read `src/components/ui/dialog.tsx` for the project's dialog primitives and one existing consumer (`src/components/school-head/school-year-forms.tsx` uses them) so the markup matches the house style rather than introducing a second dialog idiom.

- [ ] **Step 1: Write the failing test**

Create `tests/components/release-notes-modal.test.tsx`. Match the setup in `tests/components/notifications-menu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockAnnounce = vi.fn();
const mockAcknowledge = vi.fn();

vi.mock("@/lib/actions/release", () => ({
  announceRelease: () => mockAnnounce(),
  acknowledgeRelease: () => mockAcknowledge(),
}));

vi.mock("@/lib/releases", () => ({
  APP_VERSION: "1.1.0",
  latestRelease: () => ({
    version: "1.1.0",
    date: "2026-09-11",
    title: "A test release",
    announce: true,
    fixes: ["The first fix", "The second fix"],
  }),
}));

import { ReleaseNotesModal } from "@/components/release-notes-modal";

beforeEach(() => {
  vi.clearAllMocks();
  mockAnnounce.mockResolvedValue({ ok: true });
  mockAcknowledge.mockResolvedValue({ ok: true });
});

describe("ReleaseNotesModal", () => {
  it("shows the title and every fix to a user who has seen nothing", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    expect(await screen.findByText("A test release")).toBeInTheDocument();
    expect(screen.getByText("The first fix")).toBeInTheDocument();
    expect(screen.getByText("The second fix")).toBeInTheDocument();
  });

  it("records the bell row once on mount, not on every render", async () => {
    const { rerender } = render(<ReleaseNotesModal lastSeenVersion={null} />);
    await waitFor(() => expect(mockAnnounce).toHaveBeenCalledTimes(1));
    rerender(<ReleaseNotesModal lastSeenVersion={null} />);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a user who already acknowledged this version", () => {
    render(<ReleaseNotesModal lastSeenVersion="1.1.0" />);
    expect(screen.queryByText("A test release")).not.toBeInTheDocument();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("still shows for a user who acknowledged an older version", async () => {
    render(<ReleaseNotesModal lastSeenVersion="1.0.0" />);
    expect(await screen.findByText("A test release")).toBeInTheDocument();
  });

  it("acknowledges and closes when Got it is pressed", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    await screen.findByText("A test release");
    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("A test release")).not.toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/release-notes-modal.test.tsx`
Expected: FAIL — cannot resolve `@/components/release-notes-modal`.

- [ ] **Step 3: Write the implementation**

Create `src/components/release-notes-modal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeRelease, announceRelease } from "@/lib/actions/release";
import { latestRelease } from "@/lib/releases";

/**
 * "Here is what changed", shown once per release per user.
 *
 * Takes `lastSeenVersion` as a prop rather than reading it itself: the shell has
 * already loaded the user row, and a second round trip on every navigation to
 * re-answer a question the server just answered would be a waste on the common
 * path — where the answer is "nothing to show".
 *
 * A string equality test, not a `compareVersions` call. Anything other than the
 * exact current version means "has not acknowledged THIS release", which is
 * true both for someone older and for someone who was served a newer build that
 * was then rolled back. Ordering is not the question being asked.
 */
export function ReleaseNotesModal({
  lastSeenVersion,
}: {
  lastSeenVersion: string | null;
}) {
  const release = latestRelease();
  const unseen = release.announce && lastSeenVersion !== release.version;

  const [open, setOpen] = useState(unseen);
  const [saving, setSaving] = useState(false);
  // A ref, not state: an effect that sets state it also depends on re-announces
  // on every commit. React 18+ mounts effects twice in development, and this
  // guard is what keeps that from writing two bell rows.
  const announced = useRef(false);

  useEffect(() => {
    if (!unseen || announced.current) return;
    announced.current = true;
    // Deliberately not awaited: the modal is already on screen, and the bell row
    // is a durable record for later, not a precondition for reading this.
    void announceRelease();
  }, [unseen]);

  if (!unseen) return null;

  const dismiss = async () => {
    setSaving(true);
    const res = await acknowledgeRelease();
    setSaving(false);
    // Closing on failure would show this again on the next navigation with no
    // explanation. Staying open with the button re-enabled lets them retry.
    if (res.ok) setOpen(false);
  };

  return (
    <Dialog
      open={open}
      // No `onOpenChange` that closes: dismissal must go through `dismiss` so the
      // stamp is written. An Escape key that closed without stamping would show
      // the modal again on the next page and look like a bug.
      onOpenChange={() => undefined}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{release.title}</DialogTitle>
          <DialogDescription>
            Version {release.version} · {release.date}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          {release.fixes.map((fix) => (
            <li key={fix} className="flex gap-2">
              <span aria-hidden="true" className="text-primary">
                &bull;
              </span>
              <span>{fix}</span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={dismiss} disabled={saving} className="min-h-[44px]">
            {saving ? "Saving…" : "Got it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The `min-h-[44px]` is not decoration — it is the project's touch-target floor from commit `3b62b17` (WCAG 2.5.5). Do not drop it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/release-notes-modal.test.tsx`
Expected: PASS, 5 tests.

If `DialogFooter` or `DialogDescription` is not exported by `src/components/ui/dialog.tsx`, use what that file actually exports — the test asserts on text and the button, not on the primitives, so it stays green either way.

- [ ] **Step 5: Commit**

```bash
git add src/components/release-notes-modal.tsx tests/components/release-notes-modal.test.tsx
git commit -m "feat: the modal that says what changed

Escape does not dismiss it: closing without stamping would show it
again on the next page and read as a bug rather than a choice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

---

### Task 5: The releases page and the sidebar footer

**Files:**
- Create: `src/app/releases/page.tsx`
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `APP_VERSION`, `RELEASES` from `@/lib/releases` (Task 1).
- Produces: the route `/releases`.

- [ ] **Step 1: Read how the sidebar footer is built**

Run: `grep -n "logoutAction\|SignOutButton\|renderSidebarContent" src/components/app-sidebar.tsx`

The footer is the block holding the sign-out form. The version line goes above it, inside the same container, and must respect the `isCollapsed` branch that block already uses — a collapsed sidebar is icon-only, so a version string must not force it wider.

- [ ] **Step 2: Write the releases page**

Create `src/app/releases/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { RELEASES } from "@/lib/releases";

export const metadata: Metadata = { title: "Releases · LITRACK" };

/**
 * The full release history.
 *
 * Readable by anyone signed in, with no role branching: what changed in the app
 * is not tenant data, and three copies of this page — one per role shell — would
 * be three places for the same list to drift. `requireUser()` with no argument
 * is the whole authorization story.
 *
 * `force-dynamic` because `requireUser` reads cookies. The list itself is a
 * committed constant, so there is nothing here to cache.
 */
export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">What&apos;s new</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every version of LITRACK, newest first.
      </p>

      <ol className="mt-8 space-y-10">
        {RELEASES.map((release) => (
          <li key={release.version}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-medium">{release.title}</h2>
              <span className="text-xs text-muted-foreground">
                {release.version} · {release.date}
              </span>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {release.fixes.map((fix) => (
                <li key={fix} className="flex gap-2">
                  <span aria-hidden="true" className="text-primary">
                    &bull;
                  </span>
                  <span>{fix}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="mt-12 text-sm">
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Back to LITRACK
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Add the version line to the sidebar footer**

In `src/components/app-sidebar.tsx`, import at the top:

```tsx
import { APP_VERSION } from "@/lib/releases";
```

Then, immediately above the `<form action={logoutAction}>` element inside `renderSidebarContent`, add:

```tsx
<Link
  href="/releases"
  onClick={onNavigate}
  className={cn(
    "block rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
    isCollapsed ? "text-center" : "px-3"
  )}
  title={`LITRACK ${APP_VERSION} — what's new`}
>
  {isCollapsed ? APP_VERSION : `LITRACK ${APP_VERSION}`}
</Link>
```

`onNavigate` is the callback the mobile sheet passes to close itself — pass it here too or the sheet stays open over the page it just navigated to. Check the exact parameter name in `renderSidebarContent`'s signature; the file calls it `onNavigate` in the sign-out block above.

If `Link` is not already imported in that file, add `import Link from "next/link";`.

- [ ] **Step 4: Verify it renders and the route resolves**

Run: `npm run build`
Expected: build succeeds and `/releases` appears in the route list as `ƒ` (dynamic).

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck` then `npm run lint` then `npm run test`
Expected: typecheck and lint clean; tests pass except the known flake.

- [ ] **Step 6: Commit**

```bash
git add src/app/releases/page.tsx src/components/app-sidebar.tsx
git commit -m "feat: the version in the sidebar, and the history behind it

One route for all three roles: what changed in the app is not tenant
data, and three copies of this list would be three places to drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

---

### Task 6: Mount the modal in the three role shells

**Files:**
- Modify: `src/components/role-shell.tsx` (or `src/components/app-shell.tsx` — Step 1 decides which)

**Interfaces:**
- Consumes: `<ReleaseNotesModal>` from Task 4; the shell's already-loaded user row.
- Produces: nothing further.

This task is last on purpose: it is the only one that changes what every signed-in user sees on every page, so everything it depends on is already tested by the time it lands.

- [ ] **Step 1: Find the one shell all three roles pass through**

Run:
```bash
grep -n "export function\|export default\|requireUser\|getCurrentUser" src/components/role-shell.tsx src/components/app-shell.tsx
grep -rn "role-shell\|RoleShell" src/app --include=layout.tsx
```

Mount the modal in the single shell all three role layouts render. If there is no such shared shell, mount it in each of the three role layouts instead — but check first, because three mounts means three places to forget.

- [ ] **Step 2: Confirm the shell already has the user row**

The modal needs `lastSeenReleaseVersion`. If the shell already awaits `requireUser` or `getCurrentUser`, pass `user.lastSeenReleaseVersion` straight through. **Do not add a new query for it** — that would put a round trip on every navigation for every role to answer a question whose answer is almost always "nothing to show".

If the shell does not load the user, mount the modal one level up, where it does.

- [ ] **Step 3: Mount it**

Add the import:

```tsx
import { ReleaseNotesModal } from "@/components/release-notes-modal";
```

And render it as the last child of the shell's outermost element, after the main content:

```tsx
<ReleaseNotesModal lastSeenVersion={user.lastSeenReleaseVersion} />
```

Last, not first: a dialog renders in a portal so document order does not affect layout, but it does affect the tab order of what is behind it, and the modal should not sit between the nav and the page content in that order.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, then:

1. Sign in as a teacher. Because `1.0.0` ships with `announce: false`, you should see **no modal** — that is correct, and it is the flag doing its job.
2. To exercise the modal, temporarily set `announce: true` on the `1.0.0` entry in `src/lib/releases.ts`. Reload: the modal appears. Click "Got it": it closes.
3. Reload again: it does not come back.
4. Check the bell menu: a "New release" row is there.
5. **Revert the `announce: true` edit.** It is a local probe, not part of this work.

- [ ] **Step 5: Run the full gates**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all four clean, except the known `term-grades-export` flake.

- [ ] **Step 6: Commit**

```bash
git add src/components/role-shell.tsx
git commit -m "feat: the release modal reaches every role

Mounted where the shell already holds the user row, so the common path
— nothing to show — costs no extra query.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CHZYcJC6crLWdruubp8HuM"
```

---

## What this plan does NOT cover

The spec has twelve sections. This plan implements two of them (§1, §2), because the other ten are independent of the release channel and of each other, and each needs its own plan to produce working, testable software on its own.

Remaining, in the order they should be planned — dependencies first:

1. **§6 · Teachers page `deletedAt` filter** — one line in `src/lib/teachers/roster.ts:47`, plus a test. Smallest item in the spec and blocks nothing, but §4 and §5 both build on the cell it repairs, so it goes first.
2. **§4 · Multi-advisory, max 3** — the largest item and the only one changing a DB-level guarantee. `Section.adviserId @unique` becomes authoritative, `User.advisorySectionId` is dual-written for one wave. Roughly eighteen read sites move from one advisory to a list. Needs its own plan; do not fold it into another.
3. **§5 · The floating teacher** — depends on §4 (floating is derived as *zero live advisory sections*) and on §6 (the chip renders in that cell).
4. **§11 · Strict ARAL assignment** — add `aralLearnerScope` beside `teacherLearnerScope`, apply it at ARAL sites only. Independent of §4; can be planned in parallel.
5. **§3 · Global unlock switch** — `SystemSetting` key `submissions.locking`, one reader, one `canWriteWindow` helper replacing four direct grant calls. Self-contained.
6. **§7 · Grade level archive/restore** — `archiveGradeLevel` / `restoreGradeLevel`, refusing while live learners remain. Interacts with §4's cap (archived sections do not count) so plan it after §4.
7. **§12 · Ethnicity export round-trip + 44px selects** — two independent defects, one plan. Self-contained.
8. **§10 · School Head position dropdown** — UI only, the enum already has 17 values. Self-contained and small.
9. **§9 · School Head email** — contact email form plus confirming `changeEmailAction` end-to-end. Self-contained.
10. **§8 · Naidas T. Opong (Litos Extension)** — one migration replacing a partial unique index, then the school is created through the existing admin flow. Carries the accepted shared-default-password risk documented in the spec; worth its own approval moment.

---

## Self-Review

**Spec coverage (§1–2, this plan's scope):**

| Spec requirement | Task |
|---|---|
| `src/lib/releases.ts` with the five-field `Release` type | 1 |
| `RELEASES` newest-first, `APP_VERSION` derived from head | 1 |
| `package.json` synced, kept honest by a test | 1 |
| Five invariants each with a test | 1 |
| `User.lastSeenReleaseVersion String?` nullable | 2 |
| `NotificationType.RELEASE_PUBLISHED` + enum label | 2 |
| Shell reads the column; equal to `APP_VERSION` ⇒ nothing happens | 4 (prop), 6 (mount) |
| `announceRelease()` idempotent upsert of the bell row | 3 |
| `acknowledgeRelease()` stamps on acknowledgement, not display | 3 |
| Lazy per-user, never a fan-out | 3 |
| `announce: false` writes nothing, shows nothing | 3, 4 |
| Neither action runs during render | 3 (`"use server"`), 4 (effect + click) |
| Version in sidebar footer linking to `/releases` | 5 |
| `/releases` readable by anyone signed in, no role branching | 5 |
| Rollback does not re-announce | 4 (string equality, not ordering) |

Every §1 and §2 requirement maps to a task. §3–§12 are explicitly deferred above with a planning order.

**Placeholder scan:** No TBDs. Every code step carries the actual code. Three steps direct the implementer to read a file before editing (Task 2 Step 4 enum label location, Task 5 Step 1 footer structure, Task 6 Step 1 shell identity) — each names the exact grep and what to do with either answer, because guessing at those would be worse than looking.

**Type consistency:** `Release`, `RELEASES`, `APP_VERSION`, `compareVersions`, `latestRelease` are defined in Task 1 and used under those names in Tasks 3, 4, 5. `announceRelease` / `acknowledgeRelease` are defined in Task 3 and consumed in Task 4 under those names. `ReleaseNotesModal`'s single prop `lastSeenVersion` is the same in Task 4's test, its implementation, and Task 6's mount. `lastSeenReleaseVersion` is the Prisma column throughout; `lastSeenVersion` is the component prop — different names for different things, deliberately, and each used consistently.
