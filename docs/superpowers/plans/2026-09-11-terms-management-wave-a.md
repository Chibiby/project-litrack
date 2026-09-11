# Terms Management Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store per-school term window overrides and make the grade-entry lock read a separate deadline, with no visible behaviour change for any school that has not been edited.

**Architecture:** A sparse `TermWindowOverride` table holds a row only where a School Head has edited a term. `getTermWindows` stays pure and gains an `overrides` parameter that defaults to `[]`, so an un-overridden school derives exactly the windows it derives today. `isTermLocked` switches from comparing `endKey` to comparing a new `deadlineKey`, which equals `endKey` for every derived window — so the lock is unchanged until someone extends something.

**Tech Stack:** Prisma 5 → Supabase Postgres · TypeScript strict · Vitest · Next.js 15 App Router

**Spec:** `docs/superpowers/specs/2026-09-11-school-head-terms-management-design.md`

## Global Constraints

- **Never apply migrations.** Author only. `prisma migrate deploy`/`dev`/`reset` and `db push` are forbidden without task-specific owner approval. Safe: `prisma validate`, `prisma format`, `prisma generate`.
- **Migration numbering:** production already holds up to `20260911000002_release_channel`. This migration MUST sort after it — use `20260911000003_term_window_override`.
- **Date keys are strings.** Local `YYYY-MM-DD` via `formatLocalDateKey`/`parseLocalDateKey` (`src/lib/date-keys.ts`). Never `toISOString()` — the server runs UTC, schools run UTC+8.
- **`unstable_cache` serialises to JSON.** Anything returned from a `cachedQuery` must be JSON-safe; a `Date` comes back as a string while TypeScript still calls it `Date`.
- **Tenancy:** every school-scoped query carries `schoolId` in its `where`.
- **`windows.ts` stays pure** — no Prisma, no `server-only`, no I/O. It is imported by tests and by server code alike.
- **Gates before done:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. CI has not run since 2026-08-14 (billing lock), so these four local gates are the only verification.
- **Existing tests must pass unchanged.** `tests/unit/terms/windows.test.ts` is the regression guarantee for the default-argument behaviour. If a change to it seems necessary, stop — that means behaviour drifted.

---

### Task 1: Schema and migration

**Owner:** `database-engineer` — this is the only task touching `prisma/**`, which is a serialised resource.

**Files:**
- Modify: `prisma/schema.prisma` (add model + three back-relations)
- Create: `prisma/migrations/20260911000003_term_window_override/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma model `TermWindowOverride` with fields `id, schoolId, schoolYearId, term, startKey, endKey, deadlineKey, setById, createdAt, updatedAt`; relation name `TermWindowSetter` on `User`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Place it immediately after `model SchoolYear` (around line 504), keeping related models together:

```prisma
/// A School Head's edit to one term of one school year.
///
/// A row exists ONLY where a head has actually changed something. Every
/// un-edited term stays derived by `getTermWindows`, which is why this needed no
/// backfill: a school that never opens the terms page behaves exactly as it did
/// before this table existed.
model TermWindowOverride {
  id           String     @id @default(uuid())
  /// Denormalised from `schoolYear.schoolId` so tenant scoping is a direct
  /// `where` clause like every other table here, rather than a join a caller
  /// might forget. Kept honest by the action, which reads the year first.
  schoolId     String
  schoolYearId String
  term         TermPeriod

  /// Local `YYYY-MM-DD`. Deliberately String, not DateTime.
  ///
  /// `SchoolYear.startDate` is a bare timestamp, so a year starting August 1 in
  /// Manila is stored as `2026-07-31T16:00:00Z` and reading its UTC month puts
  /// Term 1 in July — the hazard `src/lib/terms/windows.ts:66` documents at
  /// length. `TermWindow` already carries these as keys and `isTermLocked`
  /// already compares them as strings, so storing keys keeps ONE representation
  /// from column to comparison to screen, which no timezone can shift.
  startKey String
  endKey   String

  /// Last day grades may still be encoded. Equals `endKey` when a head edits
  /// only the months. Moving this is how a term is extended WITHOUT shifting the
  /// next term's months — the case the feature exists for.
  deadlineKey String

  setById   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  school     School     @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  schoolYear SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)
  setBy      User       @relation("TermWindowSetter", fields: [setById], references: [id])

  /// One override per term per year. A re-edit updates this row rather than
  /// stacking a second one, so "what is this term's window?" never depends on
  /// row order — the same reasoning as `UnlockGrant`'s unique.
  @@unique([schoolYearId, term])
  @@index([schoolId])
  /// R6. FK-enforcement lookup side (implicit `Restrict` on `setBy`).
  @@index([setById])
}
```

- [ ] **Step 2: Add the three back-relations**

On `model School`, beside its other collections:

```prisma
  termWindowOverrides TermWindowOverride[]
```

On `model SchoolYear`, beside `termGrades`:

```prisma
  termWindowOverrides TermWindowOverride[]
```

On `model User`, beside the other named relations:

```prisma
  termWindowOverridesSet TermWindowOverride[] @relation("TermWindowSetter")
```

- [ ] **Step 3: Validate and format the schema**

```powershell
npx prisma validate
npx prisma format
```

Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 4: Write the migration SQL**

Create `prisma/migrations/20260911000003_term_window_override/migration.sql`:

```sql
-- Per-school term window overrides (Wave A of the terms management design).
--
-- NUMBERING
-- ---------
-- 20260911000003, after 20260911000002_release_channel, which production already
-- holds. A migration sorting behind an applied one is applied out of order.
--
-- PURELY ADDITIVE, AND DELIBERATELY NOT BACKFILLED
-- ------------------------------------------------
-- One CREATE TABLE and nothing else. No existing row is read or rewritten.
--
-- The emptiness is the design, not an omission: `getTermWindows` keeps deriving
-- three-month windows from the school year's start month, and a row here
-- OVERRIDES that derivation for one term. Seeding three rows per school year
-- would convert 126 schools from "derived, and follows the year if its dates are
-- corrected" to "frozen at whatever the derivation said on migration day".
--
-- SAFE TO APPLY BEFORE OR AFTER THE CODE
-- --------------------------------------
-- Unlike 20260911000002, this one has no ordering hazard. Nothing selects from
-- this table until `getActiveSchoolYear` is changed to read it, and an empty
-- table produces `overrides: []`, which is `getTermWindows`'s default argument
-- and therefore today's behaviour exactly. Applying it early is invisible;
-- applying it late only delays the feature.
--
-- CHECK CONSTRAINTS
-- -----------------
-- The action layer validates the same rules against the EFFECTIVE three windows
-- (derived thirds with overrides applied), which is the check that catches gaps
-- and overlaps across terms. These constraints are the narrower within-a-row
-- half, enforced where no application bug can route around them — the same
-- defence-in-depth as `TermGrade`'s 60-100 score CHECK.
--
--   * the three keys are really `YYYY-MM-DD`
--   * a term does not end before it starts
--   * a deadline never falls before its own term's last day, which would be a
--     term locked before it ended
--
-- Cross-term ordering is NOT expressible here: it spans rows, and a term with no
-- row at all is still a real window. That rule lives in `validateTermWindows`.

CREATE TABLE "TermWindowOverride" (
    "id"           TEXT NOT NULL,
    "schoolId"     TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "term"         "TermPeriod" NOT NULL,
    "startKey"     TEXT NOT NULL,
    "endKey"       TEXT NOT NULL,
    "deadlineKey"  TEXT NOT NULL,
    "setById"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermWindowOverride_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "TermWindowOverride_startKey_format"
        CHECK ("startKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    CONSTRAINT "TermWindowOverride_endKey_format"
        CHECK ("endKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    CONSTRAINT "TermWindowOverride_deadlineKey_format"
        CHECK ("deadlineKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    -- String comparison on YYYY-MM-DD is a total order, which is why these read
    -- as plain inequalities and need no date parsing.
    CONSTRAINT "TermWindowOverride_start_before_end"
        CHECK ("startKey" <= "endKey"),
    CONSTRAINT "TermWindowOverride_deadline_not_before_end"
        CHECK ("deadlineKey" >= "endKey")
);

CREATE UNIQUE INDEX "TermWindowOverride_schoolYearId_term_key"
    ON "TermWindowOverride"("schoolYearId", "term");

CREATE INDEX "TermWindowOverride_schoolId_idx"
    ON "TermWindowOverride"("schoolId");

CREATE INDEX "TermWindowOverride_setById_idx"
    ON "TermWindowOverride"("setById");

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_schoolYearId_fkey"
    FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_setById_fkey"
    FOREIGN KEY ("setById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Verify the migration matches the schema**

```powershell
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script
```

If that form is unavailable offline, verify by inspection: every column, index and constraint in the SQL appears in the model, and vice versa. **Do not** run any command that connects to a database with `--from-url`/`--to-url`.

- [ ] **Step 6: Generate the client and typecheck**

```powershell
npx prisma generate
npm run typecheck
```

Expected: both succeed. `typecheck` proves the new model compiles into the client.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260911000003_term_window_override/
git commit -m "feat: a term window a school head edited has somewhere to live"
```

---

### Task 2: `getTermWindows` accepts overrides, `isTermLocked` reads the deadline

**Files:**
- Modify: `src/lib/terms/windows.ts`
- Test: `tests/unit/terms/windows.test.ts` (extend; existing cases must not change)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime — this file stays pure and Prisma-free. The override shape is declared here as a structural type, and Prisma rows satisfy it.
- Produces:
  - `type TermWindowOverrideInput = { term: TermPeriodValue; startKey: string; endKey: string; deadlineKey: string }`
  - `TermWindow` gains `deadlineKey: string` and `isOverridden: boolean`
  - `getTermWindows(schoolYearStart: Date, overrides?: TermWindowOverrideInput[]): TermWindow[]`
  - `isTermLocked(window: TermWindow, todayKey: string): boolean` — unchanged signature, now compares `deadlineKey`
  - `validateTermWindows(windows: TermWindow[], yearStartKey: string, yearEndKey: string): string | null`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/terms/windows.test.ts`:

```ts
describe("getTermWindows with overrides", () => {
  it("derives a deadline equal to the month end when nothing is overridden", () => {
    const windows = getTermWindows(AUGUST_START);

    expect(windows.map((w) => w.deadlineKey)).toEqual([
      "2026-10-31",
      "2027-01-31",
      "2027-04-30",
    ]);
    expect(windows.every((w) => w.deadlineKey === w.endKey)).toBe(true);
    expect(windows.every((w) => w.isOverridden === false)).toBe(true);
  });

  it("replaces only the term it names, leaving the other two derived", () => {
    const windows = getTermWindows(AUGUST_START, [
      {
        term: "SECOND",
        startKey: "2026-11-01",
        endKey: "2027-01-31",
        deadlineKey: "2027-02-28",
      },
    ]);

    expect(windows[0]).toMatchObject({
      term: "FIRST",
      startKey: "2026-08-01",
      endKey: "2026-10-31",
      deadlineKey: "2026-10-31",
      isOverridden: false,
    });
    expect(windows[1]).toMatchObject({
      term: "SECOND",
      endKey: "2027-01-31",
      deadlineKey: "2027-02-28",
      isOverridden: true,
    });
    expect(windows[2]).toMatchObject({ term: "THIRD", isOverridden: false });
  });

  it("relabels the range when an override moves the months", () => {
    const [first] = getTermWindows(AUGUST_START, [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-09-30",
        deadlineKey: "2026-09-30",
      },
    ]);

    expect(first.rangeLabel).toBe("August - September");
  });

  it("ignores an override naming a term that does not exist", () => {
    const windows = getTermWindows(AUGUST_START, [
      {
        term: "FOURTH" as never,
        startKey: "2027-05-01",
        endKey: "2027-07-31",
        deadlineKey: "2027-07-31",
      },
    ]);

    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.isOverridden === false)).toBe(true);
  });
});

describe("isTermLocked reads the deadline, not the months", () => {
  const extended = getTermWindows(JUNE_START, [
    {
      term: "FIRST",
      startKey: "2026-06-01",
      endKey: "2026-08-31",
      deadlineKey: "2026-09-30",
    },
  ]);

  it("keeps a term open past its last month when the deadline was extended", () => {
    // The months ended Aug 31; the head moved entry to Sept 30.
    expect(isTermLocked(extended[0], "2026-09-15")).toBe(false);
  });

  it("locks on the day after the deadline, not the day after the months", () => {
    expect(isTermLocked(extended[0], "2026-09-30")).toBe(false);
    expect(isTermLocked(extended[0], "2026-10-01")).toBe(true);
  });

  it("still locks a derived term the day after its months end", () => {
    const [first] = getTermWindows(JUNE_START);
    expect(isTermLocked(first, "2026-08-31")).toBe(false);
    expect(isTermLocked(first, "2026-09-01")).toBe(true);
  });
});

describe("validateTermWindows", () => {
  const YEAR_START = "2026-06-01";
  const YEAR_END = "2027-03-31";

  it("accepts the derived windows of the year it was derived from", () => {
    const windows = getTermWindows(JUNE_START);
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toBeNull();
  });

  it("rejects a term that ends before it starts", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-06-30",
        deadlineKey: "2026-08-01",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term ends before it starts/
    );
  });

  it("rejects a deadline that falls before its own term ends", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-07-15",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term's deadline is before/
    );
  });

  it("rejects overlapping months across two terms", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-09-30",
        deadlineKey: "2026-09-30",
      },
    ]);

    // Derived SECOND starts 2026-09-01, so FIRST now runs past it.
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /Second Term starts before First Term ends/
    );
  });

  it("allows a deadline to run past the next term's start", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-10-15",
      },
    ]);

    // The whole point of a separate deadline: entry stays open into Term 2.
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toBeNull();
  });

  it("rejects months that start before the school year does", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-05-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-08-31",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term starts before the school year/
    );
  });
});
```

Add `validateTermWindows` to the existing import block at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run tests/unit/terms/windows.test.ts
```

Expected: FAIL — `validateTermWindows is not a function`, and `deadlineKey`/`isOverridden` undefined.

- [ ] **Step 3: Implement in `src/lib/terms/windows.ts`**

Extend the `TermWindow` type:

```ts
export type TermWindow = {
  term: TermPeriodValue;
  /** "First Term" */
  label: string;
  /** "August - October" — month names only, matching the approved sheet. */
  rangeLabel: string;
  /** Local `YYYY-MM-DD` of the first day of the window's first month. */
  startKey: string;
  /** Local `YYYY-MM-DD` of the last day of the window's last month. */
  endKey: string;
  /**
   * Local `YYYY-MM-DD` of the last day grades may be encoded. Equals `endKey`
   * for a derived window, and is the ONLY key `isTermLocked` consults, so a
   * School Head can extend entry without moving the months the sheet displays.
   */
  deadlineKey: string;
  /** True when a `TermWindowOverride` row supplied this window's dates. */
  isOverridden: boolean;
};

/**
 * The shape `getTermWindows` accepts for an override.
 *
 * Declared structurally rather than imported from `@prisma/client` so this
 * module stays pure and dependency-free — a Prisma row satisfies it, and so does
 * a literal in a test.
 */
export type TermWindowOverrideInput = {
  term: TermPeriodValue;
  startKey: string;
  endKey: string;
  deadlineKey: string;
};
```

Replace `getTermWindows` with:

```ts
export function getTermWindows(
  schoolYearStart: Date,
  overrides: TermWindowOverrideInput[] = []
): TermWindow[] {
  const [year, month] = formatLocalDateKey(schoolYearStart)
    .slice(0, 7)
    .split("-")
    .map(Number);
  const anchor = new Date(year, month - 1, 1);

  return TERM_PERIODS.map((term, index) => {
    const override = overrides.find((o) => o.term === term);
    if (override) {
      return {
        term,
        label: TERM_LABELS[term],
        rangeLabel: rangeLabelFor(override.startKey, override.endKey),
        startKey: override.startKey,
        endKey: override.endKey,
        deadlineKey: override.deadlineKey,
        isOverridden: true,
      };
    }

    const start = addMonths(anchor, index * 3);
    const end = monthEndDay(addMonths(anchor, index * 3 + 2));
    const endKey = formatLocalDateKey(end);
    return {
      term,
      label: TERM_LABELS[term],
      rangeLabel: `${MONTH_NAMES[start.getMonth()]} - ${MONTH_NAMES[end.getMonth()]}`,
      startKey: formatLocalDateKey(start),
      endKey,
      // A derived window's deadline IS its month end. Every lock behaves exactly
      // as it did before this parameter existed until a head changes something.
      deadlineKey: endKey,
      isOverridden: false,
    };
  });
}

/**
 * "August - September" from two date keys.
 *
 * Reads the month off the KEY's own characters rather than constructing a
 * `Date`, for the reason this module's header gives: a key is already local, and
 * parsing it into a `Date` only to read `.getMonth()` reintroduces the timezone
 * question the key exists to settle.
 */
function rangeLabelFor(startKey: string, endKey: string): string {
  const startMonth = Number(startKey.slice(5, 7)) - 1;
  const endMonth = Number(endKey.slice(5, 7)) - 1;
  return `${MONTH_NAMES[startMonth]} - ${MONTH_NAMES[endMonth]}`;
}
```

Change the one comparison in `isTermLocked`, and update its doc comment:

```ts
/**
 * A term is locked once its DEADLINE has passed — inclusive on the deadline
 * itself, so a teacher encoding on the last day is still open.
 *
 * The deadline, not the months. For a derived window the two are the same day;
 * for an extended one the months describe what the sheet is called and the
 * deadline decides what may be written into it.
 *
 * `todayKey` must come from `formatLocalDateKey(schoolToday())`, never from a
 * bare `new Date()`: the server runs in UTC and the school in UTC+8, so between
 * midnight and 08:00 Manila a raw date resolves to yesterday and every term
 * would lock a day early.
 *
 * String comparison on `YYYY-MM-DD` is a total order, which sidesteps `Date`
 * arithmetic entirely.
 */
export function isTermLocked(window: TermWindow, todayKey: string): boolean {
  return todayKey > window.deadlineKey;
}
```

Append the validator:

```ts
/**
 * The rule set a School Head's edit must satisfy, or `null` when it does.
 *
 * Validated against the EFFECTIVE three windows — derived thirds with any
 * overrides already applied — never against the stored rows alone. That is what
 * makes sparse storage safe: a head who overrides only Term 2 is still checked
 * against derived Terms 1 and 3, so a partial edit cannot open a gap.
 *
 * Returns a message naming the specific violation, because "invalid dates" gives
 * a head no way to fix what they typed.
 *
 * Deadlines are deliberately exempt from the cross-term ordering rule: Term 1's
 * deadline running past Term 2's start is the feature, not a violation.
 */
export function validateTermWindows(
  windows: TermWindow[],
  yearStartKey: string,
  yearEndKey: string
): string | null {
  for (const w of windows) {
    if (w.startKey > w.endKey) {
      return `${w.label} ends before it starts.`;
    }
    if (w.deadlineKey < w.endKey) {
      return `${w.label}'s deadline is before the term ends.`;
    }
    if (w.startKey < yearStartKey) {
      return `${w.label} starts before the school year does.`;
    }
    if (w.endKey > yearEndKey) {
      return `${w.label} ends after the school year does.`;
    }
  }

  for (let i = 1; i < windows.length; i++) {
    const previous = windows[i - 1];
    const current = windows[i];
    if (current.startKey <= previous.endKey) {
      return `${current.label} starts before ${previous.label} ends.`;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
npx vitest run tests/unit/terms/windows.test.ts
```

Expected: PASS, including every pre-existing case unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/terms/windows.ts tests/unit/terms/windows.test.ts
git commit -m "feat: a term can stay open for entry after its months end"
```

---

### Task 3: The cached school year carries its overrides

**Files:**
- Modify: `src/lib/cache/school-year.ts`
- Test: `tests/unit/cache-school-year.test.ts`

**Interfaces:**
- Consumes: `TermWindowOverrideInput` from Task 2; the `TermWindowOverride` model from Task 1.
- Produces: `ActiveSchoolYear` gains `endDateKey: string` and `overrides: TermWindowOverrideInput[]`.

`endDateKey` is added here because `validateTermWindows` needs the year's end and every caller already has this object.

- [ ] **Step 1: Write the failing test**

This file drives its Prisma mock from a module-level `let row` (line ~42), **not**
from `mockResolvedValue`. First widen that variable's type to carry the two new
fields, and add an end-date constant beside the existing `START_DATE`/`START_KEY`:

```ts
const END_DATE = new Date(2027, 2, 31);
const END_KEY = "2027-03-31";

let row:
  | {
      id: string;
      label: string;
      startDate: Date;
      endDate: Date;
      termWindowOverrides: {
        term: string;
        startKey: string;
        endKey: string;
        deadlineKey: string;
      }[];
    }
  | null = null;
```

Every existing assignment to `row` in the file must gain `endDate: END_DATE` and
`termWindowOverrides: []`. Then add these cases:

```ts
it("returns the year's overrides as plain date-key strings", async () => {
  row = {
    id: "sy1",
    label: "2026-2027",
    startDate: START_DATE,
    endDate: END_DATE,
    termWindowOverrides: [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-09-30",
      },
    ],
  };

  const year = await getActiveSchoolYear(SCHOOL_ID);

  expect(year).toMatchObject({
    startDateKey: START_KEY,
    endDateKey: END_KEY,
    overrides: [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-09-30",
      },
    ],
  });
});

it("returns an empty override list for an un-edited year", async () => {
  row = {
    id: "sy1",
    label: "2026-2027",
    startDate: START_DATE,
    endDate: END_DATE,
    termWindowOverrides: [],
  };

  const year = await getActiveSchoolYear(SCHOOL_ID);

  expect(year?.overrides).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run tests/unit/cache-school-year.test.ts
```

Expected: FAIL — `overrides` and `endDateKey` are undefined.

- [ ] **Step 3: Implement**

In `src/lib/cache/school-year.ts`, extend the type:

```ts
import type { TermWindowOverrideInput } from "@/lib/terms/windows";

export type ActiveSchoolYear = {
  id: string;
  label: string;
  startDateKey: string;
  /** `SchoolYear.endDate` as a key, for the same JSON reason as `startDateKey`. */
  endDateKey: string;
  /**
   * The head's edits to this year's term windows, empty for most schools.
   *
   * Already plain strings in the database, which is why they survive
   * `unstable_cache`'s JSON round trip untouched — the hazard `startDateKey`
   * exists to avoid does not arise here at all.
   */
  overrides: TermWindowOverrideInput[];
};
```

and the query:

```ts
      const schoolYear = await prisma.schoolYear.findFirst({
        where: { schoolId, isActive: true },
        select: {
          id: true,
          label: true,
          startDate: true,
          endDate: true,
          // Selected inline rather than as a second round trip: the caller that
          // wants the year always wants its windows, and this is at most three
          // tiny rows.
          termWindowOverrides: {
            select: {
              term: true,
              startKey: true,
              endKey: true,
              deadlineKey: true,
            },
          },
        },
      });
      if (!schoolYear) return null;

      return {
        id: schoolYear.id,
        label: schoolYear.label,
        startDateKey: formatLocalDateKey(schoolYear.startDate),
        endDateKey: formatLocalDateKey(schoolYear.endDate),
        overrides: schoolYear.termWindowOverrides,
      };
```

Bump the cache key so entries written by the previous shape are not read back missing the new fields:

```ts
      keyParts: ["active-school-year-v2", schoolId],
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npx vitest run tests/unit/cache-school-year.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache/school-year.ts tests/unit/cache-school-year.test.ts
git commit -m "feat: the cached school year knows its own term windows"
```

---

### Task 4: The save and export paths honour overrides

**Files:**
- Modify: `src/lib/actions/term-grades.ts` (two `getTermWindows` calls: ~line 137 and ~line 406)
- Test: `tests/unit/actions/term-grades-save.test.ts`

**Interfaces:**
- Consumes: `getTermWindows(start, overrides)` from Task 2.
- Produces: nothing new. Both call sites read `termWindowOverrides` alongside the school year they already load.

These two sites query `prisma.schoolYear.findFirst` **directly**, not through `getActiveSchoolYear`. Do not reroute them through the cache in this task — a save must read the live window, not a 60-second-old one.

- [ ] **Step 1: Write the failing test**

This file already has everything these cases need, so **do not** invent clock or
locking helpers:

- the clock is frozen at `TODAY` = **December 15 2026** (`vi.setSystemTime` in `beforeEach`)
- `SCHOOL_YEAR_START` = **August 1 2026**, so First Term derives as Aug–Oct, ending Oct 31
- `LOCKED_TERM` = `"FIRST"` — already closed on `TODAY`, which is the whole point
- `isSubmissionLockingEnabled` is mocked to return **true** by default, so locking
  is already on; the existing "locking off" case opts out with
  `.mockResolvedValueOnce(false)`

Two preparatory edits are needed before the cases will work.

**(a)** The `SchoolYearRow` fixture type and the `schoolYears` entries gain an
override list — default it to empty so every existing test is unaffected:

```ts
type SchoolYearRow = {
  id: string;
  schoolId: string;
  isActive: boolean;
  startDate: Date;
  termWindowOverrides: {
    term: string;
    startKey: string;
    endKey: string;
    deadlineKey: string;
  }[];
};
```

Give the `schoolYears` fixture built in `beforeEach` `termWindowOverrides: []`.

**(b)** The `schoolYearFindFirst` mock currently **drops** every field but `id`
and `startDate`, so an override added to the fixture would never reach the
action. It must pass the new field through:

```ts
const schoolYearFindFirst = vi.fn(
  async (args: { where: { schoolId: string; isActive: boolean } }) => {
    const found = schoolYears.find(
      (y) => y.schoolId === args.where.schoolId && y.isActive === args.where.isActive
    );
    return found
      ? {
          id: found.id,
          startDate: found.startDate,
          termWindowOverrides: found.termWindowOverrides,
        }
      : null;
  }
);
```

Now the cases, added beside the existing lock tests:

```ts
it("accepts a save past the months when the head extended the deadline", async () => {
  // First Term's months ended Oct 31. The head moved entry to Dec 31, and the
  // frozen clock is Dec 15 — inside the extension, past the months.
  schoolYears[0].termWindowOverrides = [
    {
      term: "FIRST",
      startKey: "2026-08-01",
      endKey: "2026-10-31",
      deadlineKey: "2026-12-31",
    },
  ];

  const res = await post({ term: LOCKED_TERM });

  expect(res.ok).toBe(true);
});

it("still refuses a save past the extended deadline", async () => {
  // Extended, but only to Nov 30 — the clock is past that too.
  schoolYears[0].termWindowOverrides = [
    {
      term: "FIRST",
      startKey: "2026-08-01",
      endKey: "2026-10-31",
      deadlineKey: "2026-11-30",
    },
  ];

  const res = await post({ term: LOCKED_TERM });

  expect(res.ok).toBe(false);
  expect(res).toMatchObject({
    error: expect.stringContaining("First Term is closed"),
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run tests/unit/actions/term-grades-save.test.ts
```

Expected: FAIL on the first case — the save is refused because the derived end (Aug 31) is still what the lock reads.

- [ ] **Step 3: Implement**

At the save site (~line 131), add the relation to the existing select and pass it through:

```ts
  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId: user.schoolId, isActive: true },
    select: {
      id: true,
      startDate: true,
      termWindowOverrides: {
        select: {
          term: true,
          startKey: true,
          endKey: true,
          deadlineKey: true,
        },
      },
    },
  });
  if (!schoolYear) return { ok: false, error: NO_SCHOOL_YEAR_MESSAGE };

  const window = resolveTermWindow(
    getTermWindows(schoolYear.startDate, schoolYear.termWindowOverrides),
    parsed.data.term
  );
```

Make the identical change at the export site (~line 399): add `termWindowOverrides` to that `select`, and pass `schoolYear.termWindowOverrides` as the second argument to `getTermWindows`.

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
npx vitest run tests/unit/actions/term-grades-save.test.ts tests/unit/actions/term-grades-export.test.ts
```

Expected: PASS. If `term-grades-export.test.ts` times out, re-run it alone — that file is a known flake under parallel load and passes in isolation in about a second.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/term-grades.ts tests/unit/actions/term-grades-save.test.ts
git commit -m "feat: an extended deadline lets a late teacher finish encoding"
```

---

### Task 5: The teacher's sheet shows the extended window

**Files:**
- Modify: `src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx:214`

**Interfaces:**
- Consumes: `ActiveSchoolYear.overrides` from Task 3; `getTermWindows(start, overrides)` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Make the change**

The page already holds `schoolYear` from `getActiveSchoolYear`. Pass its overrides:

```ts
  const windows = getTermWindows(
    parseLocalDateKey(schoolYear.startDateKey),
    schoolYear.overrides
  );
```

No other line changes. `isEncodingClosed` calls `isTermLocked`, which now reads `deadlineKey`, so the sheet's lock and `saveTermGrades`'s lock stay in agreement — which is the property the comment at that call site already asserts.

- [ ] **Step 2: Verify the whole suite and the build**

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: typecheck clean; lint no new warnings; tests pass; build succeeds.

If a test file times out, re-run it alone before treating it as a failure — this repo's exceljs-backed export tests starve under parallel load.

- [ ] **Step 3: Commit**

```bash
git add "src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx"
git commit -m "feat: the grade sheet reads the deadline its school actually has"
```

---

## Definition of done for Wave A

- [ ] `npx prisma validate` passes; the migration exists and has **not** been applied by an agent.
- [ ] All four gates pass: `typecheck`, `lint`, `test`, `build`.
- [ ] Every pre-existing case in `tests/unit/terms/windows.test.ts` passes **unchanged** — the regression guarantee that un-edited schools behave identically.
- [ ] No UI exists yet. A head cannot create an override; only a direct database row can. That is Wave B.
- [ ] The migration is handed to the owner with `docs/migrate-checklist.md`, noting it is additive, un-backfilled, and safe to apply before or after the code.
