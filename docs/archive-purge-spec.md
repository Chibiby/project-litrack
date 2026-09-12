# Global Archive: restore and permanent delete

Target version **1.7.0** (feature → middle number).

## 1. The problem

Removal in LITRACK is a soft delete — the row keeps answering "who recorded this" and drops out of every list. That is right and is not in scope to change. What is missing is the other half: a Super Admin who removed the wrong row, or who accumulated mistaken and duplicate accounts across 300 schools, has nowhere to go. The only existing exits are blunt (`DB_RESET_OPERATIONAL` wipes a school; `DEMO_RESET` only touches the demo tenant).

**A naming collision that must be stated, not silently resolved.** `Learner` carries both `deletedAt` (soft delete) and `archivedAt` ("archive is distinct from soft-delete deletedAt", `prisma/schema.prisma:1021`), and `restoreLearner` in `src/lib/actions/learner.ts` already means "clear `archivedAt`". **This page reads `deletedAt` only.** The route stays `/admin/archive` as decided, but every string a human reads says **Removed**, and the new actions are named `…RemovedLearner` / `…RemovedTeacher` so nothing in the codebase reads as a second `restoreLearner`.

## 2. The cascade, table by table

Read from `prisma/schema.prisma` and cross-checked against the emitted `ALTER TABLE … FOREIGN KEY` statements in `prisma/migrations/*/migration.sql` — nothing below is inferred from Prisma's implicit-action rules alone.

### 2a. What references `Learner`

| Model.column | FK action | Purge must |
|---|---|---|
| `Enrollment.learnerId` | **Cascade** | nothing |
| `AralProfile.learnerId` | **Cascade** | nothing |
| `Attendance.learnerId` | **Cascade** | nothing |
| `ReadingLevelRecord.learnerId` | **Cascade** | nothing |
| `TermGrade.learnerId` | **Cascade** | nothing |
| `Notification.learnerIds` | **no FK** (`String[]`) | nothing — see below |
| `AuditLog.resourceId` | **no FK** | nothing — kept by decision 2 |
| `Report.filters` (Json) | **no FK** | nothing — regenerated on demand |

**A learner purge is a single `prisma.learner.delete()`.** Nothing blocks it, nothing needs clearing by hand. Counts are read *before* the delete.

`Notification.learnerIds` already tolerates missing learners — `src/lib/notifications.ts:177` resolves ids through a map and filters misses, line 196 falls back to `row.learnerIds.length`. No change needed, but that tolerance is now load-bearing.

### 2b. What references `User` (a Teacher)

**Handled by the FK — Cascade. Purge does nothing.**
`SchoolHeadProfile.userId` · `TeacherProfile.userId` · `TeacherSection.teacherId` · `_TeacherGrades."B"` (`0_init:457`) · `Notification.recipientId` · `ChatChannel.memberId` · `ChatMessage.authorId` · `ChatMention.userId` · `ChatRead.userId` · `SupportTicket.requesterId` · `UnlockGrant.userId`

Two of these destroy content others can see — the teacher's staff-room messages and their support tickets. Accepted (a permanent delete of a person removes the person), called out here so nobody discovers it from a support call. Counts go in the audit row.

**Handled by the FK — SetNull. Purge does nothing.**
`Section.adviserId` · `Learner.aralTeacherId` · `Enrollment.teacherId` · `TeacherInvite.userId` · `Notification.actorId` · `SupportTicket.resolverId` · `UnlockGrant.revokedById` · `SchoolUnlockGrant.revokedById`

**Restrict — the purge resolves it explicitly.**

`Learner.teacherId` — `ON DELETE RESTRICT` (`Learner_teacherId_fkey`). A hard delete of a teacher any learner still names as adviser fails with P2003.

Resolution, inside the same transaction: call the existing `releaseTeacherAdvisory(tx, { teacherId, schoolId })` (`src/lib/teachers/release-advisory.ts`) — the same helper both soft-delete paths use — then, as the actual guarantee, one unscoped statement:

```
tx.learner.updateMany({ where: { teacherId }, data: { teacherId: null } })
```

Unscoped is safe *here and only here*: every row it can touch names the teacher about to be deleted, so it cannot cross a tenant boundary by construction. It is the belt to `releaseTeacherAdvisory`'s braces, because that helper is `schoolId`-scoped and a teacher row with a null `schoolId` slips past it. In practice it finds nothing — the helper runs at soft-delete time and migration `20260911000005_release_removed_teacher_advisories` backfilled every teacher removed before it existed. It exists so a future write path that forgets the helper produces a slow purge rather than a P2003 the admin cannot act on.

`User.advisorySectionId` is a plain `@unique` column with no FK; null it before the delete, following `src/lib/demo/teardown.ts:84`.

**Restrict — the purge REFUSES. These nine are the blockers.**

| Model.column | What the rows are |
|---|---|
| `Attendance.recordedById` | learner attendance this teacher marked |
| `AttendanceDayMeta.recordedById` | grade-level holiday flags |
| `ReadingLevelRecord.recordedById` | learner reading assessments |
| `TermGrade.recordedById` | learner term grades |
| `Announcement.authorId` | school content others read |
| `Report.createdById` | Reports Hub history rows |
| `UnlockGrant.grantedById` | grants this teacher issued |
| `SchoolUnlockGrant.grantedById` | school-wide grants this teacher issued |
| `TermWindowOverride.setById` | term deadlines this person set |

One rule: **a teacher who recorded anything cannot be purged.** Postgres will not let the delete through while these rows exist. The only ways past are to delete them (destroying the attendance, reading levels and grades of learners who are *still here* — the archive must never be a back door into deleting live learner data) or to re-point them at someone else (falsifying the record). So the purge refuses and says exactly what it is refusing over.

The refusal is not permanent: `Attendance`, `ReadingLevelRecord` and `TermGrade` all cascade from `Learner`, so purging a school's learners makes its teachers purgeable. The disabled button's tooltip says so.

`src/lib/db/account-reset.ts:117` still says "six tables" — it predates `TermWindowOverride`, `UnlockGrant` and `SchoolUnlockGrant`. Correcting it to nine is task T4.

### 2c. `AuditLog` — no schema change is possible or needed

`AuditLog` declares **no `@relation` on any column**; `userId`, `schoolId` and `resourceId` are plain nullable strings. A grep for `REFERENCES "User"` across `prisma/migrations/*/migration.sql` returns no `AuditLog` constraint. `src/lib/audit.ts:289` states it outright ("AuditLog has no relations") and `src/lib/demo/teardown.ts:98` already relies on it.

**Decision 2 is already true in the database.** No nullable `userId`, no `SetNull`, no migration. `ErrorEvent` is the same by deliberate design (schema line 1661).

## 3. Is a migration needed?

**Yes — one, index-only. No column, table or constraint changes.**

The page's two reads are global and cross-tenant:

```
User    WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC
Learner WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC
```

No existing index serves either — `User @@index([schoolId, role, deletedAt])` and `Learner`'s three composites all lead with `schoolId`, which this query does not supply. Today that is a seq scan plus external sort on a `force-dynamic`, uncached page.

**`prisma/migrations/20260912000001_archive_deleted_at_indexes/`**

`schema.prisma` gains two lines: `@@index([deletedAt])` on `User` and on `Learner`. Additive, no data touched — a no-op for existing rows by construction.

It follows the repo's dual-artifact rule (`docs/migrations.md` section "Concurrent index builds", normative), because both tables are populated in production:
- the migration file — `CREATE INDEX IF NOT EXISTS` (CI, fresh clones, local dev)
- `prisma/concurrent-indexes.sql` — the `CREATE INDEX CONCURRENTLY IF NOT EXISTS` form appended, then the `resolve --applied 20260912000001_archive_deleted_at_indexes` bookkeeping step

Names must be **byte-identical** between the two or `IF NOT EXISTS` stops protecting production. Expected: `User_deletedAt_idx`, `Learner_deletedAt_idx`. **A human applies this; the agent authors and stops.**

## 4. Restore semantics

### 4a. Learner

`removeSchoolLearners` sets the ACTIVE row to `ARCHIVED`/`endedAt: now` (`src/lib/actions/admin-school.ts:166`). `restoreLearner` (the `archivedAt` path, `src/lib/actions/learner.ts:400-443`) already solves exactly this correctly — but **inline in one action**, so the new path would be a second copy of a decision that must not diverge.

**Extract it: `src/lib/learners/reactivate-enrollment.ts`**

```
reactivateEnrollment(tx, learner) -> { outcome: "kept"|"revived"|"created"|"no-active-year", enrollmentId: string|null }
```

1. An ACTIVE row exists → `kept`. This is what protects the SQL-only partial unique `Enrollment_learner_active_unique`; checked in the function so the constraint is a backstop, not the error surface.
2. No active `SchoolYear` → `no-active-year`, create nothing (already the house rule).
3. An `ARCHIVED` row for the active year → revive to `ACTIVE`, `endedAt: null`.
4. Otherwise → create an `ACTIVE` row from the learner's current pointers.

**One deliberate behaviour change in case 3.** Existing code revives the archived row as-is, leaving its `gradeLevelId`/`sectionId`/`teacherId` at removal-time values while the app reads the `Learner` row's denormalised pointers — they can disagree, and CLAUDE.md names keeping them transactionally consistent as an invariant. The extracted function writes the learner's current pointers onto the revived row, so cases 3 and 4 produce the same state. This changes the `archivedAt` path too; intended, pinned by T10.

**Refusal:** restore fails `NOT_FOUND` if the learner's `School.deletedAt` is set — restoring into a dead tenant produces a row nobody can see or manage. Purge of such a learner is still allowed; that is the point of the page. Pointers at soft-deleted sections/grades are left intact — restore does not resurrect structure.

### 4b. Teacher — the least obvious part

Removal (`removeTeacherRows`, `src/lib/db/account-reset.ts:187`) deleted the Supabase auth user, set `deletedAt`/`isActive: false`, **rewrote `User.email` to a tombstone**, and cleared every password flag and the vault.

The tombstone has **two shapes**, both documented in `src/lib/teachers/removed-email.ts`:
- School Head Remove appends `.deleted.<timestamp>` — **the original is recoverable**.
- Super Admin removal writes `removed+<userId>@school.local` — **the original is gone**; `originalTeacherEmail()` returns `null`.

**Recommendation: restore the record, never the login.** `restoreRemovedTeacher`, in one transaction:

- `deletedAt: null`
- `isActive: false` — held deliberately. While false, `getCurrentUser` refuses the session (`src/lib/auth/session.ts:215`).
- `approvalStatus` **untouched** — an APPROVED teacher stays APPROVED; `isActive` is the gate. Silently demoting to PENDING would misreport why they cannot sign in.
- `email` — if `originalTeacherEmail(email)` returns an address **and** no live `User` holds it, write it back; otherwise keep the tombstone. The `@unique` on `email` makes "somebody re-registered with it" real; the check is in the same transaction as the write.
- `authId` — **left as the dangling string it is.** No new Supabase user. It is inert: `getCurrentUser` looks up by `authId` from a live session, and a deleted auth user has no session.
- advisory and `Learner.teacherId` — **not re-attached.** Direct precedent in the repo's own words at `AUDIT_ACTIONS.GRADE_LEVEL_RESTORE`: *"Advisers are NOT restored with them: archiving frees an adviser, and re-attaching someone to a section they may have moved on from is not this action's call."*

So restore is **restore-the-record-without-the-login**, and the action says so rather than leaving the admin guessing: the result carries `needsCredentials: true` and the page toasts *"Account restored. It cannot sign in yet — have the School Head send a new invite, or ask the teacher to register again with their email."* Both are existing working paths; the tombstone exists precisely to free the address for the second.

**Why not mint a fresh login.** It would have to invent a synthetic address under `SYNTHETIC_EMAIL_DOMAIN` and a one-time credential, silently converting a real-email teacher into a synthetic-email one who can never use password recovery — to save a step the School Head already has a button for. Rejected.

**What would change my mind:** if the owner reports the common restore is a teacher who must be working *today* with the School Head unreachable, then a separate `regenerateTeacherCredential` action (modelled on `SCHOOL_HEAD_CREDENTIAL_REGENERATED`, invoked explicitly, audited on its own) is the right second step — a sibling of restore, not part of it. Extension point; not built now.

## 5. The `/admin/archive` page

Two independently paginated tables, both `deletedAt DESC` (what someone hunting a mistake wants). Shared controls: **School** select (`?school=`), **Search** name `contains` (`?q=`). Pagination per table: `?teachers=N`, `?learners=N`, 50 per page, matching `LEARNER_PAGE_SIZE` and the `?learners=` param already on `/admin/schools/[schoolId]`.

- **Removed teachers** — Name · School · Removed on · Original email (`originalTeacherEmail()`, "not recoverable" when null) · **Blockers** · Actions
- **Removed learners** — Name · School · Grade · Section · Removed on · ARAL · Actions

Deliberately **uncached** (`force-dynamic`, no `cachedQuery`) for the reason `src/lib/admin/school-detail.ts:8` already gives: this is the page an admin reads immediately before deleting what it lists, and a 60-second stale row would be misread as the result of the action they just took.

Rows from soft-deleted schools **are** listed, school name struck through — they are the likeliest purge candidates, and hiding them would make the page lie. Restore disabled for them.

**Confirm flow.** Both use `ConfirmAction` (`src/components/confirm-action.tsx`). Restore is `variant="default"`; for a teacher it states up front that the account will not be able to sign in yet. Delete permanently is `variant="destructive"`, and the button is *already disabled with a tooltip* when the row is blocked, so the dialog only opens on an action that can succeed — blocker counts come from the page's read model, not from a failed submit. The description names what goes:

> Permanently delete {learnerName}? This removes the learner and all {attendanceCount} attendance records, {readingCount} reading assessments, {gradeCount} term grades, {aralProfileCount} ARAL profile and {enrollmentCount} enrolments. The audit log keeps a record that this happened. This cannot be undone.

**One row at a time. No bulk purge, no select-all** — a misclicked bulk permanent delete has no recovery path, and the stated problem is per-row.

### Files to create

| Path | Owner |
|---|---|
| `src/lib/admin/archive.ts` — `getArchive(params)`, uncached read model | BE |
| `src/lib/archive/purge.ts` — `teacherPurgeBlockers`, `purgeTeacherRecord`, `learnerPurgeCounts`, `purgeLearnerRecord` | BE |
| `src/lib/learners/reactivate-enrollment.ts` | BE |
| `src/lib/validators/admin-archive.schema.ts` | BE |
| `src/lib/actions/admin-archive.ts` | BE |
| `src/app/admin/archive/page.tsx` + `loading.tsx` | FE |
| `src/components/admin/archive-view.tsx` | FE |
| `src/components/admin/archive-row-actions.tsx` | FE |

Files to edit: `src/lib/audit.ts`, `src/lib/errors/codes.ts`, `src/lib/actions/learner.ts`, `src/lib/db/account-reset.ts`, `src/lib/nav/nav-config.ts`, `prisma/schema.prisma`, `prisma/concurrent-indexes.sql`, `docs/errors.md`, `docs/migrations.md`, `docs/runbook.md`, `src/lib/releases.ts`, `package.json`, `package-lock.json`.

### The four actions

All new, all via `action()` — greenfield, no reason to add to the ~30 legacy modules. In `src/lib/actions/admin-archive.ts`:

```
restoreRemovedTeacher   verb: "restore the account"
purgeRemovedTeacher     verb: "delete the account"
restoreRemovedLearner   verb: "restore the learner"
purgeRemovedLearner     verb: "delete the learner"
```

Each: `requireUser("SUPER_ADMIN")` → `checkRateLimit` → `parseInput` → load with `deletedAt: { not: null }` in the `where` (a live row must not be reachable from here) → `$transaction` → `writeAudit` → revalidate. Failures thrown as `AppError`, never returned. Rate limit `{ limit: 20, windowMs: 15 * 60 * 1000 }`, matching `REMOVE_RATE` in `admin-school.ts`.

**Teacher purge ordering** — deliberately the reverse of `clearRejectedTeacher` (`src/lib/actions/school-head.ts:751`), which deletes the Supabase user first and then has to apologise if Prisma fails afterwards:

1. Recompute blockers **inside** the transaction. The page's counts are a render-time affordance; this is the enforcement point. Non-zero throws `AppError("ARCHIVE_PURGE_BLOCKED", …)`.
2. `releaseTeacherAdvisory` + the unscoped `Learner.teacherId` null + null `advisorySectionId`.
3. `tx.user.delete()`.
4. **After commit**, best-effort Supabase admin `deleteUser(authId)`, tolerating not-found exactly as `removeTeacherRows:199` does.

Residual, accepted and named: if step 4 fails, an auth user survives with no Prisma row. That session resolves to nothing — `src/lib/auth/session.ts:180` returns `null` when no `User` matches the `authId` — so it grants no access, and a repeat purge cleans it up.

Learner purge is `learnerPurgeCounts` then `prisma.learner.delete()`.

## 6. Invariants and enforcement points

| Invariant | Enforced by |
|---|---|
| Audit rows survive a purge | **Database** — `AuditLog` has no FK on any column. Enforced by absence; a test asserts the row still resolves after a purge. |
| Only SUPER_ADMIN purges | **Application** — `requireUser("SUPER_ADMIN")` as step 1. Super Admin passes every role check by default, so this guard is exact rather than incidental. `enforceRolePrefix` on `/admin` as defence in depth. |
| A live row is never purgeable here | **Application** — `deletedAt: { not: null }` in every load `where`. Cannot be a CHECK: it is a predicate on selection, not contents. Pinned by a test. |
| A teacher who recorded learner data is never purged | **Database first, application second** — nine `ON DELETE RESTRICT` FKs make it impossible at the storage layer; `teacherPurgeBlockers` re-checks in-transaction so the admin gets a sentence, not a P2003. Deliberate belt-and-braces, not redundancy to remove. |
| No learner ends with two ACTIVE enrolments | **Database** — SQL-only partial unique `Enrollment_learner_active_unique`. `reactivateEnrollment` checks first so the constraint is a backstop. |
| `Learner`'s grade/section pointers agree with its ACTIVE enrolment | **Pure function** — `reactivateEnrollment`. Cannot be a CHECK: it spans two tables. Pinned by a test; that is the deliberate choice, not an omission. |
| Restore never resurrects a login | **Application** — writes no `authId`, calls no Supabase admin API. A test asserts the admin client is never constructed on that path. |
| A restored row's school is live | **Application** — restore refuses when `school.deletedAt` is set. Cross-table, not expressible as a CHECK. |
| No PII in audit metadata | **Test** — asserts the metadata object's value types are ids and numbers only. |

## 7. Audit actions

Four new `AUDIT_ACTIONS` entries in `src/lib/audit.ts`, prefixed by their console exactly as the `DB_*` and `DEMO_*` blocks are:

```
ARCHIVE_LEARNER_RESTORE   ARCHIVE_LEARNER_PURGE
ARCHIVE_TEACHER_RESTORE   ARCHIVE_TEACHER_PURGE
```

Deliberately **not** reusing `LEARNER_RESTORE` ("cleared `archivedAt`") or `TEACHER_REACTIVATE` ("set `isActive`") — three different state changes must not share one string, or the log stops being able to answer which happened.

Metadata — **ids and counts only:**

| Action | resource / resourceId | metadata |
|---|---|---|
| `ARCHIVE_LEARNER_PURGE` | `Learner` / id | `{ schoolId, counts: { enrollment, attendance, readingLevelRecord, termGrade, aralProfile } }` |
| `ARCHIVE_TEACHER_PURGE` | `User` / id | `{ schoolId, counts: { teacherSection, notification, chatMessage, chatMention, chatRead, supportTicket, unlockGrant }, releasedSectionIds, releasedLearnerCount, authDeleted: boolean }` |
| `ARCHIVE_LEARNER_RESTORE` | `Learner` / id | `{ schoolId, enrollmentOutcome, enrollmentId }` |
| `ARCHIVE_TEACHER_RESTORE` | `User` / id | `{ schoolId, emailRestored: boolean, needsCredentials: true }` |

`emailRestored: boolean`, never the address — it is the teacher's personal email and audit metadata renders in two UIs. The purge writes its audit row **after** commit; a row saying something was deleted when the delete rolled back is worse than a missing one, and `writeAudit` never throws either way. **Blocked purges write no audit row** — a refusal is not a state change.

**One new error code** in `src/lib/errors/codes.ts`, under "Requests":

```
ARCHIVE_PURGE_BLOCKED: {
  status: 409,
  severity: "user",
  message: "This account can't be deleted permanently — it still holds {what}. " +
           "Permanently delete those records first, or leave it removed.",
}
```

`severity: "user"` on purpose — the admin can act on it, so it earns no reference code and no alert email. `{what}` is built from the blocker counts ("412 attendance records and 32 term grades"). Add to `docs/errors.md` in the same change.

## 8. Cache invalidation

Named helpers only, no raw `revalidateTag`.

**Learner purge / restore:**
```
revalidateLearnerScoped({ schoolId, teacherId, aralTeacherId,
                          adminDashboard: true, teacherShell: isAralLearner })
revalidateSchoolsList()
revalidatePath("/admin/archive")
revalidatePath(`/admin/schools/${schoolId}`)
```
`teacherId`/`aralTeacherId` read **before** the delete. `adminDashboard: true` is the same judgement `removeSchoolLearners` already makes — a purge moves global learner counts.

**Teacher purge / restore:**
```
revalidateSchoolTeachers(schoolId)
revalidateSchoolDashboard(schoolId)
revalidateSchoolsList()
revalidateTeacherCaches(teacherId)
revalidateSchoolHeadTeachers(schoolId)
revalidatePath("/admin/archive")
revalidatePath(`/admin/schools/${schoolId}`)
```
`revalidateTeacherCaches` on a *purged* id is intentional — entries were created under that id and must be dropped even though it no longer resolves. `revalidateSchoolHeadTeachers` is included because `/school-head/teachers/removed` lists exactly the rows this page destroys; the School Head gains no control, only a correct view.

## 9. Write paths this design does not control

1. **`DB_RESTORE` / `DB_ROLLBACK`** (`src/lib/db/snapshot.ts`) — a snapshot taken before a purge contains the purged rows and restoring it brings them back, audit rows now matching live rows again. Not a bug; it is what a restore means. Belongs in `docs/runbook.md`: *a permanent delete is only permanent relative to the newest snapshot.*
2. **`DB_RESET_OPERATIONAL`** clears many teachers' blockers school-wide. No conflict; teachers becoming suddenly purgeable afterwards is correct, not surprising.
3. **`scripts/cleanup-passwordless-teachers.ts`** already hard-deletes via `prisma.user.delete` with **no blocker check** (line 241). It works today only because it targets never-profiled accounts that recorded nothing. Out of scope, but it should import `teacherPurgeBlockers` in a later pass so the two hard-delete paths cannot disagree. Noted, not scheduled.
4. **`db:import-schools`** creates rows and never rewrites `deletedAt` — cannot resurrect an archived row. No action.

## 10. Alternatives rejected

**Make the nine blockers cascade** (nullable `recordedById` + `SET NULL`). Rejected: it destroys the property decision 2 exists to protect — "who recorded this" stops answering for every attendance record, assessment and grade the teacher took. Also a nine-table migration on hot constraint-bearing tables, to buy a capability the archive does not need, since an archive fills with accounts that never recorded anything.

**Partial indexes `WHERE "deletedAt" IS NOT NULL`.** Smaller, same selectivity. Rejected: Prisma cannot express a partial index, so it would live in SQL only and permanently drift from `schema.prisma` — a cost the repo already pays three times (`Enrollment`, `School`, `Section`) and should not pay a fourth for a few megabytes. Plain `@@index([deletedAt])` matches `School`, `GradeLevel`, `Section`, `Announcement`.

**Reuse `LEARNER_RESTORE` / `TEACHER_REACTIVATE`.** Rejected in section 7.

**Bulk purge with checkboxes**, mirroring `removeSchoolLearners`. Rejected: no recovery path from a misclick, and the stated problem is per-row. Bulk restore is left out for symmetry and can be added later without changing anything here.

**Tabs on `/admin/schools/[schoolId]`.** Rejected by the owner before this spec; recorded so it is not re-opened.

## 11. Ordered task list

**DB** = `database-engineer` (sole owner of `prisma/**`) · **BE** = `backend-developer` · **FE** = `frontend-developer` · **QA** = `qa-test-engineer` (read-only on source).

`src/lib/archive/**`, `src/lib/admin/**` and `src/lib/learners/**` fall outside every agent's declared ownership list; assigned to **BE** here, and that assignment is the boundary for this work.

| # | Layer | Task | Done when |
|---|---|---|---|
| T1 | DB | Add `@@index([deletedAt])` to `User` and `Learner`. Author `prisma/migrations/20260912000001_archive_deleted_at_indexes/migration.sql` (`CREATE INDEX IF NOT EXISTS`). Append the `CONCURRENTLY IF NOT EXISTS` form to `prisma/concurrent-indexes.sql`, byte-identical names. Record the pair in `docs/migrations.md`. **Author only — do not apply.** | `prisma validate` passes; the offline schema-vs-migrations diff is empty; both files carry the same two names |
| T2 | BE | `src/lib/archive/purge.ts` — `teacherPurgeBlockers` over all nine RESTRICT relations, `purgeTeacherRecord`, `learnerPurgeCounts`, `purgeLearnerRecord`. No action wiring, no Supabase. | unit-testable with a mocked tx; `typecheck` passes |
| T3 | BE | Extract `src/lib/learners/reactivate-enrollment.ts` per 4a incl. the pointer fix; rewrite `learner.ts:400-443` to call it. | existing learner tests pass; both restore paths share one implementation |
| T4 | BE | Four `AUDIT_ACTIONS`; `ARCHIVE_PURGE_BLOCKED` in `codes.ts`; document in `docs/errors.md`; correct the stale "six tables" comment in `account-reset.ts` to nine. | `typecheck` + `test` pass |
| T5 | BE | `src/lib/admin/archive.ts` — `getArchive({ school, q, teacherPage, learnerPage })` returning both tables, per-teacher blocker counts, per-learner purge counts. Uncached. | correct shapes against a seeded DB; page size 50; `deletedAt DESC` |
| T6 | BE | `admin-archive.schema.ts` + `src/lib/actions/admin-archive.ts` — four actions via `action()` per sections 5 and 8. | guard, rate limit, parse, load, transact, audit, revalidate; blocked purge throws `ARCHIVE_PURGE_BLOCKED` |
| T7 | FE | `src/app/admin/archive/page.tsx` + `loading.tsx`. `force-dynamic`, `requireUser("SUPER_ADMIN")`, `AppShell`, reads search params. | both tables render; filters and both paginators work |
| T8 | FE | `archive-view.tsx` + `archive-row-actions.tsx` using `ConfirmAction`; purge disabled with tooltip when blocked. | dialog quotes real counts; blocked rows cannot open the destructive dialog |
| T9 | FE | Add `{ id: "admin-archive", label: "Archive", href: "/admin/archive", icon: Archive }` to the SUPER_ADMIN group in `nav-config.ts`, between Errors and Database. | visible to Super Admin only |
| T10 | QA | `tests/unit/archive/purge-blockers.test.ts` (each of the nine blocks + a zero-blocker purge), `reactivate-enrollment.test.ts` (all four outcomes + the pointer fix), `restore-teacher.test.ts` (no Supabase call; email restored only when recoverable and free), audit-metadata shape test. | `npm run test` green |
| T11 | BE | Release entry `1.7.0` at the top of `RELEASES` in `src/lib/releases.ts`, `announce: true`, fixes in the user's language. Same string in `package.json` and `package-lock.json` (top-level **and** `packages."".version`). | APP_VERSION drift test passes |

**Parallelism.** T1, T2, T3, T4 and T5 can all run at once — file sets are disjoint (`prisma/**` vs four separate `src/lib` paths). T1 is listed first because schema lands before code that queries it, but the dependency is performance, not correctness. T6 requires T2+T3+T4. T7 requires T5; T8 requires T6; T7 and T8 are parallel once unblocked. **T9 is independent of everything.** T10 requires T2+T3+T6. T11 last, same push.

Gates before done: `prisma generate`, `typecheck`, `lint`, `test`, `build`. In a worktree, `npm run lint` needs the temporary `"root": true` workaround.

## 12. Open questions

**Open question 1 below and the nine-blocker refusal in 2b are with the project owner now, awaiting an answer. T6 must not start until both land** — they determine the shape of `restoreRemovedTeacher` and the blocker set `purgeRemovedTeacher` enforces, and starting T6 first means rewriting it.

1. **Does restore-without-login serve the need?** Section 4b recommends it and names the evidence that would change it. Confirm before T6 — it decides whether a `regenerateTeacherCredential` sibling is scheduled or dropped.
2. **Should `Report`, `UnlockGrant.grantedById` and `SchoolUnlockGrant.grantedById` really block?** They hold no learner data — a report file was never stored, an expired grant is a dead permission. Uniformity was chosen over three exceptions. If the block fires mostly on these three in practice, moving them to "deleted with the teacher" is a contained change to `purge.ts` alone.
3. **Retention.** Nothing here ages a removed row out. Whether `docs/privacy.md`'s PH Data Privacy Act position wants an automatic purge after N days (an `ERROR_EVENT_RETENTION_DAYS`-style cron) is a separate decision this page does not make.
4. **A read-only version for School Heads** scoped to their own school? Out of scope by decision 3, which covers purge, not visibility. `getArchive` would need a `schoolId` scope parameter if ever wanted.
