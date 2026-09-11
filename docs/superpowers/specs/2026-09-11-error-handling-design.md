# Error handling: one catalog, one handler, honest messages

**Date:** 2026-09-11 · **Status:** Draft for review · **Branch:** `feat/error-handling`

## Decisions already made

| Question | Answer |
|---|---|
| Scope | Slice 1 = the foundation (catalog, `AppError`, handlers, admin reporting, error pages) **plus every auth/login flow**. The other ~30 action modules migrate in later slices, one shippable batch each. |
| Login messages | Specific, with throttling. School Head: "Incorrect password". Teacher: "No teacher account…" / "Incorrect password", with a new per-IP throttle on *failed* lookups. Super Admin: stays generic ("Incorrect username or password"). The exact cause is always logged. |
| Lockout | No new column. "Too many attempts" is the existing rate limiter, now saying how long to wait. Blocked-account states (deactivated, declined, school inactive) get specific messages. |
| Admin detail | A new `ErrorEvent` table + `/admin/errors` Super Admin page + one JSON line per event in Vercel logs + throttled email alerts through Resend. |
| Wrong-role pages | Keep the quiet redirect to the user's own home. The 403 page exists but is reached rarely (see §5). |
| 404 extras | Links to the signed-in user's main pages; "Sign in" for visitors. |
| Approach | **A**: actions throw `AppError`; one wrapper per action converts to a result and reports anything unexpected. |
| Language | English, plain and calm, always saying what to do next. The catalog is one file of plain strings so it can be translated later. |

## Current state (what the review found)

- The app is server-rendered pages and server actions. There's no REST API beyond 3 routes (`/api/schools/list`, `/api/cron/backup`, `/api/admin/backups/download`). Server actions don't pass through middleware, so "one error middleware" is implemented here as an action wrapper, Next's `onRequestError` hook, and the `error.tsx` boundaries.
- ~32 action files each declare their own `ActionResult` (`{ ok: false; error: string }`), 46 components read `.error`, and 52 test assertions in 19 files check those results.
- There's no logger and no Sentry. Errors go to `console.error` → Vercel runtime logs, and `@vercel/otel` handles tracing. `AuditLog` records login outcomes. Resend is installed and its env vars are in `src/lib/env.ts`, but nothing sends mail yet.
- `src/lib/db-errors.ts` already does the right thing for DB failures (classify, reference code, dev-only detail) and gets reused.
- `src/lib/auth/auth-errors.ts` already separates Supabase's rate limit from a wrong password and gets reused.
- "Email not verified" does not exist here: every account is created with `email_confirm: true` and School Heads use synthetic addresses. It is **dropped** from scope.

### Generic or wrong messages where the real cause is known

| Where | Today | Real cause |
|---|---|---|
| School Head login, wrong password (`auth.ts:188`, `login-form.tsx:312`) | "Login failed. Please contact your administrator." | Wrong password: nothing else is possible once the school is picked and the account exists. |
| School Head login, no head account (`auth.ts:161`, `login.ts:103`) | Same sentence | The school has no School Head account (a setup problem). |
| Browser sign-in, network failure (`login-form.tsx:195`) | "Incorrect password" / "Incorrect email or password." | Supabase unreachable. The password was never checked. |
| Login, school row (`auth.ts:113`, `login.ts:99`) | "School not found or inactive" | Two different cases: missing vs turned off. |
| Every app rate limit | "Too many attempts. Please try again later." | Known window. The limiter returns `retryAfterMs`. |
| Password update (`auth.ts:713/811/1008`) | "Failed to update password. Please try again." | Supabase returns `same_password`, `weak_password`, rate limit, or an outage. |
| Email change (`auth.ts:898/918`) | "Failed to update email. Please try again." | Supabase admin API failure vs our DB write failing after the auth change was rolled back. |
| Register (`teacher-registration.ts:166`) | "Registration failed. Please try again." | The DB write failed. |
| `mapSupabaseAuthError` (`auth.ts:83`) | Any message containing "after" becomes "Too many attempts" | Over-broad match that mislabels unrelated errors. |
| Password-reset email (`auth.ts:960`) | Error ignored completely | SMTP/Supabase failure is invisible to everyone. The user must still see "sent" (no enumeration), but admins need the record. |
| Root/role `error.tsx` | "Something went wrong" | Unknown to the client by design (production strips the message). This stays generic, but gains a reference code admins can look up. |

### Security findings

1. **Unmetered teacher email enumeration.** `beginTeacherLogin` / `loginTeacher` answer "No teacher account found for this school", and the limiter key includes the email (`login.ts:177`, `auth.ts:225`), so each guessed address gets a fresh 10 attempts. **Fixed in slice 1** (§4).
2. **Config details shown to anonymous users.** `SUPABASE_NOT_CONFIGURED_MESSAGE` names env vars and Vercel. `auth.ts:652` says "Set DATABASE_URL on Vercel and run migrations/seed". **Fixed in slice 1**: users see `CONFIG_MISSING` with a reference, and admins get the names.
3. **Admin error boundary covers the public `/admin/login`** and mentions Prisma, Vercel, and schema drift. **Fixed in slice 1**: the copy points admins to `/admin/errors` by reference instead.
4. **Cron route returns raw `err.message`** in its 500 JSON (`api/cron/backup/route.ts:72`). Low risk (needs `CRON_SECRET`). **Fixed in slice 1** by the route wrapper.
5. `db-errors.ts` dev detail is gated on `NODE_ENV !== "production"`. Correct: Vercel previews run as production. No change.

## §1 Catalog, `AppError`, result shape

New folder `src/lib/errors/`:

| File | Runtime | Purpose |
|---|---|---|
| `codes.ts` | isomorphic (no imports) | `ERRORS` map: code → `{ status, severity, message }`. `ErrorCode = keyof typeof ERRORS`. `formatMessage(code, params)` fills `{placeholders}`. |
| `app-error.ts` | isomorphic | `class AppError extends Error` with `code`, `status`, `severity`, `params`, `detail` (admin-only), `fieldErrors`, `cause`. `.message` is the formatted **user** message, so an accidental `String(err)` never leaks the admin detail. |
| `result.ts` | isomorphic | Shared `ActionResult<T>`, `ActionFailure`, `ok()`, `failure(appError, ref?)`. |

```ts
export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  error: string;                          // safe user message; name kept so existing `.error` readers work
  ref?: string;                           // only for severity "system"; also appended to `error`
  fieldErrors?: Record<string, string>;   // only for VALIDATION_FAILED
};
export type ActionResult<T = unknown> = { ok: true; data?: T } | ActionFailure;
```

Actions with a custom success shape (`BeginLoginResult`, `FinishLoginResult`, `TeacherRegisterResult`) keep their success member and use `ActionFailure` as the failure member.

**Severity** decides where an error is recorded:

- `user`: expected (wrong password, invalid field). Not recorded in `ErrorEvent`. Login outcomes stay in `AuditLog`.
- `security`: denied access, other-tenant lookups, rate limits. Recorded in `ErrorEvent`.
- `system`: DB, Supabase, config, bugs. Recorded in `ErrorEvent` and eligible for email alerts. The user message always carries `{ref}`.

`AppError` can override severity per throw (e.g. `NOT_FOUND` is `user` by default and `security` when `assertSameSchool` finds another tenant's row). Other-tenant rows and missing rows produce the **same** user message. Only the admin record says which case it was.

Existing message constants (`AUTH_RATE_LIMITED_MESSAGE`, `DECLINED_REGISTRATION_MESSAGE`, `DEACTIVATED_TEACHER_MESSAGE`, the `db-errors.ts` wording, `SUPABASE_NOT_CONFIGURED_MESSAGE` for user-facing use) move into the catalog. The old exports stay as re-exports until nothing imports them, so un-migrated modules keep compiling. `isAuthRateLimitError` and `classifyDbFailure` stay where they are and are called by the classifier.

Input parsing helper (replaces the house-pattern step 2 in migrated code):

```ts
const input = parseInput(changePasswordSchema, formToObj(formData)); // throws AppError VALIDATION_FAILED
```

`VALIDATION_FAILED`'s message is the first Zod issue's message (they're already human: "Email is required"). `fieldErrors` maps each field path to its first message, so `useAppForm` can mark the field later.

## §2 Handlers

### Server actions: `action()` (`src/lib/errors/action.ts`, server-only)

```ts
export const changePasswordAction = action(
  "changePassword",
  async (formData: FormData) => { /* throws AppError; returns ok() */ },
  { verb: "change your password" },   // optional; completes "Couldn't {verb}" in DB messages
);
```

Verified against the installed Next 15.5: `ensureServerEntryExports` only requires each export of a `"use server"` file to be a function, so `export const x = action(...)` is valid.

Behaviour, in order:

1. Run `fn` inside an `AsyncLocalStorage` scope `{ route: name }`. `requireUser` writes the verified `userId`/`schoolId`/`role` into that scope when one is active.
2. On throw, **`unstable_rethrow(err)` first**, so `redirect()`/`notFound()` from `requireUser` and friends keep working exactly as today.
3. Classify (`src/lib/errors/classify.ts`, pure, unit-tested):
   - `AppError` → as-is
   - `ZodError` → `VALIDATION_FAILED`
   - Prisma `P2025` → `NOT_FOUND` (resource "Record")
   - Prisma `P2002` → `DB_CONFLICT`
   - other Prisma errors → `classifyDbFailure` → `DB_SCHEMA_OUT_OF_DATE` / `DB_UNAVAILABLE` / `DB_ERROR`
   - `PrismaClientValidationError` → `INTERNAL_ERROR` (a bug)
   - Supabase `AuthError` → `AUTH_PROVIDER_RATE_LIMITED` if `isAuthRateLimitError`, else `AUTH_PROVIDER_ERROR`
   - missing-env errors (see below) → `CONFIG_MISSING`
   - anything else → `INTERNAL_ERROR`
4. If severity isn't `user`: `reportError(...)` (§3) → returns `ref`.
5. Return `failure(appError, ref)`.

`getServerEnv` and the Supabase client factories throw `AppError("CONFIG_MISSING", { detail: "<var names>" })` instead of a plain `Error`, so classification doesn't depend on message text.

**Transition property.** Un-migrated actions don't use the wrapper. If they throw, Next's `onRequestError` (below) still records the error, so every module gets admin visibility from slice 1 even before its own migration.

### API routes: `route()` (`src/lib/errors/route.ts`)

Same classify + report. The response is `NextResponse.json({ code, message, status, ref? }, { status })`. For a browser navigation (`Accept: text/html`), 401 redirects to the right login and 403 redirects to `/forbidden`. Applied to all 3 routes. The cron route stops returning `err.message`.

### Page and render errors: `onRequestError` (`src/instrumentation.ts`)

```ts
export async function onRequestError(err, request, context) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./lib/errors/report");
  await reportRequestError(err, request, context);
}
```

This records uncaught errors from RSC renders, route handlers, un-migrated actions, and middleware, with `routePath`, `routeType`, and Next's **`digest` as the reference**, which is the same value `error.tsx` receives, so the code a user reads off the screen finds the record. The user is attributed from the Supabase session cookie's JWT `sub`, decoded without verification (attribution only, marked `userSource: "cookie"` in the record, never used for access).

## §3 Admin reporting

### `ErrorEvent` table (additive migration, applied by a human)

```prisma
model ErrorEvent {
  id        String   @id @default(uuid())
  ref       String            // shown to the user; not unique (a Next digest repeats for the same error)
  code      String
  severity  String            // "security" | "system"
  message   String            // admin-facing cause, truncated to 2 KB
  stack     String?           // truncated to 8 KB
  route     String?           // action name or request path
  routeType String?           // action | render | route | middleware
  method    String?
  userId    String?
  schoolId  String?
  context   Json?             // ids and codes only: prisma code, supabase code, digest, userSource, param keys
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([ref])
  @@index([code, createdAt])
  @@index([schoolId, createdAt])
}
```

- Authored by the `database-engineer` agent as `YYYYMMDDNNNNNN_add_error_event`. The table is also added to the `prisma/rls-policies.sql` enable list (`tests/unit/rls-coverage.test.ts` enforces this).
- **Deploy-order safe:** `reportError` catches its own insert failure and falls back to console only, so code deployed before the migration is applied degrades rather than breaks. The table is still meant to be applied first, per the usual process.
- **What is never stored:** request bodies, FormData, passwords, tokens, cookies, emails typed at login, learner field values. `context` is built from an allow-list of keys. Prisma messages can contain values (e.g. a unique-constraint value), which is why the table is Super-Admin-only, RLS deny-all, and purged.
- **Retention:** 30 days (`ERROR_EVENT_RETENTION_DAYS`, default 30). The purge runs as an extra step in the existing daily cron (`/api/cron/backup?kind=daily`), so no new cron entry and no plan-limit risk. A failed purge never fails the backup.

### `reportError()` (`src/lib/errors/report.ts`, server-only, never throws)

1. Generate `ref`: 8 chars of Crockford base32, prefixed `E-` (e.g. `E-7K2P9QXM`). For page errors the Next digest is used instead.
2. `console.error(JSON.stringify({ level, ref, code, route, userId, schoolId, message, stack }))`: one searchable line per event, which works even when the DB is down.
3. Insert the `ErrorEvent` via `after()` (same defer-or-run pattern as `writeAudit`), so nothing is added to the response path.
4. For `system` severity, queue an alert (below).

### `/admin/errors` (Super Admin only)

A server-rendered page mirroring `/admin/audit` (same table components, `force-dynamic`, `requireUser("SUPER_ADMIN")`):

- search by `ref`, filters by code, severity, school, and last 24 h / 7 d / 30 d
- a row opens a detail panel with the message, stack, context, route, and user/school links
- a nav entry next to "Audit" in `src/lib/nav/nav-config.ts`
- `?ref=` deep links, used by the alert email and the admin error boundary

School Heads get no access.

### Email alerts (`src/lib/errors/alert.ts`)

- On when `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and the new `ERROR_ALERT_EMAIL` (comma-separated) are all set. Otherwise silently off, with one console warning per instance, like the rate limiter.
- Only for `system` severity. At most **one email per code per 15 minutes** via `checkRateLimit("alert:<code>")`. Upstash makes that global; without Upstash an occasional duplicate can slip through.
- Body: code, ref, route, school id, time, the first line of the admin message, and a link to `/admin/errors?ref=…`. **No stack trace and no user PII in email.**
- Sent inside `after()`. A Resend failure is console-logged and never retried or thrown.
- This is the first real Resend integration. It adds a tiny `sendEmail()` wrapper in `src/lib/email.ts`.

## §4 Auth slice

Files moved to the new system: `src/lib/actions/auth.ts`, `src/lib/actions/login.ts`, `src/lib/auth/{session,tenant,auth-errors,teacher-registration,teacher-registration-helpers}.ts`, `src/lib/supabase/{env,server,admin}.ts` (config errors), `src/lib/env.ts`, `src/lib/rate-limit.ts` (adds `peekRateLimit`). Components: `login-form.tsx`, `admin-login-form.tsx`, `password-form.tsx`, `change-email-form.tsx`, `forgot-password-form.tsx`, the set-password/reset pages, and `src/app/login/page.tsx` + `src/app/admin/login` (reason notice).

### Sign-in outcomes

| Situation | School Head sees | Teacher sees | Super Admin sees | Recorded |
|---|---|---|---|---|
| Wrong password | `AUTH_INCORRECT_PASSWORD` | `AUTH_INCORRECT_PASSWORD` | `AUTH_INCORRECT_CREDENTIALS` | AuditLog `LOGIN_DENIED reason=incorrect_password` |
| Unknown account | `AUTH_NO_SCHOOL_HEAD_ACCOUNT` | `AUTH_TEACHER_NOT_FOUND` | `AUTH_INCORRECT_CREDENTIALS` | AuditLog (`unknown_account`); SH case also ErrorEvent (`security`, it's a setup gap) |
| App limiter | `AUTH_TOO_MANY_ATTEMPTS` "…in {minutes} min" | same | same | ErrorEvent `security` |
| Supabase limiter | `AUTH_PROVIDER_RATE_LIMITED` | same | same | AuditLog `rate_limited` + ErrorEvent `security` |
| Supabase unreachable (browser) | `AUTH_SERVICE_UNREACHABLE` | same | n/a (server-side grant) | AuditLog `service_unreachable` |
| Teacher deactivated / declined | n/a | `AUTH_ACCOUNT_DEACTIVATED` / `AUTH_REGISTRATION_DECLINED` | n/a | AuditLog (as today) |
| School missing / off | `NOT_FOUND` (School) / `AUTH_SCHOOL_INACTIVE` | same | n/a | none |
| Signed in to Supabase but not an active admin | n/a | n/a | `AUTH_FORBIDDEN` ("This account can't use the admin console.") | AuditLog + ErrorEvent `security` |
| Server misconfigured | `CONFIG_MISSING` + ref | same | same | ErrorEvent `system` + alert |

Browser-grant classification lives in one pure client-safe function, `classifyBrowserSignInError(err)`:

- `invalid_credentials` → wrong password
- rate limit → provider limited
- `AuthRetryableFetchError`, status 0, or 5xx → unreachable
- anything else → `AUTH_PROVIDER_ERROR`

`reportLoginFailure`'s reason allow-list grows to match.

### Teacher enumeration throttle

- A new key, `login:lookup-miss:ip:<ip>`, allows **10 failed teacher lookups per 10 minutes per IP**. It's shared by `beginTeacherLogin`, `loginTeacher`, and `registerTeacher`'s conflict check.
- The limiter is only charged on a **miss**. Before each lookup, `peekRateLimit` (new, read-only) checks the key. Once it's over the limit, **every** lookup from that IP (hit or miss) returns `AUTH_TOO_MANY_ATTEMPTS` until the window clears, so the answer can't be used as an oracle.
- A school computer lab full of teachers typing their correct emails is never blocked, because hits don't count. Only guessing does.
- The IP comes from the first `x-forwarded-for` entry (set by Vercel), falling back to `unknown`.

### Session ended

`requireUser` currently redirects to `/login` with no reason. It will add `?reason=`, taken from an allow-list and mapped to catalog codes:

- `session_expired`: a Supabase auth cookie was present but didn't validate
- `account_disabled`: the user was soft-deleted or inactive
- `declined`: from the existing rejected-teacher redirect

`getCurrentUser` records why it returned null in the per-request `AsyncLocalStorage`/`cache()` holder, and `requireUser` reads it. It still returns `null` exactly as today, so its callers don't change. The login pages show the mapped message as a notice. Unknown `reason` values are ignored, so no text from the URL is ever reflected.

### Account flows

| Flow | New specific outcomes |
|---|---|
| Set / change / reset password | `AUTH_CURRENT_PASSWORD_INCORRECT`, `AUTH_PASSWORD_SAME`, `AUTH_PASSWORD_WEAK` (from Supabase `same_password`/`weak_password`), `AUTH_RESET_LINK_EXPIRED`, `AUTH_PROVIDER_RATE_LIMITED`, else `AUTH_PROVIDER_ERROR` + ref |
| Change email | `AUTH_EMAIL_UNCHANGED`, `AUTH_EMAIL_IN_USE`, `AUTH_CURRENT_PASSWORD_INCORRECT`, `SERVICE_UNAVAILABLE` (admin client missing), `AUTH_PROVIDER_ERROR`, and **`AUTH_EMAIL_PARTIAL_UPDATE`** (`system` + alert) when the rollback also failed and auth and DB now disagree |
| Register | `AUTH_TEACHER_PENDING`, `AUTH_ACCOUNT_EXISTS_SIGN_IN`, `AUTH_EMAIL_IN_USE`, `AUTH_REGISTRATION_DECLINED`, `AUTH_SIGNUPS_DISABLED`, `AUTH_EMAIL_REJECTED`, `AUTH_REGISTERED_SIGN_IN` (created, but the auto sign-in failed), else a DB code + ref |
| Forgot password | The user always sees success (no enumeration, unchanged). A `resetPasswordForEmail` failure is now recorded as `AUTH_EMAIL_SEND_FAILED` (`system`) |

`mapSupabaseAuthError` is replaced by code-based classification (Supabase `error.code`), which removes the over-broad `"after"` match.

## §5 Error pages

All pages match the existing card style (`bg-card`, `shadow-card`, lucide icon in a tinted circle, blue primary; violet stays reserved for ARAL) and use the existing `Button`.

| Page | File(s) | Content |
|---|---|---|
| 404 (root) | `src/app/not-found.tsx` | "Page not found". Home button. If signed in, links to that role's main pages from existing route constants (Teacher: Dashboard, ARAL, Learners; School Head: Dashboard, Learners, Teachers, Reports; Admin: Dashboard, Schools, Audit). If signed out: "Sign in". Reads the user through a new non-redirecting `peekCurrentUser()` so a pending teacher on a 404 isn't bounced. |
| 404 in the app shell | `src/app/{teacher,school-head}/(app)/[...missing]/page.tsx`, `src/app/admin/[...missing]/page.tsx` → `notFound()`, plus a `not-found.tsx` in each group | Unknown URLs **inside** a role area render with the sidebar still visible. Signed-out visitors to `/teacher/anything` still go to login first (layouts auth before the catch-all renders). Catch-alls have the lowest priority, so no existing route is shadowed. |
| 500 | `src/app/error.tsx`, the three role `error.tsx`, **new** `src/app/global-error.tsx` | "This page couldn't load". Reference = digest. Try again + back to the role home. The admin copy links to `/admin/errors?ref=<digest>` instead of mentioning Prisma/Vercel. `global-error.tsx` renders its own `<html><body>` and catches root-layout failures, which today fall back to Next's unstyled page. |
| 403 | `src/app/forbidden/page.tsx` | "You don't have access to this page". Names the signed-in role, with a button to its home. **Reached rarely by design:** you chose to keep the quiet redirects, so only `route()` sends browser navigations here (e.g. an expired admin opening a backup-download link). |

Unknown-route guarantee: an e2e spec (`e2e/not-found.spec.ts`) visits a signed-out unknown root path (404), `/teacher/does-not-exist` signed-out (login redirect), and signed-in (in-shell 404).

## §6 Testing, rollout, docs

**New unit tests** (Vitest, `tests/unit/errors/`):

- **Catalog:** every code has status/severity/message; every `{placeholder}` has a param; every `system` message contains `{ref}`; no message contains "Prisma", "Supabase", "SQL", "Vercel", "env", or a path.
- **Classifier:** Prisma P2002/P2024/P2025/P2021, Validation error, Supabase 429/`invalid_credentials`/`same_password`/`weak_password`, `ZodError`, `CONFIG_MISSING`, unknown.
- **`action()`:** `AppError` → failure; unknown → `INTERNAL_ERROR` + ref + report called; **`redirect()` and `notFound()` rethrown untouched**; `user` severity is not reported.
- **`reportError`:** never throws when the insert throws; writes one JSON console line; builds context only from the allow-list.
- **Alerts:** off without env; one per code per window.
- **Login:** each row of the sign-in table; `classifyBrowserSignInError`; the throttle only counts misses and, once tripped, blocks hits too.
- **`requireUser`:** reason param mapping; unknown reasons ignored.

**Existing tests:** only auth-touching ones change in slice 1: `tests/unit/actions/admin-login.test.ts`, `auth-errors.test.ts`, `db-errors.test.ts` (import paths/messages), `synthetic-email.test.ts` if affected. The other 17 result-asserting files are untouched until their modules migrate. `rls-coverage.test.ts` covers the new table automatically.

**Rollout:**

1. `database-engineer` authors the `ErrorEvent` migration + RLS line.
2. Human applies it to prod (`docs/migrate-checklist.md`).
3. Push `main`.
4. Set `ERROR_ALERT_EMAIL` (and Resend vars if not set) in Vercel.

Local gates before pushing: `prisma generate` → `typecheck` → `lint` → `test` → `build` (CI is billing-locked).

**Docs:**

- `docs/errors.md`: how to add a code, severity rules, the full code table.
- Update the CLAUDE.md house pattern (`action()` + `parseInput` + `throw new AppError`).
- Update the `ActionResult` snippet in `.claude/agents/backend-developer.md`.
- Add a line to `docs/runbook.md` ("a user quotes E-XXXX → /admin/errors?ref=").

**Later slices** (each: migrate modules → update their tests → gates → ship):

1. Tenant-heavy: learner, learner-profile, enrollment, section, teacher, school-year, import/export
2. Grades and attendance: term-grades, attendance, aral, aral-grid, aral-tutors, reading-level, submission-locking
3. Admin: admin-school, school, school-accounts, school-management, database, demo, release
4. Communication: chat, support, assistant, announcement, notifications, reports, search

Domain conflict codes (e.g. `SECTION_NAME_TAKEN`) are added to the catalog in the slice that needs them.

## Planned slice-1 error codes

| Code | HTTP | Severity | User message |
|---|---|---|---|
| `AUTH_INCORRECT_PASSWORD` | 401 | user | Incorrect password. Check it and try again. |
| `AUTH_INCORRECT_CREDENTIALS` | 401 | user | Incorrect username or password. |
| `AUTH_TEACHER_NOT_FOUND` | 404 | user | No teacher account uses this email at the selected school. Check the email and school, or create an account. |
| `AUTH_NO_SCHOOL_HEAD_ACCOUNT` | 404 | security | This school doesn't have a School Head account yet. Contact your division office to set one up. |
| `AUTH_SCHOOL_INACTIVE` | 403 | user | This school's LITRACK access is turned off. Contact your division office. |
| `AUTH_TOO_MANY_ATTEMPTS` | 429 | security | Too many attempts. Try again in {minutes} minutes. |
| `AUTH_PROVIDER_RATE_LIMITED` | 429 | security | Too many sign-in attempts right now. Wait about five minutes and try again. Your password hasn't changed, so there's no need to reset it. |
| `AUTH_SERVICE_UNREACHABLE` | 503 | user | Couldn't reach the sign-in service. Check your internet connection and try again. |
| `AUTH_PROVIDER_ERROR` | 502 | system | The sign-in service couldn't finish this request. Try again in a few minutes. Reference: {ref} |
| `AUTH_ACCOUNT_DEACTIVATED` | 403 | user | Your account has been deactivated. Contact your School Head. |
| `AUTH_REGISTRATION_DECLINED` | 403 | user | Your registration was declined. Contact your School Head. |
| `AUTH_TEACHER_PENDING` | 409 | user | Your request is waiting for School Head approval. |
| `AUTH_ACCOUNT_DISABLED` | 403 | user | This account has been turned off. Contact your division office. |
| `AUTH_SESSION_EXPIRED` | 401 | user | Your session ended. Sign in again to continue. |
| `AUTH_NOT_SIGNED_IN` | 401 | user | Sign in to continue. |
| `AUTH_FORBIDDEN` | 403 | security | You don't have access to this. |
| `AUTH_RESET_LINK_EXPIRED` | 401 | user | This reset link has expired or was already used. Request a new one. |
| `AUTH_CURRENT_PASSWORD_INCORRECT` | 401 | user | Your current password is incorrect. |
| `AUTH_PASSWORD_SAME` | 422 | user | Your new password must be different from your current one. |
| `AUTH_PASSWORD_WEAK` | 422 | user | That password is too easy to guess. Use a longer one with a mix of letters and numbers. |
| `AUTH_EMAIL_UNCHANGED` | 422 | user | The new email is the same as your current one. |
| `AUTH_EMAIL_IN_USE` | 409 | user | That email is already used by another LITRACK account. |
| `AUTH_ACCOUNT_EXISTS_SIGN_IN` | 409 | user | That email already has an account. Sign in instead, or use Forgot password to reset it. |
| `AUTH_REGISTERED_SIGN_IN` | 409 | user | Your account was created. Sign in with your email and password. |
| `AUTH_SIGNUPS_DISABLED` | 503 | system | New accounts can't be created right now. Contact your School Head. Reference: {ref} |
| `AUTH_EMAIL_REJECTED` | 422 | user | That email address was rejected. Check it and try again. |
| `AUTH_EMAIL_SEND_FAILED` | 503 | system | We couldn't send the email right now. Try again in a few minutes. Reference: {ref} |
| `AUTH_EMAIL_PARTIAL_UPDATE` | 500 | system | Your sign-in email changed but LITRACK couldn't save it. Don't try again yet. Give your administrator this reference: {ref} |
| `VALIDATION_FAILED` | 422 | user | {message} (the first field problem, e.g. "Email is required") |
| `NOT_FOUND` | 404 | user (security when cross-tenant) | {resource} not found. It may have been deleted or moved. |
| `DB_CONFLICT` | 409 | system | This conflicts with a record that already exists. Refresh the page and check before trying again. Reference: {ref} |
| `DB_SCHEMA_OUT_OF_DATE` | 503 | system | Couldn't {verb}: the database is missing an update this version of LITRACK needs. Trying again won't help. Give your administrator this reference: {ref} |
| `DB_UNAVAILABLE` | 503 | system | Couldn't {verb}: the database didn't respond in time. Wait a few seconds and try again. Reference: {ref} |
| `DB_ERROR` | 500 | system | Couldn't {verb}: the database rejected the change. Try again, and if it keeps failing give your administrator this reference: {ref} |
| `SERVICE_UNAVAILABLE` | 503 | system | {service} isn't responding right now. Try again in a few minutes. Reference: {ref} |
| `CONFIG_MISSING` | 503 | system | This part of LITRACK isn't set up on the server yet. Give your administrator this reference: {ref} |
| `INTERNAL_ERROR` | 500 | system | An unexpected error stopped this from finishing. Try again, and if it keeps happening give your administrator this reference: {ref} |

`{verb}` defaults to "finish that" when an action doesn't pass one.

## Risks

- **`AsyncLocalStorage` + `cache()` in server actions:** if React `cache()` doesn't memoize inside actions, the session-reason holder falls back to ALS, which the wrapper always sets. A unit test pins both paths.
- **Unverified JWT decode for page-error attribution** could mis-attribute a forged cookie. Acceptable: it's a label in an admin-only log, never an access decision, and it's marked `userSource: "cookie"`.
- **Next digest repeats** for identical errors, so `ref` isn't unique for page errors. That's intended: searching a digest shows every occurrence.
- **Without Upstash,** alert throttling and the lookup throttle are per-instance (the same limitation the existing limiter already documents).
