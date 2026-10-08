# Spec: transferring learners between sections from the Learners page

**Bottom line:** one new table holds teacher requests. One pure function decides whether every transfer is allowed, and one transaction helper moves the learners, used by both the School Head's direct transfer and an approval. Two things need the operator's attention first:
- Retiring `/school-head/transfer` removes the app's only way to change a learner's grade or place a Floating learner.
- The School Head's Learners page has no row selection or bulk menu today, so that has to be built.

## 1. The problem

- **School Head:** moves one learner or many to another live section in the same grade, at once, from the Learners page. The learner's adviser becomes that section's adviser.
- **Teacher:** may only ask to move learners in sections they advise (`Section.adviserId`). Each request stays pending until the School Head approves or declines it.
- **Out of scope:** grade changes, moves to Floating, and moves to another school. The admin and district cross-school transfer is untouched.

## 2. The shape

### 2a. Data model (database-engineer)

Migration `prisma/migrations/20261008000001_section_transfer_request/migration.sql`. It is **additive**: a new enum, a new table, indexes, SQL-only constraints and RLS. Nothing is backfilled.

```
enum SectionTransferRequestStatus { PENDING APPROVED REJECTED CANCELLED }

model SectionTransferRequest {
  id            String   @id @default(uuid())
  schoolId      String                       // tenant root
  learnerId     String
  requestedById String?                      // SetNull, same rule as Attendance.recordedById
  fromSectionId String                       // learner's section when requested
  toSectionId   String
  status        SectionTransferRequestStatus @default(PENDING)
  reason        String?                      // teacher note, <=300 (Zod); never in audit metadata
  decidedById   String?                      // SetNull; approver/decliner, or requester on cancel
  decidedAt     DateTime?
  decisionNote  String?                      // decline note, <=300 (Zod); never in audit metadata
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  school   School  @relation(onDelete: Cascade)
  learner  Learner @relation(onDelete: Cascade)   // purge.ts:94 hard-deletes learners
  requestedBy / decidedBy  User?  @relation(onDelete: SetNull)  // purge.ts:198 hard-deletes users
  fromSection / toSection  Section @relation(onDelete: Cascade)  // demo/teardown.ts:91 deletes sections
  @@index([schoolId, status, createdAt])  // School Head panel + dashboard count
  @@index([learnerId, status])            // per-row pending lookup on both rosters
  @@index([requestedById, status])        // teacher's own requests + SetNull lookup
  @@index([decidedById])
  @@index([fromSectionId])
  @@index([toSectionId])
}
```

SQL-only additions, listed in `docs/migrations.md` ("Partial unique index" section) like `Enrollment_learner_active_unique`:
- `CREATE UNIQUE INDEX "SectionTransferRequest_learner_pending_unique" ON "SectionTransferRequest"("learnerId") WHERE "status" = 'PENDING';`
- `CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL))`
- `CHECK ("fromSectionId" <> "toSectionId")`
- `ALTER TABLE "SectionTransferRequest" ENABLE ROW LEVEL SECURITY;`, as in `20261003000002`. Also add the table to `prisma/rls-policies.sql`.

The partial index keys on `learnerId`, which is NOT NULL, so NULL can't defeat it. The nullable `requestedById` and `decidedById` are in no unique index.

Other required edits:
- **`src/lib/db/schema-order.ts`:** add `{ model: "SectionTransferRequest", delegate: "sectionTransferRequest", operational: true, schoolScope: bySchoolId }` right after `AralMosyDecision` (line ~163). `tests/unit/db/schema-order.test.ts` fails if any model is missing. This file belongs to the database-engineer lane because it must land with the schema.
- **`src/lib/constants/enum-labels.ts`:** add `SECTION_TRANSFER_REQUEST_STATUS_LABELS = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Declined", CANCELLED: "Withdrawn" }`. "Declined" matches the existing teachers-declined wording.

**What happens to Enrollment rows.** This reuses the logic in `transferLearner` (`src/lib/actions/enrollment.ts:204-247`):
- The ACTIVE row is set to `TRANSFERRED` with `endedAt = now`.
- The learner's pointers are updated.
- A new ACTIVE row is created with the same `schoolYearId` (taken from the old ACTIVE row, or else the school's active year). If there is no year, only the pointers change.
- The partial index `Enrollment_learner_active_unique` (`20260806000001_foundation_models/migration.sql:131`) requires the close to happen before the create.

`transferLearner`'s current guards:
- learner `deletedAt: null`, plus `assertSameSchool` (line 122)
- target grade in the same school and live (lines 135-143)
- target teacher in the same school, `role: TEACHER`, not deleted, advising a live section in that grade (lines 168-187)
- section in the school and grade, and live (`resolveTransferSection`, lines 60-71)

`gradeLevelId` and `aralTeacherId` stay unchanged.

Two changes from the old behaviour:
- `archivedAt: null` (line 230) silently un-archived learners. The new design **refuses archived learners** instead.
- The teacher is no longer picked. It comes from `toSection.adviserId`.

### 2b. The decision function (pure, no `server-only`)

New file `src/lib/learners/section-transfer.ts`, importable by actions and client components:

```ts
type TransferLearnerFacts = { id; schoolId; gradeLevelId; gradeType; sectionId: string|null; deletedAt; archivedAt };
type TransferDestinationFacts = { id; schoolId; gradeLevelId; deletedAt; gradeDeletedAt;
  adviser: { id; deletedAt; isActive; role } | null } | null;
type TransferBlockReason = "learner-unavailable" | "floating" | "different-grade" | "section-unavailable"
  | "no-adviser" | "moved-since-request" | "not-in-advisory" | "pending-request";
type TransferVerdict = { ok: true; kind: "move"; teacherId: string } | { ok: true; kind: "unchanged" }
  | { ok: false; reason: TransferBlockReason };

evaluateSectionTransfer(input: { actorSchoolId; learner; destination; expectedFromSectionId?: string|null;
  hasPendingRequest: boolean; advisedSectionIds?: string[] /* teacher create only */ }): TransferVerdict
TRANSFER_BLOCK_REASON_LABELS: Record<TransferBlockReason, string>  // one sentence per reason
MAX_TRANSFER_BATCH = 100   // = max of LEARNER_PAGE_SIZE_OPTIONS (src/lib/learners/pagination.ts:11)
```

Checks run in a fixed order:
1. learner gone or archived
2. learner's grade is FLOATING
3. destination missing, archived, in another school, or its grade archived
4. different grade
5. destination has no adviser, or the adviser is deleted, inactive, or not a teacher
6. `expectedFromSectionId` given and the learner's section differs → moved since the request
7. `advisedSectionIds` given and the learner's section is not one of them → not in the teacher's advisory
8. a pending request already exists
9. learner already in the destination → `unchanged`, which is not an error

Both server actions and the client-side eligibility checks call this function.

### 2c. Apply helper (server-only)

New file `src/lib/learners/section-transfer-apply.ts`:

`applySectionTransferBatch(tx, { schoolId, gradeLevelId, toSectionId, teacherId, moves: {learnerId, fromSectionId|null}[], now })`

It makes a fixed number of database calls, never one per learner. Production runs on Workers, and an interactive transaction doing about 400 round trips risks timing out.

1. **Compare-and-set on the learner:** `learner.updateMany({ where: { schoolId, gradeLevelId, deletedAt:null, archivedAt:null, OR: moves.map(m => ({ id: m.learnerId, sectionId: m.fromSectionId })) }, data: { sectionId: toSectionId, teacherId } })`. If `count !== moves.length`, throw `TRANSFER_REQUESTS_CHANGED` and the transaction rolls back.
2. `enrollment.findMany({ learnerId in ids, status: ACTIVE })` reads the `schoolYearId`s, plus the school's active year once.
3. `enrollment.updateMany(... → TRANSFERRED, endedAt: now)`.
4. `enrollment.createMany(...)` for learners that have a year.

### 2d. Read helpers (server-only)

New file `src/lib/learners/section-transfer-queries.ts`, all uncached and all filtered by `schoolId`:
- `listTransferDestinations(schoolId, gradeLevelIds)` → `{id, name, gradeLevelId, adviser: {id, fullName} | null}[]`. Live sections only, excluding the FLOATING grade.
- `pendingTransfersByLearner(schoolId, learnerIds)` → `Map<learnerId, {requestId, toSectionName}>`
- `listPendingTransferRequests(schoolId, take = 100)` → rows with learner, from, to and adviser, requester, reason and createdAt, plus `staleReason` computed with `evaluateSectionTransfer`. Oldest first.
- `listTeacherTransferRequests(schoolId, teacherId, sinceDays = 14)` → the teacher's pending requests plus ones decided in the last 14 days.

### 2e. Server actions

New file `src/lib/actions/section-transfer.ts`, every action wrapped by `action()`. They take an object input, like `enrollRosterLearnersToAral`.

**Validators** (`src/lib/validators/section-transfer.schema.ts`):
- `transferLearnersSchema`: `learnerIds: z.array(nonEmpty()).min(1).max(100)`, `toSectionId: nonEmpty("Choose a section")`
- `requestSectionTransfersSchema`: the same, plus `reason` (optional, trimmed, max 300)
- `decideTransferRequestsSchema`: `requestIds` (1 to 100)
- `declineTransferRequestsSchema`: the same, plus `note` (optional, max 300)
- `cancelTransferRequestSchema`: `requestId`

| Action | Guard | Logic | Returns |
|---|---|---|---|
| `transferLearnersToSection(input)` | `requireSchoolUser("SCHOOL_HEAD")` | Dedupe the ids. Load learners by id; `assertSameSchool` on each, as in `archiveLearners` (`learner.ts:527-531`); if the count is wrong → `resourceNotFound`. Load the destination with `schoolId: user.schoolId`; if missing → `fieldError("toSectionId", ...)`. Look up pending requests, then evaluate every learner. **All-or-nothing:** any block throws `TRANSFER_BLOCKED` listing the count and reason, and a learner with a pending request blocks. In one `$transaction`, apply only the `move` learners. Then audit and revalidate. | `{moved, unchanged, sectionName}` |
| `requestSectionTransfers(input)` | `requireSchoolUser("TEACHER")` + `profileCompleted` | Placements come from `getAdvisoryPlacements(user)` (`advisory.ts:104`). Load learners with `schoolId, deletedAt:null, archivedAt:null, sectionId: { in: advisedIds }`; a count mismatch gets the generic "no longer in your advisory sections" message. Evaluate with `advisedSectionIds`; all-or-nothing. `createMany` for the `move` learners; a P2002 race becomes `DB_CONFLICT`. | `{requested, unchanged}` |
| `approveSectionTransferRequests(input)` | `requireSchoolUser("SCHOOL_HEAD")` | Load by id; `assertSameSchool` on each. Every request must be PENDING, else `TRANSFER_REQUESTS_CHANGED`. Re-evaluate each against current data with `expectedFromSectionId = fromSectionId`; any stale one throws `TRANSFER_STALE` (all-or-nothing). In the transaction: compare-and-set the requests (`updateMany({id in, status: PENDING} → APPROVED, decidedById, decidedAt})`, count must match), then group by `toSectionId` and call `applySectionTransferBatch` per group. | `{approved}` |
| `declineSectionTransferRequests(input)` | `requireSchoolUser("SCHOOL_HEAD")` | Load and `assertSameSchool`. Compare-and-set PENDING → REJECTED with `decisionNote`. Allowed even when the request is stale. | `{declined}` |
| `cancelSectionTransferRequest(input)` | `requireSchoolUser("TEACHER")` | `updateMany({ id, schoolId, requestedById: user.id, status: PENDING } → CANCELLED, decidedById: user.id, decidedAt })`. If count is 0 → `resourceNotFound("Transfer request")`. | `{}` |

**Why all-or-nothing.** This follows the repo's own rule ("a selection that partly took effect is worse than either outcome", `learner.ts:796` and `:944`). The UI removes ineligible rows and stale requests with the same pure function before submitting. A whole-batch refusal therefore only happens on a real race.

**Re-checks at approval time.** The learner may have moved (compare-and-set plus `moved-since-request`). The section may have been archived (`section-unavailable`). The destination adviser may have changed or been removed: `teacherId` is read from the current `adviserId` at approval, never stored, and a missing adviser gives `no-adviser`.

**Concurrency.**
- Two approvals of the same request: the request compare-and-set returns count 0 for the second, which rolls back.
- Approve racing a cancel: the same mechanism.
- Approve racing a direct transfer: the learner compare-and-set fails for whichever runs second.
- Last-resort guards: the Enrollment partial unique index and the pending-request partial unique index.

**Audit.** Call `writeAuditMany` with the existing `LEARNER_TRANSFER` action for each learner moved. Metadata holds ids only: `{source: "direct" | "request", requestId?, fromSectionId, toSectionId}`. Add no new constants, and **do not add anything to `SECURITY_AUDIT_ACTIONS`**: a same-school placement change is not a security event, and `LEARNER_TRANSFER` is already left out (`audit-actions.ts:432-500`). The durable record is the request row (requester, decider, timestamps) plus the TRANSFERRED/ACTIVE Enrollment pair. Cross-tenant probes are still recorded as security through `assertSameSchool`.

**Cache revalidation.** Two new named helpers in `src/lib/cache/revalidate.ts`:
- `revalidateSectionTransfer({ schoolId, gradeLevelId, teacherIds })`: `revalidatePath` on `/teacher/learners`, `/teacher/grade/${gradeLevelId}`, `/teacher/aral` and `SCHOOL_HEAD_ROUTES.learners`; then `revalidateSchoolHeadTeachers(schoolId)`, which already busts the school dashboard and grade sections; then `revalidateLearnerScoped({schoolId, teacherId})` for each previous adviser, the new adviser and each `aralTeacherId`.
- `revalidateTransferRequests(schoolId)`: `revalidatePath` on `SCHOOL_HEAD_ROUTES.learners` and `/teacher/learners`, plus `revalidateSchoolDashboard(schoolId)` for the pending count.

**Rate limits:** none. These actions are authenticated, scoped to one school, capped at 100 and cost nothing outside the database.

**Error codes** (`src/lib/errors/codes.ts`, new "Transfers" block, status 409, severity `user`; also update `docs/errors.md`):
- `TRANSFER_BLOCKED`: "{learners} can't move to {section}: {reason}."
- `TRANSFER_REQUEST_PENDING`: "{learners} already {have} a transfer request waiting for a decision."
- `TRANSFER_STALE`: "{learners} can no longer move as requested: {reason}. Decline the request instead."
- `TRANSFER_REQUESTS_CHANGED`: "Some of these were already changed or decided. Refresh to see the current list."

### 2f. Dashboard

- `getSchoolHeadMetricCounts` (`src/lib/dashboard/aggregates.ts:350`): add `pendingTransferRequestCount`, counted by `{schoolId, status: PENDING}` through the `[schoolId,status,createdAt]` index. It is cached under `schoolDashboard`, which `revalidateTransferRequests` busts.
- `SchoolHeadOverview` and `buildSchoolHeadAttention` (`school-head-overview.ts:33,129`): add the item `{id:"transfers", label:"Review transfer requests", detail:"Advisers asked to move learners to another section", badge:"N waiting", tone:"amber", href: hrefs.transferRequests}`, placed after approvals. Add `transferRequests` to `SchoolHeadAttentionHrefs`; it resolves to `schoolHeadHref(view, learners) + "#transfer-requests"`.

## 3. UI

**Key finding:** the School Head's Learners page (`src/app/school-head/(app)/learners/page.tsx:113`) renders `LearnersDirectory` (`src/components/admin/management/learners-directory.tsx`). That component is read-only, has no selection, and is shared with `/admin/management/learners`. The "inert Transfer student item" sits in `LearnerBulkActions` (`learner-bulk-actions.tsx:29-31`), which is mounted **only** on the teacher roster (`learner-list-client.tsx:564`). The School Head side therefore needs selection built.

**Shared dialog:** `src/components/learners/transfer-learners-dialog.tsx`, with props `{ mode: "transfer" | "request"; candidates: TransferCandidate[]; destinations; open; onClose; onDone }`.

| State | Content |
|---|---|
| Blocked selection | Learners from more than one grade: "These learners are in Grade 3 and Grade 4. A transfer stays inside one grade. Filter by grade and select again." Only a Close button. |
| Left-out rows | A listed "Left out (n)" with the reason for each (archived, no section, Floating, pending request, not in your advisory). The remaining learners go ahead. |
| Choose | Radio list of the grade's sections, each with "Adviser: Ana Cruz". **Nothing pre-selected**, because this is a placement decision. A section with no adviser is disabled and says "No adviser yet" (School Head: "assign one in School Setup"). For a single learner, or when every selected learner shares a section, that section is disabled and labelled "Current section". |
| Teacher only | "Note for your School Head (optional)", up to 300 characters, with a counter. |
| Preview | Transfer: "Moves 5 learners to Rosal. Their adviser becomes Ana Cruz. Attendance, reading levels and grades go with them. 2 already in Rosal stay where they are." Request: "Sends 5 requests to your School Head. The learners stay in your section until it is approved." |
| Submit | "Transfer learner" / "Transfer N learners", or "Request transfer" / "Request transfer for N learners". Disabled until a section is picked. While pending: "Transferring…" / "Sending…", with no double-submit. |
| Failure | Show `toastFailure`, keep the dialog open with its input, put field errors under the section list, and for `TRANSFER_*` codes show an inline callout with a "Refresh list" action. |
| Success | Toast ("5 learners moved to Rosal" / "Transfer requested for 5 learners. Waiting for your School Head."), clear the selection, then `invalidateNavWarm()` and `router.refresh()`. |

**School Head page:**
- **Directory:** a new client wrapper `src/components/school-head/learners/school-head-learners-directory.tsx` feeds `LearnersDirectory` with new optional client-side props: `selection`, `bulkActions`, `rowActions`, `rowBadge`. The admin page passes none of them, so it doesn't change. Selection stays per page.
- **Rows:** a "Transfer" row action; for an archived learner it is disabled with the reason. A learner with a pending request gets a "Transfer requested → Rosal" badge (icon plus text) and a "Review request" action that links to `#transfer-request-{id}`.
- **Bulk menu:** "Transfer selected".
- **Requests panel** (`school-head/learners/transfer-requests-panel.tsx`, `id="transfer-requests"`), above the directory, oldest first:
  - **Columns:** checkbox, Learner (with grade), From → To (with adviser), Requested by, When, Note, Issue chip (stale reason), and Approve / Decline buttons.
  - **Bulk bar:** "Approve selected (N)" and "Decline selected (N)". Stale rows are left out of a bulk approve, with a note saying so.
  - **Confirms:** Approve: "Approve and transfer". Decline: optional note to the adviser; buttons "Decline requests" and "Cancel".
  - **Empty:** a single line, "No transfer requests waiting." Loading: a table skeleton. Error: the existing "Could not load" line.
- **Super Admin view (`?schoolId=`):** the directory and panel are read-only, with no checkboxes or buttons and the caption "Only the School Head can transfer learners or decide requests." The reason is that `requireSchoolUser` sends a Super Admin with no `schoolId` away (`session.ts:358-366`).

**Teacher page:**
- `LearnerListRow` gains `pendingTransfer: {requestId, toSectionName} | null`; the page passes `transferDestinations`.
- A row is eligible when its section is one of the teacher's advisory sections, it isn't archived, and it has no pending request.
- **Row menu:** "Request transfer", or for a pending row "Cancel transfer request". Confirm: "Cancel the request to move X to Rosal?" with buttons "Cancel request" and "Keep request". A pending row shows the badge "Transfer requested → Rosal".
- **Bulk menu:** "Request transfer" replaces the inert item.
- **Profile modal (`index.tsx:441-464`):** add an optional `transferAction` prop. The roster supplies it. When it's absent the button is hidden, which ends the "Soon" placeholder.
- **"Your transfer requests" strip** (`learners/teacher-transfer-requests.tsx`): shown only when there are pending requests or ones decided in the last 14 days. It lists status chips (Waiting / Approved / Declined with the note / Withdrawn) and offers Cancel on pending ones. Without it, a decline would be invisible to the teacher.
- Super Admin on teacher pages: no selection (already the case at `learner-list-client.tsx:366`).

## 4. Files, by lane (shared types and validators land first)

**L0 – database-engineer** (one serialized step):
- `prisma/schema.prisma`: enum, model, back-relations on School, Learner, User and Section
- `prisma/migrations/20261008000001_section_transfer_request/migration.sql`
- `prisma/rls-policies.sql`
- `src/lib/db/schema-order.ts`
- `docs/migrations.md`

**L1 – backend, contracts:**
- `src/lib/validators/section-transfer.schema.ts` (new)
- `src/lib/learners/section-transfer.ts` (new, pure)
- `src/lib/constants/enum-labels.ts`
- `src/lib/errors/codes.ts` and `docs/errors.md`
- `src/lib/routes/school-head.ts`: remove `transfer`; add `"/school-head/transfer": SCHOOL_HEAD_ROUTES.learners` to `SCHOOL_HEAD_LEGACY_ROUTES`

**L2 – backend:**
- `src/lib/learners/section-transfer-apply.ts` and `section-transfer-queries.ts` (new)
- `src/lib/actions/section-transfer.ts` (new)
- `src/lib/cache/revalidate.ts`: the two helpers
- `src/lib/actions/enrollment.ts`: delete `transferLearner` (lines 95-286); in the cross-school action, line 481 `SCHOOL_HEAD_ROUTES.transfer` becomes `.learners`
- `src/lib/validators/enrollment.schema.ts`: delete `transferLearnerSchema` and `GRADE_FLOATING`; keep `SECTION_CLEAR` for the cross-school action
- `src/lib/actions/learner.ts:1150`: remove the transfer `revalidatePath`
- `src/lib/admin/management.ts:744,820-834`: add `gradeLevelId`, `sectionId` and `archived` to `LearnerHubRow`
- `src/lib/dashboard/aggregates.ts` and `school-head-overview.ts`
- Server data loading in `src/app/school-head/(app)/learners/page.tsx` and `src/app/teacher/(app)/learners/page.tsx`
- `src/app/school-head/(app)/transfer/page.tsx`: becomes a redirect stub keeping `?schoolId=`, like `sections/page.tsx`

**L3 – frontend** (after L1; can run alongside L2 against the contracts):
- New: `src/components/learners/transfer-learners-dialog.tsx`, `src/components/learners/teacher-transfer-requests.tsx`, `src/components/school-head/learners/school-head-learners-directory.tsx`, `src/components/school-head/learners/transfer-requests-panel.tsx`
- Change: `learners-directory.tsx` (optional props), `learner-bulk-actions.tsx`, `learner-list-client.tsx`, `learner-profile-modal/index.tsx`, `dashboard/school-head/attention-panel.tsx` + `hrefs.ts` + `dashboard-body.tsx` (quick action goes to the Learners page, label "Transfer learners"), `src/lib/nav/nav-config.ts:262` (remove the item), `src/lib/test-lab/checklist.ts:72`, `src/lib/help/topics.ts` (a "Move a learner to another section" topic for both roles)
- Delete: `src/components/school-head/transfer-learner-form.tsx` and `src/app/school-head/(app)/transfer/loading.tsx`

**L4 – qa-test-engineer:**
- **Unit:** `evaluateSectionTransfer` (every reason, the check order, `unchanged`); `applySectionTransferBatch` (compare-and-set count mismatch rolls back, Enrollment close before create, no year means pointers only); each action (tenancy via `assertSameSchool`, all-or-nothing, pending blocks a direct transfer, stale approval refused, double-approve race, cancel restricted to the requester); the validator caps (100 learners, 300 characters); `buildSchoolHeadAttention` with the transfers item.
- **Update:**
  - `role-matrix.test.ts:113,286`: drop `transferLearner`; add the 5 new actions
  - `nav-config.test.ts:658`
  - `route-loading-shape.test.tsx:33,452`
  - `learner.schema.test.ts:361-415`
  - `enrollment-transfer-revalidate.test.ts` and `enrollment-transfer-scope.test.ts`: keep only the cross-school cases
  - `e2e/learner-transfer.spec.ts`: rewrite for the Learners page
- Gates: typecheck, lint, test, build.

## 5. Invariants and where each is enforced

| Invariant | Enforced by |
|---|---|
| At most one PENDING request per learner | SQL partial unique index, plus the action's pre-check |
| Status and decision fields agree; from ≠ to | SQL CHECKs |
| Destination is in the same school and same grade | `evaluateSectionTransfer` plus tests. This crosses tables, so a CHECK can't express it; that is a deliberate choice. |
| No cross-school access | `assertSameSchool` / `schoolId` in every `where`; role-matrix test |
| Learner pointers match the ACTIVE Enrollment | `applySectionTransferBatch` in one transaction; `Enrollment_learner_active_unique`; unit test |
| No double apply | Request and learner compare-and-set inside the transaction |
| Teachers request only for their advisory sections | `getAdvisoryPlacements` filter in the action, plus a test |
| Soft-deleted and archived learners are never moved | `deletedAt: null, archivedAt: null` in the compare-and-set `where`, plus the evaluator |
| Destination has an active adviser | Evaluator (`no-adviser`) |

## 6. Migration and rollout

- Apply the migration before pushing the code, because the actions write the new table. Run `prisma migrate status` first and confirm which database `DIRECT_URL` points at.
- No data changes; no existing rows exist.
- Old clients that still have the transfer page open call a removed action. `callAction` maps that to `APP_UPDATED`, and the page redirects on reload.
- Release: this is a feature, so the middle version number moves (2.36.0 → 2.37.0, unless main has moved on).

## 7. Alternatives rejected

- **Reusing `Enrollment`, or adding a nullable `pendingSectionId` on `Learner`:** that mixes requested state with the official record, and gives no record of who requested or decided.
- **Applying whatever is valid and reporting the rest:** this contradicts the repo's all-or-nothing rule for bulk actions. Filtering ineligible rows in the UI gets the same convenience.
- **Auto-closing pending requests in every archive, delete and advisory write path:** too many write paths to change. Staleness is computed when the panel loads and at approval time instead.
- **Moving the School Head page onto `LearnerListClient`:** that is the teacher roster component, with ARAL and reading-level columns and teacher scope. Adding optional props to `LearnersDirectory` is smaller.

## 8. Open questions

1. **(HIGH)** After the transfer page is retired, nothing in the app can change a learner's grade or place a Floating learner into a section. The page's action at `enrollment.ts:129-146` is the only caller of `ensureFloatingGradeLevel`, and there is no promotion flow. Does the operator accept that?
2. Should approval also require that the requester still advises the "from" section? The design says no: only the learner's position is checked.
3. Should a deactivated adviser (`isActive: false`) make a section an invalid destination? The design says yes, matching the cross-school action.
4. Archived learners used to be un-archived by a transfer; now they are refused. Confirm.
5. Super Admin drill-down is read-only for transfers and approvals. Confirm.
6. Should teachers also get a bell notification for decisions (a new `NotificationType` value) on top of the page strip?
7. The School Head directory shows 25 rows per page, so a bulk transfer is limited to 25 at a time. Is that acceptable?

## Findings

1. **HIGH:** grade changes and Floating placements lose their only path (`src/lib/actions/enrollment.ts:129-146`; the only caller of `src/lib/grades/floating.ts:20`). This is operator-locked but needs explicit confirmation (open question 1).
2. **MEDIUM:** the School Head's Learners page has no selection or bulk menu (`src/app/school-head/(app)/learners/page.tsx:113` uses the read-only `LearnersDirectory`). `LearnerBulkActions` exists only on the teacher roster (`learner-list-client.tsx:564`).
3. **MEDIUM:** the new model must go into `src/lib/db/schema-order.ts`, which a test enforces, or backups and restores silently drop it.
4. **MEDIUM:** a bulk apply must use a fixed number of queries, not a per-learner loop. Interactive transactions on Workers/Hyperdrive would time out at 100 learners.
5. **LOW:** `transferLearner` reuses an older ACTIVE enrollment's `schoolYearId` even when a newer year is active (`enrollment.ts:209`). The behaviour is kept, but it's worth knowing.
6. **LOW:** `LEARNER_TRANSFER` is left out of `SECURITY_AUDIT_ACTIONS`, so audit rows for these moves are dropped. The request row is the durable record.


## 9. Operator decisions on the open questions (2026-10-08) — these OVERRIDE anything above

1. **Keep a School Head-only "Change grade" action.** Retiring `/school-head/transfer` must NOT remove the ability to change a learner's grade or place a Floating learner. Keep `transferLearner` (`src/lib/actions/enrollment.ts`), `transferLearnerSchema` and `GRADE_FLOATING` (do NOT delete them). Add one guard to `transferLearner`: when the target grade equals the learner's current grade (and neither is Floating), throw a user error telling the School Head to use Transfer instead. The UI becomes a "Change grade" row action on the School Head Learners page that opens a dialog reusing the existing form's fields (grade incl. Floating, section, adviser), adapted from `src/components/school-head/transfer-learner-form.tsx` minus the learner picker (the row supplies the learner). The old form file may then be deleted. Teachers never get this action. Update §4 accordingly: L2 keeps transferLearner (only the guard + revalidate path change from `.transfer` to `.learners`), and tests `enrollment-transfer-*.test.ts` stay (update only the revalidated path).
2. Approval does NOT require the requester to still advise the from-section (only the learner's position is checked).
3. An inactive or deleted adviser makes a section an invalid destination (`no-adviser`).
4. Archived learners are refused by the new section transfer.
5. Super Admin drill-down (`?schoolId=`) is read-only for transfers, change grade and approvals.
6. No bell notification. The teacher's "Your transfer requests" strip (14 days) is the only notification.
7. A bulk transfer is limited to the rows on the current directory page. That is acceptable.
