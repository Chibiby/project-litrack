# Teacher Advisory Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Floating and Multi-grade become a declared per-teacher advisory setting, the profiling designation alone decides who is a volunteer, and the School Head can change both.

**Architecture:** A `TeacherProfile.advisoryMode` enum (`DEFAULT` / `FLOATING` / `MULTI_GRADE`) sits beside `designation`. One pure function, `advisoryCapFor(designation, mode)`, decides how many sections a teacher may hold and is used by the transaction, the wizard and the School Head's picker. One pure predicate, `advisoryRosterDenial`, closes the class-bound pages and sidebar rows for volunteers and floating teachers alike.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Prisma 5 → Supabase Postgres · Zod · Vitest · Tailwind + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-09-11-teacher-advisory-modes-design.md`

## Global Constraints

- **Work only in** `C:\Users\PC5\Desktop\project-litrack\.claude\worktrees\advisory-modes` on branch `feat/advisory-modes`. Never `cd` to the repo root; another session owns uncommitted files there.
- **Never apply migrations.** Never run `prisma migrate deploy|dev|reset`, `db push`, or `prisma migrate diff` with `--from-url`, `--to-url` or `--to-schema-datasource` (it dials the database). Safe: `prisma validate`, `prisma format`, `prisma generate`.
- **Migration name:** `20260911000010_teacher_advisory_mode`. Production holds up to `20260911000004`; 005–009 are left for another branch.
- **Designation literals** are exactly `"Teacher"`, `"Master Teacher"`, `"Non-DepEd ARAL Volunteer"` (`ARAL_VOLUNTEER_DESIGNATION`), or any other string (= Others).
- **Caps:** Volunteer 0 · FLOATING 0 · DEFAULT 1 · MULTI_GRADE 3.
- **UI copy, verbatim:** checkbox labels `Floating teacher`, `Multi-grade advisory`; sidebar pill `Floating teacher`; chip `Unassigned` (zero sections, not floating) and `Floating` (mode FLOATING).
- **Tenancy:** every school-scoped query carries `schoolId: user.schoolId`, or `assertSameSchool`. Cross-tenant leakage is the worst bug shippable here.
- **Server actions** follow the house pattern: auth guard → Zod `safeParse` → ownership → `$transaction` → `writeAudit(AUDIT_ACTIONS.X)` → revalidate helper. Return `{ ok: true } | { ok: false, error }`; never throw to the client; never surface Prisma text.
- **Enum labels** live in `src/lib/constants/enum-labels.ts`.
- **Do not edit** `src/lib/actions/auth.ts`, `src/lib/auth/teacher-registration.ts` or `src/lib/validators/auth.schema.ts` — another branch is rewriting them. The sign-up change is client-only; the server already defaults `isAralVolunteer` to `false`.
- **Commit trailer**, exactly: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Every task ends green on its own tests and `npm run typecheck`.

---

### Task 1: The column, the migration, the labels

**Files:**
- Modify: `prisma/schema.prisma` (enum + `TeacherProfile.advisoryMode`)
- Create: `prisma/migrations/20260911000010_teacher_advisory_mode/migration.sql`
- Modify: `src/lib/constants/enum-labels.ts`
- Create: `tests/unit/db/teacher-advisory-mode-migration.test.ts`

**Interfaces:**
- Produces: Prisma enum `AdvisoryMode { DEFAULT FLOATING MULTI_GRADE }`; `TeacherProfile.advisoryMode AdvisoryMode @default(DEFAULT)`; `ADVISORY_MODE_LABELS` exported from enum-labels.

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/unit/db/teacher-advisory-mode-migration.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { ADVISORY_MODE_LABELS } from "@/lib/constants/enum-labels";

/**
 * The migration names a designation literal and two enum values in SQL, where no
 * type checker reaches. Renaming any of them would leave the backfill silently
 * matching nothing — or, worse, releasing sections that hold learners. These
 * assertions pin the rule, the same way password-is-school-id-backfill.test.ts
 * pins its audit action names.
 */
const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260911000010_teacher_advisory_mode/migration.sql"),
  "utf8"
);
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("teacher advisory mode migration", () => {
  it("creates the enum with exactly the three modes the app labels", () => {
    expect(code).toMatch(/CREATE TYPE "AdvisoryMode" AS ENUM \('DEFAULT', 'FLOATING', 'MULTI_GRADE'\)/);
    expect(Object.keys(ADVISORY_MODE_LABELS).sort()).toEqual(["DEFAULT", "FLOATING", "MULTI_GRADE"]);
  });

  it("adds the column NOT NULL with a DEFAULT, so every existing row lands on DEFAULT", () => {
    expect(code).toMatch(
      /ALTER TABLE "TeacherProfile" ADD COLUMN "advisoryMode" "AdvisoryMode" NOT NULL DEFAULT 'DEFAULT'/
    );
  });

  it("marks MULTI_GRADE only where two or more LIVE sections are held", () => {
    expect(code).toMatch(/SET "advisoryMode" = 'MULTI_GRADE'/);
    expect(code).toMatch(/"deletedAt" IS NULL\s*\)\s*>=\s*2/);
  });

  it("releases only volunteers' sections, and only sections with no live learner", () => {
    expect(code).toContain(`'${ARAL_VOLUNTEER_DESIGNATION}'`);
    expect(code).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM "Learner" l\s+WHERE l\."sectionId" = s\.id AND l\."deletedAt" IS NULL/);
  });

  it("never sets a teacher to FLOATING — floating is declared, not inferred", () => {
    expect(code).not.toMatch(/'FLOATING'\s*(WHERE|;)/);
    expect(code.match(/'FLOATING'/g)?.length).toBe(1); // only in CREATE TYPE
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/db/teacher-advisory-mode-migration.test.ts`
Expected: FAIL — ENOENT on the migration file.

- [ ] **Step 3: Schema**

In `prisma/schema.prisma`, add near the other teacher enums:

```prisma
/// How many advisory sections a DepEd teacher may hold, as a declared setting.
/// Separate from `TeacherProfile.designation` (rank) on purpose: a Master
/// Teacher may be floating. Ignored for the Non-DepEd ARAL Volunteer
/// designation, which never advises. Caps live in
/// `src/lib/teachers/advisory-limits.ts` (`advisoryCapFor`), not in SQL.
enum AdvisoryMode {
  DEFAULT
  FLOATING
  MULTI_GRADE
}
```

In `model TeacherProfile`, directly under `designation String?`:

```prisma
  /// DEFAULT = one advisory · FLOATING = none (no class roster, no end-of-term
  /// reports; ARAL still open) · MULTI_GRADE = one to three, any grades.
  /// Chosen once by the teacher at profiling, then changed only by the School
  /// Head (`setTeacherAdvisorySetting`).
  advisoryMode AdvisoryMode @default(DEFAULT)
```

Run `npx prisma format` then `npx prisma validate`.

- [ ] **Step 4: Migration SQL**

```sql
-- Teacher advisory modes: Floating and Multi-grade become a declared setting.
--
-- NUMBERING: 20260911000010. Production holds up to 20260911000004; 005-009 are
-- left free for feat/error-handling, which must renumber its ErrorEvent table.
--
-- APPLY BEFORE THE CODE DEPLOYS. The generated client names "advisoryMode" on
-- every TeacherProfile read, so code first is P2022 on profiling and on the
-- School Head's teachers page. Applied first, the column is invisible.
--
-- 1. DDL. Additive; every existing row lands on DEFAULT.
CREATE TYPE "AdvisoryMode" AS ENUM ('DEFAULT', 'FLOATING', 'MULTI_GRADE');
ALTER TABLE "TeacherProfile" ADD COLUMN "advisoryMode" "AdvisoryMode" NOT NULL DEFAULT 'DEFAULT';

-- 2. Teachers who already hold two or three live sections keep them. Under the
--    new rule only MULTI_GRADE may hold more than one, so they are marked it.
--    Expected on production 2026-09-11: 9 rows.
UPDATE "TeacherProfile" tp
   SET "advisoryMode" = 'MULTI_GRADE'
 WHERE (
   SELECT COUNT(*) FROM "Section" s
    WHERE s."adviserId" = tp."userId" AND s."deletedAt" IS NULL
 ) >= 2;

-- 3. Volunteers never advise. The old wizard offered them an optional section
--    picker, and picking one made them the adviser — so empty sections read as
--    taken. Release those, and ONLY those with no live learner, so no roster
--    changes hands. Expected on production 2026-09-11: 25 sections.
--    The legacy mirrors (User.advisorySectionId, TeacherSection, _TeacherGrades)
--    are cleared for the same rows, as setTeacherAdvisory would.
CREATE TEMP TABLE "_released_volunteer_sections" AS
SELECT s.id AS section_id, s."adviserId" AS teacher_id, s."gradeLevelId" AS grade_id
  FROM "Section" s
  JOIN "TeacherProfile" tp ON tp."userId" = s."adviserId"
 WHERE tp.designation = 'Non-DepEd ARAL Volunteer'
   AND s."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Learner" l WHERE l."sectionId" = s.id AND l."deletedAt" IS NULL
   );

UPDATE "Section" SET "adviserId" = NULL
 WHERE id IN (SELECT section_id FROM "_released_volunteer_sections");

UPDATE "User" SET "advisorySectionId" = NULL
 WHERE "advisorySectionId" IN (SELECT section_id FROM "_released_volunteer_sections");

DELETE FROM "TeacherSection" ts
 USING "_released_volunteer_sections" r
 WHERE ts."teacherId" = r.teacher_id AND ts."sectionId" = r.section_id;

DELETE FROM "_TeacherGrades" tg
 USING "_released_volunteer_sections" r
 WHERE tg."A" = r.grade_id AND tg."B" = r.teacher_id
   AND NOT EXISTS (
     SELECT 1 FROM "Section" s
      WHERE s."adviserId" = r.teacher_id AND s."gradeLevelId" = r.grade_id AND s."deletedAt" IS NULL
   );

DROP TABLE "_released_volunteer_sections";
```

Note: the test's `'FLOATING'` count assertion passes because FLOATING appears once, in `CREATE TYPE`.

- [ ] **Step 5: Labels**

In `src/lib/constants/enum-labels.ts`, beside `EMPLOYMENT_TYPE_LABELS`:

```ts
/** The advisory setting beside a DepEd teacher's designation. */
export const ADVISORY_MODE_LABELS = {
  DEFAULT: "One advisory section",
  FLOATING: "Floating teacher",
  MULTI_GRADE: "Multi-grade advisory",
} as const;
```

- [ ] **Step 6: Verify**

Run: `npx prisma generate && npx vitest run tests/unit/db/teacher-advisory-mode-migration.test.ts tests/unit/rls-coverage.test.ts tests/unit/db/schema-order.test.ts && npm run typecheck`
Expected: all PASS (no new model, so RLS and snapshot lists are unchanged).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260911000010_teacher_advisory_mode src/lib/constants/enum-labels.ts tests/unit/db/teacher-advisory-mode-migration.test.ts
git commit -m "feat: a teacher's advisory load is a setting, not a guess from their sections" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: One cap, one denial, one set of words

**Files:**
- Modify: `src/lib/teachers/advisory-limits.ts`
- Modify: `src/lib/teachers/scope.ts` (add `advisoryRosterDenial`; widen `deniesAdvisoryRoster`)
- Modify: `src/lib/teachers/floating-copy.ts`
- Create: `tests/unit/teachers/advisory-cap.test.ts`
- Modify: `tests/unit/teachers-scope.test.ts` (append cases; do not change existing ones)

**Interfaces:**
- Consumes: `AdvisoryMode` (Task 1), `ARAL_VOLUNTEER_DESIGNATION`.
- Produces:
  - `advisoryCapFor(designation: string | null | undefined, mode: AdvisoryMode | null | undefined): number`
  - `advisoryCapReason(designation, mode): string` — why the picker stops
  - `advisoryRosterDenial(args: { isSuperAdmin: boolean; designation: string | null | undefined; advisoryMode?: AdvisoryMode | null }): "volunteer" | "floating" | null`
  - `deniesAdvisoryRoster(args)` — same args, `advisoryRosterDenial(args) !== null`
  - `DECLARED_FLOATING_CARD` (same shape as `FLOATING_TEACHER_CARD`), `UNASSIGNED_CHIP_LABEL = "Unassigned"`

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/teachers/advisory-cap.test.ts
import { describe, expect, it } from "vitest";
import { advisoryCapFor, advisoryCapReason, MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

describe("advisoryCapFor", () => {
  it.each([
    ["Teacher", "DEFAULT", 1],
    ["Teacher", "FLOATING", 0],
    ["Teacher", "MULTI_GRADE", 3],
    ["Master Teacher", "MULTI_GRADE", 3],
    ["ARAL Coordinator", "DEFAULT", 1], // Others behaves like Teacher
    ["ARAL Coordinator", "MULTI_GRADE", 3],
  ] as const)("%s + %s → %i", (designation, mode, cap) => {
    expect(advisoryCapFor(designation, mode)).toBe(cap);
  });

  it("gives a volunteer zero whatever the mode says", () => {
    for (const mode of ["DEFAULT", "FLOATING", "MULTI_GRADE"] as const) {
      expect(advisoryCapFor(ARAL_VOLUNTEER_DESIGNATION, mode)).toBe(0);
    }
  });

  it("treats a missing mode as DEFAULT", () => {
    expect(advisoryCapFor("Teacher", null)).toBe(1);
    expect(advisoryCapFor("Teacher", undefined)).toBe(1);
  });

  it("keeps MAX_ADVISORY_SECTIONS as the multi-grade ceiling", () => {
    expect(MAX_ADVISORY_SECTIONS).toBe(3);
    expect(advisoryCapFor("Teacher", "MULTI_GRADE")).toBe(MAX_ADVISORY_SECTIONS);
  });

  it("explains each cap in words a School Head can act on", () => {
    expect(advisoryCapReason(ARAL_VOLUNTEER_DESIGNATION, "DEFAULT")).toMatch(/volunteer/i);
    expect(advisoryCapReason("Teacher", "FLOATING")).toMatch(/floating/i);
    expect(advisoryCapReason("Teacher", "DEFAULT")).toMatch(/one section/i);
    expect(advisoryCapReason("Teacher", "MULTI_GRADE")).toMatch(/3/);
  });
});
```

Append to `tests/unit/teachers-scope.test.ts`:

```ts
describe("advisoryRosterDenial", () => {
  it("names the volunteer", () => {
    expect(
      advisoryRosterDenial({ isSuperAdmin: false, designation: ARAL_VOLUNTEER_DESIGNATION, advisoryMode: "DEFAULT" })
    ).toBe("volunteer");
  });
  it("names a declared floating teacher", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "FLOATING" })).toBe("floating");
  });
  it("lets a default or multi-grade teacher through", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "DEFAULT" })).toBeNull();
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "MULTI_GRADE" })).toBeNull();
  });
  it("never denies a Super Admin", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: true, designation: "Teacher", advisoryMode: "FLOATING" })).toBeNull();
  });
  it("fails open on a missing mode", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher" })).toBeNull();
  });
  it("keeps deniesAdvisoryRoster as its boolean form", () => {
    expect(deniesAdvisoryRoster({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "FLOATING" })).toBe(true);
  });
});
```

(Add `advisoryRosterDenial` and `ARAL_VOLUNTEER_DESIGNATION` to that file's imports if absent.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/teachers/advisory-cap.test.ts tests/unit/teachers-scope.test.ts`
Expected: FAIL — `advisoryCapFor` / `advisoryRosterDenial` not exported.

- [ ] **Step 3: Implement**

`src/lib/teachers/advisory-limits.ts` — keep the existing doc and `MAX_ADVISORY_SECTIONS = 3`, then append:

```ts
import type { AdvisoryMode } from "@prisma/client";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * How many advisory sections this teacher may hold. The one rule the
 * transaction, the wizard and the School Head's picker all read, so the three
 * cannot disagree. A missing mode reads as DEFAULT (a profile predating the
 * column, or a read that failed).
 */
export function advisoryCapFor(
  designation: string | null | undefined,
  mode: AdvisoryMode | null | undefined
): number {
  if (designation === ARAL_VOLUNTEER_DESIGNATION) return 0;
  if (mode === "FLOATING") return 0;
  if (mode === "MULTI_GRADE") return MAX_ADVISORY_SECTIONS;
  return 1;
}

/** Why the picker stops at `advisoryCapFor`, in words a School Head can act on. */
export function advisoryCapReason(
  designation: string | null | undefined,
  mode: AdvisoryMode | null | undefined
): string {
  if (designation === ARAL_VOLUNTEER_DESIGNATION) {
    return "Non-DepEd ARAL Volunteers don't advise a section.";
  }
  if (mode === "FLOATING") return "Floating teachers don't advise a section.";
  if (mode === "MULTI_GRADE") {
    return `Multi-grade teachers advise up to ${MAX_ADVISORY_SECTIONS} sections.`;
  }
  return "This teacher advises one section. Set them to Multi-grade to add more.";
}
```

Place the two imports at the top of the file (the file currently has none). `import type` keeps it client-safe.

`src/lib/teachers/scope.ts` — replace `deniesAdvisoryRoster` with:

```ts
export type AdvisoryRosterDenial = "volunteer" | "floating" | null;

/**
 * Why the class-bound surfaces (`/teacher/learners`, the End of Terms Reports
 * sheet, their sidebar rows) are closed to this user, or null when they are not.
 * A Non-DepEd ARAL Volunteer never advises; a DepEd teacher set to FLOATING has
 * declared they will not. Two facts, two sets of words, one gate. Fails open on
 * a missing mode, and never closes for a Super Admin impersonating the shell.
 */
export function advisoryRosterDenial(args: {
  isSuperAdmin: boolean;
  designation: string | null | undefined;
  advisoryMode?: AdvisoryMode | null;
}): AdvisoryRosterDenial {
  if (args.isSuperAdmin) return null;
  if (isAralVolunteerDesignation(args.designation)) return "volunteer";
  if (args.advisoryMode === "FLOATING") return "floating";
  return null;
}

/** Boolean form of {@link advisoryRosterDenial}; kept for existing callers. */
export function deniesAdvisoryRoster(args: {
  isSuperAdmin: boolean;
  designation: string | null | undefined;
  advisoryMode?: AdvisoryMode | null;
}): boolean {
  return advisoryRosterDenial(args) !== null;
}
```

Change scope.ts's `import type { Prisma }` to `import type { AdvisoryMode, Prisma }`. Keep the existing JSDoc above the function, adding one line that FLOATING now closes it too.

`src/lib/teachers/floating-copy.ts` — append:

```ts
/**
 * What a DepEd teacher SET to Floating sees where a class roster or the end-of-
 * term sheet would be. Distinct from FLOATING_TEACHER_CARD, which is for a
 * default teacher whose School Head has not assigned a section yet: this one
 * was a choice, so "ask for a section" would be the wrong advice.
 */
export const DECLARED_FLOATING_CARD = {
  icon: Sparkles,
  title: "You're a floating teacher",
  description:
    "Floating teachers don't advise a section, so there is no class roster or end-of-term sheet here. Your School Head can change this. Learners you tutor for ARAL are in the ARAL Program.",
  actionHref: "/teacher/aral",
  actionLabel: "Go to ARAL Program",
} as const;

/** The chip for a teacher holding no section who has NOT been set to Floating. */
export const UNASSIGNED_CHIP_LABEL = "Unassigned";
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/teachers/advisory-cap.test.ts tests/unit/teachers-scope.test.ts && npm run typecheck`
Expected: PASS, including every pre-existing `deniesAdvisoryRoster` case unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teachers/advisory-limits.ts src/lib/teachers/scope.ts src/lib/teachers/floating-copy.ts tests/unit/teachers/advisory-cap.test.ts tests/unit/teachers-scope.test.ts
git commit -m "feat: one rule says how many sections a teacher may advise" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The profile schema knows the mode

**Files:**
- Modify: `src/lib/validators/profile.schema.ts:346-418` (`teacherProfileSchema`)
- Modify: `tests/unit/validators/profile.schema.test.ts` (append; update only cases naming `noAdvisorySection`)

**Interfaces:**
- Consumes: `AdvisoryMode` values (Task 1).
- Produces: `teacherProfileSchema` fields `advisoryMode: "DEFAULT" | "FLOATING" | "MULTI_GRADE"` (default `"DEFAULT"`) and `additionalSectionIds: string[]` (uuid, max 2, default `[]`). `noAdvisorySection` is **removed**.

Rules (replace the tail of the `superRefine` from `if (data.designation === ARAL_VOLUNTEER_DESIGNATION) return;` onward):

| Designation / mode | `sectionId` | `additionalSectionIds` | `currentGradeAssignment` |
|---|---|---|---|
| Volunteer (any mode) | must be undefined → issue `"Non-DepEd ARAL Volunteers don't advise a section"` on `sectionId` | must be empty | allowed, optional |
| FLOATING | must be undefined → `"Floating teachers don't advise a section. Clear it, or untick Floating teacher"` | must be empty | optional |
| DEFAULT | required (`"Select a section"`) | must be empty → `"Tick Multi-grade advisory to add more than one section"` | required (`"Select a grade level"`) |
| MULTI_GRADE | required | 0–2 items, no duplicates, none equal to `sectionId` → `"Pick each section only once"` | required |

- [ ] **Step 1: Failing tests** — append to `profile.schema.test.ts` (uses existing `teacherBase`, `aralVolunteerBase`, `SECTION_ID`):

```ts
describe("teacherProfileSchema — advisory mode", () => {
  const S2 = "22222222-2222-4222-8222-222222222222";
  const S3 = "33333333-3333-4333-8333-333333333333";
  const S4 = "44444444-4444-4444-8444-444444444444";
  const firstError = (r: ReturnType<typeof teacherProfileSchema.safeParse>) =>
    r.success ? null : r.error.errors[0];

  it("defaults to DEFAULT with no additional sections", () => {
    const r = teacherProfileSchema.safeParse(teacherBase);
    expect(r.success && r.data.advisoryMode).toBe("DEFAULT");
    expect(r.success && r.data.additionalSectionIds).toEqual([]);
  });

  it("refuses a second section for a DEFAULT teacher", () => {
    const r = teacherProfileSchema.safeParse({ ...teacherBase, additionalSectionIds: [S2] });
    expect(firstError(r)?.message).toMatch(/Multi-grade/);
  });

  it("allows up to three sections in all for MULTI_GRADE", () => {
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, advisoryMode: "MULTI_GRADE", additionalSectionIds: [S2, S3] }).success
    ).toBe(true);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, advisoryMode: "MULTI_GRADE", additionalSectionIds: [S2, S3, S4] }).success
    ).toBe(false);
  });

  it("refuses the same section twice", () => {
    const r = teacherProfileSchema.safeParse({
      ...teacherBase, advisoryMode: "MULTI_GRADE", additionalSectionIds: [SECTION_ID],
    });
    expect(firstError(r)?.message).toMatch(/only once/);
  });

  it("requires a first section for MULTI_GRADE", () => {
    const { sectionId: _s, ...noSection } = teacherBase;
    expect(teacherProfileSchema.safeParse({ ...noSection, advisoryMode: "MULTI_GRADE" }).success).toBe(false);
  });

  it("lets FLOATING finish with no section and refuses one that names a section", () => {
    const { sectionId: _s, currentGradeAssignment: _g, ...bare } = teacherBase;
    expect(teacherProfileSchema.safeParse({ ...bare, advisoryMode: "FLOATING" }).success).toBe(true);
    const r = teacherProfileSchema.safeParse({ ...teacherBase, advisoryMode: "FLOATING" });
    expect(firstError(r)?.message).toMatch(/Floating teachers don't advise/);
  });

  it("refuses a section for a volunteer — the bug that held 25 sections", () => {
    const r = teacherProfileSchema.safeParse({ ...aralVolunteerBase, sectionId: SECTION_ID });
    expect(firstError(r)?.message).toMatch(/Volunteers don't advise/);
  });

  it("lets Others behave like Teacher", () => {
    const { position: _p, ...others } = teacherBase;
    expect(
      teacherProfileSchema.safeParse({ ...others, designation: "ARAL Coordinator", advisoryMode: "MULTI_GRADE", additionalSectionIds: [S2] }).success
    ).toBe(true);
  });
});
```

Also: any existing case that sends `noAdvisorySection: true` must be rewritten to `advisoryMode: "FLOATING"` with the same expectation. Do not change any other existing case. If an existing volunteer fixture carries a `sectionId`, remove it from the fixture and say so in the report.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/validators/profile.schema.test.ts` → new cases FAIL.

- [ ] **Step 3: Implement** — in `teacherProfileSchema.extend({...})` replace the `noAdvisorySection` field and its doc with:

```ts
    /**
     * DEFAULT = one section · FLOATING = none · MULTI_GRADE = one to three.
     * Only read on a teacher's FIRST save; afterwards the School Head owns it
     * (see `saveTeacherProfile`). Ignored for the volunteer designation.
     */
    advisoryMode: z.enum(["DEFAULT", "FLOATING", "MULTI_GRADE"]).default("DEFAULT"),
    /** Multi-grade's second and third sections. `sectionId` stays the first. */
    additionalSectionIds: z
      .array(z.string().uuid("Invalid section"))
      .max(2, "A multi-grade teacher advises at most 3 sections")
      .default([]),
```

and implement the table above in the `superRefine`. Issue paths: `["sectionId"]`, `["additionalSectionIds"]`, `["currentGradeAssignment"]`.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/validators/profile.schema.test.ts && npm run typecheck`. Typecheck will fail in `teacher.ts` and `teacher-profile-form.tsx` where `noAdvisorySection` is read; **that is expected and fixed in Tasks 4 and 7** — report it, do not fix those files here. Run instead: `npx tsc --noEmit 2>&1 | grep -v "teacher.ts\|teacher-profile-form.tsx" | grep "error TS" ; echo "(no other errors expected)"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators/profile.schema.ts tests/unit/validators/profile.schema.test.ts
git commit -m "feat: the profile says how a teacher advises, and a volunteer cannot hold a section" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The transaction reads the cap, and profiling decides once

**Files:**
- Modify: `src/lib/teachers/section-assignment.ts` (`setTeacherAdvisory`, `AdvisoryCapError`)
- Modify: `src/lib/actions/teacher.ts` (`saveTeacherProfile`)
- Modify: `tests/unit/actions/teacher-profile-save.test.ts`, `tests/unit/actions/teacher-set-advisory-section.test.ts`, `tests/unit/floating-teacher.test.ts` (only where they name `noAdvisorySection` or assume a global cap of 3)

**Interfaces:**
- Consumes: `advisoryCapFor`, `advisoryCapReason` (Task 2); schema fields `advisoryMode`, `additionalSectionIds` (Task 3).
- Produces: `setTeacherAdvisory(tx, params)` — same signature; the cap is now read from the teacher's `TeacherProfile` inside `tx`. `AdvisoryCapError` gains a `reason: string` and its message is `advisoryCapReason(...)` followed by the held section names.

- [ ] **Step 1: Failing tests**

In `teacher-set-advisory-section.test.ts` (follow the file's existing prisma mock), add:
- DEFAULT teacher holding one section, add a second → `{ ok: false, error: /one section/ }`, no write.
- MULTI_GRADE teacher holding two, add a third → `{ ok: true }`; holding three, add a fourth → `{ ok: false, error: /up to 3/ }`.
- FLOATING teacher, add any → `{ ok: false, error: /Floating teachers/ }`.
- Volunteer, add any → `{ ok: false, error: /Volunteers/ }`.

In `teacher-profile-save.test.ts`, add:
- **First save** (no existing TeacherProfile row) with `advisoryMode: "MULTI_GRADE"`, `sectionId: S1`, `additionalSectionIds: [S2]` → upsert writes `advisoryMode: "MULTI_GRADE"`; `setTeacherAdvisory` called with `{op:"add",sectionId:S1}` then `{op:"add",sectionId:S2}`.
- **First save** FLOATING → upsert writes `advisoryMode: "FLOATING"`; advisory cleared (`op: "clear"`).
- **Later save** (existing row with `designation: "Teacher"`, `advisoryMode: "DEFAULT"`) submitting `designation: "Master Teacher"`, `advisoryMode: "MULTI_GRADE"`, different sections → upsert writes the **stored** designation and mode, and `setTeacherAdvisory` is **not** called.

Rewrite any existing `noAdvisorySection` case as `advisoryMode: "FLOATING"` on a first save with the same expectation.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/actions/teacher-profile-save.test.ts tests/unit/actions/teacher-set-advisory-section.test.ts tests/unit/floating-teacher.test.ts`

- [ ] **Step 3: Implement `setTeacherAdvisory`**

At the top of the `op: "add"` branch, before the length check, read the profile in the same transaction and use its cap:

```ts
    const profile = await tx.teacherProfile.findFirst({
      where: { userId: teacherId, user: { schoolId } },
      select: { designation: true, advisoryMode: true },
    });
    const cap = advisoryCapFor(profile?.designation, profile?.advisoryMode);
    if (!current.some((s) => s.id === change.sectionId)) {
      if (current.length >= cap) {
        throw new AdvisoryCapError(
          current.map((s) => s.name),
          advisoryCapReason(profile?.designation, profile?.advisoryMode)
        );
      }
      // … existing loadValidSections / updateMany / SectionTakenError unchanged
```

`AdvisoryCapError`:

```ts
export class AdvisoryCapError extends Error {
  constructor(public readonly held: string[], public readonly reason: string) {
    super(held.length > 0 ? `${reason} They advise ${held.join(", ")}.` : reason);
    this.name = "AdvisoryCapError";
  }
}
```

Delete `advisoryCapError()` if nothing else imports it (`grep -rn advisoryCapError src tests`); otherwise leave it. Replace the `MAX_ADVISORY_SECTIONS` import with `import { advisoryCapFor, advisoryCapReason, MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";` and keep the re-export.

A teacher with no profile row (mid-onboarding) reads as DEFAULT → cap 1, which matches the old behaviour for a School Head assigning their first section.

- [ ] **Step 4: Implement `saveTeacherProfile`**

- Remove the `raw.noAdvisorySection` coercion block and the `noAdvisorySection` destructure.
- Destructure `advisoryMode`, `additionalSectionIds` out of `parsed.data` so they don't spread into `profileFields`.
- Before the transaction:

```ts
  // Teacher once, then School Head only. The first save records what the
  // teacher declared; every later save keeps what is stored, so Settings cannot
  // be used to become multi-grade and take two more sections, or to drop a
  // classroom by ticking Floating. `setTeacherAdvisorySetting` is the only
  // route for changes after this.
  const existing = await prisma.teacherProfile.findFirst({
    where: { userId: user.id, user: { schoolId: user.schoolId } },
    select: { designation: true, advisoryMode: true },
  });
  const isFirstSave = existing === null;
```

- In `profileData`: `designation: isFirstSave ? parsed.data.designation : existing.designation, advisoryMode: isFirstSave ? advisoryMode : existing.advisoryMode`. (If `existing.designation` is null, keep the submitted one.)
- In the transaction, replace the single `setTeacherAdvisory` call with:

```ts
      if (isFirstSave) {
        const volunteer = parsed.data.designation === ARAL_VOLUNTEER_DESIGNATION;
        const wanted =
          volunteer || advisoryMode === "FLOATING" || !sectionId
            ? []
            : [sectionId, ...(advisoryMode === "MULTI_GRADE" ? additionalSectionIds : [])];
        if (wanted.length === 0) {
          await setTeacherAdvisory(tx, { teacherId: user.id, schoolId: user.schoolId, change: { op: "clear" } });
        }
        for (const id of wanted) {
          await setTeacherAdvisory(tx, { teacherId: user.id, schoolId: user.schoolId, change: { op: "add", sectionId: id } });
        }
      }
```

Import `ARAL_VOLUNTEER_DESIGNATION` from profile.schema. Map `AdvisoryCapError` in the catch to `{ ok: false, error: err.message }`. Add `advisoryMode` and `additionalSectionIds` to the audit metadata. Keep all revalidation calls.

- [ ] **Step 5: Verify** — the three test files above, `npx vitest run tests/unit/actions/`, and `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v teacher-profile-form.tsx` (the wizard is Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/teachers/section-assignment.ts src/lib/actions/teacher.ts tests/unit/actions tests/unit/floating-teacher.test.ts
git commit -m "feat: a teacher declares their advisory load once, and the cap follows it" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The School Head changes designation and setting

**Files:**
- Modify: `src/lib/audit.ts` (add `TEACHER_ADVISORY_SETTING_CHANGE`)
- Modify: `src/lib/actions/teacher.ts` (add `setTeacherAdvisorySetting`)
- Create: `tests/unit/actions/teacher-advisory-setting.test.ts`

**Interfaces:**
- Consumes: `advisoryCapFor`, `setTeacherAdvisory`.
- Produces:

```ts
export type AdvisorySettingResult =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; error: "confirm_release"; releases: { id: string; label: string }[] };
export async function setTeacherAdvisorySetting(formData: FormData): Promise<AdvisorySettingResult>
// formData: teacherId (uuid), designationKind ("Teacher" | "Master Teacher" |
//   "Non-DepEd ARAL Volunteer" | "__OTHER__"), designationOther (string, required
//   when __OTHER__, max 100), advisoryMode ("DEFAULT"|"FLOATING"|"MULTI_GRADE"),
//   confirmRelease ("true" | absent)
```

Behaviour:
1. `requireSchoolUser("SCHOOL_HEAD")`; Zod; resolve `designation` (`__OTHER__` → trimmed `designationOther`).
2. Load the teacher: `prisma.user.findFirst({ where: { id, schoolId: user.schoolId, role: "TEACHER", deletedAt: null }, select: { id, fullName, teacherProfile: { select: { designation, advisoryMode } }, advisorySections: { where: { deletedAt: null }, select: { id, name, gradeLevel: { select: { type } } }, orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }] } } })`. Missing teacher → `{ ok: false, error: "Teacher not found" }`. No `teacherProfile` → `{ ok: false, error: "This teacher hasn't finished profiling yet." }`.
3. `cap = advisoryCapFor(designation, advisoryMode)`; `excess = held.slice(cap)` (keeps the first in grade/name order).
4. If `excess.length > 0` and `confirmRelease !== "true"` → `{ ok: false, error: "confirm_release", releases: excess.map(s => ({ id: s.id, label: \`${GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type} · ${s.name}\` })) }`. No write.
5. Nothing changed (same designation, same mode) → `{ ok: true }`, no audit row.
6. `$transaction`: `tx.teacherProfile.update({ where: { userId: teacher.id }, data: { designation, advisoryMode } })`; for each excess, `setTeacherAdvisory(tx, { teacherId, schoolId: user.schoolId, change: { op: "remove", sectionId } })`.
7. `writeAudit({ action: AUDIT_ACTIONS.TEACHER_ADVISORY_SETTING_CHANGE, resource: "TeacherProfile", resourceId: teacher.id, metadata: { schoolId, teacherId, previousDesignation, designation, previousMode, advisoryMode, releasedSectionIds } })`.
8. Revalidate exactly as `setTeacherAdvisorySection` does (teachers, grade levels, `/teacher/settings/profile`, `revalidateTeacherCaches(teacher.id)`, `revalidateSchoolDashboard`).

- [ ] **Step 1: Failing tests** — mock prisma the way `teacher-set-advisory-section.test.ts` does. Cases:
  - MULTI_GRADE holding 3 → DEFAULT without confirm: returns `confirm_release` with the 2nd and 3rd labels; `teacherProfile.update` not called.
  - Same with `confirmRelease: "true"`: `update` called with `{ designation: "Teacher", advisoryMode: "DEFAULT" }`; `setTeacherAdvisory` called twice with `op: "remove"`; audit row carries `releasedSectionIds` of length 2.
  - DEFAULT holding 1 → FLOATING without confirm → `confirm_release` naming it.
  - Teacher → Volunteer holding 0 → `{ ok: true }` with no release.
  - `__OTHER__` with `designationOther: "ARAL Coordinator"` persists that string; `__OTHER__` with empty text → `{ ok: false }`.
  - Teacher in another school (`findFirst` returns null) → `"Teacher not found"`.
  - No profile → the "hasn't finished profiling" message.
  - Unchanged setting → `{ ok: true }`, no audit.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** as above; add `TEACHER_ADVISORY_SETTING_CHANGE: "TEACHER_ADVISORY_SETTING_CHANGE",` beside `TEACHER_SET_ADVISORY_SECTION` in `src/lib/audit.ts`.
- [ ] **Step 4: Verify** — the new test file plus `npx vitest run tests/unit/actions/teacher-set-advisory-section.test.ts`.
- [ ] **Step 5: Commit** — `feat: a school head can set a teacher's designation and advisory load`.

---

### Task 6: Sidebar and pages close for a floating teacher

**Files:**
- Modify: `src/lib/dashboard/aggregates.ts` (teacher shell context: select `advisoryMode`, return it, bump key `teacher-shell-context-v5` → `-v6`)
- Modify: `src/lib/nav/nav-config.ts` (`NavOptions.isFloating`, pill)
- Modify: `src/app/teacher/(app)/layout.tsx`, `src/components/role-shell.tsx`, `src/components/app-sidebar.tsx`, `src/components/shell/app-header.tsx` (thread `isFloating` exactly as `isAralVolunteer` is threaded; the header search hides for either)
- Modify: `src/app/teacher/(app)/learners/page.tsx`, `src/app/teacher/(app)/terms-reports/page.tsx`, `src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx`, `src/lib/actions/term-grades.ts` (use `advisoryRosterDenial`; pass `advisoryMode`)
- Modify: `tests/unit/nav/nav-config.test.ts`, `tests/components/app-sidebar.test.tsx`, `tests/components/app-header.test.tsx` (append)

**Interfaces:**
- Consumes: `advisoryRosterDenial`, `DECLARED_FLOATING_CARD`.
- Produces: shell context `{ grades, designation, advisoryMode: AdvisoryMode | null, advisoryGradeLevelId }`; `NavOptions.isFloating?: boolean`.

In `nav-config.ts`, replace the two volunteer spreads with one shared lock:

```ts
      const classLock = options.isAralVolunteer
        ? { pill: "DepEd only", reason: "for DepEd teachers who advise a section" }
        : options.isFloating
          ? { pill: "Floating teacher", reason: "for teachers who advise a section" }
          : null;
```

and use `...(classLock ? { unavailable: classLock } : {})` on both the Learners and End of Terms Reports items. Volunteer wins if both are set.

In `layout.tsx`, after the volunteer branch: `else if (shell.advisoryMode === "FLOATING") { isFloating = true; }` — do not change `roleLabel` for floating.

In each page, replace `if (deniesAdvisoryRoster({ isSuperAdmin, designation }))` with:

```ts
  const denial = advisoryRosterDenial({ isSuperAdmin, designation, advisoryMode });
  if (denial === "floating") { /* render the page's existing shell with <EmptyState {...DECLARED_FLOATING_CARD} /> */ }
  if (denial === "volunteer") { /* existing volunteer branch, unchanged */ }
```

In `term-grades.ts:78`, add `advisoryMode: true` to the profile select and pass it to `deniesAdvisoryRoster`.

- [ ] **Step 1: Failing tests** — append to `nav-config.test.ts`:

```ts
describe("getNavGroups — floating teacher", () => {
  const floating = () => getNavGroups("TEACHER", oneAral, { isFloating: true });
  it("closes Learners and End of Terms Reports with the Floating teacher pill", () => {
    const items = flattenNavGroups(floating());
    for (const id of ["teacher-learners", "teacher-terms-reports"]) {
      expect(items.find((i) => i.id === id)?.unavailable).toEqual({
        pill: "Floating teacher",
        reason: "for teachers who advise a section",
      });
    }
  });
  it("keeps the ARAL rows open", () => {
    const items = flattenNavGroups(floating());
    expect(items.filter((i) => i.id.startsWith("teacher-aral-")).every((i) => !i.unavailable)).toBe(true);
  });
  it("lets the volunteer pill win when both are set", () => {
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral, { isFloating: true, isAralVolunteer: true }));
    expect(items.find((i) => i.id === "teacher-learners")?.unavailable?.pill).toBe("DepEd only");
  });
});
```

In the sidebar and header component tests, add one case each mirroring their existing volunteer case with `isFloating` (sidebar: pill text "Floating teacher" rendered; header: roster search hidden).

- [ ] **Step 2–4:** run to fail, implement, run `npx vitest run tests/unit/nav tests/components/app-sidebar.test.tsx tests/components/app-header.test.tsx tests/unit/actions/term-grades-save.test.ts tests/unit/actions/term-grades-export.test.ts && npm run typecheck`.
- [ ] **Step 5: Commit** — `feat: a floating teacher's class menus close, and say why`.

---

### Task 7: Sign-up and the profiling wizard

**Files:**
- Modify: `src/components/forms/login-form.tsx` (remove the checkbox at ~L605-625, the `isAralVolunteer` state L95, its reset L127 and `formData.set("isAralVolunteer", …)` L148)
- Modify: `src/components/forms/teacher-profile-form.tsx`
- Create: `tests/components/teacher-profile-advisory.test.tsx`

**Interfaces:**
- Consumes: schema fields `advisoryMode`, `additionalSectionIds` (Task 3); `advisoryCapFor`.
- Produces: nothing downstream.

Wizard changes:
1. **No more volunteer lock.** Replace `const volunteerWizard = !isEdit && registeredAsAralVolunteer;` with `const prefillVolunteer = !isEdit && registeredAsAralVolunteer;`. Use `prefillVolunteer` only for the existing default values (designationKind, `fieldOfSpecialization ?? "NA"`, `yearsInServiceApplicable`). Every other use goes: step list is always `visibleTeacherSteps(false)`; `visiblePositionOf(x, false)`; `nextTeacherStep(s, false)`; `previousTeacherStep(s, false)`; `isLastTeacherStep(step, false)`; the step-2 validation in the save path always runs; the locked-designation block (L1007-1026) is deleted so the pills always render; the Review "Teaching Assignment" block always renders.
2. **Client form schema:** replace `hasAdvisorySection: z.boolean()` with `advisoryMode: z.enum(["DEFAULT","FLOATING","MULTI_GRADE"])` and `additionalSectionIds: z.array(z.string())`. Defaults: `advisoryMode: defaultValues.advisoryMode ?? "DEFAULT"`, `additionalSectionIds: []`. Add `advisoryMode?: "DEFAULT" | "FLOATING" | "MULTI_GRADE"` to `Defaults` and pass it from the page (`src/app/teacher/(onboarding)/profiling/page.tsx` and the settings profile page) from `TeacherProfile.advisoryMode`.
3. **Payload:** send `advisoryMode`, `additionalSectionIds` (only when MULTI_GRADE), `sectionId`/`currentGradeAssignment` only when not volunteer and not FLOATING. Remove `noAdvisorySection`.
4. **Teaching Assignment card**, replacing the `FormYesNoPills` block and its two notes:
   - Volunteer: render the card's content as a single muted paragraph, `aria-disabled`: "Non-DepEd ARAL Volunteers don't take a teaching assignment. Your School Head assigns the learners you tutor for ARAL." No pickers.
   - Otherwise two shadcn `Checkbox`es with `Label`s, `Floating teacher` and `Multi-grade advisory`, each with a one-line description ("You're a DepEd teacher who won't handle a class roster or end-of-term reports." / "You advise up to 3 sections, in any grades."). Checking one sets `advisoryMode` to it; unchecking sets `DEFAULT`; so at most one is ever checked.
   - FLOATING: hide the pickers; show the note "You won't have a class roster or end-of-term reports. ARAL stays open."
   - DEFAULT: the existing grade + section pickers, required.
   - MULTI_GRADE: the existing pickers for the first section, then one grade + section row per entry in `additionalSectionIds`, and an `Add another section` button (hidden at 2 extra = 3 total). Each extra row has a Remove button. Sections already chosen in another row are disabled in each picker.
   - Switching mode clears what the new mode cannot hold (FLOATING clears grade/section/extras; DEFAULT clears extras).
5. **Edit mode** (`isEdit`): the Designation pills and the whole Teaching Assignment card render read-only (text of the stored values) with "Ask your School Head to change this." Nothing from them is submitted differently — the server ignores them anyway (Task 4).

- [ ] **Step 1: Failing component tests** (`tests/components/teacher-profile-advisory.test.tsx`, render the form in create mode with a grade that has 3 free sections, following the setup in `tests/unit/actions/teacher-profile-save.test.ts` for mocks of `next/navigation`, `sonner`, and the save action):
  - Checking `Floating teacher` then `Multi-grade advisory` leaves only Multi-grade checked.
  - With Multi-grade checked, `Add another section` appears; after two clicks it is gone (3 rows total).
  - Choosing designation `Non-DepEd ARAL Volunteer` removes the section pickers and shows the "don't take a teaching assignment" text.
  - In edit mode, the checkboxes are not rendered and "Ask your School Head" is.
  - Sign-up: render the create-account tab of `LoginForm` and assert `queryByLabelText(/Non-DepEd ARAL Volunteer/)` is null.
- [ ] **Step 2–4:** fail, implement, then `npx vitest run tests/components/teacher-profile-advisory.test.tsx tests/components/login-form-district.test.tsx tests/unit/teachers/profiling-steps.test.ts && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `feat: profiling asks once whether a teacher floats or advises several sections`.

---

### Task 8: The School Head's teachers table

**Files:**
- Modify: `src/lib/teachers/roster.ts` (`managedTeacherSelect` adds `teacherProfile: { select: { designation: true, advisoryMode: true } }`; `toManagedRow` adds `designation` and `advisoryMode`)
- Modify: `src/components/teachers-active-table.tsx` (`ActiveTeacherRow` gains `designation: string | null; advisoryMode: "DEFAULT" | "FLOATING" | "MULTI_GRADE" | null`; chip; cap; role dialog trigger)
- Create: `src/components/school-head/teacher-role-dialog.tsx`
- Modify: `tests/unit/teachers-roster.test.ts`; Create: `tests/components/teacher-role-dialog.test.tsx`

**Interfaces:**
- Consumes: `setTeacherAdvisorySetting`, `AdvisorySettingResult` (Task 5); `advisoryCapFor`, `advisoryCapReason`, `UNASSIGNED_CHIP_LABEL`, `FLOATING_CHIP_LABEL`, `ADVISORY_MODE_LABELS`.

Changes:
- **Chip** for zero sections: `row.advisoryMode === "FLOATING" ? FLOATING_CHIP_LABEL : UNASSIGNED_CHIP_LABEL`. The success toast that says "is now floating" (L434) says "is now unassigned" unless the mode is FLOATING.
- **Picker cap:** `const cap = advisoryCapFor(row.designation, row.advisoryMode); const atCap = held.length >= cap;`. When `cap === 0` render no picker, only the reason. At cap, the disabled option/label shows `advisoryCapReason(row.designation, row.advisoryMode)`.
- **Role dialog** (`TeacherRoleDialog`, props `{ row: ActiveTeacherRow; onSaved: () => void }`): a small "Edit role" ghost button in the row opens a shadcn `Dialog` with a designation select (Teacher / Master Teacher / Non-DepEd ARAL Volunteer / Others + text input when Others, prefilled from `row.designation` — a value that is none of the three literals prefills Others with that text), and an advisory setting radio group (`ADVISORY_MODE_LABELS`, hidden when Volunteer). Save calls `setTeacherAdvisorySetting`. On `error === "confirm_release"` the dialog switches to a confirm view: "This unassigns:" + list of `releases[].label` + "Their learners stay in the section and will need a new adviser." with buttons `Cancel` and `Unassign and save` (resubmits with `confirmRelease=true`). On `ok` → toast + `onSaved()` + `router.refresh()`.
- A row with `designation === null` (no profile) shows "Hasn't finished profiling" instead of the button.

- [ ] **Step 1: Failing tests**
  - `teachers-roster.test.ts`: `toManagedRow` maps `teacherProfile.designation`/`advisoryMode`, and `null` when `teacherProfile` is null.
  - `teacher-role-dialog.test.tsx` (mock the action): Save with a `confirm_release` result shows both labels and `Unassign and save`; clicking it calls the action again with `confirmRelease` = `"true"`; choosing Volunteer hides the advisory setting radios; a row with designation `ARAL Coordinator` opens with Others selected and that text.
- [ ] **Step 2–4:** fail, implement, `npx vitest run tests/unit/teachers-roster.test.ts tests/components/teacher-role-dialog.test.tsx && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `feat: a school head sets each teacher's role from the teachers page`.

---

### Task 9: Sections with learners and no adviser

**Files:**
- Create: `src/lib/teachers/adviserless.ts`
- Create: `src/components/school-head/adviserless-sections-notice.tsx`
- Modify: `src/app/school-head/(app)/page.tsx`, `src/app/school-head/(app)/teachers/page.tsx` (render the notice at the top of the content)
- Create: `tests/unit/teachers/adviserless.test.ts`

**Interfaces:**
- Produces:

```ts
export type AdviserlessSection = { id: string; gradeLabel: string; sectionName: string; learnerCount: number };
export async function getAdviserlessSections(schoolId: string): Promise<AdviserlessSection[]>
```

Implementation (`server-only`, wrapped in `cachedQuery` with key `["adviserless-sections-v1", schoolId]` and tag `schoolDashboard(schoolId)`, which every advisory mutation already busts through `revalidateSchoolDashboard`):

```ts
const rows = await prisma.section.findMany({
  where: {
    schoolId,
    deletedAt: null,
    adviserId: null,
    learners: { some: { deletedAt: null } },
  },
  select: {
    id: true,
    name: true,
    gradeLevel: { select: { type: true } },
    _count: { select: { learners: { where: { deletedAt: null } } } },
  },
  orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
});
return rows.map((s) => ({
  id: s.id,
  gradeLabel: GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type,
  sectionName: s.name,
  learnerCount: s._count.learners,
}));
```

(Confirm the `Section → Learner` relation field name in `prisma/schema.prisma` and use it; the column is `Learner.sectionId`.)

Notice: renders nothing for an empty list. Otherwise an amber bordered block (match the existing amber notice in `teacher-profile-form.tsx` L1167) with heading `N section(s) have learners but no adviser`, a list `Grade 3 · Atis — 12 learners`, and a link `Assign advisers` to `SCHOOL_HEAD_ROUTES.teachers` (omit the link on the teachers page itself). Super Admin viewing via `?schoolId=` uses the resolved school id, as the page already does.

- [ ] **Step 1: Failing test** — mock prisma + `cachedQuery` (pass-through); assert the `where` includes `schoolId`, `deletedAt: null`, `adviserId: null` and the live-learner `some`; assert the mapping and ordering.
- [ ] **Step 2–4:** fail, implement, `npx vitest run tests/unit/teachers/adviserless.test.ts && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `feat: a school head is told which sections have learners but no adviser`.

---

### Task 10: Ops checklist and the full gate

**Files:**
- Modify: `docs/migrate-checklist.md` (add the migration to the list and a section `(j) Teacher advisory modes — Sep 2026`)

Section content: what it does (three statements, expected 9 and 25), that it is additive plus two bounded data statements, **apply before the code deploys** (P2022 otherwise), the read-only pre-check query to confirm the counts, and that it is not reversible for statement 3 without the backup (the released section ids are logged in the migration's own output only — take the step-(a) backup first).

- [ ] **Step 1:** write the section.
- [ ] **Step 2:** full gate — `npx prisma generate && npm run typecheck && npm run lint && npm run test && npm run build` (build needs a `.env.local`; copy `.env.example` into the worktree for the build only and delete it after). Report exact counts. Known pre-existing failure: `tests/unit/shadcn-coverage.test.ts` (fails on main before this branch). Known flake under load: the three export/report tests — re-run them alone before calling them failures.
- [ ] **Step 3: Commit** — `docs: how to apply the advisory mode migration, and when`.
