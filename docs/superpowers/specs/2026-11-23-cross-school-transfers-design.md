# Cross-school transfers (learners, teachers, ARAL volunteers): design

Date: 2026-11-23. Status: draft, waiting for owner approval.

## Intent

A School Head, or an admin acting for a school, can move one or many learners, teachers or Non-DepEd ARAL volunteers to another school in the same division.

Nothing moves immediately:

1. The sender tags the people.
2. The receiving school is notified.
3. The move happens only when the receiving School Head accepts.

## Goals

- **Sidebar:** Management → **Transfer** in the School Head sidebar.
- **Page:** one page with three tabs: **Learners**, **Teachers**, **ARAL volunteers**. Each tab has three lists:
  - **Outgoing:** transfers this school sent.
  - **Incoming:** transfers waiting for this school's answer.
  - **History:** a short history of past transfers.
- **Send:** send one person or many at once. Use multi-select, with one target school per send.
- **Answer:** the receiver accepts or declines one or many transfers at once. A decline can carry an optional reason, which the sender sees.
- **Cancel and expiry:** the sender can cancel while a transfer is pending. A pending transfer expires after 30 days.
- **While pending:** the person keeps working at the old school.

## Non-goals

- Same-school section moves. These already exist on the Learners page.
- Moving School Heads.
- Changing the existing instant Super Admin / District admin learner transfer (`transferLearnerCrossSchool`). It stays as it is.

## Anti-goals

- A person who belongs to two schools at once, or to no school.
- A school that sees more of another school's person than it needs to decide. Before acceptance, it sees only the name and grade.
- Transfers between divisions.

## Rules decided by the owner

### Who sends

- The School Head of the sending school.
- Super Admin and District admin, for any school in their scope, through the existing school view.

### Target schools

- A school can send only to active schools whose `School.division` equals its own.
- LITRACK has one division now. The rule must still hold when there are more.
- A school with no division set cannot send or receive.

### Learner placement and records

- The receiver picks the grade and section on accept.
- Records go with the learner, the same as today's admin transfer.
- The old school keeps the old enrollment read-only, marked "Transferred out".

### Teacher or volunteer on accept

The account's `schoolId` moves to the new school. At the old school:

- Their advisory sections are cleared. Each section stays with no adviser and shows in the existing "sections have no adviser" callout.
- Each ARAL learner they tutored gets the adviser of the learner's own section as ARAL tutor.
- If that section has no adviser, the learner has no tutor until the School Head assigns one.

### While pending

- The receiver can decline.
- The sender can cancel.
- The transfer expires after 30 days.
- The person stays fully active at the old school until the transfer is accepted.

## Approaches

1. **One shared transfer table for all three kinds (chosen).**
   - One row per person, and `kind` says which kind.
   - Rows sent together share a `batchId`.
   - One notification type, one attention item and one set of actions serve all three kinds.
2. **Separate tables for learners and staff (rejected).** The foreign keys are stricter, but the UI, the actions and the tests double.
3. **A pending step in front of the existing instant admin transfer (rejected).** It covers learners only.

## Data (additive migration only)

- `enum SchoolTransferKind { LEARNER TEACHER ARAL_VOLUNTEER }`
- `enum SchoolTransferStatus { PENDING ACCEPTED DECLINED CANCELLED EXPIRED }`
- `model SchoolTransferRequest` has these columns: `id`, `batchId`, `kind`, `learnerId?` (FK Learner), `userId?` (FK User), `fromSchoolId`, `toSchoolId`, `status`, `requestedById?`, `decidedById?`, `decidedAt?`, `reason?` (300 characters max), `decisionNote?` (300 characters max), `expiresAt`, `createdAt`, `updatedAt`.
- Indexes: `(toSchoolId, status)`, `(fromSchoolId, status)`, `(learnerId, status)`, `(userId, status)`.
- SQL-only constraints:
  - A CHECK that exactly one of `learnerId` / `userId` is set.
  - Partial unique indexes that allow one PENDING row per learner and one per user.
  - A CHECK that `fromSchoolId` differs from `toSchoolId`.
- `NotificationType` gains `SCHOOL_TRANSFER_REQUESTED` and `SCHOOL_TRANSFER_DECIDED`. Each notification points at the batch.
- **Expiry is computed when rows are read:**
  - Any read treats a row whose `expiresAt` has passed as EXPIRED.
  - The next action that touches such a row writes its status as EXPIRED.
  - No cron job is needed.

## Actions

The actions live in `src/lib/actions/school-transfer.ts` and use the house `action()` pattern.

- `requestSchoolTransfers({ kind, ids[], toSchoolId, reason? })`
- `acceptSchoolTransfers({ ids[], placement })`. Learners need a grade and section. Staff need no placement.
- `declineSchoolTransfers({ ids[], note? })`
- `cancelSchoolTransfers({ ids[] })`

Each action checks:

- the role;
- the tenant: the sender owns `fromSchoolId`, the receiver owns `toSchoolId`, and admins pass by scope;
- that the two schools are in the same division;
- that the status is PENDING and the transfer has not expired;
- that the person is still at `fromSchoolId`.

Accept runs in one transaction per batch. Learner accept reuses the enrollment logic behind `transferLearnerCrossSchool`.

Staff moves change who can sign in to a school, so their actions go in `SECURITY_AUDIT_ACTIONS` and are audited.

## Notifications and attention

- **Receiving School Head:**
  - gets a bell notification when a transfer is requested;
  - sees an "Incoming transfers to review" item in the Needs your attention pop-up and panel.
- **Sending School Head:** gets a bell notification on accept, decline or expiry.
- **Moved teacher or volunteer:** on accept, gets a bell notification saying they now sign in under the new school.

## Sign-in

Teachers pick their school at sign-in, so after a move they pick the new school. The accept dialog and the teacher's notification both say so.

## UI

- **Sidebar:** Management → Transfer goes to `/school-head/transfer`, which replaces the current redirect.
- **Each tab:**
  - The list of this school's people has checkboxes and a "Transfer to another school" button.
  - The button opens a school picker limited to the division, with an optional reason field.
  - A person with a pending transfer shows a "Transfer pending" badge.
- **Outgoing and Incoming lists:** these follow the data-table system and the 36/44px control height standard.
- **Accepting a learner:** the accept dialog asks for a grade and section at this school.

## Left to the builder

- Exact table columns and the phone layout.
- Whether the old entry points on the Learners page link to the new page.
- How to split the tests: unit tests for the actions and rules, and component tests for the page.

## Builder calls (settled by the lead, owner may correct)

- Admin accept: Super Admin and District admin whose scope covers the receiving school may accept or decline, as well as the receiving School Head (owner decision).
- Learner adviser on accept: the chosen section's adviser becomes `Learner.teacherId`. When the section has no adviser, the learner is placed with no adviser and the section shows in the no-adviser callout. The accept path forks `transferLearnerCrossSchool` only where it requires a target teacher.
- School-year gates: same as the existing admin transfer. Both schools' years must be open at send and at accept. With no active year at the receiver, the enrollment row is not created (same as today).
- Eligible staff: active, approved, not deleted. On accept, the old school's `Learner.teacherId` rows pointing at the teacher are cleared. Past records (`AralMosy.tutorId`, attendance `recordedById`) stay as history.
- Tabs: ARAL volunteers = `isAralVolunteerDesignation(designation)`; Teachers = every other teacher. `kind` is fixed at send time.
- District admin: may send from schools in their districts to any school in the same division.
- Other pending records: accept cancels the learner's pending section transfers. A learner with a pending cross-school transfer cannot get a new section transfer request. Archiving the person cancels their pending transfer.
- Partial batch: accept and decline act on the selected rows. Stale rows (expired, moved, no longer at the sending school) are skipped and reported; the rest succeed.
- "Transferred out" reuses the existing `TRANSFERRED` enrollment status.
