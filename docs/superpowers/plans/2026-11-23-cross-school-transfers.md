# Cross-school Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send learners, teachers and ARAL volunteers to another school in the same division as pending transfers. The receiving school accepts or declines them.

**Architecture:**
- One new table, `SchoolTransferRequest`, holds one row per person. People sent together share a `batchId`.
- Pure rule functions decide expiry, kind and validity.
- Server actions in `src/lib/actions/school-transfer.ts` request, cancel, decline and accept transfers.
- Accepting a learner reuses the enrollment move, which is extracted from `transferLearnerCrossSchool`.
- One client workspace serves the School Head page and the District admin page.

**Tech Stack:** Next.js 16 App Router, Prisma 6 on Neon Postgres, Zod, Tailwind and shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-cross-school-transfers-design.md`

## Global Constraints

- **Migration:** additive only (new enums, a new table, new `NotificationType` values). Name it `20261123000001_school_transfer_requests`. Apply it to prod Neon (`snowy-queen-03727769`) only with the owner's explicit approval, and before the code push.
- **Target schools:** active, with the same `School.division` as the sender, and not the same school. A school with a null division cannot send or receive.
- **Pending rules:**
  - A transfer expires 30 days after it is sent (`expiresAt = createdAt + 30 days`).
  - A reason or a decline note is at most 300 characters.
  - The person stays fully active at the old school while the transfer is pending.
- **Who can act:**
  - Sending side: the School Head of `fromSchoolId`, or a Super Admin or District admin whose scope covers `fromSchoolId`.
  - Receiving side: the same rule, applied to `toSchoolId`.
- **Error and audit:** use the house `action()` wrapper and throw `AppError`. Audit staff moves only, through `SECURITY_AUDIT_ACTIONS`.
- **UI:**
  - Controls follow the size standard: `h-11 lg:h-9`.
  - Tables follow the data-table system.
  - User-facing copy says "ARAL volunteer" and "multi-advisory", never `MULTI_GRADE`.
- **Release:** add a new RELEASES entry with a middle-number bump (feature), set the same version in `package.json` and `package-lock.json`, and use `announce: true`.

## Review Focus

1. **Person moved, archived or deleted while pending:** accept skips that row with a reason, and the other rows succeed. Test it in Task 5.
2. **Same person sent twice:** the second request is refused with a clear message. The partial unique index backs this up. Test it in Task 4.
3. **Super Admin or District admin acting for a school outside their scope:** the action fails with NOT_FOUND and the attempt is logged as cross-tenant. Test it in Task 3.
4. **Expired row:** the row shows as Expired, and cancel, decline and accept all refuse it. Test it in Tasks 2 and 4.
5. **Moved teacher at the old school:**
   - Their advisory sections are left with no adviser.
   - Learners whose `teacherId` was the moved teacher have it cleared.
   - Their ARAL learners get the adviser of their own section, or `null` if that section has none.
   - Test it in Task 5.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`. Add the enums and the model after `SectionTransferRequest` (around line 1594). Add the two values at the end of `NotificationType`. Add relations on `School`, `Learner` and `User`, and add `batchId` to `Notification`.
- Create: `prisma/migrations/20261123000001_school_transfer_requests/migration.sql`
- Modify: `src/lib/db/schema-order.ts`. Add `{ model: "SchoolTransferRequest", delegate: "schoolTransferRequest" }` after the `SectionTransferRequest` entry.
- Modify: `src/lib/constants/enum-labels.ts`. Add `SCHOOL_TRANSFER_KIND_LABELS` and `SCHOOL_TRANSFER_STATUS_LABELS`.

**Interfaces:**
- Produces:
  - `enum SchoolTransferKind { LEARNER TEACHER ARAL_VOLUNTEER }`
  - `enum SchoolTransferStatus { PENDING ACCEPTED DECLINED CANCELLED EXPIRED }`
  - `model SchoolTransferRequest`, with the columns listed in the spec.
  - Relation names: `"SchoolTransferFrom"`, `"SchoolTransferTo"`, `"SchoolTransferPerson"` (User), `"SchoolTransferRequester"`, `"SchoolTransferDecider"`.
  - `NotificationType` values `SCHOOL_TRANSFER_REQUESTED` and `SCHOOL_TRANSFER_DECIDED`.
  - `Notification.batchId String?`, with an index.

- [ ] **Step 1:** Edit the schema.
  - Use `onDelete: Cascade` for the school and person FKs.
  - Use `SetNull` for the requester and decider.
  - Add the indexes `(toSchoolId, status, createdAt)`, `(fromSchoolId, status, createdAt)`, `(learnerId, status)`, `(userId, status)` and `(batchId)`.
- [ ] **Step 2:** Run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` and save the output as `migration.sql`. The shadow DB comes from the diff command's file inputs only, never `--from-url`. Then append the SQL-only constraints:
  ```sql
  ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_one_person"
    CHECK ((("learnerId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int) = 1);
  ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_schools_differ"
    CHECK ("fromSchoolId" <> "toSchoolId");
  CREATE UNIQUE INDEX "SchoolTransferRequest_learner_pending_unique"
    ON "SchoolTransferRequest" ("learnerId") WHERE "status" = 'PENDING';
  CREATE UNIQUE INDEX "SchoolTransferRequest_user_pending_unique"
    ON "SchoolTransferRequest" ("userId") WHERE "status" = 'PENDING';
  ```
  Add a `///` doc comment on the model that names these four constraints with "PRESERVE when editing".
- [ ] **Step 3:** Run `npx prisma validate`, `npx prisma generate` and `npm run typecheck`. Expected: all pass. Then run `npx vitest run tests/unit/db`. Expected: the schema-order or snapshot-scope tests pass. Add the model wherever a test lists every model.
- [ ] **Step 4:** Commit `prisma/ src/lib/db/schema-order.ts src/lib/constants/enum-labels.ts` with the message "feat(db): school transfer requests table".

### Task 2: Pure transfer rules

**Files:**
- Create: `src/lib/transfers/school-transfer-rules.ts` (no Prisma, no `server-only`)
- Test: `tests/unit/transfers/school-transfer-rules.test.ts`

**Interfaces:**
- Produces:
  - `TRANSFER_EXPIRY_DAYS = 30`
  - `expiresAtFor(sentAt: Date): Date`
  - `effectiveStatus(row: { status: SchoolTransferStatus; expiresAt: Date }, now: Date): SchoolTransferStatus`. A PENDING row whose `expiresAt` is at or before `now` returns EXPIRED.
  - `transferKindForTeacher(designation: string | null | undefined): "TEACHER" | "ARAL_VOLUNTEER"`. Uses `isAralVolunteerDesignation` from `@/lib/teachers/scope`.
  - `canTransferBetween(from: { id: string; division: string | null; isActive: boolean }, to: same): boolean`. True only when both schools are active, the ids differ, and the divisions are non-null and equal after `trim().toLowerCase()`.
  - `type SkipReason = "EXPIRED" | "NOT_PENDING" | "MOVED" | "REMOVED"`
  - `SKIP_REASON_LABELS: Record<SkipReason, string>`. User copy, for example `MOVED: "No longer at the sending school"`.

- [ ] **Step 1:** Write the tests:
  - `effectiveStatus` with `expiresAt` 1 ms before `now` returns `"EXPIRED"`.
  - `effectiveStatus` with `expiresAt` 1 ms after `now` returns `"PENDING"`.
  - `effectiveStatus` of a DECLINED row past its expiry still returns `"DECLINED"`.
  - `expiresAtFor(new Date("2026-11-23T00:00:00Z"))` returns `2026-12-23T00:00:00Z`.
  - `canTransferBetween`:
    - true when the divisions are `"Division of X"` and `" division of x "`;
    - false when either division is null;
    - false when the target school is inactive;
    - false when both ids are the same.
  - `transferKindForTeacher` returns `"ARAL_VOLUNTEER"` for the volunteer designation value used in `scope.ts`, and `"TEACHER"` for `"TEACHER_I"` and for `null`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/transfers/school-transfer-rules.test.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Implement the module.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): pure school transfer rules".

### Task 3: Acting-school resolver and validators

**Files:**
- Create: `src/lib/transfers/actor.ts` (`server-only`)
- Create: `src/lib/validators/school-transfer.schema.ts`
- Test: `tests/unit/transfers/actor.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `loadAdminScopeForUser` and `loadSchoolInScope` (`src/lib/auth/district-scope.ts`), `assertSameSchool`.
- Produces:
  - `resolveTransferActor(schoolId: string): Promise<{ user: User; schoolId: string; viaAdmin: boolean }>`. It accepts:
    - a SCHOOL_HEAD whose `user.schoolId === schoolId`; any other school is NOT_FOUND through `assertSameSchool`;
    - a SUPER_ADMIN or DISTRICT_ADMIN, through `loadSchoolInScope(scope, schoolId, { id: true })`.
    - TEACHER and every other role gets the FORBIDDEN AppError.
  - Zod schemas (ids are uuid, arrays have 1–200 items, text is trimmed, empty text becomes undefined):
    - `requestSchoolTransfersSchema`: `{ fromSchoolId, toSchoolId, kind, ids: string[], reason?: string≤300 }`
    - `cancelSchoolTransfersSchema`: `{ schoolId, ids }`
    - `declineSchoolTransfersSchema`: `{ schoolId, ids, note?: string≤300 }`
    - `acceptSchoolTransfersSchema`: `{ schoolId, ids, placement?: { gradeLevelId, sectionId } }`
    - Types are inferred from the schemas.

- [ ] **Step 1:** Write the tests. Mock `@/lib/auth/session` and `@/lib/prisma` the way `tests/unit/enrollment-transfer-scope.test.ts` does.
  - A School Head acting for their own school resolves with `viaAdmin: false`.
  - A School Head passing another school's id rejects with code `NOT_FOUND`.
  - A District admin passing a school outside their districts rejects with `NOT_FOUND`.
  - A District admin passing a school inside their districts resolves with `viaAdmin: true`.
  - A Teacher rejects with `FORBIDDEN`.
  - The schema rejects a 301-character reason, and rejects an empty `ids` array.
- [ ] **Step 2:** Run `npx vitest run tests/unit/transfers/actor.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): acting-school resolver and schemas".

### Task 4: Request, cancel and decline actions

**Files:**
- Create: `src/lib/actions/school-transfer.ts` (`"use server"`)
- Modify: `src/lib/cache/tags.ts` and `src/lib/cache/revalidate.ts`. Add `schoolTransfers(schoolId)` and `revalidateSchoolTransfers(schoolIds: string[])`. The latter also busts the School Head dashboard attention tags for those schools.
- Modify: `src/lib/actions/section-transfer.ts` (`requestSectionTransfers` and `transferLearnersToSection`). Refuse a learner with a PENDING, not-expired `SchoolTransferRequest`, with block reason `"SCHOOL_TRANSFER_PENDING"`, label "Has a pending transfer to another school". Add the reason in `src/lib/learners/section-transfer.ts`.
- Test: `tests/unit/actions/school-transfer-request.test.ts`

**Interfaces:**
- Consumes: Task 2 rules, Task 3 resolver and schemas, and `notifySchoolTransfer` from Task 6. Until Task 6 lands, Task 4 imports it from `src/lib/transfers/notify.ts` as a stub that does nothing.
- Produces:
  - `requestSchoolTransfers(input: RequestSchoolTransfersInput): Promise<{ ok: true; data: { batchId: string; count: number } }>`
    - Resolve the actor on `fromSchoolId`.
    - Load both schools and require `canTransferBetween`. On failure, throw `fieldError("toSchoolId", "Pick an active school in your division")`.
    - Call `assertSchoolYearOpen` on both schools.
    - **For learners:** each id must be a learner with `schoolId = fromSchoolId`, `deletedAt: null` and `archivedAt: null`. Otherwise throw NOT_FOUND.
    - **For staff:** each id must be a TEACHER with that `schoolId`, `isActive`, `approvalStatus: APPROVED` and not deleted. `transferKindForTeacher(designation)` must equal `kind`, otherwise throw a VALIDATION_FAILED field error.
    - If any person already has a live PENDING row, throw `AppError("CONFLICT", { detail })` with the message "{n} already have a pending transfer".
    - First, in a transaction, mark this school's expired PENDING rows as EXPIRED.
    - Create all rows in one `createMany` with a fresh `crypto.randomUUID()` batchId and `expiresAt = expiresAtFor(now)`.
    - Call `notifySchoolTransfer({ type: "REQUESTED", batchId })`. Call `revalidateSchoolTransfers([from, to])`.
  - `cancelSchoolTransfers(input)`: resolve the actor on `schoolId` as the sender. Use `updateMany` with `where { id in ids, fromSchoolId: schoolId, status: PENDING, expiresAt > now }`, setting CANCELLED, the decider and `decidedAt`. Return `{ count }`. If the count is 0, throw `AppError("CONFLICT")` with the message "Nothing left to cancel".
  - `declineSchoolTransfers(input)`: the same, with `toSchoolId: schoolId`, status DECLINED and `decisionNote`. Then call `notifySchoolTransfer({ type: "DECIDED", ids })`.

- [ ] **Step 1:** Write the tests against mocked Prisma:
  - A learner request with a different-division target throws a field error on `toSchoolId`.
  - A learner request for a learner of another school throws `NOT_FOUND`.
  - Asking to send a learner who already has a PENDING row throws `CONFLICT`.
  - A staff request where the volunteer designation is sent as `kind: "TEACHER"` throws VALIDATION_FAILED.
  - A happy path with 3 learners calls `createMany` with 3 rows sharing one batchId and with `expiresAt` 30 days out.
  - Cancel passes `status: "PENDING"`, `fromSchoolId` and `expiresAt: { gt: now }` in the `updateMany` where.
  - Decline on an expired row (`updateMany` count 0) throws `CONFLICT`.
  - Section-transfer request for a learner with a pending school transfer is blocked with `SCHOOL_TRANSFER_PENDING`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/actions/school-transfer-request.test.ts tests/unit/section-transfer.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): request, cancel, decline actions".

### Task 5: Accept action and the move helpers

**Files:**
- Create: `src/lib/transfers/apply-learner-move.ts`
- Create: `src/lib/transfers/apply-staff-move.ts`
- Modify: `src/lib/actions/enrollment.ts:420-486`. `transferLearnerCrossSchool` calls `applyLearnerSchoolMove` inside its transaction. Its behavior stays the same.
- Modify: `src/lib/actions/school-transfer.ts`. Add `acceptSchoolTransfers`.
- Modify: `src/lib/audit-actions.ts`. Add `STAFF_SCHOOL_TRANSFER_ACCEPTED` to `AUDIT_ACTIONS` and `SECURITY_AUDIT_ACTIONS`.
- Modify: `src/lib/actions/learner.ts` (archive) and the teacher remove/deactivate action in `src/lib/actions/accounts.ts`. Cancel that person's PENDING school transfer in the same transaction.
- Test: `tests/unit/transfers/apply-staff-move.test.ts`, `tests/unit/actions/school-transfer-accept.test.ts`. The existing `tests/unit/enrollment-transfer-*.test.ts` must stay green.

**Interfaces:**
- Produces:
  - `applyLearnerSchoolMove(tx, { learner: { id; gradeLevelId; sectionId }, toSchoolId, gradeLevelId, sectionId, teacherId: string | null, actorId }): Promise<void>`. This is the existing body:
    1. end the ACTIVE enrollment as TRANSFERRED;
    2. update the learner pointers, with `aralTeacherId: null` and `archivedAt: null`;
    3. cancel PENDING section requests;
    4. create an ACTIVE enrollment when the target has an active year.
  - `applyStaffSchoolMove(tx, { userId, fromSchoolId, toSchoolId }): Promise<{ clearedSections: number; retutored: number; untutored: number }>`, in this order:
    1. Read the user's advisory section ids at `fromSchoolId`.
    2. Set ARAL learners `{ schoolId: fromSchoolId, aralTeacherId: userId }` to their own `section.adviserId` when it is not this user, else `null`. Use a per-section `updateMany`.
    3. Clear `Section.adviserId` on the advisory sections, and delete the user's `TeacherSection` rows at `fromSchoolId`.
    4. Set `Learner.teacherId = null` where it equals `userId` and `schoolId = fromSchoolId`.
    5. Set `User.schoolId = toSchoolId`.
    6. Leave `AralMosyDecision.tutorId` and attendance as they are.
  - `acceptSchoolTransfers(input): Promise<{ ok: true; data: { accepted: number; skipped: { id: string; reason: SkipReason }[] } }>`
    - Resolve the actor on `schoolId` as the receiver.
    - Load the rows with `toSchoolId: schoolId`. Classify each row:
      - not PENDING → `NOT_PENDING`;
      - past `expiresAt` → `EXPIRED`;
      - the person's current `schoolId` differs from `fromSchoolId` → `MOVED`;
      - the person is deleted or archived → `REMOVED`.
    - When any learner row is acceptable, `placement` is required. Use `fieldError("placement")` otherwise. Validate the grade (not FLOATING) and the section with `resolveTransferSection`. The teacher is `section.adviserId ?? null`. Learner rows of one accept share one placement.
    - Call `assertSchoolYearOpen` on `toSchoolId` and each `fromSchoolId`.
    - Run one `$transaction`. For each row, compare-and-set `updateMany({ id, status: PENDING })` to ACCEPTED, then apply the matching move.
    - Write the audit row for staff. Call `notifySchoolTransfer({ type: "DECIDED", ids })`. Revalidate both schools plus `revalidateLearnerScoped` and `revalidateTeacherCaches`.

- [ ] **Step 1:** Write the tests:
  - `applyStaffSchoolMove`:
    - an ARAL learner in a section whose adviser is X gets `aralTeacherId` X;
    - an ARAL learner in a section the moving teacher advised gets `null`;
    - the adviser is cleared and `User.schoolId` is updated.
  - Accept:
    - a batch of 3 where one learner has moved schools returns `accepted: 2` and `skipped: [{ reason: "MOVED" }]`;
    - a learner accept without placement throws a field error on `placement`;
    - placement in a section with no adviser writes `teacherId: null`;
    - accepting a teacher writes a `STAFF_SCHOOL_TRANSFER_ACCEPTED` audit.
  - Archiving a learner with a pending transfer sets that row to CANCELLED.
- [ ] **Step 2:** Run `npx vitest run tests/unit/transfers tests/unit/actions/school-transfer-accept.test.ts tests/unit/enrollment-transfer-aral.test.ts tests/unit/enrollment-transfer-scope.test.ts tests/unit/enrollment-transfer-revalidate.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Extract the helper first, then confirm the old enrollment tests still pass, then add accept.
- [ ] **Step 4:** Run the same command. Expected: all PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): accept moves learners and staff".

### Task 6: Notifications and the attention item

**Files:**
- Create: `src/lib/transfers/notify.ts` (this replaces the Task 4 stub)
- Modify: `src/lib/notifications.ts`. Compose sentences at read time for the two new types, the same way `PROFILE_PHOTO_REMOVED` does.
- Modify: `src/components/dashboard/school-head/dashboard-body.tsx` and `src/components/dashboard/school-head/hrefs.ts`. Add the attention item `{ id: "incoming-transfers", label: "Incoming transfers to review", badge: count, href: SCHOOL_HEAD_ROUTES.transfer, tone: "amber" }`, shown only when the count is above 0.
- Test: `tests/unit/transfers/notify.test.ts`, plus extend `tests/components/school-attention-modal.test.tsx` only if its item fixtures need the new id.

**Interfaces:**
- Produces:
  - `notifySchoolTransfer(e: { type: "REQUESTED"; batchId: string } | { type: "DECIDED"; ids: string[] }): Promise<void>`. It never throws; failures are logged only.
  - **REQUESTED:** one row per active School Head of `toSchoolId`, with `schoolId = toSchoolId`, `batchId` set and `actorId` = the requester.
  - **DECIDED:** one row per decided batch for each active School Head of `fromSchoolId`. Also, for each accepted staff member, one row to that user with `schoolId = toSchoolId`.
  - Sentences:
    - "{School} sent {n} {kind} to your school. Review them on Transfer."
    - "{School} accepted {a} and declined {d} of your transfer of {n} {kind}."
    - Moved staff: "You moved to {School}. Next time you sign in, choose {School}."
  - `countIncomingTransfers(schoolId: string): Promise<number>`, in `src/lib/transfers/queries.ts`, counting PENDING rows with `expiresAt > now`.

- [ ] **Step 1:** Write the tests:
  - REQUESTED writes one notification per School Head of the receiving school, with type `SCHOOL_TRANSFER_REQUESTED` and the batchId.
  - DECIDED for an accepted teacher writes a row to that teacher whose sentence contains "choose".
  - A Prisma failure resolves without throwing.
- [ ] **Step 2:** Run `npx vitest run tests/unit/transfers/notify.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/unit/transfers tests/components/school-attention-modal.test.tsx`. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): notifications and attention item".

### Task 7: Read queries

**Files:**
- Modify: `src/lib/transfers/queries.ts` (`server-only`)
- Test: `tests/unit/transfers/queries.test.ts`

**Interfaces:**
- Produces:
  - `listTransferTargets(schoolId): Promise<{ id: string; name: string }[]>`. Active schools in the same division, excluding this school, sorted by name.
  - `listTransferCandidates(schoolId, kind): Promise<TransferCandidate[]>`, where `TransferCandidate = { id; name; detail: string; pendingTo: string | null }`. For learners, `detail` is "Grade 4 · A". For staff, it is the designation label plus their advisory.
  - `listSchoolTransfers(schoolId, kind, direction: "outgoing" | "incoming" | "history"): Promise<TransferRow[]>`, where `TransferRow = { id; batchId; personName; detail; otherSchoolName; status: SchoolTransferStatus (effective); reason; decisionNote; createdAt; expiresAt; requestedByName }`.
    - History covers the last 90 days of non-PENDING rows, in both directions.
    - Before acceptance, incoming rows expose only the name, grade and section labels from the sending school.
  - `listPlacementOptions(schoolId): Promise<{ grades: { id; label; sections: { id; name; adviserName: string | null }[] }[] }>`. Grades exclude FLOATING.

- [ ] **Step 1:** Write the tests:
  - `listTransferTargets` passes `division: { equals: <division>, mode: "insensitive" }`, `isActive: true` and `id: { not }` in its where.
  - For a school with a null division, `listTransferTargets` returns `[]` and does not query.
  - An expired PENDING row comes back from `listSchoolTransfers(..., "outgoing")` with status `"EXPIRED"`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/transfers/queries.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): read queries".

### Task 8: Transfer page UI

**Files:**
- Create: `src/components/transfers/transfer-workspace.tsx`. This client component holds the tabs Learners / Teachers / ARAL volunteers, plus the sub-tabs Send, Outgoing, Incoming and History.
- Create: `src/components/transfers/send-transfer-dialog.tsx`. School picker, optional reason, confirm.
- Create: `src/components/transfers/accept-transfer-dialog.tsx`. For learners it has grade and section pickers, and shows the adviser or "No adviser yet". For staff it shows the sign-in note.
- Create: `src/components/transfers/transfer-table.tsx`. Uses `ResponsiveTable` and has row checkboxes.
- Modify: `src/app/school-head/(app)/transfer/page.tsx`. Replace the redirect with the real page. Use `requireUser(["SCHOOL_HEAD"])` and `resolveSchoolContext` (a Super Admin passes `?schoolId=`), and add a `loading.tsx`.
- Modify: `src/lib/routes/school-head.ts`. Add `transfer: "/school-head/transfer"` and remove the `"/school-head/transfer"` entry from `SCHOOL_HEAD_LEGACY_ROUTES`.
- Modify: `src/lib/nav/nav-config.ts`. Add the School Head Management item `{ id: "sh-transfer", label: "Transfer", href: SCHOOL_HEAD_ROUTES.transfer, icon: ArrowRightLeft }` after ARAL Teachers.
- Modify: `src/app/district/transfers/page.tsx`. Above the existing instant form, add a "Schools" picker (`?school=`, limited to scope) that renders `TransferWorkspace` for the chosen school.
- Test: `tests/components/transfer-workspace.test.tsx`. Update `tests/components/app-sidebar.test.tsx` for the new item.

**Interfaces:**
- Consumes: the Task 4 and Task 5 actions through `callAction`, and the Task 7 query types.
- Produces: `TransferWorkspace` props `{ schoolId: string; targets; candidates: Record<SchoolTransferKind, TransferCandidate[]>; rows: Record<SchoolTransferKind, Record<"outgoing" | "incoming" | "history", TransferRow[]>>; placement }`.

Behavior:
- **Send:**
  - Ticking people enables "Transfer to another school (n)".
  - A person whose `pendingTo` is set shows a "Pending → {school}" badge, and their checkbox is disabled.
- **Outgoing:** has a Cancel action for ticked rows.
- **Incoming:** has Accept and Decline actions for ticked rows. A decline asks for an optional note.
- **After an action:** a toast shows the counts and the skipped reasons from `SKIP_REASON_LABELS`, then the page calls `router.refresh()`.
- **Empty states:** "No incoming transfers", and so on.
- **Without a division:** a school with no division shows a callout instead of the Send tab: "Set this school's division before transferring".

- [ ] **Step 1:** Write the component tests:
  - Ticking 2 learners shows the button "Transfer to another school (2)".
  - A candidate with `pendingTo` renders a disabled checkbox and the text "Pending".
  - On Incoming learners, Accept opens a dialog that requires a section before "Accept" is enabled.
  - Empty targets render the division callout.
- [ ] **Step 2:** Run `npx vitest run tests/components/transfer-workspace.test.tsx tests/components/app-sidebar.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the components, the pages and the nav item.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with the message "feat(transfers): Transfer page for School Head and District admin".

### Task 9: Gates, release, browser check, migration

**Files:**
- Modify: `src/lib/releases.ts` (new top entry), `package.json`, `package-lock.json` (both version spots).

- [ ] **Step 1:** Add the release entry: the next minor version after whatever main holds, `announce: true`. Its notes per role are:
  - **School Head:** "New Transfer page under Management: send learners, teachers and ARAL volunteers to another school in your division; they move only when that school accepts."
  - **Teacher:** "If your School Head transfers you to another school, you will choose your new school at sign-in once it is accepted."
  - **Super Admin / District admin:** "You can send and answer transfers for schools in your scope."
- [ ] **Step 2:** Run `npm run typecheck`, `npm run lint` and `npm run test`. Expected: 0 type errors, 0 lint errors, and every test passing.
- [ ] **Step 3:** Apply the migration to the local or dev database. Then check in the browser through Test Lab, at desktop, tablet and phone widths:
  1. The School Head of school A sends 2 learners and 1 teacher to school B.
  2. School B sees the attention item and the Incoming list.
  3. School B accepts one learner into a section and declines the other learner.
  4. School B accepts the teacher.
  5. School A sees History. The teacher's old section shows no adviser, and their ARAL learners are re-tutored.
  6. Measure the 36/44px control heights.
- [ ] **Step 4:** Commit with the message "chore(release): cross-school transfers".
- [ ] **Step 5:** Stop. Before any deploy, ask the owner to approve running `prisma migrate deploy` on prod Neon. Run `prisma migrate status` against the Neon direct URL first and show the pending list.
