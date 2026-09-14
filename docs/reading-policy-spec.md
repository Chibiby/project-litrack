# Reading policy: K-2 rubric, SHS levels, language scope, nutritional status, writing removal

Target version: **next minor** (feature -> middle number per `CLAUDE.md`; implementers set the exact `x.y.0` at push time against whatever `main` holds then).

Gate commands (run all four locally before declaring any task in this spec done -- `CLAUDE.md`, "Commands"):

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## 1. The problem

Four DepEd-driven changes land on the same surface -- the reading-level data every grade collects -- and they must not bleed into each other:

- Kinder, Grade 1 and Grade 2 stop reporting the CRLA-style four-band profile (`Non-Decoder ... Independent`) and start reporting a four-level letter/word rubric (`Cannot name and sound letters ... CVC blending`).
- Grade 1 and Grade 2 stop reporting an **English** reading level at all -- Kinder keeps both languages, Grade 3 and up are untouched.
- Grade 11 and Grade 12 stop offering `Non-Decoder` and rename the remaining three bands (`Independent Level`, `Instructional Level`, `Frustration Level`).
- Writing stops being collected anywhere active, but the column and every historical row must survive edits to the *other* fields on the same row.

Alongside these: the enrollment age ceiling moves to 70, `NutritionalStatus` gains `OVERWEIGHT`, and "Add new learner" gets a chooser step ahead of the form. None of Grades 3-10 may visibly change. Every legacy row -- whatever grade or era wrote it -- must keep rendering exactly what it always rendered; nothing may be reinterpreted, converted, or flagged as legacy.

## 2. Representation decision: reuse `ReadingProfile`, dispatch labels by value first, grade second

**Decision: add the four new K/1/2 rubric levels as new members of the existing `ReadingProfile` enum (not a new enum, not a parallel nullable column).** `Learner.englishReadingProfile` / `Learner.filipinoReadingProfile` and `ReadingLevelRecord.englishProfile` / `ReadingLevelRecord.filipinoProfile` keep their current columns and types; only the enum's member list and `Learner.englishReadingProfile`'s nullability change.

Why, and the alternative rejected:

- The codebase already interprets one `ReadingProfile` value through **two label sets depending on context** (`READING_PROFILE_LABELS_K3` vs `READING_PROFILE_LABELS_G4_PLUS`, dispatched by `readingProfileLabelsForGradeType` in `src/lib/constants/enum-labels.ts`). Adding a third label set for a *disjoint* set of values is the same pattern one notch further, not a new one.
- **Rejected: a second nullable column pair** (e.g. `Learner.earlyGradeEnglishLevel` / `earlyGradeFilipinoLevel`, and the equivalent on `ReadingLevelRecord`). This looks cleaner in the schema at first glance, but every consumer that currently reads "the reading level" (roster pills, the profile modal, CSV/Excel export, the reports builder, the two dashboard aggregates) would have to branch on *which* pair is populated for every row, doubling the touched-file count in section 7 for no behavioural gain, and it does not resolve the K/1/2-vs-G3 label ambiguity described below -- that ambiguity is inherent to *any* representation, because `ReadingLevelRecord` stores no snapshot of the grade a learner was in when the row was written.
- The reused-enum approach is purely additive at the schema level (`ALTER TYPE ... ADD VALUE`) and needs no backfill in either direction.

**The label-dispatch rule (decision I: legacy rows render raw and unchanged).** A `ReadingLevelRecord` row carries no grade snapshot -- `learner.gradeLevel.type` is always the learner's *current* grade, which drifts as they're promoted. Label lookup must therefore be **value-first, grade-second**:

1. If the stored value is one of the four new rubric members, show its rubric label -- always, regardless of the learner's current grade. These four values are only ever written by K/1/2 collection, so there is no cross-grade ambiguity to resolve.
2. Otherwise the value is one of the original four members. Dispatch by the learner's *current* grade type exactly as today: Kinder/G1/G2/G3 -> `READING_PROFILE_LABELS_K3`, G4-G10/FLOATING -> `READING_PROFILE_LABELS_G4_PLUS`, G11/G12 -> the new SHS label set with a fallback to `READING_PROFILE_LABELS_G4_PLUS` for `NON_DECODER_LOW_EMERGENT` (a value the SHS set has no entry for, but which legacy G11/G12 rows may still hold).

This is exactly today's behaviour for original-enum values (`isEarlyGradeReadingBand` / `EARLY_GRADE_TYPES` -- `KINDER, G1, G2, G3` -- stay as-is; do not touch them), plus one new branch checked first. A promoted learner's old CRLA-band record still shows its old label under their new grade, same as before this change -- this spec does not fix that pre-existing quirk, only avoids making it worse.

### 2a. New `ReadingProfile` members

| Enum member | Label |
|---|---|
| `CANNOT_NAME_SOUND_LETTERS` | Level 0 - Cannot name and sound letters |
| `LETTER_LEVEL` | Level 1 - Letter Level |
| `CV_BLENDING` | Level 2 - CV blending |
| `CVC_BLENDING` | Level 3 - CVC blending |

### 2b. G11/G12 label set (no new enum members -- a restricted view of the original four)

| Enum member | SHS label |
|---|---|
| `FRUSTRATION_HIGH_EMERGENT` | Frustration Level |
| `INSTRUCTIONAL_DEVELOPING` | Instructional Level |
| `INDEPENDENT_GRADE_READY` | Independent Level |
| `NON_DECODER_LOW_EMERGENT` | *(not offered; legacy-only -- falls back to "Non-decoder")* |

## 3. The shared reading-policy module

**New file: `src/lib/reading/policy.ts`** (owner: `backend-developer` -- see the file-ownership note in section 6). Framework-agnostic, no `server-only`, no Prisma import except for the one typed `Prisma.ReadingLevelRecordWhereInput` builder -- it must be importable from client components (`learner-form.tsx`, `aral-monthly-reading-level-grid-form.tsx`) as well as server actions.

**Grade context rule (binding on every consumer of this module): the grade type passed in must come from the authorized placement (`AdvisoryPlacement.gradeType` from `getAdvisoryPlacements`) or a DB-loaded learner/grade row -- never a client-submitted `gradeLevelId`/`gradeType` form field.** Every call site touched by this spec already has (or gains, per section 6) access to one of those two sources.

```ts
export type ReadingLanguage = "ENGLISH" | "FILIPINO";

export const EARLY_RUBRIC_VALUES = [
  "CANNOT_NAME_SOUND_LETTERS",
  "LETTER_LEVEL",
  "CV_BLENDING",
  "CVC_BLENDING",
] as const;

export const SHS_ALLOWED_VALUES = [
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

export const STANDARD_VALUES = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

// languagesForGrade: Kinder = both; G1/G2 = Filipino only; every other grade
// (G3-G10, G11/G12, FLOATING) = both, unchanged.
export function languagesForGrade(gradeType: string): ReadingLanguage[];

// allowedReadingValuesForGrade: Kinder/G1/G2 -> EARLY_RUBRIC_VALUES;
// G11/G12 -> SHS_ALLOWED_VALUES; everything else -> STANDARD_VALUES.
export function allowedReadingValuesForGrade(gradeType: string): readonly string[];

export function isReadingValueAllowedForGrade(value: string, gradeType: string): boolean;

// The single source for "what does the radio group / band picker show for this
// grade" - values x labels, in rubric order. Supersedes the ad hoc
// `toOptions(readingProfileLabelsForGradeType(...))` call in learner-form.tsx and
// the hardcoded PROFILE_ORDER in aral-monthly-reading-level-grid-form.tsx.
export function readingProfileOptionsForGrade(
  gradeType: string
): { value: string; label: string }[];

// Completeness for ONE record, grade-aware: English is only required when
// languagesForGrade(gradeType) includes it. writingLevel and notes are excluded
// on purpose - same rule COMPLETE_ASSESSMENT_WHERE already documents.
export type ReadingRecordLike = {
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
};
export function isReadingRecordComplete(
  record: ReadingRecordLike,
  gradeType: string
): boolean;

// Prisma predicate builder for a SET of grades that may mix language policies
// (a teacher advising both a G2 and a G5 section, or the admin-wide chart).
// Partitions the grade ids by languagesForGrade and OR's the two shapes -
// no raw SQL, fully typed, and each shape stays legible on its own.
export function completeAssessmentWhereForGrades(
  grades: { id: string; type: string }[]
): Prisma.ReadingLevelRecordWhereInput;
```

`src/lib/constants/enum-labels.ts` keeps owning the *label text* (`EARLY_RUBRIC_LABELS`, `READING_PROFILE_LABELS_SHS`, the widened flat `READING_PROFILE_LABELS`, `readingProfileLabelsForGradeType`, `labelReadingProfile`) -- that is the existing, documented convention ("every Prisma enum's UI label lives in `enum-labels.ts`", `CLAUDE.md`). `policy.ts` imports those maps to build `readingProfileOptionsForGrade`; it does not duplicate label text. This keeps "deciding" (which values/languages apply, and whether a record is complete) in one new module and "labelling" in the existing one, per the deciding/doing split in this brief.

## 4. The three sub-decisions in detail

### 4a. `Learner.englishReadingProfile` required -> nullable, never overwritten by omission

Schema: `ReadingProfile` -> `ReadingProfile?` (migration in section 5).

Zod (`src/lib/validators/learner.schema.ts`, `learner-import.schema.ts`): `englishReadingProfile` changes from `z.enum(READING_PROFILE)` to the same `optionalEnum(READING_PROFILE)` helper already used for `modeOfTransportation` etc. -- **structurally** optional. `filipinoReadingProfile` stays required (`z.enum(READING_PROFILE)`) -- Filipino is collected in every grade.

Zod cannot enforce "required unless this grade excludes English" because it never sees the grade (`learnerUpdateSchema` doesn't carry `gradeLevelId` at all, and the create schema's `gradeLevelId` is client-submitted and explicitly untrusted for this exact reason -- see the grade-context rule in section 3). **That enforcement is an action-level invariant, not a Zod one:**

- `createLearner` (`src/lib/actions/learner.ts`): grade is already resolved server-side as `advisory.gradeType` (from `getAdvisoryPlacements`/`resolveAdvisoryTarget`). After parsing, call `languagesForGrade(advisory.gradeType)` and `allowedReadingValuesForGrade(advisory.gradeType)`; reject (generic error, matching this file's existing hand-rolled `{ ok:false, error }` shape) if English is required but missing, if English is supplied but not required (defense against a stale client -- silently ignoring is also acceptable, but rejecting is preferred so a stale client's mistake is visible), or if either supplied value is outside the allowed set for that grade. Only include `englishReadingProfile` in the `tx.learner.create` `data` object when the grade requires it; omit the key (not `null`) otherwise, so the column takes its natural default (`NULL`, since the migration makes it nullable with no default).
- `updateLearner`: the `learner.findFirst` gains `gradeLevel: { select: { type: true } }`. Same validation, keyed off `learner.gradeLevel.type` (the learner's real, current, DB-stored grade -- never the edit form's own state). **Critically: when the grade does not collect English, the key is omitted from `tx.learner.update`'s `data` entirely** -- not set to `null`. This is what makes a Grade 1 learner's edit never touch a value that may have been carried over from Kinder, and never disturb a value a previous edit already left alone. The same allowed-value-set check applies to `filipinoReadingProfile` (reject an out-of-range value) but its presence stays always required.

CSV import (`src/lib/actions/import-learners.ts`, `src/lib/learners/import-csv.ts`): the grade is resolved once per import (route param / `gradeLevelId`, already loaded before rows are validated -- see the file's own comment "`gradeLevelId` supplied by the route, not the file"). Apply the identical presence/allowed-value check at commit time, keyed off that resolved grade's type; `learnerCsvTemplate(gradeType)` drops the English column entirely when the target grade doesn't collect it, matching what the form does.

### 4b. Assessment completeness becomes grade-aware -- the four call sites

`COMPLETE_ASSESSMENT_WHERE` (`src/lib/aral/reading-level-progress.ts`) is a **static** Prisma `where` fragment today (`englishProfile: { not: null }, filipinoProfile: { not: null }, ...`). Left static, every Grade 1/Grade 2 ARAL learner would become permanently "incomplete" the moment English collection stops, because English can never be recorded for them again. It is replaced by `completeAssessmentWhereForGrades` (section 3), called with the actual set of grades in scope at each site:

| Site | Change |
|---|---|
| `src/lib/aral/reading-level-progress.ts` (`countMonthlyAssessmentProgress`) | Drop the static export. Add a `grades: { id: string; type: string }[]` argument (replacing the implicit single-grade assumption baked into callers today); build the where with `completeAssessmentWhereForGrades(args.grades)`. |
| `src/lib/actions/aral-grid.ts` (`resolveGradeLearnerWhere`) | The `prisma.gradeLevel.findFirst` already loads the one grade in scope; add `type: true` to its `select` and pass `[{ id: grade.id, type: grade.type }]` into `countMonthlyAssessmentProgress`. |
| `src/lib/dashboard/aggregates.ts` (`getTeacherReadingOverview`) | The `grades` query currently `select: { id: true }` only -- widen to `{ id: true, type: true }` and pass `grades` straight into `completeAssessmentWhereForGrades`. This is the site that actually needs the multi-grade OR: a teacher may advise a Kinder section and ARAL-tutor a Grade 6 section in the same call. |
| `src/lib/dashboard/teacher-overview.ts` (`getTeacherOverview`) | `grades` already selects `{ id: true, type: true }` -- no extra query, just swap the static import for `completeAssessmentWhereForGrades(grades)`. |

The monthly grid's own client-side counters (`isRowComplete` / `countRows` in `aral-monthly-reading-level-grid-form.tsx`) currently hardcode the same four-field check the server predicate encodes. Per "a decision belongs in one place", `isRowComplete` is replaced with a call into the equivalent of `isReadingRecordComplete(row, gradeType)` (section 3) rather than re-deriving the same rule a third time.

A writing-only legacy row (all four reading fields null, `writingLevel` set) already fails every shape of `completeAssessmentWhereForGrades` by construction -- nothing in this change makes it start counting as progress.

### 4c. Writing preservation on the monthly upsert

Current behaviour (`bulkRecordMonthlyReadingLevel`, `src/lib/actions/reading-level.ts`): the raw `INSERT ... ON CONFLICT DO UPDATE` names `"writingLevel" = EXCLUDED."writingLevel"`, and `EXCLUDED."writingLevel"` comes from `entry.writingLevel ?? null`. Once the grid stops sending `writingLevel` (section 6), every save of an existing month would null every row's historical writing value on the very next edit of *any* other field.

**Exact change, in two parts.**

**Upsert.** Drop `writingLevel` from the entry payload's type (`RawReadingLevelRow` loses the field), from the `INSERT ... VALUES` column list, and from the `DO UPDATE SET` list. A brand-new row still inserts with `writingLevel` implicitly `NULL` (the column has no default) -- correct, since nothing can write writing going forward. An existing row's `writingLevel` is **not named in `SET`**, so Postgres's `ON CONFLICT DO UPDATE` leaves it exactly as it was. This is the whole fix: omission, not a preserved-value round-trip.

**Clears.** Current behaviour is a hard `DELETE FROM "ReadingLevelRecord"` filtered by learner id and the month's date range -- a full-row delete, which would destroy a legacy `writingLevel` value on any row a teacher's "Clear row" happens to touch, even though writing is invisible to them in this UI and clearing it was never their intent. Replace the single `DELETE` with two statements inside the same transaction, same predicate:

1. An `UPDATE` that sets `englishProfile`, `filipinoProfile`, `wordRecognitionLevel`, `readingComprehensionLevel` and `notes` to `NULL` for the matched rows (same tenant + month-range + learnerId predicate as today), returning the affected ids. It never names `writingLevel`.
2. A `DELETE` of exactly those returned ids, further filtered to `writingLevel IS NULL` -- a row that is now entirely empty (no legacy writing either) is removed, matching today's externally-visible behaviour for a row with no writing history. A row that still carries a legacy `writingLevel` survives, silently converted from "full assessment" to "writing-only legacy row" -- which is precisely what it now is.

`cleared` (the count returned to the client and written to the audit row) is the row count from step 1 (the teacher's "N cleared" experience is unchanged); step 2's physical delete count is an internal storage-tidiness detail, not surfaced.

**Distinguishing "explicit clear" from "untouched legacy" -- resolved, with the underlying call flagged as an open question (section 9).** Because the grid never shows `writingLevel` again, there is no future gesture that can "explicitly clear" it -- freezing it (never nulling it from this action, ever) is the only interpretation consistent with decision F's "the DB column and all historical rows are preserved" read literally. A row nobody has touched since the rubric change and a row a teacher explicitly cleared through this UI end up in the *same* observable state (reading fields null, writing preserved if it existed) -- which is correct, because after this change "clear the reading assessment" is the only clear this UI can express, and it must mean the same thing regardless of what is sitting untouched in the writing column.

## 5. Migrations, in apply order

All three are additive/widening only -- no column is dropped, renamed, or backfilled, and no existing row changes. None touches `Enrollment`, so its SQL-only partial unique index (`Enrollment_learner_active_unique`) is untouched and not at risk here.

**`prisma/migrations/20260914000001_reading_profile_early_grade_rubric/migration.sql`**

```sql
-- Kinder/Grade 1/Grade 2 reading rubric (docs/reading-policy-spec.md). Four new
-- members on the existing "ReadingProfile" enum. Grades 3-10 keep writing the
-- original four values; Grade 11-12 keep writing three of the original four
-- (Zod-only restriction, no schema change - see migration ...003's note).
-- Purely additive: no existing row can hold one of these values yet, and
-- nothing else in this file uses them, so there is no same-transaction hazard.
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CANNOT_NAME_SOUND_LETTERS';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'LETTER_LEVEL';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CV_BLENDING';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CVC_BLENDING';

-- Rollback: Postgres cannot drop a single enum value; only rebuilding the type
-- (rename, recreate, cast every column, drop the renamed type) can remove one,
-- and that is destructive the moment any row holds one of these four. Safe to
-- roll back only before the accompanying application change ships.
```

**`prisma/migrations/20260914000002_nutritional_status_overweight/migration.sql`**

```sql
-- Section A nutritional status gains "Overweight", ordered between Normal and
-- Obese to match the DepEd display order (docs/reading-policy-spec.md).
ALTER TYPE "NutritionalStatus" ADD VALUE IF NOT EXISTS 'OVERWEIGHT' BEFORE 'OBESE';

-- Rollback: same caveat as migration ...001 - safe only before any row is
-- saved with OVERWEIGHT.
```

**`prisma/migrations/20260914000003_learner_english_reading_profile_optional/migration.sql`**

```sql
-- Grade 1 and Grade 2 stop collecting an English reading level (Kinder and
-- Grade 3+ are unaffected). Widened, not dropped or renamed: every row written
-- before this migration already carries a value and is untouched; only a
-- Grade 1/Grade 2 learner created or edited by the accompanying application
-- change may now save one with englishReadingProfile left NULL.
ALTER TABLE "Learner" ALTER COLUMN "englishReadingProfile" DROP NOT NULL;

-- No index touches this column; no backfill; no data rewritten.
-- Rollback: `ALTER TABLE "Learner" ALTER COLUMN "englishReadingProfile" SET NOT
-- NULL` only succeeds while every row is still non-NULL. Once a Grade 1/Grade 2
-- learner is saved with no English value there is no honest value to backfill
-- with (decision I) - treat this as a one-way door once the application change
-- ships.
```

**No migration for:** the age ceiling (section 6, decision A -- `Learner.age` carries no DB `CHECK`, confirmed by grepping every `migration.sql` for one; the 3-70 range is Zod-only, same as today's 3-25), the G11/G12 label restriction (Zod-only, reuses existing enum members), or writing removal (no schema change -- the column and every row survive verbatim, per section 4c).

**Rollout order.** A human applies all three migrations, in the order above, **before** the release that ships the backend/frontend changes in section 6 deploys (mirroring `20260912000002_add_teacher_presence`'s documented rule). Reasoning: these migrations are pure supersets (new enum members nobody writes yet; a NOT NULL constraint relaxed on a column every existing row already satisfies), so the *old* application code continues running against the migrated schema with zero behaviour change during the gap between migration and deploy. The reverse order is not safe -- new code that tries to write `CANNOT_NAME_SOUND_LETTERS`, `OVERWEIGHT`, or a NULL `englishReadingProfile` against the pre-migration schema fails at the database (invalid enum input / NOT NULL violation) for exactly the rows it touches. A stale client (an already-loaded browser tab running the previous bundle) posting the previous, stricter payload shape to a newly deployed server action is handled the same way any other version-skew payload already is -- the action's Zod parse or the new grade-aware check rejects it with a generic message; no bespoke handling is added.

## 6. Ordered task breakdown

Tasks are numbered within their phase; phases are strictly ordered (schema before code that queries it, backend before frontend that calls it). Within a phase, tasks touching the **same file** are marked **(serialize)** and must land as one pass by one contributor, not parallel edits.

### Phase 1 -- `database-engineer` (`prisma/**` only)

1. Edit `prisma/schema.prisma`: add the four `ReadingProfile` members (section 2a), add `OVERWEIGHT` to `NutritionalStatus` between `NORMAL` and `OBESE` (section 5), change `Learner.englishReadingProfile` to `ReadingProfile?`. Run `prisma format` then `prisma validate`.
2. Author the three migration files in section 5, verbatim.
3. Run `npx prisma generate` locally (offline, no DB connection -- reads `schema.prisma` only) so the regenerated `@prisma/client` types carry the new enum members and nullability for Phase 2's typecheck. **Do not run `migrate dev`/`migrate deploy`/`db push`.**

### Phase 2 -- `backend-developer` (`src/lib/{actions,validators,auth,cache}/**`, `src/app/api/**`; see the ownership note below for the files this spec touches outside that literal list)

4. New file `src/lib/reading/policy.ts` (section 3) -- the whole module in one pass.
5. `src/lib/validators/common.ts` -- add `export const LEARNER_AGE_RANGE = { min: 3, max: 70 } as const;`.
6. `src/lib/constants/enum-labels.ts` **(serialize -- one file, do before 7-17 since they all import from it)** -- add `EARLY_RUBRIC_LABELS`, `READING_PROFILE_LABELS_SHS`; extend the flat `READING_PROFILE_LABELS` with the four new keys (needed so `src/lib/reports/queries.ts`'s existing ungrouped lookup -- section 7 row 4 -- resolves the new values without itself changing); extend `NUTRITIONAL_STATUS_LABELS` with `OVERWEIGHT` in display position; update `readingProfileLabelsForGradeType` / `labelReadingProfile` per the value-first dispatch in section 2.
7. `src/lib/validators/learner.schema.ts` -- `READING_PROFILE` gains the four new values; `englishReadingProfile` becomes `optionalEnum(READING_PROFILE)`; `NUTRITIONAL_STATUS` gains `OVERWEIGHT`; `age` uses `LEARNER_AGE_RANGE`.
8. `src/lib/validators/learner-import.schema.ts` -- same four changes, mirrored.
9. `src/lib/validators/reading-level.schema.ts` -- `READING_PROFILE` gains the four new values (`monthlyBulkEntryFields`, and the dead `readingLevelSchema`/`bulkEntryFields` for consistency); remove `writingLevel` from `monthlyBulkEntryFields` only (section 4c) -- leave `readingLevelSchema`/`readingLevelBulkSchema` untouched, they have no live caller (task 26).
10. `src/lib/actions/learner.ts` -- `createLearner`/`updateLearner` per section 4a (grade-resolved validation, conditional key omission on both create and update).
11. `src/lib/actions/reading-level.ts` -- `bulkRecordMonthlyReadingLevel` per section 4c (drop `writingLevel` from the upsert; two-step clear; add `gradeLevel: { select: { type: true } }` to the learners lookup and validate each entry's `englishProfile`/`filipinoProfile` against `allowedReadingValuesForGrade` for that learner's own grade).
12. `src/lib/aral/reading-level-progress.ts` -- replace `COMPLETE_ASSESSMENT_WHERE` with the `grades`-parameterized call into `completeAssessmentWhereForGrades` (section 4b).
13. `src/lib/actions/aral-grid.ts` -- `resolveGradeLearnerWhere` selects grade `type`, threads it into `countMonthlyAssessmentProgress` (section 4b).
14. `src/lib/dashboard/aggregates.ts` -- `getTeacherReadingOverview` selects grade `type`, swaps to `completeAssessmentWhereForGrades` (section 4b).
15. `src/lib/dashboard/teacher-overview.ts` -- same swap; no extra query (section 4b).
16. `src/lib/actions/export-learners.ts` -- null-guard `l.englishReadingProfile` before `labelReadingProfile(...)`.
17. `src/lib/learners/profile.ts` -- widen `LearnerProfileData.englishReadingProfile` to `string | null`; `src/lib/actions/learner-profile.ts` -- verify the Prisma select/return flows the wider type without further change.
18. `src/lib/actions/import-learners.ts` + `src/lib/learners/import-csv.ts` **(serialize -- the commit path spans both)** -- grade-resolved validation mirroring task 10; `learnerCsvTemplate(gradeType)` drops the English column when the target grade doesn't collect it.
19. `src/lib/reports/queries.ts` -- **verify only**, no code change expected: `buildReadingLevelTable` already reads the flat `READING_PROFILE_LABELS` map, which task 6 widens; confirm the report renders the four new values and the SHS labels correctly and that Grades 3-10 output is byte-identical to before.

**File-ownership note.** `CLAUDE.md` lists `backend-developer`'s globs as `src/lib/{actions,validators,auth,cache,supabase}/**` + `src/app/api/**` + `src/middleware.ts`. Tasks 4, 6, 12-15, 17 and 19 above touch `src/lib/reading/**`, `src/lib/constants/**`, `src/lib/aral/**`, `src/lib/dashboard/**`, `src/lib/learners/**` and `src/lib/reports/**`, which are outside that literal list but are server/domain logic (Prisma-backed or pure business rules), not components or JSX -- this spec assigns them to `backend-developer` as the closest fit and flags the gap explicitly rather than silently stretching the stated boundary.

### Phase 3 -- `frontend-developer` (`src/components/**`, JSX)

20. `src/components/learners/reading-band-pill.tsx` -- add `BAND_TONE` entries for the four new rubric values (rose -> amber -> blue -> emerald, weakest to strongest, matching the file's existing ramp convention).
21. `src/components/forms/learner-form.tsx` **(serialize with 22 -- both restructure the create-time placement flow)** -- age input `min`/`max` from `LEARNER_AGE_RANGE`; reading section switches to `readingProfileOptionsForGrade(selectedGradeType)`; the whole "Reading Level (English)" block (radio group + frustration checkboxes) is hidden and stripped from the submitted `FormData` when `languagesForGrade(selectedGradeType)` excludes `ENGLISH`; `LEARNER_FORM_SECTIONS`'s `identity`/`reading` `requiredFields` stop counting `englishReadingProfile` in that case; remove the in-form multi-advisory `Select` entirely (superseded by task 22) so `LearnerForm` always receives a single resolved placement in create mode.
22. `src/components/learners/add-learner-dialog.tsx` + a new chooser component (naming at `frontend-developer`'s discretion, e.g. `src/components/learners/advisory-chooser-dialog.tsx`) -- implement decision H: when `placements.length > 1`, show grade+section together (reuse `AdvisoryPlacement.label`) in a step *before* `LearnerForm` mounts; `placements.length <= 1` keeps today's behaviour untouched. **No backend change is required for "server-revalidated on submit"** -- `createLearner` already re-derives `placements` from `getAdvisoryPlacements(user)` and re-checks the chosen section through `resolveAdvisoryTarget` on every submit (`src/lib/actions/learner.ts`), so a placement picked in step 1 is always re-validated against the teacher's *current* advisories at save time, not merely at modal-open time.
23. `src/components/learners/learner-add-menu.tsx` -- verify only; adjust prop plumbing if task 22's new component changes the trigger API.
24. `src/components/forms/aral-monthly-reading-level-grid-form.tsx` -- remove the Writing column and all associated state/constants (`RowState.writingLevel`, `EMPTY_ROW.writingLevel`, `WRITING_BAND`, `WRITING_ORDER`, the Writing `ScaleHead`/cell) per decision F; `profileBandFor` switches to `readingProfileOptionsForGrade(gradeType)`; the English column (header + cell) is omitted entirely when `languagesForGrade(gradeType)` excludes it; `isRowComplete`/`hasAnyValue` delegate to the `isReadingRecordComplete`-equivalent logic from `src/lib/reading/policy.ts` instead of re-deriving the four-field check inline; `hadRecord`'s seed and the `clears` computation in `handleSave` are redefined to track only rows with *visible* data (English/Filipino/word/comprehension/notes) -- never a row whose only stored value is a legacy `writingLevel` (section 4c) -- so such a row can never be sent in `clears` by this UI.
25. `src/app/teacher/(app)/grade/[id]/learners/[learnerId]/page.tsx`, `src/components/learners/learner-profile-modal/reading-panel.tsx`, `src/components/learners/learner-profile-modal/profile-panel.tsx`, `src/components/reports/printable-learners-report.tsx`, `src/components/learners/learner-list-client.tsx`, `src/app/teacher/(app)/learners/page.tsx` -- null-guard any now-possibly-null `englishReadingProfile` render path (blank/"--", not a crash); confirm `OVERWEIGHT` renders via the existing generic `NUTRITIONAL_STATUS_LABELS` lookup with no code change.
26. **Do not touch** `src/components/forms/reading-level-form.tsx` or `src/app/teacher/(app)/aral/[gradeId]/learners/[id]/reading-level/page.tsx`. `ReadingLevelForm` has no importer anywhere in `src/` (confirmed by search) -- it and the `recordReadingLevel`/`readingLevelSchema` action/schema pair it calls are dead code, same category as the already-noted-dead weekly bulk schema. Folding this spec's changes into them risks resurrecting a path nobody exercises; leave them exactly as they are.

### Phase 4 -- `qa-test-engineer` (`tests/**`, `e2e/**`, read-only on source)

27. Unit tests for `src/lib/reading/policy.ts` -- table-driven over every `GradeLevelType`: `languagesForGrade`, `allowedReadingValuesForGrade`, `isReadingRecordComplete`, and `completeAssessmentWhereForGrades` for a mixed-grade set (e.g. one Kinder id + one G5 id) asserting the emitted `OR` shape.
28. Extend `tests/unit/validators/learner.schema.test.ts` and the CSV import validator tests -- `englishReadingProfile` omissible; age accepts 70, rejects 71; `nutritionalStatus` accepts `OVERWEIGHT`.
29. Extend `tests/unit/actions/reading-level-bulk-save.test.ts` -- a fixture row with a legacy `writingLevel` and no other field survives an unrelated save untouched; a save that clears a row's visible fields preserves that row's `writingLevel` and does not delete the row; a save that clears a row with no legacy `writingLevel` deletes it (matches today's externally-visible behaviour).
30. Extend `tests/unit/reading-level-progress.test.ts` and `tests/unit/actions/aral-grid-reading-level.test.ts` -- a Grade 1/Grade 2 ARAL learner with Filipino+word+comprehension set (no English) counts as complete; the equivalent Grade 5 learner with the same three fields set does not.
31. Regression pass: re-run `tests/unit/reports/queries-reading-level.test.ts`, `tests/components/aral-monthly-grid-partial-save.test.tsx`, `tests/unit/learner-form-progress.test.ts`, `tests/components/learner-form-ethnicity*.test.tsx`, `tests/components/learner-profile-modal.test.tsx`, `tests/unit/import-csv.test.ts`, `tests/unit/actions/import-learners-commit.test.ts`, `tests/unit/actions/export-learners-ethnicity.test.ts` and confirm Grade 3-10 fixtures produce byte-identical output before and after.
32. e2e (if exercised in this change): the two-step advisory chooser for a fixture teacher with 2-3 advisories; a Kinder monthly grid page showing both languages with the new rubric; a Grade 1 monthly grid page showing Filipino only.

## 7. Regression fence -- Grades 3-10

Every consumer of the shared `ReadingProfile` enum/label helpers found by grepping `src/` for `isEarlyGradeReadingBand`, `readingProfileLabelsForGradeType`, `READING_PROFILE_LABELS*`, `labelReadingProfile`, `englishReadingProfile`, `filipinoReadingProfile`, `COMPLETE_ASSESSMENT_WHERE`, and `isRowComplete` (the task's own audit list, confirmed against the checkout, not assumed):

| File | Changes for G3-G10? |
|---|---|
| `src/lib/constants/enum-labels.ts` | Gains new branches/entries; every existing key, value and label for `NON_DECODER_LOW_EMERGENT`/`FRUSTRATION_HIGH_EMERGENT`/`INSTRUCTIONAL_DEVELOPING`/`INDEPENDENT_GRADE_READY` under `readingProfileLabelsForGradeType("G3".."G10")` is untouched (section 2's dispatch order only intercepts the four *new* values before falling through to exactly today's logic). |
| `isEarlyGradeReadingBand` / `EARLY_GRADE_TYPES` | **No change.** Still `{KINDER, G1, G2, G3}`, still governs only which *label set* an *original-enum* value gets. |
| `src/lib/reading/policy.ts` (new) | New file; G3-G10 route through `STANDARD_VALUES` / both-languages / the unchanged 4-field completeness check -- same values, same rule, expressed once instead of three times. |
| `src/lib/validators/learner.schema.ts`, `learner-import.schema.ts` | `READING_PROFILE` grows (a superset -- old values still valid everywhere); `englishReadingProfile` stays *required in practice* for G3-G10 via the action-level check in section 4a, even though the Zod shape is now structurally optional. |
| `src/lib/actions/learner.ts` (`createLearner`/`updateLearner`) | For a G3-G10 placement, `languagesForGrade` returns both languages and `allowedReadingValuesForGrade` returns `STANDARD_VALUES` -- identical to today's implicit behaviour. |
| `src/lib/actions/reading-level.ts` (`bulkRecordMonthlyReadingLevel`) | Same -- no value-set narrowing for G3-G10; the writing-upsert fix (section 4c) changes storage semantics for *every* grade equally, which is intended (decision F is grade-independent). |
| `src/lib/aral/reading-level-progress.ts`, `src/lib/actions/aral-grid.ts`, `src/lib/dashboard/aggregates.ts`, `src/lib/dashboard/teacher-overview.ts` | `completeAssessmentWhereForGrades` for an all-G3-G10 grade set collapses to exactly today's single `AND` shape (the "English required" branch only, both-languages required) -- no `OR` is even generated when every grade in the set requires both languages. |
| `src/components/forms/learner-form.tsx` | English section keeps rendering for G3-G10; `readingProfileOptionsForGrade` returns the same four values/labels `readingProfileLabelsForGradeType` returns today for those grades. |
| `src/components/forms/aral-monthly-reading-level-grid-form.tsx` | English column keeps rendering; profile band options unchanged; **only** the Writing column disappears (decision F, grade-independent, not a G3-G10-specific change but stated here since this file is in scope). |
| `src/components/learners/reading-band-pill.tsx` | `BAND_TONE` gains keys, loses none; G3-G10 pills use the same four existing keys/tones. |
| `src/lib/reports/queries.ts`, `src/lib/actions/export-learners.ts`, `src/components/reports/printable-learners-report.tsx` | Output for G3-G10 rows is byte-identical (task 31 pins this explicitly). |
| `src/components/learners/learner-profile-modal/reading-panel.tsx`, `.../profile-panel.tsx`, `src/app/teacher/(app)/grade/[id]/learners/[learnerId]/page.tsx` | Only gain a null-guard for the now-nullable English field; G3-G10 rows are never null there, so the guard is inert for them. |
| `src/components/forms/reading-level-form.tsx`, the `[id]/reading-level` page | Dead, untouched (task 26). |

## 8. Alternatives rejected

1. **A second `ReadingProfile`-like enum plus parallel nullable columns for the K/1/2 rubric** -- rejected in section 2; doubles the touched-file surface and does not solve the cross-grade-promotion label ambiguity any better than value-first dispatch on a single enum does.
2. **Keep `COMPLETE_ASSESSMENT_WHERE` static and simply drop the `englishProfile` clause from it entirely** (i.e. never require English for completeness, for any grade) -- rejected: this would silently loosen what "assessed" means for Grade 3-10 and Kinder too, which decision E and the Kinder half of decision C explicitly forbid. Completeness must stay per-grade, not globally loosened.
3. **Treat "Clear row" on the monthly grid as a genuine full erase (including any legacy `writingLevel`)** -- rejected as the default in section 4c because decision F's "historical rows are preserved" reads as unconditional and the UI can no longer show the teacher what they'd be erasing; kept as an explicit open question (section 9) rather than silently decided either way, since it is a real product judgment call.
4. **Show the advisory-chooser modal even for a single advisory** (an extra confirm step for the common case) -- rejected as the default (task 22 keeps today's "shown, never chosen" single-placement behaviour) because decision H's wording does not clearly demand it and the UX cost (one extra click for the majority of teachers, who hold exactly one advisory) is real; flagged as an open question rather than decided silently.

## 9. Open questions (not resolved by this spec -- do not invent an answer)

1. **G11/G12 "corrected spelling."** No existing misspelling of "Frustration"/"Independent"/"Instructional" was found anywhere in the checkout (source files, docs, or seed data) to correct. This spec implements the literal labels from the confirmed decision (`Independent Level`, `Instructional Level`, `Frustration Level`). If the project owner had a specific prior wording in mind (e.g. from an external DOCX source not present in this repo), confirm the exact copy before `enum-labels.ts` ships.
2. **Should "Clear row" on the monthly grid ever be allowed to erase a legacy `writingLevel` value?** This spec's default (section 4c, section 8.3) is "never -- freeze it, since the teacher can no longer see it to decide." That is the conservative reading of decision F, not a certainty; confirm with the project owner if a genuine full-erase path is wanted for writing-only legacy rows.
3. **Should the advisory-chooser modal (decision H) appear for a teacher with exactly one advisory?** This spec's default (section 8.4) is no -- unchanged from today. If "gains an advisory-chooser modal before the learner form" was meant literally for every add, regardless of advisory count, that changes task 21/22's scope.
