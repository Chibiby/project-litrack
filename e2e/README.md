# E2E tests

Playwright, opt-in (`playwright.config.ts` has no `webServer`): start `npm run dev`
yourself, or set `PLAYWRIGHT_BASE_URL`, before `npm run test:e2e`. **Never point
this suite at production** — every spec calls `assertNotProduction()` from
`e2e/helpers/e2e-env.ts`, which throws if `PLAYWRIGHT_BASE_URL` contains
`arallitrack.com`.

Every spec skips cleanly (`test.skip` with a reason) when the env vars or the
persona session file it needs are missing, rather than failing. Run
`npx playwright test --list` to confirm specs are collected without a server.

## Sessions

Some specs need to be signed in as a demo persona. Two scripts under
`e2e/auth/` manage that without ever handling a real password inside a spec:

```powershell
node e2e/auth/login.mjs             # signs in as Super Admin, saves e2e/.auth/super-admin.json
node e2e/auth/persona.mjs head      # derives a School Head session -> e2e/.auth/head.json
node e2e/auth/persona.mjs teacher   # -> e2e/.auth/teacher.json
node e2e/auth/persona.mjs district  # -> e2e/.auth/district.json (a real district admin)
```

`login.mjs` needs `LITRACK_E2E_USER` / `LITRACK_E2E_PASS` in `.env.e2e` at the
repo root (gitignored). Persona sessions expire after about two hours (an
impersonation ticket) — re-run before a check that needs one.

Specs that need a persona set `test.use({ storageState: ... })` to the saved
file when present and otherwise fall back to an unauthenticated context; the
per-test `skipReason()` check (see below) is what actually skips the test when
the file is absent, so a missing session never shows up as a false "not found"
or a redirect-to-login being misread as a pass.

## Shared helpers (`e2e/helpers/e2e-env.ts`)

- `assertNotProduction()` — call once per spec file (`test.beforeAll`).
- `hasPersonaSession(persona)` / `personaStatePath(persona)` — session file
  presence and path, for `test.use({ storageState })`.
- `missingEnv(names)` / `skipReason({ envNames, persona })` — env + session
  preconditions in one call, for `test.skip(!!reason, reason)`.
- `shouldRunAgainstServer()` — true when `PLAYWRIGHT_BASE_URL` is set or a
  local server answers on `:3000` (the existing opt-in gate, reused).

## Specs and their env vars

| Spec | Covers | Persona | Env vars |
|---|---|---|---|
| `tenancy-isolation.spec.ts` | Cross-tenant 404s: teacher → another school's learner/ARAL grade; School Head's own pages ignore a foreign `?schoolId=`; district admin → out-of-scope school | teacher, head, district | `LITRACK_E2E_OTHER_SCHOOL_LEARNER_GRADE_ID`, `LITRACK_E2E_OTHER_SCHOOL_LEARNER_ID`, `LITRACK_E2E_OTHER_SCHOOL_GRADE_ID`, `LITRACK_E2E_OTHER_SCHOOL_ID`, `LITRACK_E2E_OUTSIDE_DISTRICT_SCHOOL_ID` |
| `aral-weekly-attendance.spec.ts` | Set a day to Present, save, reload, value persisted | teacher | `LITRACK_E2E_ARAL_GRADE_ID` |
| `learner-import.spec.ts` | CSV import: a valid file commits both rows; a mixed file reports invalid rows and imports only the valid one (partial commit) | teacher | `LITRACK_E2E_IMPORT_GRADE_ID` |
| `learner-transfer.spec.ts` | Transfer a learner to Floating within the same school | head | `LITRACK_E2E_TRANSFER_LEARNER_QUERY` |
| `tablet-viewport-smoke.spec.ts` | 768x1024 and 1024x768: no page-level horizontal overflow; buttons ≥44px tall below 1024px width, on the teacher dashboard, ARAL grid, and learner list | teacher | `LITRACK_E2E_ARAL_GRADE_ID` |
| `not-found.spec.ts` (existing) | Public/role 404 and /forbidden pages | none | — |
| `school-head-login.spec.ts` (existing) | District/School Name picker on `/login` | none | — |
| `smoke.spec.ts` (existing) | Login/admin-login/forgot-password pages render | none | — |

Full list of env vars this suite reads, beyond the existing `LITRACK_E2E_USER` /
`LITRACK_E2E_PASS` / `LITRACK_E2E_BASE_URL` / `LITRACK_E2E_ALLOW_REMOTE` /
`PLAYWRIGHT_BASE_URL` (see `e2e/auth/shared.mjs`):

- `LITRACK_E2E_OTHER_SCHOOL_GRADE_ID` — a `GradeLevel` id belonging to a
  school other than the "teacher" persona's own school.
- `LITRACK_E2E_OTHER_SCHOOL_LEARNER_ID` / `LITRACK_E2E_OTHER_SCHOOL_LEARNER_GRADE_ID` —
  a `Learner` id and its grade id, both in that other school.
- `LITRACK_E2E_OTHER_SCHOOL_ID` — a `School` id other than the "head"
  persona's own school.
- `LITRACK_E2E_OUTSIDE_DISTRICT_SCHOOL_ID` — a `School` id outside the
  "district" persona's district/division scope.
- `LITRACK_E2E_ARAL_GRADE_ID` — a `GradeLevel` id with ARAL learners, reachable
  by the "teacher" persona at `/teacher/aral/<id>/attendance`.
- `LITRACK_E2E_IMPORT_GRADE_ID` — a `GradeLevel` id the "teacher" persona
  advises, for the import wizard.
- `LITRACK_E2E_TRANSFER_LEARNER_QUERY` — a name substring that resolves to one
  disposable test learner in the "head" persona's own school.

**Mutating tests** (`aral-weekly-attendance`, `learner-import`,
`learner-transfer`) write real rows against whatever ids/queries you point
them at. Use disposable grades/learners in seeded or Test Lab demo data, never
a roster anyone is tracking. None of them clean up after themselves.

## Fixtures

`e2e/fixtures/learner-import-valid.csv` — two well-formed rows, headers matching
`LEARNER_CSV_HEADERS` (`src/lib/learners/import-csv.ts`).

`e2e/fixtures/learner-import-mixed.csv` — one valid row plus two malformed ones
(an unrecognized `gender` enum value, a missing `age`), to exercise
per-row error reporting and the "valid rows commit, invalid rows are skipped"
partial-commit behaviour.
