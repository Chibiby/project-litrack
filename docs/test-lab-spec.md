# Page Test Lab — spec

Super Admin QA of School Head and Teacher pages in production, with temporary
data only, without creating a login or using a real person's account.

## Decisions (project owner, 2026-09-17)

1. **Mechanism: sign in as demo accounts.** Test Lab reuses the existing signed,
   session-bound "sign in as" ticket (`impersonateUser`, `src/lib/auth/impersonation.ts`),
   restricted to demo personas that Test Lab itself creates inside a demo school.
   Saves are real; existing tenancy checks confine them to the demo school.
   The `?schoolId=` read-only admin view is NOT used for writing — School Head
   pages are `readOnly` there and saves call `requireSchoolUser`, which redirects
   a school-less Super Admin.
2. **One demo school.** `DEMO_SCHOOLS` shrinks to `[demo school 1]` only. After
   deploy the owner clicks "Reset test data", and `resetDemoTenant` (which deletes
   every `isDemo: true` school) removes schools 2 and 3 and rebuilds school 1.
   No code path deletes them automatically.
3. **Side effects accepted, tagged.** Support tickets, chat, and error events from a
   demo school still reach admin views, but are visibly labelled "Demo" there.
4. **Self-bound forms dry-run** in a Test Lab session: School Head profile, Teacher
   profile, change/set password, skip password change, change email.
5. No schema change, no migration. Checklist ticks live in localStorage.
6. Release 2.1.0 (feature).

## Test mode signal

`readTestLabSession(user)` is true only when ALL hold, re-checked server-side per
request: a valid impersonation ticket bound to this Supabase session, whose
`targetUserId === user.id`, and `user.school.isDemo === true`. No new cookie, query
param, or route. A demo account signed in with its password (training video) has
no ticket, so it is NOT in test mode and its saves stay real.

## Guard module — `src/lib/auth/test-lab.ts` (server-only)

- `assertTestableSchool(schoolId)`: loads school with `deletedAt: null`; throws the
  same generic not-found as `assertSameSchool` unless `isDemo`.
- `isTestLabSession({ ticketTargetUserId, userId, schoolIsDemo })`: pure.
- `readTestLabSession(user)`: React `cache()` wrapper over the ticket read.

Callers: `startTestLabSession`, `prepareTestLab`, the dry-run saves. No other save
needs it — during a test session the acting identity is the demo account.

## Fixtures — `src/lib/demo/test-fixtures.ts`

`prepareTestLabFixtures(createdById)` — idempotent, every write keyed on a school
found with `isDemo: true` (via `assertTestableSchool`), in `[demo school 1]`:
- active SchoolYear; Kindergarten and Grade 1, each with section A
- demo School Head: existing head, `profileCompleted: true`, `mustChangePassword: false`
- demo Teacher: Supabase auth user with synthetic email, random never-shown password,
  APPROVED, active, profiled, `MULTI_GRADE` advising K-A and G1-A through
  `setTeacherAdvisory`
- one PENDING teacher (with auth user)
- ~3 learners per section, 2 ARAL with `aralTeacherId` = demo teacher; learner
  grade/section pointers consistent with the single ACTIVE Enrollment — use
  existing writers, not raw inserts
- audit `TEST_LAB_PREPARE` (ids and counts only)

`findTestLabFixtures()` returns ids or "not prepared" (never throws on missing rows —
demo schools can be deleted elsewhere).

Personas: `head | teacher | pending-teacher`, found by fixed synthetic emails.

## Actions

- `prepareTestLab` in `src/lib/actions/demo.ts`: `action()`, `requireUser("SUPER_ADMIN")`.
- `startTestLabSession(persona, next?)` in `src/lib/actions/accounts.ts`: Zod enum
  persona; lookup with `school: { isDemo: true }`; `assertTestableSchool`; shares
  `impersonateUser`'s body via a local non-exported function; same rate limit;
  audit `IMPERSONATION_START` with `metadata.source = "test-lab"`. `next` must resolve
  (after dot-segment normalization) inside the persona's role tree, with no scheme,
  `//`, backslash, or encoded slash; otherwise it falls back to the role home.
- `endImpersonation` returns to `/admin/test-lab` when the target school is demo
  (pure helper `impersonationReturnPath`).
- `impersonateUser` behaviour for real accounts is unchanged (regression test).

## Dry-run

In `saveSchoolHeadProfile`, `saveTeacherProfile`, `changePasswordAction`,
`setPasswordAction`, `skipPasswordChange`, `changeEmailAction`: after auth guard
and schema parse, `if (await readTestLabSession(user))` return
`{ ok: true, data: { dryRun: true, preview } }` with zero Prisma/Supabase writes.
Where input→saved mapping is inline, extract a pure function used by both the
real save and the preview. Password previews never echo values.

Pages pass `dryRun` prop to forms (UI only): amber "Test Lab — nothing will be
saved" notice; on success show preview dialog instead of redirecting. Onboarding
layouts skip the "already profiled → dashboard" redirect in a test session.

## Checklist — `src/lib/test-lab/checklist.ts`

`buildTestLabChecklist(fixtures)` → `{ id, role, label, href }[]` plus explicit
`ALIASES`. Coverage test: every `page.tsx` under `src/app/school-head` and
`src/app/teacher` is in the checklist or `ALIASES`/`[...missing]`.

## UI

- `/admin/test-lab` (`force-dynamic`, `requireUser("SUPER_ADMIN")`): status of demo
  data / fixtures / demo mode; Create (link to `/admin/settings/demo`), Prepare,
  Reset (existing confirm); Start as School Head / Teacher / Pending teacher; checklist
  with Open buttons posting to `startTestLabSession` with `next`; localStorage ticks.
- Impersonation banner in a Test Lab session: "Test Lab — demo data", checklist
  drawer for the current role, "Back to Test Lab".
- Demo tags on support/chat/error admin lists for demo-school rows.

## Invariants

| Invariant | Enforced by |
|---|---|
| Test Lab session starts only as a demo account | `assertTestableSchool` + isDemo persona lookup |
| Test-session saves land only in the demo school | existing tenancy checks |
| Test mode cannot be self-granted | signed session-bound ticket + server isDemo check |
| Dry-run writes nothing | early return; tests assert zero write calls |
| Fixtures never written to a real school | `assertTestableSchool` in prepare |
| Real "sign in as" still works | unchanged path + regression test |
| Checklist covers every page | coverage test |
