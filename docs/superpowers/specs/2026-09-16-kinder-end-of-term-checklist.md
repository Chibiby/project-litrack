# Kindergarten End-of-Term competency checklist

Slots into the v2 End of Terms Reports feature (`docs/superpowers/specs/2026-09-15-litrack-v2-end-of-terms-reports-design.md`). Read that spec first - this one only covers what is different for Kindergarten.

## 1. Problem, in domain terms

Every other grade's end-of-term report is a numeric subject sheet (`TermGrade`, one score per learner x subject x term). Kindergarten's DepEd end-of-term report is not that: it is a fixed 62-item, 4-domain competency checklist, rated Beginning/Developing/Consistent per term, entered one learner at a time, not as a class-wide grid. The two reports share a page family (End of Terms Reports) and a term-window lock, and nothing else about their shape.

Already decided by the owner and not reopened here: the 62-competency catalog (`src/lib/terms/kinder-competencies.ts`), the `KinderCompetencyRecord` model (`prisma/schema.prisma`, uncommitted), the three-hero-card layout, the learner-picker-is-a-searchable-select decision, the T1/T2/T3-as-columns decision, and the Filipino/English note.

## 2. Where Kindergarten is detected (no new hardcoding)

The repo already has exactly one place that means "is this grade Kindergarten": a raw `GradeLevelType` string compared against a `Set(["KINDER"])`, sourced from `AdvisoryPlacement.gradeType` (`src/lib/teachers/advisory.ts`) or a DB-loaded grade row - never a client-submitted value. `src/lib/reading/policy.ts` does exactly this (`EARLY_RUBRIC_GRADE_TYPES = new Set(["KINDER"])`) and its own doc comment states the binding rule: the `gradeType` passed in must come from an authorized placement or a DB-loaded row.

Decision: add one predicate next to the catalog, `isKinderGradeType(gradeType: string): boolean` in `src/lib/terms/kinder-competencies.ts` (pure, no Prisma), and make every call site (teacher route branch, School Head route, the pure sheet-scope splitter in section 9) call it instead of writing `=== "KINDER"` locally. One decision, one place, per the repo's own rule - `reading/policy.ts`'s `EARLY_RUBRIC_GRADE_TYPES` stays as is (different concern, already correct), but nothing new should re-invent the check.

`TERM_SHEET_GRADE_TYPES` (`src/lib/terms/subjects.ts`) still lists `"KINDER"` - that constant is about which grades have a End of Terms sheet at all, which is still true for Kindergarten, just not a numeric one. Do not remove `"KINDER"` from it (see section 11 conflict list).

## 3. Routing and page shape

Decision: a separate route, not a branch inside the numeric sheet's own render.

`src/app/teacher/(app)/terms-reports/page.tsx` and its supporting modules (`sheet-data.ts`, `sheet-view.ts`, `TermsReportBody`/`Panel`/`Hero`) are shaped entirely around "many learners x many subject columns, one term active, paged." Kindergarten's view is "one learner x three fixed term columns x 62 fixed rows, no paging, no term dropdown, no subject picker." Forcing the two into one component tree would mean every function in `sheet-data.ts`/`sheet-view.ts` grows a Kindergarten branch that returns a completely different shape - that is a rewrite wearing a branch, not a branch.

New route: `src/app/teacher/(app)/terms-reports/kinder/page.tsx`.

Where the branch lives: in the existing `TeacherTermsReportsPage` (`src/app/teacher/(app)/terms-reports/page.tsx`), immediately after `inScope` is computed (after `?advisory=`/`?section=` narrowing, before `resolveSheetTerms`/`loadTermSheet` are called):

```
const kinderInScope = inScope.filter((p) => isKinderGradeType(p.gradeType));
const numericInScope = inScope.filter((p) => !isKinderGradeType(p.gradeType));
if (numericInScope.length === 0) {
  redirect(kinderTermsReportsHref({ advisory: sp.advisory, section: sp.section, schoolId: sp.schoolId }));
}
```

- If every placement currently in scope is Kindergarten (the common case - a Kinder-only teacher, or `?advisory=` narrowed to one Kinder section), redirect straight to `/teacher/terms-reports/kinder`, carrying the same `advisory`/`section`/`schoolId` query params over. No numeric page is ever rendered for a pure-Kinder scope.
- If scope is mixed (a multi-advisory teacher holding a Kinder section and a non-Kinder one, viewing "All advisories"), render the numeric page as today but built only from `numericInScope` (`scopes` passed to `TermsReportBody` drops the Kinder placement entirely - its subjects/scores are never queried), and add one small card above or beside the toolbar linking to `/teacher/terms-reports/kinder` naming the Kinder section(s) left out. This is a real behavior change from today (where "All advisories" tries to render every placement in one grid) and is called out explicitly in section 11 rather than resolved silently.

A Super Admin never reaches either branch: the page already redirects them to `/teacher/aral` before placements are computed, and that is unchanged - the Super Admin's Kindergarten view is reached from the grade page (see section 6 of the original task list, not built here per the given scope, which only asks for the teacher entry page, the School Head read-only view, and export/print).

## 4. Multi-advisory and "All advisories"

`getAdvisoryPlacements`/`resolveAdvisoryGradeScope` (`src/lib/teachers/advisory.ts`) are reused as-is, restricted to the Kinder subset, exactly the way `requireAdvisoryForTermSheet` already narrows placements today:

- Inside `/teacher/terms-reports/kinder/page.tsx`, compute `placements` via `getAdvisoryPlacements`, filter to `kinderPlacements = placements.filter(p => isKinderGradeType(p.gradeType))`.
- Resolve which one advisory this render is for via `resolveAdvisoryTarget(kinderPlacements, sp.advisory)` (same function `saveTermGrades`'s gate uses) - not `resolveAdvisoryGradeScope`, because there is no `gradeId` route segment here to scope by; `resolveAdvisoryTarget`'s three-way `{ none | unspecified | not-yours }` outcome is exactly the "ask, never guess" behavior needed when a teacher holds two Kinder sections.
- `unspecified` (more than one Kinder placement, none named) renders a chooser card listing the Kinder sections (same visual language as the numeric page's advisory dropdown, reusing `AdvisorySelect` scoped to `kinderPlacements` only) - never falls back to the first one.
- `none` (a teacher whose scope, after the parent page's redirect, still holds no Kinder placement - should not be reachable given section 3's redirect condition, but the direct-URL case is real) refuses with the same `TERM_SHEET_NO_ADVISORY_CARD`-style empty state, scoped to say "no Kindergarten advisory."

This guarantees "the teacher's grade" is never derived from `placements[0]` - every path that lands on one section went through `resolveAdvisoryTarget`, which is the one function CLAUDE.md already binds this rule to.

## 5. Data loading

New server-only module `src/lib/terms/kinder-sheet-data.ts`, mirroring `sheet-data.ts`'s shape and doc-comment style:

```
export async function loadKinderChecklist(args: {
  schoolId: string;
  schoolYearId: string;
  learnerId: string;
  advisory: AdvisoryPlacement; // already resolved by the caller
}): Promise<{
  learner: { id: string; fullName: string };
  records: Map<KinderCompetencyKey, {
    t1Rating: KinderCompetencyRatingCode | null;
    t2Rating: KinderCompetencyRatingCode | null;
    t3Rating: KinderCompetencyRatingCode | null;
    remark: string | null;
  }>;
}>
```

Tenancy + advisory scoping in one query, following the exact pattern `ReadingLevelPage` (`src/app/teacher/(app)/aral/[gradeId]/learners/[id]/reading-level/page.tsx`) already uses for a nested per-learner page: `prisma.learner.findFirst({ where: { id: learnerId, schoolId, gradeLevelId: advisory.gradeLevelId, sectionId: advisory.sectionId, deletedAt: null, archivedAt: null } })`. A miss is `notFound()` - this is the tenancy/advisory boundary, not a second check bolted on after. `KinderCompetencyRecord` carries no `schoolId` of its own (the model comment explains why, matching `TermGrade`), so this learner-first load is the only place tenancy is enforced for the read, exactly as `TermGrade`'s own reads rely on the learner join.

Then `prisma.kinderCompetencyRecord.findMany({ where: { learnerId, schoolYearId } })`, keyed into the `Map` above by `competencyKey`.

Caching: none, deliberately, matching `loadTermSheet`. Every role page here is `force-dynamic`; `loadTermSheet` is not wrapped in `cachedQuery`/`unstable_cache` and carries no tag, and this read should not either - it is one learner's <=62 rows, cheaper than the roster-wide sheet it sits beside. No new entry in `src/lib/cache/tags.ts`.

Revalidation: `revalidatePath` only, called from the save action (section 6), same as `saveTermGrades` does today (no `revalidateLearnerScoped` - this checklist feeds no dashboard aggregate today; see the extension-point note in Open Questions).

## 6. Server action contract

New file `src/lib/actions/kinder-competencies.ts`, `"use server"`. Unlike `term-grades.ts` (a ~30-module legacy file, hand-rolled `{ ok, error }` + its own try/catch), this is new code - use the house `action()` wrapper (per CLAUDE.md's documented pattern), which no Kindergarten-adjacent module has adopted yet but which every new module should.

### Save granularity: per-competency-row diff, not per-cell and not whole-sheet

Three precedents, three different grains, and Kindergarten's grain matches neither exactly:

- `saveTermGrades` diffs at (learner x subject) cell grain, because its unit of storage is one non-nullable score per cell and its unit of work is a whole roster.
- `fetchAral*`/weekly-attendance/reading-level actions diff at (learner x week-or-month) record grain - one record per learner per period, several nullable fields on it.
- `KinderCompetencyRecord` is (learner x competency) grain: one row holds three nullable per-term ratings and one remark shared across all three terms (this is the model's own deciding constraint, per its Prisma doc comment). Since only one learner is open at a time here, the roster-wide "diff of touched cells" that `saveTermGrades` needs (up to 1500 cells across a class) has no equivalent - the whole payload is at most 62 rows.

Decision: diff at the row grain the table is keyed on - one entry per touched `competencyKey`, each entry carrying only the fields the teacher touched:

```ts
export const kinderCompetencySaveSchema = z.object({
  advisorySectionId: z.string().min(1),
  learnerId: z.string().min(1),
  entries: z.array(z.object({
    competencyKey: z.string().min(1), // re-validated with isKinderCompetencyKey server-side
    t1Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
    t2Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
    t3Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
    remark: z.string().max(500).nullable().optional(),
  })).min(1).max(KINDER_COMPETENCY_COUNT), // 62, imported, never re-hardcoded
});
```

`undefined` on a field means "not touched, leave the stored value alone"; `null` means "clear it"; a value sets it. This maps directly onto Prisma's own `update` input semantics (an omitted key in `update: {}` is a no-op on that column), so the write is a plain per-row `upsert` - not the raw-SQL bulk insert `saveTermGrades` needs. That machinery exists there for a different reason (up to 1500 rows across a whole roster in one statement); here the ceiling is 62 rows for one learner, well within a `prisma.$transaction([...entries.map(upsert)])` batch. Copying the raw-SQL path here would be solving a scale problem this feature doesn't have.

### Term-window lock: checked per touched field, not once for the whole request

`saveTermGrades` takes one `term` for the whole save because its grid shows one term at a time. Kindergarten's grid shows all three term columns at once, so a single save can touch T1, T2 and T3 in the same request - the lock (`getTermWindows` + `isTermLocked`/`canWriteWindow`, `src/lib/terms/windows.ts` + `src/lib/unlock/grants.ts`) must be evaluated per term actually touched, not once against a single `term` field. Resolve all three windows up front (`getTermWindows` already returns all three), then for every entry: if `t1Rating !== undefined` and T1's window is locked (and no grant covers it), fail the whole batch - same fail-closed-on-the-whole-batch behavior `saveTermGrades` uses for a cross-tenant id, extended to "any locked column touched" rather than "the request's one term is locked." The error names which term(s) were rejected.

### Audit

Add to `src/lib/audit-actions.ts`, next to `TERM_GRADES_BULK_SAVE`:

```
/** One learner's Kindergarten competency checklist saved (one or more rows). Metadata carries the placement, learner id, competency keys touched and per-term counts - never the ratings or the remark text, which are learner assessment data and free-text PII respectively. */
KINDER_COMPETENCY_BULK_SAVE: "KINDER_COMPETENCY_BULK_SAVE",
```

Metadata mirrors `TERM_GRADES_BULK_SAVE`'s shape: `{ schoolId, gradeLevelId, sectionId, learnerId, schoolYearId, competencyKeys, savedByTerm: { t1, t2, t3 }, grantKind }`. Ratings and remark text are excluded, matching `docs/privacy.md` and the existing rule that scores never reach `AuditLog`.

### Revalidation

`revalidatePath("/teacher/terms-reports/kinder")` (the query-param learner selection means one path covers every learner) and, if the School Head read-only route (section 10) exists, `revalidatePath` its path too so a School Head viewing the same learner right after a save sees it.

## 7. Component boundaries

New files under `src/components/terms/`, all consuming the catalog from `src/lib/terms/kinder-competencies.ts` and reusing existing shells rather than one-off markup:

- `kinder-checklist-hero.tsx` - thin wrapper over `PageHero` (`src/components/shell/page-hero.tsx`), the same relationship `AralPageHero`/`AttendanceHero` already have to it. Renders the title/subtitle and, immediately under it, the three `StatCard`s (Advisory, Learner, "N / 62 competencies" with `progressLabel`/a progress bar - `StatCard` already supports both).
- `kinder-checklist-toolbar.tsx` - the `SearchableSelect` learner picker (scoped to the resolved advisory's roster) plus, only when `kinderPlacements.length > 1`, the advisory chooser from section 4. Also the export/print controls (section 8).
- `kinder-checklist-panel.tsx` - the four collapsible domain sections (shadcn `Collapsible`), each showing its competency count in the trigger, composed from `KINDER_COMPETENCY_CATALOG`'s `groups`/`sections` shape directly (Domain IV's lettered sub-sections and the item-13 stem/sub-item grouping fall out of that shape for free - no new grouping logic needed beyond the pure module in section 9). Desktop renders a `Table` (`#` | Competency | T1 | T2 | T3 | Remarks); phones render a stacked list, one card per competency with the three term selects and the remark field - the same desktop-table/phone-list split every other v2 sheet uses (`TermsReportPanel`, the ARAL weekly attendance grid), so the existing test convention (`within(screen.getByRole("table"))` for the desktop assertions) keeps working.
- `kinder-checklist-row.tsx` - one competency's cells: a `Select` per term (Not specified / BG / DV / CO, values from `KINDER_COMPETENCY_RATING_LABELS`) and an `Input`/`Textarea` for the shared remark. A locked term column renders its `Select` `disabled`, driven by a `locked: { t1: boolean; t2: boolean; t3: boolean }` prop computed once in the page from the same three-window resolution that feeds the save gate (section 6), so render and save cannot disagree about which columns are open.

No new `Select`/`Table`/`Collapsible` primitives - everything is shadcn, satisfying `tests/unit/shadcn-coverage.test.ts` by construction rather than by exemption.

## 8. Export / print - reuse the existing two-part mechanism, invent nothing

The repo already has exactly one export/print combo, wired together in one component: `src/components/reports/export-controls.tsx` - an Excel download (`exceljs`, server action returns `{ filename, base64 }`, client `atob`s it into a `Blob` and clicks a synthetic `<a download>`, exactly as `terms-report-panel.tsx` and `exportTermGrades` already do) plus a browser print (`window.print()` over a component classed `.printable-report`, hidden from the printed page's chrome by `@media print` in `src/app/globals.css`, with everything else marked `print:hidden`; `src/components/reports/printable-learners-report.tsx` is the existing example). papaparse is not part of this - it is only ever used for CSV import, not any export path in this codebase, and should not be introduced here.

Decision: apply the same combo, not a new stack:

- `exportKinderChecklist(input)` in `src/lib/actions/kinder-competencies.ts`: same `requireUser("TEACHER")` / Super-Admin-passthrough shape as `exportTermGrades`, builds one worksheet for the resolved learner - columns `#`, `Domain`, `Competency`, `T1`, `T2`, `T3`, `Remarks`, one row per catalog entry in display order (Domain IV's stem row prints its sub-items as three rows under it, matching the on-screen grid) - via the same dynamic `import("exceljs")`.
- `PrintableKinderChecklist` component, `.printable-report`, rendered off-screen on the same page from data already in hand (no extra round trip - the page already loaded the records for the visible grid), triggered by the same `window.print()` call `export-controls.tsx` makes when it has no `onPrint` override.

Both live behind one `KinderChecklistExportControls` client component in `kinder-checklist-toolbar.tsx`, matching `ExportControls`'s own "Excel busy state vs print busy state" shape.

## 9. Pure, DB-free module (unit-testable, no database)

New file `src/lib/terms/kinder-checklist-view.ts`, following `src/lib/aral/reading-level-stats.ts` + `tests/unit/reading-level-stats.test.ts` as the named precedent - no Prisma, no React, importable from both server and client:

```ts
export type KinderChecklistCellState = {
  t1Rating: KinderCompetencyRatingCode | null;
  t2Rating: KinderCompetencyRatingCode | null;
  t3Rating: KinderCompetencyRatingCode | null;
  remark: string | null;
};

// Overlays saved rows onto the fixed 62-entry catalog: every key gets a state, even one never saved (all-null).
export function mergeKinderChecklist(
  saved: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>
): ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>;

// How many of the 62 entries have at least one non-null rating across any term - the hero's "N / 62 competencies" figure and its progress bar.
export function countTouchedCompetencies(
  merged: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>
): { touched: number; total: number; pct: number };

// Splits a set of advisory placements into the teacher's numeric vs Kinder scopes - the one place section 3's split logic lives, shared by the teacher page and the School Head page in section 10.
export function splitByKinderGradeType<T extends { gradeType: string }>(
  placements: readonly T[]
): { kinder: T[]; numeric: T[] };
```

`countTouchedCompetencies`'s "touched" definition (any of the three ratings set, remark alone does not count) is a real decision - noted explicitly in Open Questions since the owner's spec says the Progress card counts "N / 62 competencies," not "N of 186 term-ratings," and a competency with only T1 filled is arguably "in progress" rather than "done." This module makes that definition one function's problem, testable without a database, and easy to revise if the owner means something stricter (e.g., all three terms rated).

Test file: `tests/unit/kinder-checklist-view.test.ts`.

## 10. School Head read-only view

There is no existing interactive per-learner or per-grade term-report page under `src/app/school-head/**` today. Searched `src/app/school-head/(app)/**` for anything reading `TermGrade`/`terms-reports`: none. The only School-Head-facing surface that touches term grades at all is the Reports Hub (`src/app/school-head/(app)/reports/page.tsx` -> `src/lib/reports/queries.ts`'s `buildTermGradesTable`), which is a generate-and-download flat table, not an on-screen grid - there is no preview, and its `ReportTable` shape (one header row, flat string/number cells) cannot represent four collapsible domains with lettered sub-sections without flattening the structure the owner explicitly wants kept.

Minimum correct build, given that gap: a new route, `src/app/school-head/(app)/terms-reports/kinder/page.tsx`, that:

- Gates with `requireSchoolUser("SCHOOL_HEAD")` (not `getAdvisoryPlacements` - a School Head is not an adviser; scope is the whole school, any Kindergarten section, via `assertSameSchool`/a plain `schoolId` where-clause) and the same `resolveSchoolContext` pass-through every other School Head page uses for a Super Admin's `?schoolId=` drill-down.
- Offers a section picker (Kindergarten sections only, the same `getGradeSections`-style query already used by `aral/profiling/page.tsx`) then the same `SearchableSelect` learner picker from section 7.
- Renders the exact same `kinder-checklist-panel.tsx`, passed `readOnly` (every `Select`/remark `Input` disabled, Save button omitted) - zero new grid markup, only a new page shell and a read-only variant of the data loader in section 5 that swaps the advisory-scoped `learnerFilter` for a school-scoped one.
- No sidebar entry is specified by the owner for this page. Recommendation (not an owner decision - flagged in Open Questions): link to it from the School Head's Grade Levels page (`src/app/school-head/(app)/grade-levels/`), next to each Kindergarten grade row, since that is the existing per-grade browsing surface for a School Head. Do not add a new top-level sidebar item for this without the owner confirming it.

## 11. Conflicts flagged, not resolved silently

1. "All advisories" no longer means "everything in one grid." Today's numeric page assumes every placement in scope can render in the same subject-grid shape. Per section 3, a Kindergarten placement is now silently excluded from that grid and surfaced instead as a link to a different page. This is a real behavior change for any multi-advisory teacher who mixes Kindergarten with another grade, not something the original v2 End of Terms Reports spec anticipated.
2. `TERM_SHEET_GRADE_TYPES` still includes `"KINDER"`, and Super Admin's per-`GradeLevelType` default-subject console (`/admin/term-subjects`) still offers a Kindergarten template, and a school's Kindergarten grade still has seeded `TermSubject` rows and possibly historical `TermGrade` rows from before this change. Nothing here migrates or hides that numeric data - it is simply no longer reachable through the teacher's or School Head's day-to-day pages once this ships. Whether Super Admin's default-subject template for `KINDER` should be removed or left inert is not decided here.
3. Existing historical `TermGrade` rows for Kindergarten learners are not migrated or exported anywhere by this design. If a school has already encoded Kindergarten numeric grades in a prior term, this change does not surface, convert, or archive them - they simply stop being editable through any teacher-facing UI, but remain in the database and in any past Excel export.

## 12. Invariants and where each is enforced

| Invariant | Enforcement point |
|---|---|
| Tenancy (a School Head/teacher never reads or writes another school's learner) | `loadKinderChecklist`'s single `learner.findFirst` with `schoolId` (+ `gradeLevelId`/`sectionId` for the teacher path) in the `where`, mirroring `ReadingLevelPage`; the save action re-derives the same filter before any write |
| A term's lock closes only that term's columns | The same `getTermWindows`/`isTermLocked`/`canWriteWindow` call feeds both the render (`locked` prop, section 7) and the save gate (section 6), so they cannot disagree |
| Competency keys are stable and never re-pointed | `isKinderCompetencyKey` (already in `kinder-competencies.ts`) re-validates every incoming `competencyKey` server-side in the save schema; the catalog module's own doc comment is the human-readable half of this rule |
| No workflow may gate on the checklist being complete | Not built here - nothing in this design makes Advisory/enrollment/grade-promotion logic read `KinderCompetencyRecord`; the Progress stat card is informational only, matching the ARAL Profile precedent (`docs/aral-profile.md`) |
| `Learner`'s denormalized grade/section pointers stay untouched | This feature never writes to `Learner` - it only reads `gradeLevelId`/`sectionId` to scope the query, same as `TermGrade`'s reads do |
| No hardcoded colors | New components use theme tokens/shadcn variants only (`tests/unit/no-hardcoded-colors.test.ts`) - no new `bg-white`/`bg-gray-*` etc. |
| shadcn coverage | Every input is a shadcn primitive (`Select`, `Collapsible`, `Input`/`Textarea`, `Table`) - no raw `<select>`/`<table>` (`tests/unit/shadcn-coverage.test.ts`) |
| Remarks/ratings never reach `AuditLog` | `KINDER_COMPETENCY_BULK_SAVE` metadata carries counts and keys only, per section 6, matching `TERM_GRADES_BULK_SAVE`'s existing rule and `docs/privacy.md` |

## 13. Implementation tasks, ordered

1. database - Land the already-authored `prisma/schema.prisma` diff (enum + `KinderCompetencyRecord`) as a committed migration under `prisma/migrations/`, additive-only (new enum, new table - no existing column touched). No backfill needed; the table starts empty. File: `prisma/migrations/<timestamp>_add_kinder_competency_record/migration.sql` + schema.
2. backend - `src/lib/terms/kinder-competencies.ts`: add `isKinderGradeType`. (Small addition to an already-written file; still backend-owned per the file's path.)
3. backend - `src/lib/terms/kinder-checklist-view.ts` + `tests/unit/kinder-checklist-view.test.ts` (pure module, section 9). Can be built and tested before the DB migration lands, since it takes plain data.
4. backend - `src/lib/terms/kinder-sheet-data.ts` (section 5, the read).
5. backend - `src/lib/validators/kinder-competency.schema.ts` (the Zod schema from section 6, split out following `term-grade.schema.ts`'s own file convention).
6. backend - `src/lib/actions/kinder-competencies.ts`: `saveKinderCompetencies` (action() wrapper, section 6) and `exportKinderChecklist` (section 8). Add `KINDER_COMPETENCY_BULK_SAVE` to `src/lib/audit-actions.ts` first (dependency of this task).
7. frontend - `src/components/terms/kinder-checklist-hero.tsx`, `kinder-checklist-toolbar.tsx`, `kinder-checklist-panel.tsx`, `kinder-checklist-row.tsx`, `printable-kinder-checklist.tsx` (section 7, section 8).
8. frontend - `src/app/teacher/(app)/terms-reports/kinder/page.tsx` (section 4) and the branch in `src/app/teacher/(app)/terms-reports/page.tsx` (section 3).
9. frontend - `src/app/school-head/(app)/terms-reports/kinder/page.tsx` + read-only data loader variant (section 10), plus the Grade Levels page link (recommendation, confirm with owner first - see Open Questions).
10. tests - Component tests for the desktop-table/phone-list split (scoped with `within(screen.getByRole("table"))` per the worktree's own testing note), the save action's per-term lock check, the export/print controls, and the teacher page's redirect/branch logic from section 3.

## Open questions (not decided here)

1. Default learner on page load. The owner did not specify whether `/teacher/terms-reports/kinder` with no `?learner=` shows an empty "pick a learner" state or defaults to the first learner alphabetically. This spec assumes an empty prompt state is safer (never silently opens one specific child's record); confirm with the owner.
2. "Touched" definition for the Progress stat. Section 9 flags that "N / 62 competencies" could mean "any term rated" (this spec's default) or "all three terms rated" or something per-term. Needs an owner answer before `countTouchedCompetencies` is finalized.
3. School Head entry point. No sidebar link is specified. This spec recommends surfacing it from the Grade Levels page; needs owner confirmation before building the link (the read-only page itself does not depend on where it's linked from).
4. Fate of Kindergarten's numeric leftovers (section 11, items 2-3): whether `/admin/term-subjects`' Kindergarten template and any historical `TermGrade` rows should be hidden, archived, or left exactly as-is. Not blocking this build, but the owner should decide before a School Head or Super Admin notices the inconsistency.
5. Multi-advisory "All advisories" card copy (section 3): the exact wording/placement of the "N Kindergarten section(s), open checklist" link on the numeric page was not specified by any mockup seen; needs a design pass before implementation, since no mockup for the mixed-scope case was provided in this task's context.

## Could not determine from the code

- Whether the owner's mockups (referenced in the task but not attached to this session) show a specific desktop/phone layout for the domain accordions or the mixed-advisory banner in section 3 - this spec infers a shape from existing v2 conventions (`Collapsible`, `StatCard`, `TermsReportPanel`'s responsive split) but the actual mockup should be the tiebreaker where it disagrees with anything above.