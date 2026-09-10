# Version 1.0.0, release notes, and ten concerns

Status: approved design, not yet implemented
Date: 2026-09-10

Two things at once. A **release channel** — a version number the app knows about
and a way to tell people what changed — and the **ten concerns** raised
alongside it. They ship together because the concerns are the first release
notes: 1.0.0 is what exists today, and the fixes below become the entry that
announces itself.

Every migration here is *authored only*. A human applies them
(`docs/migrate-checklist.md`). Nothing in this document may be run against a
remote database by an agent.

---

## 1 · Where the version lives

`src/lib/releases.ts`, a committed ordered array, newest first:

```ts
export type Release = {
  version: string;        // semver, no leading "v"
  date: string;           // YYYY-MM-DD
  title: string;          // one line, sentence case
  announce: boolean;      // true = interrupt the user with the modal
  fixes: string[];        // what changed, in the user's language
};

export const RELEASES: readonly Release[] = [ /* newest first */ ];
export const APP_VERSION = RELEASES[0].version;
```

`package.json` is synced to the same string (it reads `0.1.0` today). The file is
the source of truth; `package.json` is a mirror kept honest by a test.

Semver convention: **patch** = bugfix bundle, **minor** = feature, **major** = a
revision that changes how the app is used.

`announce` is deliberately *independent* of the semver level. "Big revision"
is an editorial judgement, not an arithmetic one — a patch that changes what a
teacher sees on Monday may deserve the modal, and a minor that only touches the
admin console may not. One boolean, decided per release.

Bumping a version means adding an entry in the same commit as the work. No
migration, no admin UI, no separate CHANGELOG to drift.

**Invariants**, each with a test:

- `RELEASES` is non-empty and strictly descending by version.
- No duplicate versions.
- Every `date` is `YYYY-MM-DD`; every `fixes` array is non-empty.
- `package.json.version === APP_VERSION`.

### Where it shows

The version string sits in the sidebar footer for all three roles, linking to
`/releases` — the full history, readable by anyone signed in. Small surface: one
route, one list, no role branching beyond the shell it renders in.

---

## 2 · Telling people about a release

Both surfaces, because they answer different questions: the modal answers "what
changed just now", the bell answers "what was that thing I dismissed".

**Migrations.** `User.lastSeenReleaseVersion String?` (nullable — every existing
row has seen nothing, and that is the truth). `NotificationType.RELEASE_PUBLISHED`
added to the enum, plus its label in `src/lib/constants/enum-labels.ts` — the
house rule for enum additions.

**Lazy per-user, never a fan-out.** A release does not write a row per user.
Nothing is written until a user actually arrives, and then only for them:

1. Shell reads `lastSeenReleaseVersion`. If it equals `APP_VERSION`, nothing
   happens — the common path costs one column already being selected.
2. Otherwise, if the newest release has `announce: true`, the client calls
   `announceRelease()`, which idempotently upserts that user's bell row.
3. The modal renders `title` + `fixes`. "Got it" calls `acknowledgeRelease()`,
   which stamps `lastSeenReleaseVersion = APP_VERSION`.

The stamp is written on acknowledgement, not on display, so a user who closes the
tab mid-read sees it again. Both actions follow the house pattern
(`ActionResult`, auth guard first) and are idempotent — a double-click or a
double-mount must not produce two bell rows. Neither runs during render.

A release with `announce: false` writes nothing and shows nothing. It is visible
at `/releases` and in the sidebar, and that is the whole point of the flag.

`lastSeenReleaseVersion` holds a version string rather than a boolean or a
timestamp: it survives a rollback (a user who saw 1.1.0 and is served 1.0.9 is
not re-interrupted), and it says *what* they saw, which a boolean cannot.

---

## 3 · Unlocked submissions, with a switch

Today two write paths consult `UnlockGrant` before refusing:
`saveAralWeeklyAttendance` (`attendance.ts:155`) and `saveTermGrades`
(`term-grades.ts:146`). Two read paths render the lock state:
`listActiveUnlockKeys` on the ARAL attendance and terms-reports pages.

Add `SystemSetting` key `submissions.locking`, **defaulting to off** — the app
ships with everything writable, which is what "unlock all for now" asks for.
`SystemSetting` is untyped by design precisely so a switch costs no migration.

One reader, `isSubmissionLockingEnabled()`, in
`src/lib/settings/system-settings.ts`, next to `isDemoEnabled` and wrapped in
`cache()` the same way. It must follow the module's existing rule: **a read
failure degrades to the default, never throws.** Here the default is "locking
off", so a settings hiccup leaves teachers able to work — the same direction
`isDemoEnabled` chose for its own failure mode.

One helper, `canWriteWindow(userId, scope, targetKey)`, replaces direct
`hasActiveUnlock` / `findActiveUnlock` calls at the four sites. When locking is
off it returns "writable" **without touching `UnlockGrant` at all** — no query,
no grant lookup. When locking is on, behaviour is exactly what it is today.

Individual grants are untouched and start mattering again the instant the switch
flips. The Super Admin toggle lives in system settings and writes an audit row.

Deliberately global, not per-school: the request was for one decision about the
program's rollout, and a per-school variant can be added later without moving
what this establishes.

---

## 4 · Multi-advisory, maximum of three

The largest item, and the only one that changes a DB-level guarantee.

Today `User.advisorySectionId String? @unique` — one section per teacher, one
teacher per section, both enforced by that single index.

**Invert the pointer.** `Section.adviserId String? @unique` becomes
authoritative. A section still has at most one adviser, guaranteed in SQL; a
teacher may now advise up to three, and *the cap of three is enforced in the
action layer*, not in SQL, so the number can change without a migration.

Additive-first, per the project rule, in two waves:

- **Wave A (this work).** Migration adds `Section.adviserId` with its unique
  index and backfills from `User.advisorySectionId`. The old column stays and is
  **dual-written** by the two writers that own it (`setTeacherAdvisorySection`
  in `teacher.ts`, and the profiling submit path). Reads move to the new column.
- **Wave B (a later, separately approved change).** Drop
  `User.advisorySectionId` once Wave A is confirmed in production.

Dual-writing means one row can hold three advisories while the legacy column
holds only the first. That is acceptable *only* because nothing reads the legacy
column for access after Wave A — `taughtGrades` is already in exactly this
state, described in `scope.ts:70` as dual-written and never read. The same
discipline, made explicit: after Wave A, `User.advisorySectionId` is written and
never read.

**Reach.** Roughly eighteen read sites move from "the advisory section" to
"advisory sections": both transfer pages, ARAL terms-reports, the teacher
learners page, profiling, `teacher-profile-form`, `teachers-active-table`,
`enrollment.ts` (two sites), `global-search`, `section.ts`, `teacher.ts`,
`term-grades.ts`, `dashboard/aggregates`. Each currently assumes at most one and
must render or query a list.

`teacherAdvisoryGradeScope` and `teacherGradeScope` already query through
`sections.some({ adviser: { id } })` and need no change — they were written
against the relation, not the pointer, which is why they survive.

`Section.adviser` is already a relation (`@relation("SectionAdviser")`), so the
Prisma-side rename is mostly moving which side holds the foreign key.

**Cap enforcement** lives in `setTeacherAdvisorySection`: count the teacher's
live advisories, refuse a fourth with a message naming the sections they hold.
Archived sections do not count — see §7, they are not live assignments.

---

## 5 · The floating teacher

A DepEd teacher with no advisory section. Today
`teacherAdvisoryGradeScope` matches nothing for them, so the app renders blank
tables and reads as broken data.

**No migration, no flag.** With multi-advisory in place, floating is exactly
*zero live advisory sections* — a derived state. A stored flag could disagree
with the sections themselves, and then which one is true? Deriving it makes the
disagreement unrepresentable. Setting floating = clearing advisories; clearing
floating = assigning one.

Four things must work:

1. **Finish profiling.** `teacherProfileSchema` requires `sectionId` and
   `currentGradeAssignment` for every designation except ARAL Volunteer
   (`profile.schema.ts:338`). Add an explicit "I have no advisory section" path
   that a DepEd teacher may take, so the requirement lifts on a declared
   choice rather than on a designation. The distinction matters: an ARAL
   Volunteer holds no classroom role at all, while a floating DepEd teacher
   holds one and simply has no section yet.
2. **Be designated an ARAL tutor.** Already true and must stay true.
   `aralTutorScope` (`aral-tutor.ts:120`) filters on school, role, active and
   approved — no advisory requirement — and its doc comment says so explicitly.
   Verified, covered by a test, not changed.
3. **Show as Floating on the teachers page.** Where the grade/section cell is
   blank today, a **Floating** chip, which the School Head can set and clear.
   Blank reads as missing data; the chip reads as a decision. The cell it
   replaces is the one §6 repairs.
4. **See a real page.** The teacher dashboard and learners page get an empty
   state naming the floating state and pointing at what they *can* reach,
   instead of empty tables. `deniesAdvisoryRoster` already handles the
   volunteer case and is the right place to look for the pattern.

---

## 6 · The teachers page, assigned and unassigned

One defect, in one line. `managedTeacherSelect` (`src/lib/teachers/roster.ts:47`)
selects `advisorySection` with **no `deletedAt` filter**:

```ts
advisorySection: {
  select: { id: true, name: true, gradeLevel: { select: { type: true } } },
},
```

So a teacher whose section was archived still renders as advising it. The page
shows an assignment that no longer exists, and the teacher looks assigned when
they are in fact free.

Every other reader in the repo already guards this — `admin/transfers/page.tsx:107`,
`school-head/transfer/page.tsx:107`, and `teacherAdvisoryGradeScope` all filter
`deletedAt: null`. The teachers page is the one that was missed, which is why it
is the only surface where the two disagree.

Fix: add `deletedAt: null` to the selection. A teacher holding only archived
sections then reads as unassigned, which is what they are — and with §5 in place
that cell renders the **Floating** chip rather than a blank.

This is also the filter that §4 must carry forward: when `advisorySection`
becomes a list of sections through `Section.adviserId`, the list is of *live*
sections. The same rule, one place, applied once rather than at each call site
that counts them.

---

## 7 · Grade levels: active and inactive

For a grade set by mistake. Today only `createGradeLevel` exists;
`bootstrapSchoolStructure` is explicitly commented *"Never deletes existing
grades/sections"* — there is no archive path at all. `GradeLevel.deletedAt`
exists and is already restored by that bootstrap, so the column needs no
migration.

`archiveGradeLevel` and `restoreGradeLevel` in `school-head.ts`:

- **Archive refuses when the grade still holds live learners**, reporting the
  count so the School Head moves them first. Deactivating is for a mistake, and
  a mistake has nobody in it. Hiding a class of real learners behind a toggle is
  the failure this rule exists to prevent.
- An empty grade archives freely, taking its sections with it.
- Restore brings the grade and the sections archived with it back — mirroring
  what `bootstrapSchoolStructure` already does when it revives a soft-deleted
  grade.

Both audited via new `AUDIT_ACTIONS` entries, both revalidating through the named
helpers in `cache/revalidate.ts`. The toggle goes in `grade-levels-client`, which
already holds `createGradeLevel` and the optimistic-update pattern to match.

Archiving a grade whose sections have advisers frees those advisers — archived
sections are not live assignments, so they leave §4's cap and, via §6, stop
rendering as assignments on the teachers page.

---

## 8 · Naidas T. Opong (Litos Extension), school ID 130554

*Revised 2026-09-10 during implementation. The first version of this section
proposed relaxing `School_schoolIdCode_real_key` to a partial unique on
`(lower(btrim(name)), schoolIdCode)`. It would not have worked, for two reasons
the index change does not touch:*

1. *`createSchool` refuses a duplicate code in the app layer
   (`src/lib/actions/school.ts`, the case-insensitive `codeTaken` probe) before
   it ever reaches the database.*
2. *The School Head's Supabase login email is built from the stored code —
   `sh@<schoolIdCode>.<domain>` (`schoolHeadSyntheticEmail`). The mother
   school's head already holds `sh@130554.…`, so `createUser` fails "already
   registered".*

**Follow the convention the roster import already established.** An extension
shares its mother school's DepEd ID, but its *stored* code carries a `-N` suffix:
Naidas T. Opong ES is `130554`, Naidas T. Opong ES (Banlas Extension) is
`130554-2` (`assignSchoolCredentials`, `src/lib/import/school-credentials.ts`).
The Litos Extension is `130554-3`. No migration; the stored code stays unique
and so does the login email built from it.

**One default password for the whole group — the bare `130554`.** Decided by
the project owner: a school and its extensions start on the same credential.
The import already set it that way, but three other paths used the stored code
instead, so an extension head could be handed `130554-2` by one screen and need
`130554` at sign-in. `defaultSchoolHeadPassword` (`src/lib/auth/school-head-password.ts`)
inverts the import's suffix — only after a six-digit base, so a code an admin
typed with a dash of its own is left whole — and is now the single source for
every path that sets or shows the default:

- `createSchool` (initial password; the email stays on the stored code)
- `regenerateSchoolHeadCredential` (key icon on /admin/schools)
- `resetSchoolHeadPasswordToDefault` (Reset in the school-accounts console)
- `resetAllSchoolHeadPasswords` (database console bulk reset)
- the console row, as `SchoolAccountRow.defaultPassword` — `schoolIdCode` is
  still what the School ID column shows

A test pins the helper as the exact inverse of `assignSchoolCredentials` over
the real collision groups, so the two rules cannot drift apart.

Safe because nothing resolves a school *by* its code or its password: sign-in
takes the selected school's UUID. The schema comment at `School.schoolIdCode`
says so, and it stays true.

⚠️ **Stated plainly:** heads of a school and its extensions start on the same
default credential until they change it. `mustChangePassword` still forces the
change at first login, and `passwordIsSchoolId` still tracks the state.
Accepted knowingly.

A Super Admin creates the extension through the existing admin form — name
`Naidas T. Opong ES (Litos Extension)`, School ID `130554-3`. No hand-written
INSERT; the form's own duplicate check refuses if `130554-3` is taken.
---

## 9 · School Head email

Both halves, as decided.

**Contact email** (`SchoolHeadProfile.contactEmail`) becomes editable in
Settings → Profile. Pure form and action work — the column exists, and it is
already documented as distinct from the login identity.

**Login email** reuses `changeEmailAction` (`auth.ts:834`), which already
handles the synthetic→real transition: it re-verifies the current password,
checks the new address is not taken, updates Supabase Auth through the admin
client, and tracks `previousWasSynthetic`. The School Head security page already
renders `ChangeEmailForm` with `isSynthetic` computed. The work is confirming
this path end-to-end for a School Head and fixing what it turns out not to cover
— not building it.

Replacing the synthetic address with a real one also restores email password
recovery for that head, which `docs/runbook.md` currently says they cannot use.

---

## 10 · School Head position dropdown

The `SchoolHeadPosition` enum has held 17 values since it was written. The form
never used them: `sh-profile-form.tsx:179` locks position to `SH_DEFAULT_POSITION`
(`PRINCIPAL_I`) and renders it read-only with the hint *"Default school head
position for this profile."*

Replace that read-only field with a select over `SCHOOL_HEAD_POSITION_LABELS`.
`SH_DEFAULT_POSITION` stays as the initial value for a profile that has none, so
existing rows keep reading as they do now. The review step at line 669 already
renders the chosen label and needs no change.

`designation` stays locked to `"School Head"` — it is a `z.literal` in the
schema, a different axis from rank, and not what was asked for.

---

## 11 · Strict ARAL assignment

The one with a real correctness bug behind it.

`teacherLearnerScope` (`scope.ts:38`) is `OR: [{ teacherId }, { aralTeacherId }]`
— "learners this teacher may act on", adviser **or** designated ARAL tutor. Every
ARAL page uses it. So an adviser sees the ARAL learners *in their own class* on
their own ARAL pages even when somebody else is the designated tutor. That is the
reported symptom.

**`teacherLearnerScope` must not change.** It has 19 invocation sites and is correct
for almost all of them: the advisory roster, exports, global search, the
assistant, dashboard aggregates. Narrowing it would close the advisory roster to
advisers, which is the opposite of what anyone wants.

Add a second, narrower predicate beside it:

```ts
/** ARAL pages only: learners this teacher is the DESIGNATED tutor for. */
export function aralLearnerScope(teacherId: string): Prisma.LearnerWhereInput {
  return { aralTeacherId: teacherId };
}
```

Applied at the ARAL sites only — the ARAL dashboard, the grade-level attendance
and reading-level sheets, the three per-learner ARAL routes, `aral-grid.ts`, and
the ARAL branches of `attendance.ts` / `reading-level.ts` / `term-grades.ts`.
Each site is changed individually and deliberately; the ARAL branch of a shared
action must be identified rather than assumed.

Two predicates, two names, two doc comments saying which is which — the
`aralTeacherId` axis is what makes an ARAL-only teacher work at all, and the
distinction between "may act on" and "is the tutor for" needs to be legible at
every call site.

`teacherGradeScope` keeps its `aralTeacherId` branch: a floating ARAL tutor
reaches an ARAL grade *because* they tutor a learner in it. Narrowing that would
undo §5.

---

## 12 · Ethnicity on the learner form

The enum, `ETHNICITY_LABELS`, the two-slot rule and `ethnicityColumns` are all in
sync — verified. Two real defects, neither of them in that logic.

**The export cannot round-trip.** `export-learners.ts:176` writes
`formatEthnicity(...)` — the *display label*, with the free text substituted for
"Others" — into a column headed `Ethnicity`, and emits no `ethnicityOther`
columns at all. `import-csv.ts` expects four columns and resolves the enum
through `ETHNICITY_LOOKUP`. So a learner recorded as Others/"Manobo" exports as
`Manobo`, which resolves to no enum value, and the row is rejected on re-import
(`import-csv.ts:199` falls back to the raw string, which then fails validation).
Export a roster, re-import it, and every Others learner is lost.

Fix: export all four columns, matching the importer's contract, so the two halves
of the same feature agree. The human-readable label stays available for the
reading view; it is the machine columns that were missing.

**Both selects are 40px.** `learner-form.tsx:471` and `:521` are `h-10`, missed
by the 44px touch-target pass in `3b62b17`. WCAG 2.5.5, same fix as that commit.

No new ethnicity options in this work. If groups are missing from the thirteen in
the enum, that is a third fix and an enum migration; say which and it gets added.

---

## Verification

Unit tests (Vitest):

- `releases.ts`: ordering, no duplicates, date shape, non-empty fixes,
  `package.json` in sync.
- Release announcement: `announce: false` writes nothing; acknowledgement is
  idempotent; a stamped user is not re-announced; a rollback does not re-announce.
- `canWriteWindow`: locking off ⇒ writable without a grant lookup; locking on ⇒
  today's behaviour; a settings read failure ⇒ writable.
- Advisory cap: a fourth assignment refuses; archived sections do not count;
  `Section.adviserId` uniqueness still holds.
- Teachers page: a teacher whose only section is archived reads as unassigned,
  not as advising it.
- `aralLearnerScope` vs `teacherLearnerScope`: an adviser who is not the
  designated tutor does not see the learner on ARAL pages but does see them on
  the advisory roster. This is the regression test for §11 and must fail if
  either predicate is changed to the other.
- Floating teacher: profiling submits with no section; `aralTutorScope` still
  admits them.
- Grade archive: refuses with a count while learners remain; succeeds when
  empty; restore brings sections back.
- Ethnicity: export → import round-trips, including an Others learner with free
  text.

Then the four gates CI enforces: `typecheck` → `lint` → `test` → `build`.

Migrations are validated offline only — `prisma validate`, `prisma format`,
`prisma generate`. No agent runs `migrate deploy`, `migrate dev`, `db push`, or
any DDL against a live database.

## Out of scope

- Dropping `User.advisorySectionId` (Wave B, separately approved).
- Per-school submission locking.
- New ethnicity enum values.
- Unlocking `designation` on the School Head profile.
- Dropping `TeacherProfile.mostSubjectHandled`, already flagged in the schema for
  a future wave.
