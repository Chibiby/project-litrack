# School Head Terms Management — Design

Date: 2026-09-11
Status: awaiting review
Supersedes nothing. Extends the term model introduced by
`2026-08-22-end-of-terms-reports-design.md`.

## Purpose

A School Head can move their school's term windows, extend a grade-entry
deadline, see which sections are behind, and reopen a closed term — for one
teacher or for the whole school — without raising a support ticket.

## The problem this solves

Term windows are derived, not managed. `getTermWindows` (`src/lib/terms/windows.ts`)
splits the active `SchoolYear` into three-month blocks from its start month, and
`isTermLocked` closes a term the day after its last month ends. Nothing about a
window is stored and nothing about it can be changed.

When submission locking is switched on, that derived deadline becomes real. A
production reading on 2026-09-11 shows what it would mean today:

| Measure | Value |
| --- | --- |
| Active school years starting June 2026 | 107 of 126 |
| Their First Term window | Jun–Aug, ended Aug 31 |
| Sections with learners | 367 |
| First Term grade cells filled | 2,188 of 44,136 (**5.0%**) |
| Sections with no First Term grades at all | 352 |
| Schools with any First Term grade | 3 of 109 |
| Live `UnlockGrant` rows | **0** |

So the deadline that locking would enforce has already passed for most schools,
before nearly anyone has encoded anything. The only remedy in the code today is
a per-teacher `UnlockGrant`, issued by a Super Admin, one teacher at a time.

This feature is the precondition for turning submission locking on at all.

## Approved decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where window truth lives | Sparse override table | No backfill; untouched schools keep today's behaviour exactly |
| Stored date type | `String` date keys (`YYYY-MM-DD`) | The value stored, compared and rendered is one string no timezone can shift |
| Editable | Term months **and** a separate deadline | Extending entry must not require moving the next term's months |
| Manual open/close flag | Not built | Moving the deadline already expresses it; two sources of "is it open?" would drift |
| School-wide reopen | Deadline extension, not a grant | See §4 — it is the same operation, so it gets one mechanism |
| Per-teacher reopen | Existing `UnlockGrant` | Already built, already tested, already audited |
| Who may manage | School Head (own school) and Super Admin (any school) | Matches every other school-scoped surface |

## 1. Data model

One new table. Nothing else in the schema changes.

```prisma
/// A School Head's edit to one term of one school year. A row exists ONLY where
/// a head has actually changed something; every un-edited term stays derived by
/// `getTermWindows`, which is why this needs no backfill and no seeding.
model TermWindowOverride {
  id           String     @id @default(uuid())
  schoolId     String
  schoolYearId String
  term         TermPeriod

  /// Local `YYYY-MM-DD`. Deliberately String, not DateTime: `SchoolYear.startDate`
  /// is a bare timestamp, so a year starting August 1 in Manila is stored as
  /// `2026-07-31T16:00:00Z` and reading its UTC month puts Term 1 in July.
  /// `TermWindow` already carries these as keys and `isTermLocked` already
  /// compares them as strings. Storing keys keeps one representation end to end.
  startKey String
  endKey   String

  /// Last day grades may still be encoded. Defaults to `endKey` when a head
  /// edits only the months. Moving this is how a term is extended WITHOUT
  /// shifting the next term's months — the case that motivated the feature.
  deadlineKey String

  setById   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  school     School     @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  schoolYear SchoolYear @relation(fields: [schoolYearId], references: [id], onDelete: Cascade)
  setBy      User       @relation("TermWindowSetter", fields: [setById], references: [id])

  @@unique([schoolYearId, term])
  @@index([schoolId])
  /// R6. FK-enforcement lookup side.
  @@index([setById])
}
```

`schoolId` is denormalised (it is reachable through `schoolYearId`) so tenant
scoping is a direct `where` clause like every other table here, rather than a
join a caller might forget.

Back-relations to add: `TermWindowOverride[]` on `School`, on `SchoolYear`, and
on `User` under the relation name `TermWindowSetter`.

### Invariants

Validated against the **effective** three windows — derived thirds with any
overrides applied — never against the stored rows alone. That is what makes
sparse storage safe: a head who overrides only Term 2 is still checked against
derived Terms 1 and 3, so a partial edit cannot open a gap.

1. Within a term: `startKey <= endKey`, and `deadlineKey >= endKey`.
   A deadline may never fall before its own term's last month — that would be a
   term locked before it ended.

   Closing a term **early** is still possible, and is done by pulling `endKey`
   in; the deadline follows it. That is the approved substitute for a manual
   close flag. What the rule forbids is the narrower case of a deadline behind
   its own months, not movement in either direction.

   Shortening is the one edit that can lock someone out mid-encoding, so the
   confirm step names it explicitly: *"N sections have not finished First Term.
   Closing it on this date will stop them editing."*
2. Across terms, on the **months** only: `t1.endKey < t2.startKey` and
   `t2.endKey < t3.startKey`. Strict, so no gap and no overlap.
3. Deadlines are explicitly exempt from rule 2. Term 1's deadline may fall
   after Term 2 has started; that is the whole point of a separate field.
4. All `startKey`/`endKey` values lie inside the school year's own range.
   Deadlines may extend past the year's end (a head finishing last year's
   encoding in the new year is normal).

### Migration

One `CREATE TABLE`, no backfill, nothing rewritten. Authored by
`database-engineer` under `prisma/migrations/`, named per convention, and
**applied by a human** — see `docs/migrate-checklist.md`. Note that CI has not
run since 2026-08-14 (billing lock), so the four local gates are the only
verification before this ships.

## 2. Deriving windows

`getTermWindows` gains a second parameter and stays pure:

```ts
export function getTermWindows(
  schoolYearStart: Date,
  overrides: TermWindowOverrideRow[] = []
): TermWindow[]
```

`TermWindow` gains `deadlineKey` and `isOverridden: boolean`. The default
argument reproduces today's output exactly, so every existing test in
`tests/unit/terms/` stays valid unchanged — that is the regression guarantee.

`isTermLocked` changes one word:

```ts
export function isTermLocked(window: TermWindow, todayKey: string): boolean {
  return todayKey > window.deadlineKey;   // was: window.endKey
}
```

For a derived window `deadlineKey === endKey`, so behaviour is identical until a
head actually extends something.

**Months and deadline do different jobs, and the split must stay legible:**

| Question | Answered by |
| --- | --- |
| Which term is the current one? | `startKey`/`endKey` (`terms-reports/page.tsx:82`) |
| What does the sheet's header say? | `rangeLabel`, from the months |
| May this save be written? | `deadlineKey`, via `isTermLocked` |

### Call sites

Four, all of which already load the school year and can load overrides beside it:

| Site | Change |
| --- | --- |
| `term-grades.ts:137` (save) | pass overrides |
| `term-grades.ts:406` (export) | pass overrides |
| `terms-reports/page.tsx:214` | pass overrides |
| `src/lib/cache/school-year.ts` | extend the cached read to return overrides with the year |

The lock/grant sequence at `term-grades.ts:151` is **not** restructured. It stays:
date test first, then `canWriteWindow` only if the date says closed. A grant
still only ever widens a window that is closed anyway — the invariant
`src/lib/unlock/grants.ts` opens with.

## 3. Interaction with submission locking

`isSubmissionLockingEnabled()` (`src/lib/settings/system-settings.ts:80`) is a
single global switch, currently **off** in production (no `submissions.locking`
row). While it is off, `canWriteWindow` short-circuits to writable and no
deadline is enforced anywhere.

This feature does not change that switch and does not depend on it being on.
The relationship is one-directional and worth stating plainly:

- **Locking off:** term windows are labels. A head can still correct months and
  set sensible deadlines; nothing is enforced.
- **Locking on:** the same stored windows become the enforced deadlines.

That ordering is deliberate. Heads can put correct windows in place *first*, and
locking can then be switched on against deadlines schools have actually agreed
to, rather than against derived ones that have silently already passed.

**The terms page must say which state it is in.** A head reading "First Term
closed Aug 31" while locking is off is being misinformed — nothing is closed. A
banner states the live answer, read from the same helper the save path uses.

## 4. Reopening a closed term

Two mechanisms, one per job.

### School-wide — extend the deadline

Setting `deadlineKey` later reopens the term **for the whole school at once**.
This is what both roles do when the whole cohort is behind:

- **School Head** → their own school, via the terms page.
- **Super Admin** → any school, via the same page under `?schoolId=`, which
  `resolveSchoolContext` already resolves and audits.

There is deliberately **no school-wide `UnlockGrant`**. `UnlockGrant` is keyed
`@@unique([userId, scope, targetKey])` — one row per person. Expressing "all
teachers" as grants would mean either fanning out one row per teacher (stale the
moment a teacher is added, and a revoke that must find them all) or making
`userId` nullable and breaking the uniqueness invariant that makes "is it open?"
independent of row order. A deadline extension is the same operation with none
of that: one row, one audit entry, and any teacher hired tomorrow is covered
automatically.

### One teacher — the existing grant

For the single straggler after a term is genuinely finished, `UnlockGrant`
stays exactly as it is. Today only a Super Admin may issue one
(`grantUnlockDirect`, `support.ts:388`, `requireUser(["SUPER_ADMIN"])`).

**New: School Heads may issue and revoke grants for teachers in their own
school.** Two new actions in `src/lib/actions/unlock-grants.ts`:

- `grantTermUnlockForTeacher` — `requireSchoolUser("SCHOOL_HEAD")`, target must
  be a teacher whose `schoolId` equals the head's, re-read from the database
  rather than trusted from the form.
- `revokeTermUnlockForTeacher` — same guard, and additionally refuses a grant
  whose `schoolId` is not the head's, so a head cannot revoke another school's
  grant by id.

Both reuse the existing upsert semantics and the existing
`UNLOCK_GRANT_ISSUE` / `UNLOCK_GRANT_REVOKE` audit actions. Super Admin's
existing paths are untouched.

## 5. Surfaces

One new route, `/school-head/school/terms`, added to `SCHOOL_HEAD_ROUTES` and to
`SCHOOL_WORKSPACE_TABS` beside `schoolYears`. It follows the shape of
`school/years/page.tsx`: `SchoolHeadPage`, `Surface`, `force-dynamic`, and
**read-only when `view.isSuperAdminView`** for the editing controls — with the
one deliberate exception that a Super Admin *may* set a deadline, since choosing
a school and reopening its term is an approved Super Admin capability.

The page carries three sections, in the order a head actually works:

**a. The three windows.** Each row: label, month range, deadline, whether it is
derived or overridden, and its live lock state. `Edit` opens months and
deadline; `Extend deadline` is a shortcut that opens only the deadline, because
that is the common action. `Reset to derived` deletes the row and returns the
term to computed thirds — the undo that makes editing safe to try.

**b. Who is behind.** Per section, for the selected term: section, adviser,
encoded vs expected. Expected is `learners × 8` learning areas
(`LEARNING_AREA_ORDER`). Two queries — learner counts per section, and a grouped
`TermGrade` count joined through `Learner.sectionId` — wrapped in `cachedQuery`
under a term-scoped tag, matching `src/lib/dashboard/aggregates.ts`.

This sits on the same page as the windows, not a separate route, because the
head's actual loop is *see who is behind → extend the deadline*, and splitting
those across two pages breaks the one workflow the feature exists to serve.

Note for implementation: a teacher may now advise **up to three sections**
(`Section.adviserId`, cap enforced in `setTeacherAdvisory`), so "sections
behind" and "teachers behind" are no longer the same list. The table is keyed by
section; a teacher advising three appears three times, once per section, which
is correct — each sheet is encoded separately.

**c. Grants.** Live `UnlockGrant` rows for the school: teacher, term, expiry,
who granted it. Issue, extend, revoke. Issue is reachable inline from a
"behind" row, because that is the only context it is ever needed in. Revoked
grants stay listed as revoked rather than disappearing, so history survives.

## 6. Actions, audit, cache

New file `src/lib/actions/term-windows.ts`, house pattern throughout — auth
guard first, Zod `safeParse`, ownership scoped to `schoolId`, mutate, audit,
revalidate:

- `setTermWindow` — upsert on `@@unique([schoolYearId, term])`
- `setTermDeadline` — the narrow path; only `deadlineKey`
- `resetTermWindow` — delete the override row

Three new entries in `AUDIT_ACTIONS`: `TERM_WINDOW_SET`, `TERM_DEADLINE_SET`,
`TERM_WINDOW_RESET`. Each logs the year, the term and before/after keys — the
same before-and-after treatment `SCHOOL_YEAR_UPDATE` already gets, so a window
that moved mid-term is traceable. `TERM_DEADLINE_SET` is distinct from
`TERM_WINDOW_SET` precisely because "who reopened this term, and when" is the
question an audit will be asked.

A `revalidateTermWindows(schoolId)` helper joins the named helpers in
`src/lib/cache/revalidate.ts`, busting the terms page and the teacher
terms-reports route. Never a raw `revalidateTag`.

## 7. Testing

- **`windows.ts` units** — the pure core, and cheap to cover exhaustively:
  overrides applied; partial overrides; deadline defaulting to `endKey`;
  deadline later than `endKey` keeping a term writable past its months; every
  invariant rejection (gap, overlap, reversed, deadline earlier than end,
  outside the year).
- **Existing `windows.ts` tests pass unchanged** — the regression guarantee for
  the default argument.
- **Tenancy** — a School Head of school A cannot set, reset or read school B's
  override, and cannot grant or revoke a grant for school B's teacher. The
  cross-tenant leak is the worst bug shippable here.
- **Role** — a `TEACHER` is refused every write; a Super Admin may set a
  deadline for a school under `?schoolId=`.
- **The lock actually moves** — the one test that proves the feature does its
  job: with locking **on**, `saveTermGrades` refuses a save on a date past the
  derived end, and accepts it once the deadline is extended past that date.
  Belongs in the existing `term-grades-save.test.ts` suite beside the other
  lock cases.
- **Locking off** — the same save succeeds regardless of deadline, and the
  page's banner says so.

## Suggested implementation waves

This is more than one sitting, and the pieces have a natural order. Each wave is
independently shippable and leaves the app working:

| Wave | Contents | Value on its own |
| --- | --- | --- |
| A | Schema + migration, `getTermWindows`/`isTermLocked` change, four call sites | Nothing visible; unblocks everything, zero behaviour change |
| B | Terms page §5a — view and edit windows and deadlines, plus the locking-state banner | A head can fix wrong windows and extend deadlines |
| C | §5b who-is-behind table | The head can see the problem before the deadline |
| D | §5c grants list and the two School Head grant actions | The single-straggler case stops needing a support ticket |

Wave A is the only one touching `prisma/**`, so it is also the only one that
must serialise through `database-engineer`.

## Not building

- A manual open/close flag — the deadline expresses it.
- School-wide `UnlockGrant` rows — §4.
- Any change to `ARAL_WEEKLY_ATTENDANCE` windows or to the global
  `submissions.locking` switch itself.
- Per-grade or per-section deadlines. The unit is the school.

## Resolved: Super Admin may set a deadline

**Approved 2026-09-11.** A Super Admin viewing a school under `?schoolId=` may
set that school's term deadline, a deliberate exception to the otherwise
read-only admin school view. This is what "Super Admin can choose which school
to unlock" requires.

The exception is narrow and must stay so:

- A Super Admin may set `deadlineKey` — the reopen operation.
- A Super Admin may **not** edit term months or reset a window to derived. Those
  stay the head's, because they describe the school's own calendar.
- Every such write is audited as `TERM_DEADLINE_SET` with the admin's own
  `userId` and the target `schoolId`, on top of the `ADMIN_SCHOOL_VIEW` row
  `resolveSchoolContext` already writes.

So the read-only rule holds everywhere except one field, reached through one
action, and the audit log names who used it.
