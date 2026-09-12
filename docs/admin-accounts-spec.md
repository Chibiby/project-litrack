# Spec — Super Admin accounts console (`/admin/accounts`)

Status: proposed · 2026-09-12 · supersedes the account half of `/admin/school-accounts`

## 1. The problem

When a school calls for help, the Super Admin can reach only one kind of account:
the School Head, and only by going through the school. Everything a teacher can be
stuck on — a forgotten password, an account that never got approved, a profiling
wizard that will not submit, an ARAL grid that looks empty — is invisible from the
admin side. There is no list of people, only a list of schools with one head
attached.

What is needed is a single place where the admin can find any account in the
system by name, see enough state to say what is wrong with it, and take the three
actions that fix it: read the password back (School Heads only, and only when
LITRACK sealed it), reset the password, or sign in as the person and look.

Non-goals, named so nobody builds them by accident:

- No account *state* controls here (activate, approve, reject, remove). Those
  belong to the School Head who owns the roster, and duplicating them would put
  the same decision in two consoles. `/admin/archive` already owns restore/purge.
- No teacher password storage. See section 6.
- No cross-school editing of profiles. The modal is read-only.

## 2. Fixed constraints (owner decisions, not re-opened here)

1. `passwordVaultCipher` stays `SCHOOL_HEAD`-only. A teacher's password cell reads
   an em dash, always.
2. Teacher impersonation is full-write, with the persistent banner and an audit
   row at both ends.
3. One console. `/admin/school-accounts` redirects into `/admin/accounts`. The
   reveal / reset / impersonate logic exists in exactly one module afterwards.
4. The profile modal shows four sections: identity and account state; advisory
   sections and the learners under them; ARAL involvement; recent activity.

## 3. The read model

File: `src/lib/admin/accounts.ts` (new). `src/lib/admin/school-accounts.ts` is
deleted in the same slice; its `parse*Params` / `*TotalPages` helpers move across
unchanged in shape.

### 3.1 What it lists

Every `User` row with `deletedAt: null`, across every tenant, including
`SUPER_ADMIN` rows. Soft-deleted accounts are NOT listed: `/admin/archive` already
owns them, and a console whose buttons reset passwords must not offer them for an
account that no longer signs in.

One table, one row shape, role-dependent cells:

| Column | SUPER_ADMIN | SCHOOL_HEAD | TEACHER |
|---|---|---|---|
| Account | name + role badge | name + role badge | name + role badge |
| School | none (`schoolId` is null) | school name + School ID | school name + School ID |
| Sign-in | username | email, "no mailbox" chip when synthetic | email, ditto |
| Status | Active / Inactive | + "Must change password" | + Pending / Declined, "Must change password" |
| Password | em dash | School ID / eye (sealed) / "Not on record" | em dash |
| Actions | View profile | View profile, Reveal, Reset to School ID, Sign in as | View profile, Reset password, Sign in as |

The Password cell is a discriminated union computed in the read model, not a set
of booleans the table interprets. The four members, in TypeScript union order:

- `{ kind: "school_id"; value: string }` — SCHOOL_HEAD, live password is the School ID
- `{ kind: "sealed" }` — SCHOOL_HEAD, a sealed copy exists, so reveal is offered
- `{ kind: "not_recorded" }` — SCHOOL_HEAD, nothing sealed, reset instead
- `{ kind: "never_stored" }` — TEACHER / SUPER_ADMIN, renders an em dash

The mapper branches on `role` once. A teacher row cannot carry `sealed`, because
the only code that produces `sealed` sits inside the `SCHOOL_HEAD` branch.
`passwordVaultCipher` is selected only to be turned into a boolean and never
leaves the server, the same rule the current read model already follows. This is
presentation; the server-side half of the invariant is in section 9.

The row also carries `canRecoverByEmail: boolean`, computed once here from
`isSyntheticEmail(user.email)` (`src/lib/auth/synthetic-email.ts`). The table must
not re-derive "is this a real mailbox" from the address string: that decision
belongs in one place, and section 6 depends on it.

### 3.2 Filtering and paging

URL params: `?role=&schoolId=&q=&page=`.

- `role` — one of SUPER_ADMIN, SCHOOL_HEAD, TEACHER; absent means all.
- `schoolId` — honoured when present so `/admin/schools` can deep-link "accounts
  at this school". No picker is rendered. A dropdown of 333 schools is a large
  client payload and a third query, for a filter the text search already serves.
- `q` — case-insensitive `contains` against `fullName`, `email`, `username`,
  `school.name`, `school.schoolIdCode`. One input covers both "find Mrs Dela Cruz"
  and "show me Salimama".
- `page` — `ACCOUNTS_PAGE_SIZE = 20`.

Order: school name asc, then role asc, then lastName asc, then firstName asc.
`SUPER_ADMIN` rows have `schoolId = null` and therefore sort last under Postgres's
NULLS LAST default. Deliberate: they are the rows an admin looks for least.

### 3.3 Query count: the bound, and why it holds

One render of `/admin/accounts` costs exactly 2 Prisma calls, and that number does
not change with page size or row count.

1. `prisma.user.findMany` with `relationLoadStrategy: "join"`, the `where` above,
   `skip` / `take: 20`, and a `select` of scalars plus
   `school: { select: { id, name, schoolIdCode } }`.
2. `prisma.user.count({ where })` for the pager.

Both run inside one `Promise.all`, exactly as `getSchoolAccountsPage` does today.
With the join strategy the first is a single SQL statement; even under Prisma's
default strategy the `school` relation resolves as one batched `IN (...)` — still
constant, never one per row. Worst case 3 statements, best case 2.

What makes the bound real is what the read model is forbidden to do. None of the
following may appear in `getAccountsPage`, in the page component, or in a row
component:

- per-row advisory-section or learner reads. This is the fan-out that took
  `/admin/archive` down against a pooler floored at `connection_limit=3`;
- per-row ARAL counts;
- per-row `supabaseAdmin.auth.admin.getUserById`. That is an HTTP round trip per
  row, strictly worse than a query, and it is why "last sign in" is sourced from
  `AuditLog` instead (section 7);
- any `await` inside `rows.map`.

Everything per-person lives behind the profile modal, which opens for one row at a
time. The list is pinned to 2 calls by a unit test that counts calls on a mocked
client.

Not wrapped in `cachedQuery`, for the reason already recorded at the top of
`src/lib/admin/school-accounts.ts`: this list drives credential actions, and an
admin who has just reset a password must see the new state on the very next render
or they will reset it again. Two indexed statements on a Super-Admin-only page are
not worth a stale window.

### 3.4 Indexes: none added

The `where` is `deletedAt IS NULL` plus optional `role` / `schoolId` equality and
an unindexable case-insensitive `contains`. The existing `User` indexes on
`[schoolId, role, deletedAt]` and `[deletedAt]` cover the filtered shapes; the
unfiltered cross-tenant sort falls back to a scan-and-sort over the whole `User`
table, a few thousand rows at ~333 schools, which Postgres sorts in single-digit
milliseconds. No migration is needed (section 10).

The extension point, if `User` ever passes roughly 50k rows: a covering index on
`[role, deletedAt, lastName]`, together with dropping the joined `school.name`
sort key so the index can actually serve the ORDER BY. Do not add it
speculatively. It cannot serve the `q` path anyway, and `prisma/**` has a single
serialized owner whose time should not be spent on an index nothing needs yet.

## 4. Prefetch safety

Yes, this route needs the opt-out. In `src/lib/nav/nav-config.ts` the
`admin-school-accounts` item is replaced by an `admin-accounts` item, label
"Accounts", href `/admin/accounts`, same `KeyRound` icon, carrying `heavy: true`.

Reasoning. `PrefetchLink` defaults `intent` to true, so a cursor travelling down
the admin sidebar speculatively renders the whole route on the server after a
short delay. `/admin/accounts` shares three of the four properties that made
`/admin/archive` the first `heavy` route: it is `force-dynamic`, it reads a global
cross-tenant table, and its ORDER BY is on a joined column with no index behind
it. It differs in one: its query count is bounded at 2.

That difference is what makes this a judgement call rather than an obvious one.
Recommendation: ship it `heavy`. The opt-out costs one word, it removes only the
speculative render (click navigation is untouched), and the cost of being wrong in
the other direction is a pooler outage this project has already paid for once.
What would change my mind: an `EXPLAIN ANALYZE` of the unfiltered list query at
production row counts coming back under roughly 10 ms. Then drop `heavy` and let
it prefetch like `/admin/schools`.

## 5. Extending impersonation to teachers

The ticket in `src/lib/auth/impersonation.ts` is already role-agnostic:
`adminAuthId`, `adminUserId`, `targetUserId`, `expiresAt`. Nothing in that module
changes except one addition: wrap `readImpersonationTicket` in React `cache()`,
because after this change it is read twice per request in the school-head tree
(once by the layout for the profiling bypass, once by the shared banner).

### 5.1 The action guard

`impersonateSchoolHead(formData{schoolId})` is replaced by
`impersonateUser(formData{userId})` in `src/lib/actions/accounts.ts`. It has one
call site today (`src/components/admin/school-accounts-table.tsx`, which this work
deletes), so there is no compatibility shim to keep.

Guard order, inside the `action()` wrapper:

1. `const admin = await requireUser("SUPER_ADMIN")`. Safe from the
   Super-Admin-passes-everything trap: `allowSuperAdmin` short-circuits to the
   same role being asked for. The trap does bite in 5.2 — see there.
2. `checkRateLimit("impersonate:" + admin.id, IMPERSONATE_RATE)`, existing
   constants, unchanged.
3. Load the target by id with `deletedAt: null`, selecting `role`, `isActive`,
   `approvalStatus`, `email`, `schoolId`, `fullName`, and the school's name.
4. Refuse `role === "SUPER_ADMIN"` with `AppError("AUTH_FORBIDDEN")`. No
   escalation path, ever, not even admin to admin.
5. Refuse a soft-deleted or inactive target with
   `AppError("AUTH_ACCOUNT_DEACTIVATED")`, worded to name the fix ("Reactivate
   the account, then sign in as it"). This is not politeness. `getCurrentUser`
   signs out `deletedAt` and `!isActive` users on their very next request, so the
   swap would destroy the admin's own session and leave them on the login page
   holding a ticket they can no longer redeem. Refusing before the swap is the
   only correct order.
6. `setImpersonationCookie(...)` before `switchSessionTo(...)`: after the swap
   there is nothing left in the request identifying the admin. Unchanged.
7. On swap failure, `clearImpersonationCookie()` and return. Unchanged.
8. `writeAudit` with `IMPERSONATION_START`, resource `User`, resourceId the
   target id, plus `schoolId`, `schoolName` and `targetRole` in metadata.
9. `redirect(target.role === "TEACHER" ? "/teacher" : "/school-head")`.

A PENDING teacher is allowed. "Why has this teacher been stuck on Pending for a
week" is one of the two tickets this console exists to answer, and the admin has
to see what the teacher sees. `getCurrentUser` redirects them to
`/pending-approval`, so that page must carry the banner (5.2).

### 5.2 Which layouts read the ticket

Today the ticket is read inline in `src/app/school-head/(app)/layout.tsx`. That
does not scale to five entry points, and "the banner cannot be suppressed" is
easier to hold when one component owns it.

New: `src/components/admin/impersonation-notice.tsx`, a server component that
reads the ticket itself, compares `targetUserId` against the current user, and
renders `ImpersonationBanner` or `null`. Mounted immediately above `{children}` in
five places.

| File | Why it needs it |
|---|---|
| `src/app/school-head/(app)/layout.tsx` | replaces the inline logic already there |
| `src/app/teacher/(app)/layout.tsx` | the normal teacher case |
| `src/app/teacher/(onboarding)/layout.tsx` | a teacher stuck in profiling, which is the diagnosis itself |
| `src/app/pending-approval/page.tsx` | where a PENDING teacher's session lands |
| `src/app/account/set-password/page.tsx` | where `mustChangePassword` sends any impersonated account |

The last two are the ones that get forgotten. Without them the admin is signed in
as someone else on a page with no way back, and the only exit is clearing a cookie
they cannot see.

The Super-Admin trap, named: `requireUser("TEACHER")` in the teacher layout
returns a `SUPER_ADMIN` row too, because an admin may browse `/teacher` directly.
So "am I being impersonated" must be decided by `ticket?.targetUserId === user.id`
and never by the role, exactly as the school-head layout already does. The notice
component encapsulates that comparison so no layout re-derives it.

Two further mirrors of the school-head layout belong in
`src/app/teacher/(app)/layout.tsx`:

- `lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}`.
  Otherwise the admin acknowledges the release modal on the teacher's row and the
  teacher never sees it. The layout therefore still reads the ticket itself for
  this one fact, which is why `readImpersonationTicket` gets memoized.
- The profiling gate: do NOT bypass it for teachers.

The school-head layout bypasses its profiling gate because SH profiling blocks the
entire `/school-head` tree. The teacher onboarding route is a real page that
renders, and it is frequently the thing that is broken, so landing the admin in
the wizard shows them the actual failure. The onboarding layout carries the
banner, so there is always a way out. The defensible alternative is to mirror the
school-head bypass so the admin reaches the app; it is rejected for now, and what
would change my mind is the tickets turning out to be about ARAL grids on
already-profiled teachers, in which case the bypass costs nothing.

### 5.3 Returning, expiry, middleware

`endImpersonation` is already role-agnostic: the ticket is the sole authority and
it re-verifies that the named admin is still `role: SUPER_ADMIN`, `isActive: true`,
`deletedAt: null` before restoring. Exactly one literal changes — the final
`redirect("/admin/school-accounts")` becomes `redirect("/admin/accounts")`.

Ticket TTL stays two hours, the existing `TICKET_TTL_MS`. A shorter teacher-only
TTL was considered and rejected: one TTL is one decision in one place, and an
expired ticket is not a lockout — the admin simply signs in again.

Middleware needs no change. `enforceRolePrefix` admits a `TEACHER` JWT to
`/teacher`, and the impersonated session carries the teacher's own
`app_metadata.role`. Legacy teachers with no JWT role fall through the
`if (!role) return { ok: true }` branch, which is the documented deliberate
pass-through; `requireUser` in the layout is the real gate either way.

### 5.4 What stops a head or teacher minting a ticket

The cookie value is the payload plus an HMAC-SHA256 of that payload keyed on
`SUPABASE_SERVICE_ROLE_KEY`, verified in constant time by
`decodeImpersonationTicket`, which is the only reader and returns null for
anything unparseable, mis-signed, or expired. Forging one therefore requires the
service-role key, which never reaches a browser and whose possession already means
total compromise.

Three further layers sit behind that signature: `encodeImpersonationTicket` lives
in a `server-only` module; its only caller is an action whose first line is
`requireUser("SUPER_ADMIN")`; and even a validly signed ticket only restores an
account that `endImpersonation` re-checks is a live Super Admin.

## 6. Resetting a teacher's password

New action `resetTeacherPassword(formData{userId})` in
`src/lib/actions/accounts.ts`.

What it resets to: a fresh random one-time credential from
`generateActivationCredential`, the same generator the teacher invite flow already
uses. Not the School ID. The School ID is the School Head's credential and it is
printed on the schools table; handing it to teachers would both create a shared
password across a school and hand every teacher a value to try against the head's
account.

The Salimama failure that pushed School Head resets away from random credentials
does not transfer: heads kept typing the School ID they already knew, and teachers
have no such well-known default to fall back on. A random credential for a teacher
cannot collide with an expectation, and it matches the one credential story
teachers already have — invite resend.

Mechanics, in order:

1. `requireUser("SUPER_ADMIN")`, then `checkRateLimit("reset:teacher:" + admin.id, RESET_RATE)`.
2. Load the target; refuse unless `role === "TEACHER"` and `deletedAt === null`,
   with `AppError("NOT_FOUND")` so a wrong id never distinguishes "not a teacher"
   from "does not exist".
3. `supabaseAdmin.auth.admin.updateUserById(authId, { password, app_metadata: { role: "TEACHER", schoolId } })`.
4. `prisma.user.update` writing `mustChangePassword: true`, `passwordIsSchoolId: false`,
   `passwordVaultCipher: null`, `passwordVaultSetAt: null`.

5. `writeAudit` with the new `TEACHER_PASSWORD_RESET` action (section 8).
6. `revalidatePath("/admin/accounts")`.
7. Return `{ ok: true, data: { password } }` for a one-shot dialog.

Two things that write deliberately are worth stating, because both are easy to get
wrong by copying the School Head path:

- It must NOT set `isActive: true`. `regenerateSchoolHeadCredential` does, and
  `docs/backlog.md` already flags that as a HIGH issue: a password reset must not
  silently resurrect an account a School Head deactivated on purpose.
- It must NOT call `sealPassword`. `passwordChangeFields` already refuses to seal
  a non-`SCHOOL_HEAD` role, but this action writes its columns explicitly rather
  than delegating, because it needs `mustChangePassword: true` and that helper
  hardcodes `false`.

On `mustChangePassword`, the two defensible answers:

- `false`, mirroring `resetSchoolHeadPasswordToDefault`, whose comment says the
  point is a login that works immediately.
- `true`, mirroring `createSchool`, which forces a change after issuing a random
  initial password.

Recommended: `true`. The precedent that governs here is credential *issuance*, not
reset-to-a-known-default. The School Head default is the School ID, a value the
head already knows and that is not a secret in transit, so forcing a change there
buys nothing. A random string read out over the phone IS a secret in transit and
should be retired at first login. The cost of this choice is that the impersonated
and non-impersonated paths both land on `/account/set-password`, which is exactly
why that page gets the banner in 5.2.

Conveying it, consistent with `docs/runbook.md`:

- Real email (`canRecoverByEmail === true`): the reset button carries a hint that
  `/forgot-password` works for this teacher, and that path is preferred because it
  never puts a credential in the admin's hands at all.
- Synthetic email (`@school.local`, or anything under `SYNTHETIC_EMAIL_DOMAIN`):
  the mailbox does not exist, so reset is the only path. The credential is shown
  once in a dialog with a copy button and is never emailed, never persisted, never
  audited.

`docs/runbook.md` gains a "Reset a teacher's password" procedure next to the two
School Head ones, naming `TEACHER_PASSWORD_RESET` as the audit row to confirm and
repeating that the credential is shown once.

### 6.1 Write paths this design does not control

`src/lib/db/account-reset.ts` rewrites these same columns wholesale:
`DB_RESET_SCHOOL_ACCOUNTS` resets every School Head to the School ID, and
`removeTeacherRows` tombstones teachers, clearing `mustChangePassword`,
`passwordIsSchoolId` and both vault columns. `prisma/seed.ts` and the roster
import script also set passwords at creation.

None of them conflicts with this design — a teacher reset that a later bulk
operation overwrites is correct behaviour, because the bulk operation is a
deliberate re-provisioning. What would be broken is any design asking an admin to
hand-correct a stored password value and expect it to survive; this spec asks for
no such thing. Stated so the next person does not have to re-derive it.

## 7. The profile modal

Opened from a row's "View profile". Data is fetched on open by a server action,
`getAccountProfile(userId)` in `src/lib/actions/accounts.ts`, wrapped in
`action()`, first line `requireUser("SUPER_ADMIN")`.

On open, not prefetched into the list. This is the same rule
`revealSchoolHeadPassword` and `listAralTutorOptions` already follow: most rows
are never opened, and shipping twenty profiles so that one might be read would put
twenty people's data in a page payload and undo the bound in 3.3.

A server action rather than a route handler under `src/app/api/`, because the
repo's precedent for on-demand modal data is an action and a route handler would
need its own auth guard written from scratch.

### 7.1 Sections and sources

Identity and account state, all from the `User` row already loaded, plus the
joined `School`:

- name, role, `isActive`, `approvalStatus`, `approvedAt`, `rejectedAt`,
  `mustChangePassword`, `createdAt`, `profileCompleted`, `lastSeenReleaseVersion`;
- school name and `schoolIdCode`;
- sign-in identity: `email` or `username`, with the synthetic flag derived by
  `isSyntheticEmail`;
- last successful and last failed sign-in — see 7.3.

Advisory sections and their learners (TEACHER only): `advisorySections` where
`deletedAt: null`, each with its `gradeLevel.type`, labelled through
`GRADE_LEVEL_LABELS` — the same shape `listAralTutors` already builds, so the
label reads identically in both places. Learner counts come from a single
`prisma.learner.groupBy({ by: ["sectionId"], where: { sectionId: { in: ids }, deletedAt: null }, _count: true })`,
never one count per section.

ARAL involvement (TEACHER only): `TeacherProfile.designation` run through
`isAralVolunteerDesignation`, `employmentType`, `advisoryMode`, and one
`prisma.learner.count` on `{ schoolId, aralTeacherId: userId, isAralLearner: true, deletedAt: null }`
— a shape the existing `@@index([schoolId, aralTeacherId, isAralLearner, deletedAt])`
serves directly, which is why `schoolId` stays in the `where` even though
`aralTeacherId` alone would be correct. Note for implementers: an ARAL tutor is a
`TEACHER` with learners pointing at them, not a separate role, so there is nothing
else to read.

Submission state and last sign-in, both from one query: an `AuditLog.groupBy` by
`action`, `where: { userId, action: { in: [...] } }`, `_max: { timestamp: true }`.
The action list is `LOGIN_SUCCESS`, `LOGIN_DENIED`, `ATTENDANCE_WEEK_SAVE`,
`READING_LEVEL_RECORD`, `READING_LEVEL_BULK_RECORD`, `TERM_GRADES_BULK_SAVE`. One
statement, served by the existing `@@index([userId, timestamp])`, and it answers
"when did they last sign in", "when did they last fail to sign in", and "have they
submitted this month" together.

Recent activity: `prisma.auditLog.findMany({ where: { userId }, orderBy: { timestamp: "desc" }, take: 20 })`,
same index. Rendered as action plus timestamp plus resource, reusing the labels
`/admin/audit` already has rather than inventing a second vocabulary.

### 7.2 Query cost of opening the modal

Six statements for a TEACHER, fixed, regardless of how many sections or learners
they have:

1. the user with `school`, `teacherProfile` and `advisorySections.gradeLevel`
   (one statement under `relationLoadStrategy: "join"`, at most four under the
   default strategy, constant either way);
2. `learner.groupBy` over the advisory section ids;
3. `learner.count` for ARAL learners;
4. `auditLog.groupBy` for submission state and sign-in timestamps;
5. `auditLog.findMany` for recent activity.

That is five calls; the join-strategy note is why "statements" and "calls" differ.
For a SCHOOL_HEAD or SUPER_ADMIN target, steps 2 and 3 are skipped by a `role`
branch, leaving three calls. Nothing here scales with row count, and none of it
runs until a human clicks.

### 7.3 Last sign-in: no new column

`User` has no `lastSignInAt` and this design does not add one. Three candidates
were weighed:

- Supabase `auth.admin.getUserById(authId).last_sign_in_at`. Rejected: an HTTP
  round trip inside a request path, and it says nothing about failures, which is
  the half that actually diagnoses the runbook's rate-limit-versus-wrong-password
  case.
- A new `User.lastSignInAt` column. Rejected: it needs an UPDATE on the hottest
  path in the app, and a backfill could not reconstruct history anyway.
- The newest `LOGIN_SUCCESS` and `LOGIN_DENIED` rows in `AuditLog`. Chosen. The
  fact is already recorded, the index already exists, it comes free inside the
  groupBy above, and it yields both halves.

The honest caveat: it is accurate only back to when `LOGIN_SUCCESS` started being
written, and `AuditLog` is never purged, so in practice that is the whole history.
An account with no rows renders "No recorded sign-in", not "never signed in".

## 8. Absorbing `/admin/school-accounts`

Redirect, not rewrite. `src/app/admin/school-accounts/page.tsx` is reduced to a
server component that calls `redirect("/admin/accounts?role=SCHOOL_HEAD")` so the
landing view is exactly what the old page showed.

Why the file survives rather than being deleted: the URL is printed in
`docs/runbook.md`, `docs/migrate-checklist.md`, `docs/FINAL-ACCEPTANCE.md` and in
the in-app help topics, and admins have it bookmarked. A plain `redirect()` (307),
not `permanentRedirect()` — a 308 is cached by browsers indefinitely and would be
a nuisance if the console ever moves again.

Deleted in the same slice: `src/lib/admin/school-accounts.ts` and
`src/components/admin/school-accounts-table.tsx`. Repointed: the
`revalidatePath("/admin/school-accounts")` calls in `src/lib/actions/school.ts`
and in the reset action now name `/admin/accounts`.

How the reveal control survives without leaking into teacher rows, in three
independent places:

1. The read model maps every non-`SCHOOL_HEAD` row to
   `{ kind: "never_stored" }`, so a teacher row carries no reveal state to render.
2. The table renders the eye button only for `sealed` and `school_id`, which a
   teacher row can never hold.
3. `revealSchoolHeadPassword` is re-keyed from `schoolId` to `userId` and gains an
   explicit `if (target.role !== "SCHOOL_HEAD") throw new AppError("NOT_FOUND")`.
   This is the one that matters: a hand-crafted POST with a teacher's id must be
   refused by the server, not by the absence of a button.

The action keeps its per-admin `REVEAL_RATE` limit and its one-audit-row-per-
reveal rule unchanged.

Module layout afterwards, so the "not in two places" constraint is checkable:

- `src/lib/actions/accounts.ts` — `revealSchoolHeadPassword`,
  `resetSchoolHeadPasswordToDefault`, `resetTeacherPassword`, `impersonateUser`,
  `endImpersonation`, `getAccountProfile`. Renamed from `school-accounts.ts`.
- `src/lib/admin/accounts.ts` — the read model.
- `src/components/admin/accounts-table.tsx`, `account-profile-dialog.tsx`,
  `impersonation-notice.tsx`, and the unchanged `impersonation-banner.tsx`.
- `src/app/admin/accounts/page.tsx`.

While the actions are being re-keyed anyway, migrate all of them to the `action()`
wrapper and `AppError` throws. That module is one of the roughly thirty still on
the hand-rolled `{ ok: false, error }` shape; every signature in it changes in this
work regardless, so the migration is free here and expensive later.

## 9. Audit

One new entry in `src/lib/audit-actions.ts` (the map moved out of `audit.ts`; add
it there, and `audit.ts` re-exports it):

- `TEACHER_PASSWORD_RESET` — "Super Admin issued a teacher a new one-time
  credential." Resource `User`, resourceId the teacher's id, `schoolId` set,
  metadata `{ schoolId, via: "admin_accounts" }`. Never the credential, never the
  email address, never the teacher's name.

Deliberately NOT folded into `SCHOOL_HEAD_PASSWORD_RESET_DEFAULT`: that string
means "the live password is once again the School ID" and is replayed by the
`passwordIsSchoolId` backfill. A teacher reset means the opposite — a random
credential that nobody can read back — and sharing one string would make the log
unable to say which happened.

Reused unchanged, with one metadata addition:

- `IMPERSONATION_START` / `IMPERSONATION_END` — already role-neutral names. START
  gains `targetRole` in metadata so the log can answer "head or teacher" without
  a join. END already carries only `resourceId`; leave it.
- `SCHOOL_HEAD_PASSWORD_VIEWED`, `SCHOOL_HEAD_PASSWORD_RESET_DEFAULT` — unchanged
  in name, meaning and metadata, even though the actions are re-keyed to `userId`.

Opening the profile modal writes no audit row. It exposes no credential, no
learner PII and no learner names — counts and the staff member's own professional
profile, which a School Head already sees unaudited at `/school-head/teachers`.
The `ADMIN_SCHOOL_VIEW` dedupe machinery would have to be generalised to support
it, and a row per click would drown the log. Flagged as open question 1 rather
than decided silently.

## 10. Security invariants and where each is enforced

| Invariant | Enforcement point |
|---|---|
| Only a Super Admin reaches the console | `requireUser("SUPER_ADMIN")` as the first line of `src/app/admin/accounts/page.tsx`. `enforceRolePrefix` on `/admin` is defense-in-depth only and is explicitly not authoritative |
| Only a Super Admin reaches each control | `requireUser("SUPER_ADMIN")` as the first line of every action in `src/lib/actions/accounts.ts` — never inferred from the page having rendered |
| Soft-deleted accounts never appear or are acted on | `deletedAt: null` in the single `accountsWhere()` helper and in every action's target lookup |
| No head or teacher can mint or forge a ticket | HMAC-SHA256 keyed on `SUPABASE_SERVICE_ROLE_KEY`, constant-time compared in `decodeImpersonationTicket`, which is the only reader. Pinned by `tests/unit/impersonation-ticket.test.ts` |
| The minting path stays admin-only | `encodeImpersonationTicket` / `setImpersonationCookie` are exported from a `server-only` module; a unit test asserts `src/lib/actions/accounts.ts` is their only importer under `src/` |
| Impersonation cannot escalate to Super Admin | explicit `target.role === "SUPER_ADMIN"` refusal in `impersonateUser`, plus a unit test |
| Impersonation cannot strand the admin | explicit refusal of `deletedAt != null` and `isActive === false` before the session swap, plus a unit test naming the `getCurrentUser` sign-out as the reason |
| Return-to-admin restores only a live Super Admin | `endImpersonation` re-queries `{ id, authId, role: "SUPER_ADMIN", isActive: true, deletedAt: null }` — already implemented, keep the test |
| The banner cannot be suppressed | rendered server-side by the layout above `{children}`; no prop or client state can turn it off. A wiring test in the style of `tests/unit/release-shell-wiring.test.ts` asserts all five files in 5.2 mount `ImpersonationNotice` |
| No teacher password material exists | `passwordChangeFields` seals only `SCHOOL_HEAD`; pinned by `tests/unit/actions/auth-password-vault-wiring.test.ts` |
| No teacher password material reaches the client | read model maps non-SH rows to `never_stored`; `revealSchoolHeadPassword` throws `NOT_FOUND` for a non-SH target; the one-time credential is returned in an action result and never persisted, logged, or revalidated into the list |
| No credential reaches the audit log | metadata is ids and counts only, in every action; `tests/unit/audit.test.ts` is the precedent |
| One reveal writes exactly one audit row | unchanged in `revealSchoolHeadPassword`; not deduped, not batched |
| A reset cannot resurrect a deactivated teacher | `resetTeacherPassword` writes no `isActive`; unit test asserts the update payload |
| The list never fans out per row | `getAccountsPage` issues exactly 2 Prisma calls; unit test counts calls on a mocked client |
| Credential controls are rate limited | `checkRateLimit` per admin id in reveal, reset, and impersonate, with the existing constants |

## 11. Migration and rollout

No Prisma migration. `prisma/**` is untouched, so `database-engineer` has no task
in this work and is not in the critical path.

Checked explicitly before concluding that: `User` already carries `isActive`,
`mustChangePassword`, `approvalStatus`, `approvedAt`, `rejectedAt`,
`profileCompleted`, `username`, `createdAt`, `deletedAt`, and both vault columns;
`Section.adviserId` and `User.advisorySections` give the advisory data;
`Learner.aralTeacherId` plus `isAralLearner` give ARAL involvement;
`AuditLog[userId, timestamp]` gives activity, submission state and sign-in
history. The one field the modal wants that the schema lacks is `lastSignInAt`,
and 7.3 sources it without a column.

No data changes. Every existing row means exactly what it meant before; the change
is entirely additive in code.

Clients in flight:

- A Super Admin sitting on `/admin/school-accounts` when the deploy lands gets the
  redirect on their next navigation. Their bookmarks keep working.
- An impersonation ticket minted before the deploy still verifies (same key, same
  payload shape) and still returns its holder to an admin session; only the
  redirect target changes.
- No teacher or head sees any difference until an admin acts on their account.

Rollout is one push. Per the release rule it ships a `RELEASES` entry in
`src/lib/releases.ts` with a middle-number bump (this is a feature), and the same
version string in `package.json` and `package-lock.json`. Suggested user-facing
wording: "Admins can now find any account by name, see what a teacher is stuck on,
and sign in as them to fix it."

## 12. Alternatives rejected

Extending the password vault to teachers. Rejected by the owner, and independently
the right call: a recoverable copy of a teacher password buys the console one row
of display and costs the deployment a reversible secret for every staff account in
the division. Reset and impersonate already cover every diagnosis.

Keeping two consoles, adding `/admin/teacher-accounts` beside the existing one.
Rejected: reveal, reset and impersonate would exist twice, and the second copy is
the one that drifts. It also makes "find this person" require knowing their role
first, which is precisely what the admin does not know when a school calls.

A rewrite instead of a redirect for the old URL. Rejected: a rewrite keeps a dead
path alive in the router forever and hides from the admin that the console moved.

Adding `User.lastSignInAt`. Rejected in 7.3 — an UPDATE on the hottest path for a
fact `AuditLog` already holds.

Caching the list with `cachedQuery`. Rejected in 3.3 — a 60-second stale window on
a console that mutates credentials causes double resets.

Auditing every profile-modal open. Deferred, with reasoning in section 9; see open
question 1.

## 13. Task breakdown

Gates for every task: `npx prisma generate`, `npm run typecheck`, `npm run lint`,
`npm run test`, `npm run build`. In a worktree, `npm run lint` needs a temporary
`"root": true` in the worktree ESLint config, restored afterwards.

T0 · backend-developer · rename only
Rename `src/lib/actions/school-accounts.ts` to `src/lib/actions/accounts.ts` and
update its two importers (`src/components/admin/impersonation-banner.tsx`,
`src/components/admin/school-accounts-table.tsx`). Mechanical, no behaviour
change. This crosses into `src/components/**` for two import lines; that crossing
is deliberate so T1 and T2 can then run in parallel.
Verify: `npm run typecheck` clean, `git diff` shows only a path and two imports.

T1 · backend-developer · read model — parallel with T2
Create `src/lib/admin/accounts.ts`: `ACCOUNTS_PAGE_SIZE`, `parseAccountsParams`,
`accountsTotalPages`, `accountsWhere`, `getAccountsPage`, types `AccountRow` and
`AccountPasswordState`, and the `canRecoverByEmail` derivation. Sections 3.1–3.3.
Verify: a new unit test asserts (a) exactly 2 calls on a mocked Prisma client,
(b) a TEACHER row always maps to `never_stored`, (c) `deletedAt: null` is always
in the `where`.

T2 · frontend-developer · the banner everywhere — parallel with T1
Create `src/components/admin/impersonation-notice.tsx`; mount it in the five files
listed in 5.2; remove the now-duplicated inline ticket logic from the school-head
layout while keeping its profiling bypass and release suppression; add the release
suppression to the teacher app layout. Depends on T0 for the import path.
Verify: a wiring test in the style of `tests/unit/release-shell-wiring.test.ts`
asserts all five files mount the notice.

T3 · backend-developer · the actions — after T0 and T1
In `src/lib/actions/accounts.ts`: re-key `revealSchoolHeadPassword` and
`resetSchoolHeadPasswordToDefault` to `userId` with an explicit role refusal; add
`resetTeacherPassword` (section 6); replace `impersonateSchoolHead` with
`impersonateUser` (5.1); repoint the `endImpersonation` redirect; add
`getAccountProfile` (section 7); migrate the whole module to `action()` plus
`AppError`. Add `TEACHER_PASSWORD_RESET` to `src/lib/audit-actions.ts` and
`targetRole` to the `IMPERSONATION_START` metadata. Memoize
`readImpersonationTicket` with React `cache()`. Repoint the
`revalidatePath("/admin/school-accounts")` calls in `src/lib/actions/school.ts`.
Delete `src/lib/admin/school-accounts.ts`.
Verify: unit tests on each refusal branch — SUPER_ADMIN target, inactive target,
soft-deleted target, non-SH reveal, and the `resetTeacherPassword` update payload
containing no `isActive`.

T4 · frontend-developer · the console — after T1 and T3
Create `src/app/admin/accounts/page.tsx` (force-dynamic, `requireUser`,
Suspense + `TableSectionSkeleton`, the degradation path the current page uses when
the database is unreachable), `src/components/admin/accounts-table.tsx` and
`src/components/admin/account-profile-dialog.tsx`. Reduce
`src/app/admin/school-accounts/page.tsx` to a redirect. Delete
`src/components/admin/school-accounts-table.tsx`. Update
`src/lib/nav/nav-config.ts` to the `admin-accounts` item with `heavy: true`.
Note: `src/lib/nav/**` falls outside both declared ownership boundaries in
`.claude/agents/`; it is assigned here because it is navigation presentation, and
the boundary gap is worth recording.
Verify: nav resolver tests still pass; manual pass over the three role filters.

T5 · qa-test-engineer · invariants — starts after T3, runs parallel with T4
Own `tests/**` exclusively, so this never collides. Write the tests named in the
section 10 table that T1–T3 did not already carry: the import-boundary test for
`encodeImpersonationTicket`, the banner wiring test, the impersonation refusal
matrix, the "no credential in audit metadata" assertions for the new action, and
an e2e under `e2e/` covering admin signs in as teacher, sees the banner, returns,
lands on `/admin/accounts`.
Verify: `npm run test` green; e2e run against a locally started dev server only.

T6 · whoever pushes · docs and release
`docs/runbook.md` gains "Reset a teacher's password" and "Sign in as a teacher";
the three docs that print `/admin/school-accounts` gain the new URL. `RELEASES`
entry plus the version bump in `package.json` and `package-lock.json`.
Verify: the release-guard test passes; the pre-push hook does not fire.

Parallelism summary: T0 alone first (it moves a file everything else imports).
Then T1 and T2 together — disjoint file sets, `src/lib/admin/**` versus
`src/components/**` plus `src/app/**/layout.tsx`. Then T3 alone. Then T4 and T5
together — `src/components/**` plus `src/app/**` versus `tests/**` and `e2e/**`.
Then T6. `database-engineer` has no task.

## 14. Open questions

1. Should opening the profile modal write an audit row? Section 9 recommends no,
   on the grounds that it shows counts and a staff member's own professional
   profile, which a School Head already sees unaudited. If the owner reads
   cross-tenant staff data as needing a trail under the Data Privacy Act, the
   answer is an `ADMIN_ACCOUNT_VIEW` action deduped per admin and target over
   eight hours, reusing the `ADMIN_SCHOOL_VIEW` pattern — which means generalising
   that dedupe helper first.
2. Should the teacher reset force `mustChangePassword`? Section 6 recommends yes
   and gives the reasoning; it is the one place this design deliberately differs
   from the School Head path, so it deserves a yes or no from the owner.
3. Should impersonating a teacher bypass the profiling gate, as it does for a
   School Head? Section 5.2 recommends no. Decide before T2 — it is one `if` in
   the teacher app layout, and changing it afterwards means re-testing both trees.
