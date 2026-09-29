# MOSY Report page (teacher, ARAL tutor scope) — design

Status: proposed · Date: 2026-09-29 · Target release: v2.17.0

Binding context: `CLAUDE.md` (tenancy, `action()` wrapper, audit, cache helpers,
enum labels, additive migrations, release rule), `src/lib/teachers/scope.ts`
(tutor scope vs. access scope), `src/lib/reading/policy.ts` (grade-appropriate
reading values), `src/lib/actions/learner.ts#toggleAralLearner` (the existing
ARAL untag path). The working tree carries in-flight v2.16.0 work (dirty
`prisma/schema.prisma`, `src/lib/releases.ts`, `package.json`, untracked
migration `20260926000001_notification_created_at_index`). This design adds on
top of that work and reverts none of it.

---

## 1. The problem

At the middle of the school year (MOSY), every ARAL tutor re-assesses each ARAL
learner they tutor and decides whether the learner **moves out of ARAL**
(improved to grade-appropriate reading, or is an LSEN case) or **stays**.
LITRACK has nowhere to record that decision. Today the only way out of ARAL is
the generic ARAL toggle. It records no level and no reason, and it clears the
tutor link, so the tutor loses sight of the learner.

The tutor needs one page, covering every grade they tutor, that:

- shows each learner's latest monthly reading level,
- takes one MOSY reading level per learner,
- asks "Move out from ARAL?" when that level changes, and requires a reason for moving out,
- keeps moved-out learners visible to that tutor for the rest of the school year,
- and never untags a learner unless the tutor explicitly confirms Move out.

## 2. The shape

### 2.1 Decisions taken (and why)

| Question | Decision | Why |
|---|---|---|
| Where is the MOSY level stored? | On the decision row (`AralMosyDecision.mosyLevel`), one `ReadingProfile` value. | Operator decision. `ReadingLevelRecord` (monthly, bilingual) stays untouched. |
| Previous level column? | **Include it.** Show the latest `ReadingLevelRecord` in the active school year for each row on the current page: `Fil: <band>`, plus `Eng: <band>` when the grade reads English, plus the record's month. | Costs one nested `take: 1` per row on a page of at most `LEARNER_PAGE_SIZE` rows, served by the existing `@@unique([learnerId, weekStart])` index. Needs no new query shape. Showing both languages avoids silently picking one (Open question 2). |
| Does Move out clear `aralTeacherId`? | **Yes**, the same as `toggleAralLearner`. | `toggleAralLearner` and `setAralTeacher` both hold the rule that `aralTeacherId` never grants access to a non-ARAL learner. `teacherLearnerScope` grants roster, export, search and dashboard access through `aralTeacherId`, so keeping it on an untagged learner would widen access at 19 call sites. |
| How does a moved-out learner stay on the tutor's page? | The decision row stores `tutorId` (who decided). Page scope is *tagged and I am the designated tutor* **OR** *untagged and I recorded a MOVE_OUT this school year*. | `aralTeacherId` keeps its meaning. The extra visibility applies only to the MOSY page and only to the active year. |
| Re-tag on Move out → Stay | Set `isAralLearner = true`, `aralTeacherId = actor` (by scope, the actor is the recorded tutor), and `aralEnrolledAt = priorAralEnrolledAt ?? now`. | An accidental Move out becomes a true undo, including the "ARAL since" date shown in `aral-panel.tsx`. |
| Reuse `toggleAralLearner`? | **No.** Repeat its three field writes inside the MOSY transaction. | It is a legacy hand-rolled action (not wrapped in `action()`), its wide `teacherCanAccessLearner` guard lets advisers through, and its write would run outside our transaction. Repeated here: the field patch, `revalidateLearnerScoped({ teacherShell: true })`, and the `revalidatePath` set. Not needed: `notifyAralAssigned`. On re-tag the recipient is the actor, and that function already skips self-notifications. |
| Kinder | Kinder learners **can** be ARAL: no ARAL enroll path restricts by grade. Kinder MOSY level options are the early rubric (`readingProfileOptionsForGrade("KINDER")`). Kinder gets the **Grades 1–3** improvement reason, because the repo already puts KINDER in one reading-band family with G1–G3 (`isEarlyGradeReadingBand`). See Open question 1. | With no improvement reason, a Kinder learner who improved could never be moved out. |
| G11/G12, FLOATING | These get the **Grades 4–10** improvement reason ("Instructional / Independent"), which matches their label family (`READING_PROFILE_LABELS_SHS` / `_G4_PLUS`). | One predicate covers them. No third branch. |
| "Level updated, no decision" | A row may have `decision = NULL` ("Decide later"). The **For MOSY decision** card counts these rows. Once a row has a decision, it can switch between MOVE_OUT and STAY but can never return to NULL. | This gives the operator's stat card a real meaning, and untag or re-tag still happens only by explicit choice. A third state would force the code to guess. |
| MOSY export (`src/lib/reports/mosy.ts`, `queries.ts`) | **Out of scope (later).** No change. | The export already lists every learner with their current `isAralLearner`, so a moved-out learner correctly appears as non-ARAL. A later slice can add a "MOSY decisions" block: add `decision/reason/mosyLevel` to `MosyLearner` and one block in `buildMosyBlocks`. |
### 2.2 Data model (owner: database-engineer)

Two new enums and one new table. Add them to `prisma/schema.prisma` directly
after `model AralProfile` so the ARAL models stay together:

```prisma
enum AralMosyOutcome {
  MOVE_OUT
  STAY
}

enum AralMosyMoveOutReason {
  IMPROVED_EARLY_GRADES        // K–G3: "Improved to Developing / Transitioning / Grade Ready"
  IMPROVED_UPPER_GRADES        // G4+:  "Improved to Instructional / Independent Reader"
  DIAGNOSED_LSEN
  RECOMMENDED_LSEN_ASSESSMENT
}

/// One MOSY (middle of school year) decision per learner per school year.
/// See docs/superpowers/specs/2026-09-29-mosy-report-page-design.md.
/// SQL-only CHECKs (Prisma cannot express them) — PRESERVE when editing:
///   AralMosyDecision_reason_iff_move_out, AralMosyDecision_remarks_length.
model AralMosyDecision {
  id                  String                 @id @default(uuid())
  /// Denormalised from learner.schoolId for direct tenant scoping (TermWindowOverride precedent).
  schoolId            String
  schoolYearId        String
  learnerId           String
  mosyLevel           ReadingProfile
  /// NULL = level saved, decision deferred ("For MOSY decision").
  decision            AralMosyOutcome?
  /// Non-null iff decision = MOVE_OUT (SQL CHECK).
  reason              AralMosyMoveOutReason?
  remarks             String?
  /// Tutor who last saved this row. Scope anchor for moved-out learners, whose
  /// Learner.aralTeacherId is cleared. SetNull: see Attendance.recordedById.
  tutorId             String?
  /// Learner.aralEnrolledAt captured at Move out, restored on re-tag.
  priorAralEnrolledAt DateTime?
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt

  school     School     @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  schoolYear SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)
  learner    Learner    @relation(fields: [learnerId], references: [id], onDelete: Cascade)
  tutor      User?      @relation("AralMosyTutor", fields: [tutorId], references: [id], onDelete: SetNull)

  @@unique([learnerId, schoolYearId])      // upsert conflict target
  @@index([schoolYearId, tutorId])         // page scope branch 2 + SchoolYear cascade
  @@index([tutorId])                       // User SetNull FK side
  @@index([schoolId])                      // School cascade + bySchoolId snapshot/clear
}
```

Back-relations (one line each): `School.aralMosyDecisions AralMosyDecision[]`,
`SchoolYear.aralMosyDecisions AralMosyDecision[]`,
`Learner.mosyDecisions AralMosyDecision[]`,
`User.aralMosyDecisionsTutored AralMosyDecision[] @relation("AralMosyTutor")`.

Both columns in the unique key (`learnerId`, `schoolYearId`) are NOT NULL, so
NULLs cannot defeat it. If the tutor is deleted, `tutorId` becomes NULL, and
that only removes a moved-out learner from every tutor's MOSY page. The School
Head can still re-tag the learner with the existing toggle.

### 2.3 Migration — `prisma/migrations/20260929000001_aral_mosy_decision/migration.sql`

Category: **additive**. It adds two new types, one new empty table with its
indexes, FKs and CHECKs, and RLS on that table. No existing row or column is
touched. The latest committed folder is `20260925000003_…`.
`20260926000001_notification_created_at_index` is untracked in-flight work, so
`prisma migrate status` will list **both** as pending and `migrate deploy` will
apply both. Confirm that is intended, and confirm which Supabase project
`DIRECT_URL` points at, before applying (CLAUDE.md).

```sql
-- MOSY (middle of school year) ARAL decision: one row per learner per school year.
-- Purely additive: two new enum types and one new, empty table. These use CREATE
-- TYPE, not ALTER TYPE ... ADD VALUE, so this same transaction may use the new
-- values in the CHECK. No existing row is touched; no backfill; no tightening follow-up.

CREATE TYPE "AralMosyOutcome" AS ENUM ('MOVE_OUT', 'STAY');

CREATE TYPE "AralMosyMoveOutReason" AS ENUM (
  'IMPROVED_EARLY_GRADES',
  'IMPROVED_UPPER_GRADES',
  'DIAGNOSED_LSEN',
  'RECOMMENDED_LSEN_ASSESSMENT'
);

CREATE TABLE "AralMosyDecision" (
    "id"                  TEXT NOT NULL,
    "schoolId"            TEXT NOT NULL,
    "schoolYearId"        TEXT NOT NULL,
    "learnerId"           TEXT NOT NULL,
    "mosyLevel"           "ReadingProfile" NOT NULL,
    "decision"            "AralMosyOutcome",
    "reason"              "AralMosyMoveOutReason",
    "remarks"             TEXT,
    "tutorId"             TEXT,
    "priorAralEnrolledAt" TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AralMosyDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AralMosyDecision_learnerId_schoolYearId_key"
  ON "AralMosyDecision"("learnerId", "schoolYearId");
CREATE INDEX "AralMosyDecision_schoolYearId_tutorId_idx"
  ON "AralMosyDecision"("schoolYearId", "tutorId");
CREATE INDEX "AralMosyDecision_tutorId_idx" ON "AralMosyDecision"("tutorId");
CREATE INDEX "AralMosyDecision_schoolId_idx" ON "AralMosyDecision"("schoolId");

ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_schoolYearId_fkey"
  FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_tutorId_fkey"
  FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A reason is present exactly when the decision is MOVE_OUT. The COALESCE matters:
-- a bare ("decision" = 'MOVE_OUT') = ("reason" IS NOT NULL) evaluates to NULL
-- when decision IS NULL, and a CHECK passes on NULL, so a deferred row could then
-- hold a reason. Here both sides are non-null booleans.
-- Prisma cannot express this; PRESERVE IT when editing AralMosyDecision migrations.
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_reason_iff_move_out"
  CHECK ((COALESCE("decision"::text, '') = 'MOVE_OUT') = ("reason" IS NOT NULL));

-- The remarks cap mirrors the Zod schema (250). PRESERVE IT as above.
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_remarks_length"
  CHECK ("remarks" IS NULL OR char_length("remarks") <= 250);

-- Deny-all to PostgREST, same as every table (prisma/rls-policies.sql).
ALTER TABLE "AralMosyDecision" ENABLE ROW LEVEL SECURITY;

-- Rollback (possible only before any row exists): DROP TABLE "AralMosyDecision";
-- DROP TYPE "AralMosyMoveOutReason"; DROP TYPE "AralMosyOutcome";
-- Rollback is destructive and needs project-owner approval (CLAUDE.md).
```

Also add `ALTER TABLE "AralMosyDecision" ENABLE ROW LEVEL SECURITY;` to
`prisma/rls-policies.sql` next to the `"AralProfile"` line (line 32). The
`rls-coverage` test requires it.

### 2.4 Enum labels — `src/lib/constants/enum-labels.ts` (add after the `READING_PROFILE_LABELS_G4_PLUS` block, ~line 207)

- `ARAL_MOSY_OUTCOME_LABELS = { MOVE_OUT: "Moved out", STAY: "Stay in ARAL" }` (status chips, cards)
- `ARAL_MOSY_OUTCOME_CHOICE_LABELS = { MOVE_OUT: "Move out", STAY: "Stay as ARAL learner" }` (dialog radios)
- `ARAL_MOSY_MOVE_OUT_REASON_LABELS`:
  - `IMPROVED_EARLY_GRADES: "Improved to Developing / Transitioning / Grade Ready"`
  - `IMPROVED_UPPER_GRADES: "Improved to Instructional / Independent Reader"`
  - `DIAGNOSED_LSEN: "Diagnosed as Learner with Special Educational Needs (LSEN)"`
  - `RECOMMENDED_LSEN_ASSESSMENT: "Recommended for LSEN assessment"`

No MOSY level labels are added. The level labels already come from
`readingProfileOptionsForGrade` and `labelReadingProfile(value, gradeType)`.
### 2.5 The pure decision layer — `src/lib/aral/mosy.ts` (new)

This module has no Prisma runtime import (type imports only) and no
`server-only`, so the client dialog can import it too. It follows
`src/lib/aral/profiling-stats.ts`. Exports:

1. `mosyMoveOutReasonsForGrade(gradeType: string): AralMosyMoveOutReason[]`
   returns `[isEarlyGradeReadingBand(gradeType) ? "IMPROVED_EARLY_GRADES" : "IMPROVED_UPPER_GRADES", "DIAGNOSED_LSEN", "RECOMMENDED_LSEN_ASSESSMENT"]`.
   This is **the only place** that decides which reasons a grade may use. The dialog renders its result and the resolver validates against it.
2. `MOSY_STATUSES = ["all", "not_updated", "for_decision", "moved_out", "stay"]`, plus `MOSY_STATUS_LABELS` and `parseMosyStatus(raw)` (anything unknown becomes `"all"`).
3. `mosyRowStatus({ isAralLearner, row: { decision } | null })` returns one of the four statuses other than `all`:
   - no row → `not_updated`
   - `decision NULL` → `for_decision`
   - `MOVE_OUT` and untagged → `moved_out`
   - `MOVE_OUT` but tagged again (someone re-enrolled the learner through the toggle since) → `for_decision`
   - `STAY` → `stay`
4. `mosyStatusWhere(status, schoolYearId): Prisma.LearnerWhereInput` is the Prisma version of `mosyRowStatus`. It builds its clauses inside an `AND: [...]` array so they never collide with the scope's `OR`. A parity test keeps the two in step.
5. `computeMosyStats({ total, notUpdated, forDecision, movedOut, stay }) → MosyStats` returns the five card numbers with their hints: `updated = total − notUpdated`, and negatives are clamped to zero. Cards: Total ARAL learners (hint "This school year, including moved out"), Updated MOSY level, For MOSY decision, Moved out, Stay in ARAL.
6. `formatPreviousLevel(record: { monthKey: string; englishProfile; filipinoProfile } | null, gradeType)` returns `{ filipino: string | null; english: string | null; monthLabel: string } | null`. English is left out when `languagesForGrade(gradeType)` excludes it. Labels come from `labelReadingProfile`. The query layer produces `monthKey` with `formatLocalDateKey`, never `toISOString`.
7. **`resolveMosySave(input) → MosySaveResult`** is the function that decides every save. Input:
   ```
   {
     actorId: string,
     now: Date,
     learner: { gradeType: string; isAralLearner: boolean; aralTeacherId: string | null; aralEnrolledAt: Date | null },
     existing: { decision: AralMosyOutcome | null; tutorId: string | null; priorAralEnrolledAt: Date | null } | null,
     submitted: { mosyLevel: ReadingProfile; decision: AralMosyOutcome | null; reason: AralMosyMoveOutReason | null; remarks: string | null },
   }
   ```
   Output (a tagged union; the function never throws):
   ```
   | { ok: true;
       row: { mosyLevel; decision; reason; remarks; tutorId /* = actorId */; priorAralEnrolledAt: Date | null };
       learnerPatch: null | { isAralLearner: boolean; aralTeacherId: string | null; aralEnrolledAt: Date | null };
       transition: "NONE" | "MOVED_OUT" | "RETAGGED" }
   | { ok: false; failure: "OUT_OF_SCOPE" | "LEVEL_NOT_ALLOWED" | "REASON_REQUIRED" | "REASON_NOT_ALLOWED" | "DECISION_REQUIRED" }
   ```
   Rules, in order:
   - Scope: if `teacherOwnsMosyRow(learner, existing, actorId)` (§2.6) is false → `OUT_OF_SCOPE`.
   - If `isReadingValueAllowedForGrade(mosyLevel, gradeType)` is false → `LEVEL_NOT_ALLOWED`.
   - `decision === null` is allowed only when the learner is tagged and `existing?.decision` is null or there is no row. Otherwise → `DECISION_REQUIRED`.
   - `MOVE_OUT` needs a `reason` (`REASON_REQUIRED`), and the reason must be in `mosyMoveOutReasonsForGrade(gradeType)` (`REASON_NOT_ALLOWED`). For any other decision, `reason` is forced to `null`.
   - Tagged + `MOVE_OUT` → `learnerPatch = { isAralLearner: false, aralTeacherId: null, aralEnrolledAt: null }`, `row.priorAralEnrolledAt = learner.aralEnrolledAt`, `transition = "MOVED_OUT"`.
   - Untagged + `STAY` → `learnerPatch = { isAralLearner: true, aralTeacherId: actorId, aralEnrolledAt: existing.priorAralEnrolledAt ?? now }`, `row.priorAralEnrolledAt = null`, `transition = "RETAGGED"`.
   - Every other case → `learnerPatch = null`, `transition = "NONE"`, `row.priorAralEnrolledAt = existing?.priorAralEnrolledAt ?? null`.
   - **A level change never produces a patch by itself.** Only the `decision` input can. This rule is what guarantees "updating the level never untags", and this function is the only place it is enforced.

### 2.6 Scope — `src/lib/teachers/scope.ts` (add after `aralLearnerScope`, ~line 83)

This module is where every learner-scope predicate lives, so the MOSY scope
goes here rather than in the page.

- `mosyLearnerScope(teacherId: string | null, schoolYearId: string): Prisma.LearnerWhereInput` returns
  `{ OR: [ { isAralLearner: true, ...(teacherId ? { aralTeacherId: teacherId } : {}) },
           { isAralLearner: false, mosyDecisions: { some: { schoolYearId, decision: "MOVE_OUT", ...(teacherId ? { tutorId: teacherId } : {}) } } } ] }`.
  `teacherId = null` is the Super Admin view: the whole school, read-only. This mirrors the Profiling page's `isSuperAdmin ? {} : aralLearnerScope(user.id)`. The function **owns the `OR` key**; its doc comment must say so, and callers combine it with `AND`.
- `teacherOwnsMosyRow(learner: { isAralLearner; aralTeacherId }, existing: { decision; tutorId } | null, teacherId)` is the in-memory version of the same rule: `(isAralLearner && aralTeacherId === teacherId) || (!isAralLearner && existing?.decision === "MOVE_OUT" && existing.tutorId === teacherId)`.

These consequences are intended:
- An adviser who is not the tutor never sees the row. This is tutor scope, the same as Profiling.
- If a tagged learner is reassigned from tutor A to tutor B, the learner moves to B's page along with A's decision, and B's next save overwrites `tutorId`.
- A learner untagged through the generic toggle after a STAY decision drops off the page, because they did not leave ARAL through MOSY.

### 2.7 Validation — `src/lib/validators/aral-mosy.schema.ts` (new)

```ts
export const MOSY_REMARKS_MAX = 250;
export const aralMosyDecisionSchema = z.object({
  learnerId: z.string().uuid("Invalid learner"),
  mosyLevel: z.nativeEnum(ReadingProfile, { message: "Choose a MOSY reading level" }),
  decision: z.union([z.nativeEnum(AralMosyOutcome), z.literal("")]).transform((v) => v || null),
  reason: z.union([z.nativeEnum(AralMosyMoveOutReason), z.literal("")]).transform((v) => v || null),
  remarks: z.string().trim().max(MOSY_REMARKS_MAX, "Remarks can be up to 250 characters").transform((v) => v || null),
}).superRefine((v, ctx) => {
  if (v.decision === "MOVE_OUT" && !v.reason)
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose a reason for moving the learner out" });
}).transform((v) => ({ ...v, reason: v.decision === "MOVE_OUT" ? v.reason : null }));
```

The grade-dependent rules (level allowed, reason allowed) stay **out** of the
schema. The binding rule in `policy.ts` says the grade must come from the
DB-loaded learner, never from the form, so those checks live in
`resolveMosySave`. The client dialog uses the same schema through
`useAppForm` and filters its options with the same policy functions.

### 2.8 Server action — `src/lib/actions/aral-mosy.ts` (new, `"use server"`)

```ts
export const saveMosyDecision = action(
  "saveMosyDecision",
  async (formData: FormData): Promise<{ ok: true; data: { transition: "NONE" | "MOVED_OUT" | "RETAGGED" } }> => { … },
  { verb: "save the MOSY decision" },
);
```

Steps (the house pattern):
1. `const user = await requireSchoolUser("TEACHER")`.
2. `const input = parseInput(aralMosyDecisionSchema, formToObj(formData))`.
3. `prisma.$transaction(async (tx) => { … })`:
   - Active year: `tx.schoolYear.findFirst({ where: { schoolId: user.schoolId, isActive: true }, select: { id: true } })`. Read it fresh here, not through `getActiveSchoolYear`, because a write must not trust a 60-second cache. If there is none → `throw new AppError("SCHOOL_YEAR_NOT_ACTIVE")`.
   - Learner: `tx.learner.findFirst({ where: { id, deletedAt: null, archivedAt: null }, select: { schoolId, teacherId, gradeLevelId, isAralLearner, aralTeacherId, aralEnrolledAt, gradeLevel: { select: { type } } } })`. If missing → `resourceNotFound("Learner")`. Then `assertSameSchool(user.schoolId, learner.schoolId, "Learner")`.
   - Load the existing row by `learnerId_schoolYearId`.
   - Call `resolveMosySave(...)`. `OUT_OF_SCOPE` → `resourceNotFound("Learner")`, so nothing leaks about whether the learner exists. Any other failure → `AppError("VALIDATION_FAILED", { message, fieldErrors: { <field>: [msg] } })`.
   - `tx.aralMosyDecision.upsert({ where: { learnerId_schoolYearId }, create: { schoolId: user.schoolId, schoolYearId, learnerId, ...row }, update: row })`.
   - If there is a `learnerPatch`: `tx.learner.update({ where: { id }, data: learnerPatch })`. Both writes are in one transaction, so a MOVE_OUT decision row can never commit while the learner stays tagged.
4. After commit, `writeAudit` (it never throws), one row per save:
   - `transition === "MOVED_OUT"` → `AUDIT_ACTIONS.ARAL_MOSY_MOVE_OUT`
   - `"RETAGGED"` → `AUDIT_ACTIONS.ARAL_MOSY_RETAG`
   - `"NONE"` → `AUDIT_ACTIONS.ARAL_MOSY_SAVE`
   - `resource: "AralMosyDecision"`, `resourceId: learnerId`, `metadata: { schoolId, learnerId, schoolYearId, mosyLevel, decision, reason }`. **Leave out** `remarks`: free text can carry learner PII, and audit metadata holds IDs and codes only (docs/privacy.md).
5. Revalidate:
   - Every save: `revalidatePath(ARAL_MOSY_HREF)`.
   - When `transition !== "NONE"` (ARAL membership changed), do what `toggleAralLearner` does: `revalidatePath("/teacher/aral")`, `revalidatePath(ARAL_PROFILING_HREF)`, `revalidatePath("/teacher/learners")`, `revalidatePath("/teacher/grade/<gradeLevelId>")`, `revalidatePath("/teacher/grade/<gradeLevelId>/learners/<learnerId>")`, and `revalidateLearnerScoped({ schoolId, teacherId: learner.teacherId, aralTeacherId: user.id, teacherShell: true })`. The sidebar's `hasAral` may flip. `adminDashboard` stays false, as it does for the toggle.
   - A level-only save busts nothing else, because no other surface reads `AralMosyDecision`.
6. `return { ok: true, data: { transition } }`.

Super Admin sees the page read-only (`canEdit = false`), as on Profiling. A
Super Admin can never be the tutor, so even a forged post from one fails
`teacherOwnsMosyRow` and returns NOT_FOUND.

### 2.9 Error code — `src/lib/errors/codes.ts` (new section before `// ── Requests`, ~line 205)

`SCHOOL_YEAR_NOT_ACTIVE: { status: 409, severity: "user", message: "Your school has no active school year yet, so this can't be saved. Ask your School Head to set the school year first." }`. Follow the "Adding a code" steps in `docs/errors.md`.

### 2.10 Audit — `src/lib/audit-actions.ts` (insert after `ARAL_PROFILE_SAVE`, line 127)

Add `ARAL_MOSY_SAVE`, `ARAL_MOSY_MOVE_OUT` and `ARAL_MOSY_RETAG`, with a doc
comment stating the metadata rule from §2.8.
### 2.11 Page query module — `src/lib/aral/mosy-queries.ts` (new, `server-only`)

`loadMosyPage({ schoolId, schoolYear: { id, startDateKey }, teacherId: string | null, q, grade, section, status, page }) → { stats, counts: Record<MosyStatusFilter, number>, rows: MosyRow[], totalCount, pages, sections }`.

- `baseWhere = { schoolId, deletedAt: null, archivedAt: null, AND: [mosyLearnerScope(teacherId, schoolYear.id)] }`
- `filterWhere = { ...nameSearchWhere(q), ...(grade ? { gradeLevelId: grade } : {}), ...sectionIdWhere(section) }`
- Counts: one `Promise.all` of `learner.count` calls over `baseWhere` + `mosyStatusWhere(s)`, for `all` and each of the four statuses. The tabs and the cards read the same numbers, so they cannot disagree.
- Rows: `learner.findMany` with `relationLoadStrategy: "join"`, the list `where`, `orderBy: [{ fullName: "asc" }, { id: "asc" }]`, and `skip`/`take` of `LEARNER_PAGE_SIZE`. Select `id, fullName, gradeLevelId, isAralLearner`, `gradeLevel: { select: { type } }`, `section: { select: { name } }`, `mosyDecisions: { where: { schoolYearId }, take: 1, select: { mosyLevel, decision, reason, remarks, updatedAt } }`, and `readingLevels: { where: { weekStart: { gte: parseLocalDateKey(startDateKey) } }, orderBy: { weekStart: "desc" }, take: 1, select: { weekStart, englishProfile, filipinoProfile } }`. Map the results through the pure helpers (`mosyRowStatus`, `formatPreviousLevel`, `labelReadingProfile`, `readingProfileOptionsForGrade`, `mosyMoveOutReasonsForGrade`) into plain `MosyRow` objects. No `Date` crosses to the client.
- Sections: `getGradeSections({ schoolId, gradeLevelIds })` over the distinct `gradeLevelId`s in `baseWhere`, as on Profiling.

### 2.12 Page and components (owner: frontend-developer)

New files:
- `src/app/teacher/(app)/aral/mosy/page.tsx`: a server component copying the skeleton of the Profiling page:
  - `requireUser("TEACHER")`.
  - Super Admin branch: `schoolId` from `?schoolId=`, `teacherId = null`, `canEdit = false`.
  - The profile-completed redirect, then `getActiveSchoolYear(schoolId)`.
  - If there is no active year, render the hero plus an empty-state `Surface` ("No active school year yet — ask your School Head to set one before recording MOSY decisions.") and nothing else.
  - Export `MOSY_LIST_KEYS = ["page", "status", "q", "grade", "section"]` and key the rows' `Suspense` with `listKey(sp, MOSY_LIST_KEYS)`.
  - `export const dynamic = "force-dynamic"`.
  - The static `mosy` segment takes precedence over `[gradeId]`, exactly as `profiling` does. No new framework API is involved: the page uses the same `searchParams` Promise, `Suspense` and `redirect` as the current Profiling page on Next 16.3.
- `src/components/aral/mosy-stat-cards.tsx`: the five cards from `MosyStats`, in the violet ARAL accent, reusing the Profiling card primitives.
- `src/components/aral/mosy-toolbar.tsx` (client):
  - Search with a 500 ms debounce.
  - One grouped "Grade & section" `Select`. For each grade it offers "All of Grade N" (`grade=<id>`), then that grade's sections (`grade=<id>&section=<id>`).
  - A status `Select`.
  - URL-driven through `useListNavigate`: every change resets `page` and keeps `schoolId`.
  - This is a new file rather than a generalized `ProfilingToolbar`, because that file is dirty in the in-flight work and hardcodes `ARAL_PROFILING_HREF`.
- `src/components/aral/mosy-table.tsx` (client):
  - Columns: Learner · Grade & section · Previous level (Fil/Eng lines + month, or "—") · MOSY reading level (a `Select` of `row.levelOptions`) · ARAL status (a chip from `ARAL_MOSY_OUTCOME_LABELS`, or "Not updated", or "For decision") · Reason · Remarks (truncated, full text on hover) · Update (button).
  - Holds `dialogRow: { row, draftLevel } | null`.
- `src/components/aral/mosy-decision-dialog.tsx` (client): uses `useAppForm(aralMosyDecisionSchema)`.

Client state flow:
1. The tutor changes a row's MOSY level `Select`. The table sets `dialogRow = { row, draftLevel: value }`, and the row's `Select` shows the draft while the dialog is open. Nothing is saved yet. This applies to moved-out rows too: the dialog opens with Move out preselected, so the tutor either confirms it or picks Stay to re-tag.
2. The "Update" button sets `dialogRow = { row, draftLevel: row.mosyLevel }` so the tutor can edit the decision, reason or remarks. The dialog also shows the level `Select`, so a row with no level yet can pick one there.
3. The dialog is titled "Move out from ARAL?":
   - Radios: Move out / Stay as ARAL learner. They are preselected from `row.decision`; otherwise neither is selected.
   - Choosing Move out reveals the reason radio group, built from `row.reasonOptions` (computed on the server through `mosyMoveOutReasonsForGrade`), with the helper text: "This removes the learner from ARAL. They stay on this page for the rest of the school year."
   - Remarks: a textarea with a live `n/250` counter.
4. Buttons:
   - **Save** requires a decision.
   - **Decide later** shows only when `row.decision === null` and the learner is tagged. It submits `decision = ""`.
   - **Cancel** closes the dialog and resets the row's `Select` to `row.mosyLevel`.
5. Submit: build a `FormData` and run `startTransition(() => saveMosyDecision(fd))`.
   - On `ok`: close the dialog and show `toast.success` with "Moved out of ARAL", "Back in ARAL" or "MOSY level saved", depending on `data.transition`. The action's `revalidatePath` refreshes the list.
   - On `!ok`: keep the dialog open, show `toast.error(res.error)`, and map `res.fieldErrors` onto the form.
6. When `canEdit = false` (Super Admin), the selects and the Update button are disabled and the dialog never opens.

### 2.13 Nav — `src/lib/nav/nav-config.ts`

- After `ARAL_PROFILING_HREF` (line 122), add `ARAL_MOSY_HREF = "/teacher/aral/mosy"` with the doc comment "The MOSY Report list: middle-of-year level and ARAL decision for every learner a teacher tutors."
- In the teacher "ARAL Program" group, add `{ id: "teacher-aral-mosy", label: "MOSY Report", href: ARAL_MOSY_HREF, icon: ClipboardCheck }` directly after the `teacher-aral-profiling` item (~line 315), and add `ClipboardCheck` to the `lucide-react` import. It needs no `alsoOwns`, because the page has no sub-routes.

## 3. Invariants and where each is enforced

| Invariant | Enforced by |
|---|---|
| One decision per learner per school year | DB unique `(learnerId, schoolYearId)`; the action upserts on it. |
| A reason is present iff decision = MOVE_OUT | DB CHECK `AralMosyDecision_reason_iff_move_out`, plus the Zod `superRefine`/transform, plus `resolveMosySave`. |
| Remarks ≤ 250 chars | DB CHECK + Zod. |
| The reason fits the grade | `resolveMosySave` via `mosyMoveOutReasonsForGrade`. The grade lives on `GradeLevel`, another table, so a CHECK cannot see it. App code is the deliberate enforcement point, pinned by a unit test. |
| The MOSY level fits the grade | `resolveMosySave` via `isReadingValueAllowedForGrade`, using the DB-loaded grade type. Same cross-table reason, same unit-test pin. |
| Changing the level never untags | `resolveMosySave` builds `learnerPatch` from `decision` only. A unit test runs every level change with `STAY`, `null` and an unchanged decision and asserts `learnerPatch === null`. |
| Move out and untag commit together | One interactive `prisma.$transaction` in `saveMosyDecision`. An action test asserts both writes run on `tx`. |
| `aralTeacherId` is never set on a non-ARAL learner | The shape of the `resolveMosySave` patch: `aralTeacherId: null` whenever `isAralLearner: false`. Pinned by a unit test. |
| Only the tutor, or whoever recorded the Move out, can write | `teacherOwnsMosyRow` inside `resolveMosySave`; a failure returns NOT_FOUND. The `aral-scope-coverage` test is extended to the new action file, so no wide predicate can creep in. |
| Tenancy | `assertSameSchool` in the action. `schoolId` is in every page `where`. The `schoolId` column is set from `user.schoolId`, never from the form. |
| A decision cannot be cleared back to none | `resolveMosySave` (`DECISION_REQUIRED`), pinned by a unit test. |
| The page list and the in-memory scope agree | `mosyLearnerScope` ⇄ `teacherOwnsMosyRow` and `mosyStatusWhere` ⇄ `mosyRowStatus`, checked by parity unit tests over a fixture matrix. |

## 4. Migration / rollout path

- **Existing data:** nothing is touched. Every learner starts with no MOSY row ("Not updated"). No backfill.
- **Order within one push** (a push to main is a deploy): the database-engineer applies `20260929000001` before the code that reads or writes `AralMosyDecision` reaches production. Check `migrate status` first, because the in-flight `20260926000001` will apply too. If the code deployed without the table, every MOSY page load would fail with Prisma's "table does not exist", classified as `DB_SCHEMA_OUT_OF_DATE`. No other page would be affected, since nothing else queries the table.
- **Clients in flight:** none. The route and the action are both new.
- **Write paths we do not control:** these can all flip `isAralLearner` or `aralTeacherId` after a MOSY decision: the ARAL toggle (`toggleAralLearner`), the roster enroll actions, `setAralTeacher`, the CSV import (`import-learners.ts`, which sets `isAralLearner`/`aralEnrolledAt` on create only), and the demo fixtures. None of them touches `AralMosyDecision`, and the design copes with each:
  - A re-tag after MOVE_OUT shows as "For decision" on the new tutor's page (`mosyRowStatus`).
  - An untag after STAY drops the learner off the page.
  - A reassignment follows the new tutor.

  No stored value depends on a human correction that a later import could overwrite.
- **Backup/restore:** `src/lib/db/schema-order.ts` must list the model, or the `schema-order` test fails. Add `{ model: "AralMosyDecision", delegate: "aralMosyDecision", operational: true, schoolScope: bySchoolId }` directly after the `KinderCompetencyRecord` entry (~line 153). That position comes after School, SchoolYear, User and Learner, which the table points at.

## 5. Alternatives rejected

1. **Keep `aralTeacherId` on Move out and scope the page by `aralTeacherId` alone.** It gives the simplest page query. But `teacherLearnerScope` would keep granting that tutor roster, export, search and dashboard access to a non-ARAL learner, a state `setAralTeacher` already refuses. Rejected: it breaks a documented invariant across 19 call sites.
2. **Write the MOSY level into `ReadingLevelRecord`.** The operator rejected this. It would also force a choice of language and a `weekStart` anchor that could collide with the real monthly record.
3. **Call `toggleAralLearner` for the untag.** Its write is not in the same transaction as the decision row, its access guard is too wide, and it uses the legacy error shape. Rejected (see §2.1).
4. **Store the decision in `Learner` columns (`mosyDecision`, `mosyReason`, …).** That keeps no per-year history, adds nullable columns to the widest table, and edits the `Learner` block of the dirty `schema.prisma`, which other in-flight work is also changing. Rejected.
5. **Make the decision NOT NULL (no "Decide later").** The operator's "For MOSY decision" card would have nothing to count. Rejected.
## 6. Files

### New
| File | Owner |
|---|---|
| `prisma/migrations/20260929000001_aral_mosy_decision/migration.sql` | database-engineer |
| `src/lib/aral/mosy.ts` (pure) | backend-developer |
| `src/lib/aral/mosy-queries.ts` | backend-developer |
| `src/lib/validators/aral-mosy.schema.ts` | backend-developer |
| `src/lib/actions/aral-mosy.ts` | backend-developer |
| `src/app/teacher/(app)/aral/mosy/page.tsx` | frontend-developer |
| `src/components/aral/mosy-stat-cards.tsx`, `mosy-toolbar.tsx`, `mosy-table.tsx`, `mosy-decision-dialog.tsx` | frontend-developer |
| The tests listed in §7 | qa-test-engineer |

### Existing files — edits and insertion points
| File | Edit | Dirty in tree? |
|---|---|---|
| `prisma/schema.prisma` | 2 enums + the model after `model AralProfile` (~line 1330); 4 back-relation lines in `School`, `SchoolYear`, `Learner` (relations block ~line 1194, next to `aralProfile`) and `User` | **yes**: append only, do not reorder |
| `prisma/rls-policies.sql` | one `ENABLE ROW LEVEL SECURITY` line after `"AralProfile"` (line 32) | no |
| `docs/migrations.md` | one bullet naming the two SQL-only CHECKs to preserve | yes: append only |
| `src/lib/constants/enum-labels.ts` | 3 label maps after `READING_PROFILE_LABELS_G4_PLUS` (~line 207) | no |
| `src/lib/audit-actions.ts` | 3 constants after `ARAL_PROFILE_SAVE` (line 127) | no |
| `src/lib/errors/codes.ts` (+ a row in `docs/errors.md`) | `SCHOOL_YEAR_NOT_ACTIVE` before `// ── Requests` (~line 205) | no |
| `src/lib/teachers/scope.ts` | `mosyLearnerScope` and `teacherOwnsMosyRow` after `aralLearnerScope` (~line 83) | no |
| `src/lib/db/schema-order.ts` | snapshot entry after `KinderCompetencyRecord` (~line 153) | no |
| `src/lib/nav/nav-config.ts` | `ARAL_MOSY_HREF` after line 122; nav item after `teacher-aral-profiling` (~line 315); icon import | no |
| `src/lib/releases.ts`, `package.json`, `package-lock.json` | the v2.17.0 entry and version | **yes**: add the entry above whatever is on top at push time |
| `tests/unit/nav/nav-config.test.ts` | the ARAL group href list (~line 336) gains `"/teacher/aral/mosy"`; add an active-item case | — |
| `tests/unit/aral-scope-coverage.test.ts` | add `"lib/actions/aral-mosy.ts"` to `ARAL_FILES` | — |

No edits to `src/lib/actions/learner.ts`, `src/lib/cache/revalidate.ts` (the
existing helpers are enough), or the MOSY export.

## 7. Tests that prove it (qa-test-engineer)

- **`tests/unit/aral/mosy.test.ts`**
  - `mosyMoveOutReasonsForGrade` for KINDER, G1, G3, G4, G10, G11 and FLOATING.
  - `resolveMosySave` accepted paths:
    - tagged → MOVE_OUT: the patch clears the flag, tutor and date, and captures the prior date;
    - untagged MOVE_OUT → STAY: re-tags with the prior date and the actor as tutor, falling back to `now` when there is no prior date;
    - STAY produces no patch;
    - a level change with any non-MOVE_OUT decision never produces a patch;
    - a deferred decision is allowed only when no decision exists yet.
  - `resolveMosySave` rejected paths:
    - clearing a decision → `DECISION_REQUIRED`;
    - a missing reason → `REASON_REQUIRED`;
    - a reason from the wrong grade (G2 with `IMPROVED_UPPER_GRADES`) → `REASON_NOT_ALLOWED`;
    - a level from the wrong grade (KINDER with `INSTRUCTIONAL_DEVELOPING`, G11 with `NON_DECODER_LOW_EMERGENT`) → `LEVEL_NOT_ALLOWED`;
    - out of scope: another tutor; untagged with a STAY row; untagged with another tutor's MOVE_OUT.
  - `mosyRowStatus`, including a learner re-tagged after MOVE_OUT.
  - `computeMosyStats` and `parseMosyStatus`.
  - `formatPreviousLevel`: G1 leaves out English; the month comes from a local date key.
- **`tests/unit/aral/mosy-scope-parity.test.ts`** runs a fixture matrix through `teacherOwnsMosyRow` and `mosyRowStatus`, and asserts the exact `where` objects from `mosyLearnerScope` and `mosyStatusWhere`. A `null` teacher (Super Admin) drops the tutor filters.
- **`tests/unit/validators/aral-mosy.schema.test.ts`**
  - empty strings become null;
  - MOVE_OUT without a reason fails on `reason`;
  - STAY with a reason has the reason stripped;
  - 251-character remarks fail;
  - an unknown enum value fails.
- **`tests/unit/actions/aral-mosy-save.test.ts`** mocks `requireSchoolUser`, `prisma.$transaction`, `writeAudit`, `revalidatePath` and `revalidateLearnerScoped`, and asserts:
  - no active year → `SCHOOL_YEAR_NOT_ACTIVE`;
  - another school's learner → NOT_FOUND;
  - an adviser who is not the tutor → NOT_FOUND;
  - Move out both upserts the row and updates the learner, on `tx`;
  - a level-only save never calls `learner.update` and only revalidates `ARAL_MOSY_HREF`;
  - each transition writes its own audit action, and the metadata has no `remarks`;
  - `teacherShell: true` appears only on transitions.
- **`tests/unit/aral/mosy-page-list-key.test.ts`** copies `profiling-page-list-key.test.ts`, and also asserts the no-active-year empty state.
- **`tests/unit/constants/enum-labels-aral-mosy.test.ts`** checks that every `AralMosyOutcome` and `AralMosyMoveOutReason` value (from `@prisma/client`) has a label.
- **`tests/unit/db/aral-mosy-decision-migration.test.ts`** reads the SQL and asserts:
  - both named CHECKs are present, including the COALESCE form;
  - `ENABLE ROW LEVEL SECURITY` is present;
  - there is no `DROP`, no `ALTER TYPE`, and no `ALTER TABLE` on any table other than `"AralMosyDecision"`.
- **Existing tests that must stay green** once the edits land: `rls-coverage`, `db/schema-order`, `nav/nav-config` (updated), `aral-scope-coverage` (updated), and `releases`/`release-guard`.

## 8. Release entry (v2.17.0)

This is a feature, so the middle number moves. Which version to use depends on
what has shipped when this is pushed:
- If 2.16.0 has already shipped, use `2.17.0`.
- If main has moved past that, renumber above main. Never reuse a number.
- If this lands in the **same** push as the in-flight 2.16.0 work, fold these lines into that one entry instead (one entry per push).

```
version: "2.17.0", date: "<push date, local YYYY-MM-DD>",
title: "MOSY Report for ARAL tutors", announce: true,
fixes: [
  { text: "There is a new MOSY Report page under ARAL Program. It lists every ARAL learner you tutor, across all your grades, with their latest monthly reading level.", roles: ["TEACHER"] },
  { text: "Set each learner's middle-of-year reading level, then choose whether they move out of ARAL or stay. Changing the level alone never removes a learner from ARAL.", roles: ["TEACHER"] },
  { text: "Moving a learner out asks for a reason and lets you add a short remark. Learners you move out stay on the page for the rest of the school year, so you can still change your decision.", roles: ["TEACHER"] },
]
```
Set the same version in `package.json` and in both `version` fields of `package-lock.json`.

## 9. Task breakdown (ordered; each can be verified on its own)

**database-engineer (prisma/**)**
1. [db] Add the enums, model and back-relations to `schema.prisma`, then run `prisma format`, `prisma validate` and `prisma generate`. Verify: generate succeeds and `tsc` still passes.
2. [db] Create the migration folder `20260929000001_aral_mosy_decision` with the SQL from §2.3. Cross-check it with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` (file inputs only). Verify: the only differences are the SQL-only lines.
3. [db] Add the `rls-policies.sql` line and the `docs/migrations.md` bullet about preserving the CHECKs.
4. [db] Apply: run `prisma migrate status` and read the pending list (expect `20260926000001` plus ours), confirm the `DIRECT_URL` target, then run `prisma migrate deploy`. This migration is additive, which CLAUDE.md permits. Report which database was touched.

**backend-developer (src/lib/**)**, after task 1
5. [backend] Entries in `enum-labels.ts`, `audit-actions.ts`, `codes.ts` (+ `docs/errors.md`) and `schema-order.ts`.
6. [backend] The pure module `src/lib/aral/mosy.ts`, plus the additions to `scope.ts`.
7. [backend] `aral-mosy.schema.ts`.
8. [backend] `saveMosyDecision` in `actions/aral-mosy.ts`.
9. [backend] `loadMosyPage` in `aral/mosy-queries.ts`.

**frontend-developer (src/app, src/components, nav)**, once the signatures from tasks 6–9 exist
10. [frontend] The `nav-config.ts` constant and nav item.
11. [frontend] The page, the stat cards and the toolbar.
12. [frontend] The table, the decision dialog, and the client flow from §2.12.
13. [frontend] The release entry and version bump, at push time.

**qa-test-engineer (tests/**)**. Tests for tasks 6 and 7 can be written from this spec in parallel with the backend work.
14. [qa] The unit tests in §7, plus the updates to `nav-config.test.ts` and `aral-scope-coverage.test.ts`.
15. [qa] Run `prisma generate` → `typecheck` → `lint` → `test` → `build`.

## 10. Open questions

1. **Kinder improvement reason.** Kinder MOSY levels use the early rubric (Level 0–3), yet this design gives Kinder the Grades 1–3 reason "Improved to Developing / Transitioning / Grade Ready". Confirm this, or supply Kinder-specific wording (for example "Improved to Level 3 – CVC blending"). That would be one more enum value, which is an additive change.
2. **Which language is the single MOSY level?** The monthly record is bilingual, but the MOSY level is one value. The page shows both previous languages so nothing is hidden. The dialog text still needs to say what the one value means ("overall" or "Filipino", for example). This needs one sentence from the operator, not a design change.
3. **Should "Improved to …" require the MOSY level to actually be in an improved band?** It is not enforced now, because the operator did not ask for it. Adding it is one extra rule in `resolveMosySave`.
4. **G11/G12 and FLOATING** get the Grades 4–10 improvement reason. Confirm.
5. **School Head visibility.** Only tutors see decisions (and Super Admin, read-only). A School Head view, or a decisions block in the MOSY export (§2.1), is a follow-up slice.