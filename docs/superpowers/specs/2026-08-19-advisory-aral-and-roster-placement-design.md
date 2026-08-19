# Advisory placement, ARAL designation, and roster fixes

**Date:** 2026-08-19
**Status:** approved, not yet implemented

Five changes to the teacher surfaces, driven by four decisions recorded in
`## Decisions` below. Two of them need a migration authored here and applied by
the project owner.

## Problems

1. **Adding a learner fails with a grade the form itself offered.** The
   add-learner grade dropdown is built from `teacherGradeScope`, which includes
   grades reached through ARAL tutoring. `createLearner` validates the submitted
   grade with `teacherAdvisoryGradeScope`, which deliberately excludes ARAL. Any
   teacher who tutors an ARAL learner is therefore offered a grade the server
   refuses with *"You are not assigned to this grade level"*. Because the modal
   defaults to the first grade in the list, it can open pre-set to a grade that
   cannot succeed. Sections inherit the same over-wide list and fail through
   `resolveSectionForGrade` with *"Section not found in this grade"*.

2. **The "Others" ethnicity detail loses typed text.** `ethnicityOther` is the
   only value in the learner form not held in React state. It is an uncontrolled
   input inside a conditional, so choosing Others, typing, switching ethnicity
   away and switching back unmounts the input and silently discards the text.

3. **One grade and one section per teacher is enforced on write but not on
   read.** `User.advisorySectionId` is `@unique` and `setTeacherAdvisory` already
   strips every other `TeacherSection` row and `taughtGrades` link. Both grade
   scopes still union in the legacy `taughtGrades` mirror, so reads remain
   permissive.

4. **A teacher enrolling a learner in ARAL can only ever assign themselves.**
   `enrollLearnersToAral` hard-codes `aralTeacherId: user.id`. The School Head
   surface already designates any active teacher; the teacher surface cannot.
   Nothing tells the designated tutor they were given a learner.

5. **`End of Terms Reports` sits under ARAL Program and collides with
   `Reports`.** It is a per-term grades report, not an ARAL surface, and it
   points at `/teacher/reports` — the same href as the real `Reports` item — so
   `resolveActiveItemId` highlights the wrong row.

## Decisions

| Question | Decision |
|---|---|
| How to record DepEd vs non-DepEd | Nullable enum on `TeacherProfile`. Displayed as a chip when picking an ARAL tutor; **never** filters eligibility. |
| Legacy `taughtGrades` union in reads | Cut it. The already-applied backfill covers the data (see §3). |
| Teacher-side ARAL enrolment | One tutor picked from the whole active roster, bulk enrolment, and a notification to the designated tutor naming who assigned it. |
| Grade/section in the add-learner form | Neither select. Show the placement the learner will get. |

## 1 · Schema

Two additions, one migration, **authored here and applied by the project owner**.
Per `docs/migrations.md`, nothing in this repo applies migrations to a remote or
shared database.

### `EmploymentType`

```prisma
enum EmploymentType {
  DEPED_PLANTILLA
  NON_DEPED
}
```

Nullable `TeacherProfile.employmentType`. Nullable is deliberate: existing
profiles never answered this question and must not be made to claim an answer.
The existing `TeacherPosition` enum (Teacher I–VII, Master Teacher I–IV) is a
different axis — plantilla rank — and is untouched.

The field is display-only. It is shown as a chip in the ARAL tutor picker so a
School Head or adviser can see who they are designating. It must never narrow
the list of eligible tutors, because a non-DepEd teacher is a valid ARAL tutor.

### `Notification`

There is no notification table today. The bell renders derived, non-persisted
`ShellNotification` values, and the builder that produces them
(`buildTeacherNotifications`) currently has no callers at all. An
actor-attributed message with per-recipient read state cannot come from derived
alerts, so it needs a row.

```prisma
enum NotificationType {
  ARAL_ASSIGNED
}

model Notification {
  id          String           @id @default(uuid())
  schoolId    String
  recipientId String
  actorId     String?
  type        NotificationType
  learnerIds  String[]
  readAt      DateTime?
  createdAt   DateTime         @default(now())
}
```

`actorId` is nullable so a removed account leaves the notification readable.
`learnerIds` holds ids only — names are resolved at read time. No learner PII is
duplicated into a second table, and a renamed or removed learner cannot leave
stale text in a feed. Relations: `school` and `recipient` cascade on delete,
`actor` sets null. Indexes: `[recipientId, readAt, createdAt]` for the unread
read path, `[schoolId, createdAt]` for tenant-scoped reads.

One row is written per enrolment action rather than per learner, so a bulk
enrolment of twelve learners produces one notification, not twelve.

## 2 · Grade scopes

`src/lib/teachers/scope.ts` only. Cut the legacy `{ teachers: { some: { id } } }`
clause from both scopes:

- `teacherAdvisoryGradeScope` → the advised section alone. One clause, no `OR`.
- `teacherGradeScope` → advisory ∪ grades where the teacher is somebody's ARAL
  tutor.

Nothing else reads `taughtGrades` for access. The only other references
disconnect it when a teacher or section is deleted
(`src/lib/actions/school-head.ts`, `src/lib/actions/section.ts`).

### No new backfill is needed

`prisma/migrations/20260811000003_backfill_advisory_and_aral` already populated
`User.advisorySectionId` from `TeacherSection`, in two deterministic passes
(earliest `assignedAt` wins the teacher's candidate section, then earliest
assignment wins a contested section), idempotent and guarded on
`advisorySectionId IS NULL`.

No drift can have accumulated since: `setTeacherAdvisory` is the only creator of
`TeacherSection` rows, and it writes `advisorySectionId` in the same
transaction.

**What remains is structural, not fixable by SQL.** That migration deliberately
left the pass-2 losers of a contested section with a null pointer. Because
`advisorySectionId` is `@unique`, two teachers cannot share one section's single
adviser slot, so no migration can give those teachers an advisory. Today they
keep grade access through the `taughtGrades` union; once it is cut they resolve
to zero grades.

That is handled in the interface, not the database. A teacher with no advisory
section sees an explicit empty state naming the fix — *"Set your advisory
section in Settings → Profile"* — instead of a blank roster, and the add-learner
control is disabled with the same reason rather than silently absent. A School
Head can also assign them a section. This is the accepted cost of the decision
to cut the union.

## 3 · Add-learner and edit form

`createLearner` stops trusting the client and derives placement from
`user.advisorySectionId`, scoped by `schoolId` and `deletedAt: null`:

- No advisory section — null pointer, or the section was soft-deleted — returns
  *"Set your advisory section in Settings → Profile before adding learners."*
  This is a reachable state, not a defensive branch.
- The derived grade and section are used for the `Learner` row and its
  `Enrollment`. The submitted `sectionId` is ignored.
- If a submitted `gradeLevelId` disagrees with the derived advisory grade, the
  action refuses rather than silently relocating the learner. Writing a row that
  contradicts the screen the teacher was looking at is worse than an error.

The form drops both selects. In their place, one read-only placement line in
section 1 (Identity & placement): the teacher's advisory assignment in add mode
(`Grade 3 · Sampaguita`, hinted *"New learners join your advisory section."*),
and the learner's current placement in edit mode. Rendered as text, not as a
disabled `<select>` — a greyed-out control invites a click and reads as broken,
where a labelled value reads as a fact.

`LEARNER_FORM_SECTIONS` keeps its four keys, titles and hints, and
`gradeLevelId` stays out of every section's required-field list, so the existing
progress-bar tests hold.

`updateLearner` preserves the learner's existing `gradeLevelId` and `sectionId`
instead of reading them from the payload. With one section per teacher, the only
moves the form could express are a no-op within the teacher's own section or —
for a learner they hold only as ARAL tutor — a move into a section they do not
advise. Relocating learners belongs to the School Head's transfer flow.

`ethnicityOther` moves into React state, initialised from the default value, so
it survives the conditional unmount. It keeps its `name` so `FormData` still
picks it up while visible, and `handleSubmit` keeps stripping it when ethnicity
is not `OTHER`.

`handleSubmitClick` is untouched. It exists because a control in a collapsed
section is hidden but not unmounted: `FormData` reads it, the browser refuses to
submit because it is not focusable, and the only report is a console line no
teacher sees. That handler intercepts the click before constraint validation,
opens the offending section, then focuses and reports. Native `required` inside
a collapsed section is therefore already handled.

## 4 · ARAL designation

`enrollLearnersToAral` gains an optional `aralTeacherId`, defaulting to the
caller. A supplied id is validated exactly as the School Head action validates
it — same school, `role: "TEACHER"`, `deletedAt: null`, `isActive`,
`approvalStatus: "APPROVED"` — with no advisory requirement and no employment
filter, because a teacher with no advisory section is a valid tutor.

The bulk enrol dialog gains a tutor select over the whole active roster,
defaulting to "Myself", each row showing the advisory (`Grade 3 · Sampaguita`)
or `ARAL only`, with the DepEd / non-DepEd chip beside it.

Candidates stay adviser-only. Enrolling is a roster write over one's own
learners; an ARAL-only teacher receives designations rather than making them.
The profile modal's single-learner "Enroll as ARAL" keeps self-assigning, and
writes no notification — assigning yourself should not notify you.

### Delivery to the designated tutor

Enrolling on someone else's behalf writes one `Notification` row. The recipient
sees it two ways:

- **In the bell.** `buildTeacherNotifications` is wired up — it was built for
  this and has no callers today — and persisted rows are merged with the derived
  alerts into the existing `ShellNotification[]` the menu already renders.
- **As a modal on next page load.** Unread `ARAL_ASSIGNED` notifications raise a
  dialog naming the actor and the learners — *"Teacher Marivic assigned you 3
  ARAL learners."* — with Dismiss (marks read) and a link to the ARAL roster.

This stack has no push channel, so the modal appears on navigation rather than
the instant the assignment happens. A new server action marks notifications
read.

## 5 · Navigation

`NavItem` gains `soon?: boolean`. `End of Terms Reports` moves out of the ARAL
Program group into `Menu`, directly below `Learners`, marked `soon`. It keeps
its label, icon and href for when it is wired.

`resolveActiveItemId` skips `soon` items, so `/teacher/reports` resolves to the
real `Reports` item — which fixes the collision.

`NavLink` grows a non-interactive branch for `soon` items: icon and label at
muted emphasis with an uppercase "Soon" pill, not a `PrefetchLink`, so it is
neither clickable nor focusable. The treatment reuses the convention already
established in `learner-bulk-actions.tsx` and the profile modal footer. The
collapsed rail conveys the state too, following how `item.badge` degrades to a
dot there.

## Also in scope

- Delete `src/app/teacher/(app)/grade/[id]/learners/[learnerId]/edit/`
  (`page.tsx` and `loading.tsx`). Editing happens in the profile modal; the
  route is orphaned. Clear any remaining `/edit` warm hrefs.
- Regression test for the header-search crash: dispatching a bare
  `new Event("keydown")` — which a browser extension or dev tooling can do, and
  which carries no `key` — must not throw. The guard is in place; nothing covers
  it.

## Testing

- `LEARNER_FORM_SECTIONS` / `formProgress` / `sectionProgress` unit tests must
  keep passing unchanged; they are the contract that the section split did not
  move.
- `tests/unit/nav/nav-config.test.ts` updates: both group arrays, and the
  `resolveActiveItemId("/teacher/reports")` assertion, which now correctly
  resolves to `teacher-reports`.
- New coverage: `createLearner` derives placement and refuses a mismatched
  grade; `createLearner` refuses a teacher with no advisory section;
  `enrollLearnersToAral` validates a supplied tutor and rejects one from another
  school; a notification row is written for a designation and not for a
  self-assignment; the scope functions no longer match on `taughtGrades`.
- Tenant isolation stays the first-class concern in every new query: `schoolId`
  in the `where`, or `assertSameSchool`, which reports a generic `"Not found"`
  so existence in another tenant never leaks.

`npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`, per
CI's gate order.

## Apply order

The scope cut in §2 needs no migration and can ship on its own. The DepEd chip
and every notification path stay dark until the project owner applies the §1
migration; the code must not be deployed ahead of it.
