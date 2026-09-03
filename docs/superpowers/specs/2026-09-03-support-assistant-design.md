# Support assistant — design

**Date:** 2026-09-03
**Status:** implemented, deployed, and migrated 2026-09-03

## The problem

A teacher who misses the ARAL weekly attendance deadline is simply stuck. The
grid renders read-only, the save action refuses, and there is nothing in the app
that says what to do next. The same is true of a term grade sheet after its
window closes. Today the answer is an out-of-band message to somebody at the
division office, who has no way to reopen one week for one teacher — only to
change a deadline for everybody or to edit rows directly.

Two things were missing, and they are related: a place to ask a question inside
the app, and a way for an admin to answer a question about access by actually
granting it.

## Decisions taken up front

Four choices shaped everything below. Each was chosen over a more ambitious
alternative.

1. **The assistant answers from a curated index, not a model.** No LLM call, no
   API key, no per-question cost, no chance of inventing a DepEd policy that
   does not exist. What it cannot answer it hands to a human, and that handoff
   is the feature — not a fallback.
2. **The "division admin" is the existing `SUPER_ADMIN`.** No fourth role, no
   new permission surface, no migration of existing accounts.
3. **An unlock is a real, scoped, expiring grant** — not a flag, not a deadline
   edit, not an admin editing the learner's row on the teacher's behalf.
4. **All three roles get the assistant; teachers and school heads can file
   tickets.** A Super Admin has the inbox instead — filing a ticket to oneself
   is not a workflow.

## Architecture

Three layers that only touch at their edges.

### 1. The help index — `src/lib/help/`

Pure, synchronous, no I/O, no database. `topics.ts` holds the corpus; `search.ts`
is the whole answering mechanism; `quick-actions.ts` is the tile set the panel
opens with.

`answerQuery(query, ctx, limit)` tokenizes, scores every visible topic, drops
anything under `MIN_SCORE`, and returns matches ordered best-first. Scoring is
weighted so a title phrase beats a keyword beats a body word, with a small boost
for a topic that belongs to the route the person is on.

Two properties matter more than any individual ranking:

- **It returns nothing rather than something wrong.** An empty array is what the
  panel turns into "I could not find that — send it to the division admin". A
  scoring change that made everything clear the threshold would kill the
  escalation path silently, so `MIN_SCORE` is asserted directly in the tests.
- **Visibility is per-topic and follows the app's own role rule.** A teacher is
  never shown a topic that describes a school head's screen; `SUPER_ADMIN` sees
  everything, because that role passes every check in this app by design.

Because the index is pure, it is also the cheap half: no query runs when
somebody opens the panel and reads a topic.

### 2. Tickets — `src/lib/actions/support.ts`, `src/lib/support/queries.ts`

A ticket is one message with one reply. Deliberately not a thread: the reply is
a single `resolutionNote` column, and the state machine is
`OPEN → RESOLVED | DECLINED` with no reopening. A follow-up is a new ticket.

**The two trust boundaries in this file are opposites, and that is the point.**

- *Raising* a ticket is school-scoped: `requireSchoolUser(["TEACHER",
  "SCHOOL_HEAD"])`, and `schoolId`/`requesterId` come from the session, never
  from the payload. A requester cannot file against another school.
- *Answering* one is cross-tenant and Super-Admin-only:
  `requireUser(["SUPER_ADMIN"])`, and the lookup carries **no** `schoolId`
  filter, because a division admin's inbox spans every school. That missing
  filter is intentional and is the one place in the app where its absence is
  correct.

Rate limiting is five tickets per hour per user, keyed `support-ticket:<userId>`.
Input is validated before the limiter is consulted, so a malformed submission
does not consume anybody's budget.

### 3. Grants — `src/lib/unlock/grants.ts`

A grant is permission for **one user** to write inside **one already-closed
window**. It names a user, a scope, a target period, and an expiry. There is no
school-wide form and no open-ended form, because the failure mode of this table
is a lock left quietly open.

Expiry and revocation are enforced **in the SQL predicate** — `revokedAt: null`
and `expiresAt: { gt: now }` — not in a JavaScript branch afterwards. An expired
row never comes back to be inspected.

Every read **fails closed**. A pool timeout resolves to "no grant", which reads
as "still locked". If it rethrew, a transient database error would 500 a
teacher's save; if it returned a grant, one error would open every locked window
in the app at once.

`findActiveUnlock` is `cache()`-wrapped for the request, since a save path and
the page that rendered it ask the same question.

## Data model

Two tables and three enums, in `20260903000001_support_assistant`.

`SupportTicket` — `schoolId`, `requesterId`, `category`, `status`, `subject`,
`body`, `pageUrl?`, the optional `requestedScope`/`requestedTargetKey` pair, and
the resolution triple `resolverId?`/`resolutionNote?`/`resolvedAt?`. Indexed for
the three reads that exist: the admin inbox (`status, createdAt`), a school's
tickets (`schoolId, createdAt`), and "my requests" (`requesterId, createdAt`).

`UnlockGrant` — `userId`, `scope`, `targetKey`, `grantedById`, a **required**
`expiresAt`, and the revocation pair. Two constraints carry the invariants:

- `@@unique([userId, scope, targetKey])` — one row per window per person. A
  re-grant updates that row rather than stacking a second one, so "is it open?"
  never depends on row order.
- `ticketId @unique` — one ticket cannot issue two grants.

`targetKey` is a bare string rather than two nullable typed columns because the
lock sites already key their windows by exactly these strings: a Monday
`YYYY-MM-DD` from `src/lib/date-keys.ts` for `ARAL_WEEKLY_ATTENDANCE`, a
`TermPeriod` name for `TERM_GRADES`.

`Notification` gained a nullable `ticketId` (`SetNull`) rather than reusing
`learnerIds`, which is learner-specific by design.

Resolver, revoker and ticket pointers are all `SetNull`: removing an admin
account must leave the history readable, not delete it.

**`UnlockScope` is the coupling to watch.** Adding a value without adding its
check at a lock site produces a grant that silently does nothing. The enum's
doc comment names the two enforcement points for exactly this reason.

## Where the lock actually opens

Four places, and they must agree.

| Site | Call | Purpose |
|---|---|---|
| `src/lib/actions/attendance.ts:155` | `findActiveUnlock` | the save that must not be refused |
| `src/lib/actions/term-grades.ts:146` | `findActiveUnlock` | same, for a term sheet |
| `.../aral/[gradeId]/attendance/page.tsx:278` | `listActiveUnlockKeys` | render the week editable |
| `.../aral/[gradeId]/terms-reports/page.tsx:222` | `listActiveUnlockKeys` | render the term editable |

The set-returning read applies the same `revokedAt`/`expiresAt` filters as the
single lookup. If it were laxer, a revoked week would render editable and then
refuse to save — the worst of the available answers. A test asserts both
predicates for that reason.

A save that consumes a grant writes `UNLOCK_GRANT_USED`, so a reopened window
leaves a trail on both sides: who opened it, and that it was used.

## Privacy — stricter here than anywhere else in the app

`subject` and `body` are free text typed by somebody describing a problem with
their class. They **will** name learners.

They are never copied into `AuditLog.metadata`, into a `Notification`, or into an
error message. Audit rows carry ids and counts only —
`{ category, requestedScope, notifiedAdmins }` on submit,
`{ ticketId, userId, scope, targetKey }` on a grant. A test JSON-stringifies
every audit and notification payload and asserts the learner name from the
fixture appears in none of them.

`pageUrl` is a **bare pathname**, and this is enforced rather than assumed. The
first version of the regex accepted `//evil.example.com`, because `/`, `.` and
`-` are all legal pathname characters — a protocol-relative URL is
indistinguishable from a path without an explicit `(?!/)` lookahead. Writing the
test found it. The field is currently rendered as text in a `<code>` element, so
nothing was exploitable, but it would become an open-redirect the moment anyone
turned it into a link. Fixed in both places that carry the pattern
(`support.schema.ts` and `assistant-panel.tsx`). A query string is refused for a
second reason: it could carry learner ids into a column meant to say only which
page somebody was on.

## Validation

`src/lib/validators/support.schema.ts`, shared by the client form and the server
actions, so the rules a person is shown are the rules enforced. One rule is
load-bearing beyond hygiene: **a stray scope on a non-unlock ticket is refused,
not dropped.** Dropping it would let a bug report carry `requestedScope` through
to an admin who answers it with a grant nobody asked for. The refusal is why
`resolveTicket` can trust that a ticket naming a period is an access request.

Grant length is capped at `MAX_UNLOCK_DAYS = 30`, defaulting to 7. The cap is
what makes a grant temporary rather than a permanent widening of what a teacher
can edit.

## UI

`AssistantWidget` mounts once in `role-shell.tsx`, so it is present on every
authenticated page and nowhere else. Layout follows the supplied mock: floating
launcher, panel with a greeting, quick-action tiles, a message list, and a
composer. Departures from the mock were driven by data rather than taste — the
tiles and topics are the real index, and the ticket form's category and period
fields exist because `UnlockScope` needs them.

`/admin/support` is the inbox, reached from a new `LifeBuoy` nav entry. It lists
tickets across schools, resolves with an optional note and an optional grant,
declines with a required note, and revokes a live grant.

A decline requires a note where a resolve does not: a decline with no note
leaves somebody blocked and told nothing.

## Caching

Ticket mutations go through `revalidateSupportTicket(requesterId)` plus
`revalidatePath("/admin/support")`, following the named-helper convention in
`src/lib/cache/revalidate.ts`. The help index is static and needs no
invalidation. Grants are read per-request and not cached across requests — a
revocation must take effect immediately, which rules out a TTL.

## Testing

99 tests across four files, all passing.

| File | Tests | Focus |
|---|---|---|
| `tests/unit/help-search.test.ts` | 20 | ranking, the empty-result contract, per-role visibility, index integrity |
| `tests/unit/validators/support.schema.test.ts` | 30 | the stray-scope refusal, the `pageUrl` table |
| `tests/unit/unlock-grants.test.ts` | 12 | the query predicate, fail-closed behaviour |
| `tests/unit/actions/support-ticket.test.ts` | 37 | both trust boundaries, PII containment, idempotent revoke |

Two testing constraints are worth recording, because both shape what an honest
test here can claim:

- Since expiry and revocation live in the SQL `where`, a mocked client cannot
  prove "an expired grant does not unlock" by returning an expired row — that
  row would never have come back. The test asserts the predicate sent instead.
  Deleting either filter from the source fails a test.
- `findActiveUnlock` is `cache()`-wrapped, and no request store exists in a unit
  test, so that file overrides React's `cache` with identity. It is the only
  test in the repo that mocks `react`.

## Deliberately not built

- No threaded conversation on a ticket. One reply.
- No school-wide or never-expiring grant.
- No email on ticket events — in-app notification only, reusing `Notification`.
- No new role. No change to how deadlines themselves are configured.
- No LLM.

## The migration, as applied

`prisma/migrations/20260903000001_support_assistant/` was applied to Supabase on
2026-09-03 with `prisma migrate deploy`, on the owner's explicit instruction.
It is additive — three `CREATE TYPE`, two `ALTER TYPE ... ADD VALUE`, one
nullable `ADD COLUMN` on `Notification`, two `CREATE TABLE`, eleven indexes and
nine foreign keys. Nothing dropped, nothing rewritten, no backfill, so it was
safe to apply while serving. Neither new enum value is consumed by a later
statement in the same transaction, which is what makes `ALTER TYPE ... ADD VALUE`
legal inside Prisma's wrapping transaction on PG 12+.

Verified afterwards: both `SUPPORT_TICKET_*` values present on
`NotificationType`, both tables queryable and empty.

`prisma/rls-policies.sql` was then re-run, as the checklist requires whenever a
migration adds a table.

### What auditing that turned up

Adding the two tables to `rls-policies.sql` exposed a gap in the file itself:
`Report`, from the previous day's migration, had never been added. Two of the
three additions were therefore fixing an existing omission rather than
completing this feature.

The reason the file's own header gives for why that matters is **not accurate in
this project**. It says Supabase grants `anon` privileges on new public-schema
tables, so an un-enabled table is readable through PostgREST. Checked directly
against `information_schema.role_table_grants`: only `User` carries an
`anon`/`authenticated` SELECT grant, and RLS is on there with no SELECT policy
for `anon`, so it returns nothing. No table in the database has RLS off *and* a
grant. The gap was a missing layer, not an open door.

Both halves still have to be right, because they are set by different tools in
different places and a table with RLS off is one stray grant away from readable.
`tests/unit/rls-coverage.test.ts` now fails if a model is missing from the file,
which is the cheap half of the invariant. The privilege half is not something a
unit test can see.

### Unrelated drift found in the same pass

Four tables exist in the production `public` schema that appear in no migration,
no `schema.prisma` model, and nowhere in `src/`: `MasterSyncConfig`,
`SchoolSyncLink`, `SyncInbox`, `SyncOutbox` — a Google-Sheets sync subsystem,
created out of band. `SyncOutbox` holds four rows; the rest are empty.
`MasterSyncConfig.masterApiKey` is a plaintext key column.

They are not a security exposure (RLS off, but no `anon` grant either). They are
schema drift, and that has a concrete cost: Prisma has no record of them, so
`prisma migrate dev` will report drift and offer a reset. Left as found —
deciding whether that subsystem is real or abandoned is the owner's call, and
they are deliberately *not* added to `rls-policies.sql`, since the coverage test
asserts that file names only tables the schema defines.
