# End of Terms Reports — Design

Date: 2026-08-22
Status: approved for implementation

## Purpose

A per-term grade sheet inside the ARAL module. A DepEd teacher who advises a section encodes one score per learning area per term for every learner in that section; the sheet computes a General Average, exports to Excel, and becomes read-only once the term's date window has passed.

Source of truth for layout: the annotated mock at `5a1a4d67-45d3-4fc5-868e-1ac908b5100c.jpg`. Layout is followed as drawn; the deviations are listed under "Deliberate deviations" and each is justified.

## Approved decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Access gate | Advisory placement + existing non-DepEd designation check | Composes two tested helpers; no schema change; `employmentType` is NULL for every teacher row and is schema-marked DISPLAY ONLY |
| Roster scope | The adviser's own advisory section | A term report card is a whole-class artifact |
| Subject list | The mock's 8 (JHS set) for every grade | Explicit user choice; isolated in one constant so a per-grade-band map is a later one-file change |
| Export | Excel only | Repo has exceljs; it has no PDF library at all |
| Term model | Enum terms, windows derived from the active SchoolYear | One table, no seeding, no backfill, no cron |
| Manual lock | Deferred | Appears under the mock's best practices, not its requirements |
| Score range | 60-100 | 75 is DepEd's passing mark, not its floor; a 75 floor makes a failing learner unrecordable |
| General Average | Computed on read, never stored | Cannot drift from the cells |
| Score type | `Int` | DepEd quarterly grades are whole numbers |

## 1. Data model

Two enums and one table, following `ReadingLevelRecord` — the existing per-period, teacher-recorded precedent.

```prisma
enum TermPeriod { FIRST SECOND THIRD }

enum LearningArea {
  ENGLISH FILIPINO MATHEMATICS SCIENCE
  ARALING_PANLIPUNAN EDUKASYON_SA_PAGPAPAKATAO MAPEH TLE
}

/// One learner's grade in one learning area for one term of one school year.
/// Corrected by overwrite, never soft-deleted - hence no `deletedAt`.
model TermGrade {
  id           String       @id @default(uuid())
  learnerId    String
  schoolYearId String
  term         TermPeriod
  subject      LearningArea
  score        Int          // 60-100, enforced by a CHECK constraint in SQL
  recordedById String
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  learner    Learner    @relation(fields: [learnerId], references: [id], onDelete: Cascade)
  schoolYear SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)
  recordedBy User       @relation("TermGradeRecorder", fields: [recordedById], references: [id])

  @@unique([learnerId, schoolYearId, term, subject])
  @@index([schoolYearId, term])
}
```

Back-relations to add: `TermGrade[]` on `Learner`, on `SchoolYear`, and on `User` under the relation name `TermGradeRecorder`.

Notes:

- `LearningArea` is new. The existing `Subject` enum is a dead teacher-survey artifact (`ARALPAN`, `ABM`, `TECHVOC`) that the schema already marks for removal; a live feature must not depend on it.
- `schoolYearId` is required because a term enum carries no year. Without it, next year's Term 1 English collides with this year's.
- No `schoolId` column, matching `ReadingLevelRecord`. Tenancy is enforced by the learner query being scoped to `user.schoolId`.
- The 60-100 CHECK constraint is raw SQL in the migration because Prisma's schema language cannot express it. Precedent: `Enrollment`'s partial unique index is SQL-only for the same reason.

Migration: `prisma/migrations/20260822000001_term_grades/migration.sql` (lineage ends at `20260819000001`). Authored only. A human applies it. No command touches a remote database.

## 2. Term windows and locking

New module `src/lib/terms/windows.ts`.

Term N spans three whole months from the active `SchoolYear.startDate`'s month, snapped to month boundaries using `addMonths` from `src/lib/month-range.ts`.

`SchoolYear.startDate` is a bare `DateTime` (timestamp, not `@db.Date`) and the app runs in UTC+8, so the month is read as `formatLocalDateKey(sy.startDate).slice(0, 7)` and never off the raw `Date` — reading it directly shifts a school year starting August 1 back into July.

A school year starting in August yields Aug-Oct / Nov-Jan / Feb-Apr, the mock's exact labels. A June-start school gets correct windows with no code change.

Locking is one pure function comparing local date keys as strings:

```
isTermLocked(window, todayKey) === todayKey > window.endKey
```

String comparison on `YYYY-MM-DD` is total and sidesteps `Date` arithmetic. Today comes from `schoolToday()`, never `new Date()` — otherwise every term locks a day early between midnight and 08:00 Manila.

No lock column, no cron, no scheduled job.

Exports: `TERM_PERIODS` (ordered), `getTermWindows(schoolYearStart)`, `isTermLocked(window, todayKey)`, `resolveTermWindow(windows, term)`.

`src/lib/terms/average.ts` exports `generalAverage(scores)` — the mean of the filled cells only, rounded to 2 decimals, `null` when nothing is filled. One implementation shared by the grid and the export.

**No active school year is a real state** (the schema permits it; learner creation already skips enrollment when there is none). The page renders a violet `InfoCard` saying a school year must be active. Not a crash, and not an empty grid that silently discards input.

## 3. Access control

Route: `/teacher/aral/[gradeId]/terms-reports`, a fourth sibling of `attendance` and `reading-level`.

Server page guard order:

1. `requireUser("TEACHER")`; `isSuperAdmin = user.role === "SUPER_ADMIN"`.
2. `if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling")`.
3. Teachers: `getAdvisoryPlacement(user)` must be non-null, and `deniesAdvisoryRoster({ isSuperAdmin, designation })` must be false. Failure renders a violet explanation card using the nav's exact wording ("for DepEd teachers who advise a section") — not a 404, matching `src/app/teacher/(app)/learners/page.tsx`.
4. Grade scope uses `teacherAdvisoryGradeScope(user.id)`, **not** `teacherGradeScope`. The latter is a union including ARAL-tracked grades, which would let an ARAL-only tutor reach a sheet they must not write.
5. The URL's `gradeId` must equal `advisory.gradeLevelId`, else refuse — mirroring `src/lib/actions/learner.ts:105-120`.

Roster where-clause for a teacher:

```ts
{ schoolId: user.schoolId, sectionId: advisory.sectionId,
  deletedAt: null, archivedAt: null, ...nameSearchWhere(list.q) }
```

Paginated with `parseLearnerListParams(sp, LEARNER_LIST_DEFAULT_PAGE_SIZE)` (10 per page), ordered by `fullName asc`. Both `q` and `page` are already supported params with existing Prisma helpers — the mock's search box needs no new machinery.

Super Admin: skips the advisory gate, resolves the school from `?schoolId=`, scopes by grade with the section filter like the sibling pages, and is **read-only** (`readOnly={isSuperAdmin}`), matching how both siblings already treat admin view.

## 4. Save action

`src/lib/actions/term-grades.ts`, following `bulkRecordMonthlyReadingLevel` (`src/lib/actions/reading-level.ts:113-233`) and returning the house `ActionResult`.

1. `requireSchoolUser("TEACHER")`.
2. Zod `safeParse` of `{ gradeLevelId, term, entries: [{ learnerId, subject, score }] }` where `score` is `int().min(60).max(100).nullable()`. Schema lives in `src/lib/validators/term-grade.schema.ts`.
3. Re-derive the advisory placement and the designation gate server-side. A client-posted `gradeLevelId` is never trusted.
4. Resolve the active `SchoolYear`; refuse when there is none.
5. Re-derive the term window and **refuse when the term is locked**. The client disables the inputs, but the client is not the enforcement point.
6. `findMany` the posted learner ids scoped to `schoolId` + the advisory section; refuse the whole batch when the returned count differs from the requested count. Cross-tenant or cross-section ids fail closed.
7. `$transaction`: upsert on `@@unique([learnerId, schoolYearId, term, subject])` for non-null scores; `deleteMany` for cleared cells. Score is non-nullable, so a cleared cell is a row deletion, not a null write.
8. `writeAudit({ action: AUDIT_ACTIONS.TERM_GRADES_BULK_SAVE, ... })` with `gradeLevelId`, `sectionId`, `term`, `schoolYearId`, saved/cleared counts and learner ids. **Never the score values** — those are learner PII, and `docs/privacy.md` plus the audit conventions forbid putting them in metadata.
9. `revalidatePath` for the route plus `revalidateLearnerScoped({ schoolId, teacherId })`.

New keys in `AUDIT_ACTIONS` (`src/lib/audit.ts`): `TERM_GRADES_BULK_SAVE`, `TERM_GRADES_EXPORT`.

## 5. Export

`exportTermGrades` in `src/lib/actions/term-grades.ts`, following `src/lib/actions/export-learners.ts`: exceljs via dynamic import, server action returns base64, the client builds a Blob and clicks a synthetic anchor. No route handler and no `Content-Disposition`.

One sheet: `#`, Complete Name, the 8 learning areas, General Average. Header row bold, matching the only styling the existing exporter uses.

Filename `litrack-term-grades-<term>-<YYYY-MM-DD>.xlsx` built with `formatLocalDateKey(schoolToday())`. The existing exporter uses `toISOString().slice(0,10)` there, which violates the repo's own date rule; the new code will not copy that bug, and the existing bug is out of scope.

Unlike `export-learners.ts`, this action **does** `safeParse` its input, per the house pattern.

## 6. UI

Three files, mirroring the monthly reading-level trio.

- `src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx` — server page: auth, gate, queries, `AppShell`.
- `src/components/aral/aral-term-grades-panel.tsx` — client panel.
- `src/components/forms/aral-term-grades-grid-form.tsx` — client grid, with `forwardRef` + `useImperativeHandle` exposing `{ save }`, matching both existing grid forms.

Mock mapping, top to bottom:

| Mock element | Implementation |
| --- | --- |
| Title + subtitle | `AppShell title` / `subtitle` |
| Header buttons | `AppShell actions` — links to Weekly Attendance, Monthly Reading Level, and `EnrollToAralDialog`, using each sibling's existing label |
| SELECT TERM, 3 tabs with durations | A 3-button row above the card |
| Auto-Lock info panel | The existing violet `InfoCard` |
| Grade Level dropdown | `AralFilterPopover` |
| Search learner | `Input`, driving the existing `?q=` param |
| Export / Save Grades | Toolbar right slot; Save is violet, matching the monthly panel |
| LEARNER + SUBJECTS AND GRADES header groups | The existing two-span `ScaleHead` idiom |
| 8 subject cells | Number inputs, 60-100 |
| GENERAL AVERAGE column | Violet, 2 decimals, from `generalAverage` |
| Showing X to Y of Z + pages | `LearnerListFooter` |

The term tabs are a button row rather than a third mode inside `AralDateNav`, because that component is built around a date value this page has no use for. The toolbar beneath reuses `AralDateNav`'s exact container classes (`flex flex-wrap items-center gap-3 border-b border-border/60 p-4`) so it is visually identical without contorting the component.

The grid diffs against a snapshot and sends only changed cells, like the weekly attendance form, so the audit counts mean something and an untouched sheet saves nothing.

Read-only when the term is locked or the viewer is Super Admin: inputs disabled, Save hidden, Export still available — the mock requires that viewing and export survive locking.

## 7. Deliberate deviations from the mock

1. **Term tabs are their own row, not `AralDateNav`.** Justified above.
2. **Score floor is 60, not 75.** A 75 floor makes a failing learner unrecordable and pushes teachers to enter a false 75. 75 remains a UI passing threshold for styling only.
3. **No PDF export.** The repo has no PDF library; "PDF" everywhere in this app means `window.print()`. Excel only, per the approved decision.
4. **No manual lock button.** Best-practice note in the mock, not a requirement. Auto-lock satisfies the stated behaviour.
5. **Subject columns are the JHS 8 for every grade**, per explicit decision. Kinder, G1-3 and SHS will show JHS headers. Isolated in one constant.

## 8. Nav wiring

`src/lib/nav/nav-config.ts` already parks the item at `:156-162` with `soon: true` and an href that collides with the live Reports item. Change its href to `aralHref(grades, "terms-reports")` and delete `soon: true`. It stays in the "Menu" group, where the existing comment deliberately placed it.

Non-DepEd volunteers get the same `unavailable` treatment the Learners item already uses: `{ pill: "DepEd only", reason: "for DepEd teachers who advise a section" }`.

## 9. Testing

Unit (Vitest):

- `windows.ts` — August-start yields the mock's three windows; June-start yields June-Aug / Sep-Nov / Dec-Feb; Term 3 crosses the calendar year; the lock boundary is inclusive on the last day and locked the day after; a 01:00-Manila "today" does not lock a day early.
- `average.ts` — filled-only mean, 2-decimal rounding, `null` on empty.
- `term-grade.schema.ts` — rejects 59 and 101, accepts 60 and 100, accepts null, rejects a non-integer.
- The action's refusals — locked term, learner outside the advisory section, cross-tenant learner id, no active school year, non-adviser caller.

Gates before done: `prisma generate`, `typecheck`, `lint`, `test`, `build`.

## 10. Out of scope

Per-school configurable term dates, manual lock, PDF export, per-grade-band subject sets, School Head and Super Admin term-grade dashboards, and fixing `export-learners.ts`'s pre-existing `toISOString` date bug.
