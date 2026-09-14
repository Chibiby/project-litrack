# Spec: School Head-managed End of Terms subjects (per school, per grade)

Status: approved design, 2026-09-14. Owner decisions in §0 override anything below.

## 0. Owner decisions (binding)

- Subject list is per school **and** per grade level.
- Remove = archive (`deletedAt`). Archived subjects are hidden **everywhere**: grade sheet, export, Reports hub, General Average. Scores are kept; restore brings them back.
- Modify = rename and reorder. Grades stay attached (keyed by subject id).
- **Super Admin CAN edit** subjects when viewing a school via `?schoolId=` (resolveSchoolContext). Every edit is audited. The school is derived server-side from the target grade/subject row, never from a client-supplied schoolId.
- **New sidebar item** for School Head: route `/school-head/term-subjects` (label "Term Subjects" / "End of Terms Subjects"), not a School workspace tab.
- Learner moves grade mid-year: old grade's scores stay stored, not shown on the new grade's sheet.
- Cap: 15 active subjects per grade.
- M3 (drop `TermGrade.subject`) only when owner says so.

## 1. Model `TermSubject` (prisma/schema.prisma)

Columns: `id` uuid, `schoolId`, `gradeLevelId`, `name` (trimmed, 1-60), `position Int` (not unique), `legacyArea LearningArea?` (only on the 8 default rows; backfill join key + idempotent seed; never shown), `createdAt`, `updatedAt`, `deletedAt DateTime?`.

- `GradeLevel` gets `@@unique([id, schoolId])`; `TermSubject.gradeLevel` relation on `[gradeLevelId, schoolId] -> [id, schoolId]`, Cascade. `school` relation Cascade.
- `@@unique([gradeLevelId, legacyArea])` (NULLs distinct).
- `@@index([gradeLevelId, deletedAt, position])`.
- SQL-only partial unique: `CREATE UNIQUE INDEX "TermSubject_grade_active_name_unique" ON "TermSubject"("gradeLevelId", lower(btrim("name"))) WHERE "deletedAt" IS NULL;` — preserve in future migrations (document next to Enrollment's).

## 2. `TermGrade` changes

- Add `termSubjectId String?` (nullable in M1, NOT NULL in M2), relation `onDelete: NoAction`.
- New `@@unique([learnerId, schoolYearId, term, termSubjectId])` — new ON CONFLICT target.
- `subject LearningArea` becomes nullable in M1; its unique dropped in M2; column dropped in M3.
- Keep `TermGrade_score_range` CHECK.
- `src/lib/db/schema-order.ts`: add `{ model: "TermSubject", delegate: "termSubject", operational: false }` after GradeLevel, before TermGrade.

## 3. Pure module `src/lib/terms/subjects.ts` (no Prisma)

- `DEFAULT_TERM_SUBJECTS` from `LEARNING_AREA_ORDER`/`LEARNING_AREA_LABELS`, positions 0-7.
- `subjectNameKey(name)` = trim + lowercase.
- `orderSheetSubjects(rows)` — drop archived, sort position, name, id.
- `planSubjectReorder(activeIds, requestedIds)` → `{ok:true, updates}` | `{ok:false, reason:"STALE"|"DUPLICATE"}` (must be permutation).
- `nextPosition(rows)` = max active position + 1 (0 if empty).
- `MAX_ACTIVE_SUBJECTS_PER_GRADE = 15`.

## 4. Server helper `src/lib/terms/subjects-db.ts` (server-only)

`getSheetSubjects(client, { schoolId, gradeLevelId })`: read all rows for grade (incl. archived); if **zero rows**, `createMany(DEFAULT_TERM_SUBJECTS, skipDuplicates: true)` and re-read; return `orderSheetSubjects`. Lazy seed chosen because grades are created from 6 paths. Also export a variant returning archived rows for the management page.

## 5. Validators

- `term-grade.schema.ts`: `entries[].subject` enum → `termSubjectId: z.string().min(1)`; max 1000 → 1500.
- New `term-subject.schema.ts`: name (trim, 1-60, no control chars); `createTermSubjectSchema {gradeLevelId, name}`, `renameTermSubjectSchema {id, name}`, `termSubjectIdSchema {id}`, `reorderTermSubjectsSchema {gradeLevelId, orderedIds 1..15}`. No client schoolId.

## 6. Actions `src/lib/actions/term-subjects.ts` ("use server", `action()` wrapper)

Guard: `requireUser("SCHOOL_HEAD")` (Super Admin passes). Resolve school:
- SCHOOL_HEAD: `user.schoolId` required; load target with `where: { id, schoolId: user.schoolId }` + `assertSameSchool`.
- SUPER_ADMIN: load target by id (grade or subject), take its `schoolId`. Tenancy for Super Admin is the row's own school.
Grade must be `deletedAt: null` and not FLOATING.

| action | rule | audit |
|---|---|---|
| createTermSubject | seed via getSheetSubjects; cap 15 → VALIDATION_FAILED; insert at nextPosition; P2002 → DB_CONFLICT "A subject with that name is already on this grade's sheet" | TERM_SUBJECT_CREATE |
| renameTermSubject | active row; same P2002 mapping | TERM_SUBJECT_RENAME (ids, gradeLevelId, old/new name) |
| archiveTermSubject | set deletedAt; TermGrade untouched | TERM_SUBJECT_ARCHIVE |
| restoreTermSubject | deletedAt null, position = nextPosition, cap, P2002 → DB_CONFLICT | TERM_SUBJECT_RESTORE |
| reorderTermSubjects | $transaction: SELECT ... FOR UPDATE active ids; planSubjectReorder; STALE → DB_CONFLICT "The subject list changed. Reload and try again."; update positions | TERM_SUBJECT_REORDER (ids) |

Audit rows include `schoolId` of the target and actor. Revalidate: the management route + new `revalidateTermSheets()` helper in `src/lib/cache/revalidate.ts` (wraps `revalidatePath("/teacher/aral/[gradeId]/terms-reports", "page")`).

## 7. Existing reads/writes

- `saveTermGrades`: load `getSheetSubjects` for advisory grade; any posted termSubjectId not in set → refuse whole batch "One or more subjects are no longer on this sheet. Reload the page." Raw upsert: `${e.termSubjectId}::text`, JOIN TermSubject on id + schoolId + gradeLevelId + deletedAt IS NULL (RETURNING count catches mid-save archive), ON CONFLICT on termSubjectId, dedupe tuple on termSubjectId, clear deleteMany by termSubjectId + `termSubject: {gradeLevelId, deletedAt: null}`. Keep legacy result shape.
- `exportTermGrades`: columns from getSheetSubjects (id key, name header); filter TermGrade by active ids; General Average over active subjects only.
- Teacher page `terms-reports/page.tsx`: load subjects in parallel; filter grades by active ids; pass `subjects: {id,name}[]` to panel/form; include ids in panel `key`.
- `aral-term-grades-grid-form.tsx`: columns from prop, cells keyed by termSubjectId; empty state when zero active subjects.
- `src/lib/reports/queries.ts buildTermGradesTable`: select termSubject, filter deletedAt null, group columns by subjectNameKey across grades, order by lowest position then name.
- `enum-labels.ts`: keep LEARNING_AREA_* (now only feed defaults); update comments.
- UI: sidebar item + route `/school-head/term-subjects` (route constant, nav config, warm hrefs if applicable). Page uses resolveSchoolContext; grade picker (live, non-FLOATING); active list with rename, archive, up/down reorder (posts full ordered id list); collapsed Archived list with Restore. Editable for School Head and Super Admin view.

## 8. Migrations (database-engineer authors; human applies)

**M1 `20260915000001_term_subject_table`** (additive, old code keeps working):
1. `ALTER TABLE "GradeLevel" ADD CONSTRAINT "GradeLevel_id_schoolId_key" UNIQUE ("id","schoolId");`
2. CREATE TABLE TermSubject + FKs + uniques + index + partial name index.
3. Seed defaults for every GradeLevel (incl. soft-deleted/FLOATING):
```sql
INSERT INTO "TermSubject" ("id","schoolId","gradeLevelId","name","position","legacyArea","updatedAt")
SELECT gen_random_uuid()::text, g."schoolId", g."id", d.name, d.pos, d.area::"LearningArea", CURRENT_TIMESTAMP
FROM "GradeLevel" g
CROSS JOIN (VALUES ('ENGLISH','English',0),('FILIPINO','Filipino',1),('MATHEMATICS','Mathematics',2),
  ('SCIENCE','Science',3),('ARALING_PANLIPUNAN','Araling Panlipunan',4),
  ('EDUKASYON_SA_PAGPAPAKATAO','Edukasyon sa Pagpapakatao',5),('MAPEH','MAPEH',6),('TLE','TLE',7)) AS d(area,name,pos)
ON CONFLICT DO NOTHING;
```
Labels must equal LEARNING_AREA_LABELS (unit test pins it).
4. Add `TermGrade.termSubjectId` TEXT + FK NO ACTION; `ALTER COLUMN "subject" DROP NOT NULL`.
5. Backfill:
```sql
UPDATE "TermGrade" tg SET "termSubjectId" = ts."id"
FROM "Learner" l, "TermSubject" ts
WHERE l."id" = tg."learnerId" AND tg."termSubjectId" IS NULL
  AND ts."legacyArea" = tg."subject"
  AND ts."gradeLevelId" = COALESCE(
    (SELECT e."gradeLevelId" FROM "Enrollment" e
      WHERE e."learnerId" = tg."learnerId" AND e."schoolYearId" = tg."schoolYearId"
      ORDER BY (e."status" = 'ACTIVE') DESC, e."updatedAt" DESC LIMIT 1),
    l."gradeLevelId");
```
6. Unique index on (learnerId, schoolYearId, term, termSubjectId) + index on termSubjectId.
Checklist: `SELECT count(*) FROM "TermGrade" WHERE "termSubjectId" IS NULL` = 0.

**Release 1.15.0** — code uses termSubjectId only, writes subject NULL. M1 must be applied first.

**M2 `20260915000002_term_grade_subject_tighten`** (after release live): re-run backfill; pre-check collisions (stop if >0); SET NOT NULL; drop old subject unique.

**M3** later, owner-approved: drop `TermGrade.subject`.

## 9. Tests (qa-test-engineer)

- `tests/unit/terms/subjects.test.ts`: order/tie-break, archived excluded, reorder STALE/DUPLICATE, defaults == LEARNING_AREA_LABELS, name key.
- `tests/unit/actions/term-subjects.test.ts`: school head of another school → NOT_FOUND; Super Admin allowed and audited with target's schoolId; FLOATING/archived grade refused; duplicate name DB_CONFLICT; cap 15; restore clash refused; stale reorder refused; audit + revalidate helper called.
- `term-grades-save.test.ts`: subject from other grade / other school / archived refused; mixed batch writes nothing; SQL has TermSubject JOIN + new conflict target.
- `term-grades-export.test.ts`: custom headers/order; archived columns absent.
- validator tests: termSubjectId, max 1500.
- lazy seed: zero rows seeds 8; all-archived does not re-seed.
- schema-order test; reports grouping test; nav config test for new sidebar item.
