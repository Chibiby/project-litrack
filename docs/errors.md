# Error handling

How LITRACK turns a thrown error into a safe message for the user and a full
record for admins. Covers `src/lib/errors/**`, the `/admin/errors` log, and
the env vars that turn on alert email.

## The three severities

Every code in the catalog (`src/lib/errors/codes.ts`) has a severity, and the
severity — not the message — decides what happens when the error fires.

| Severity | Meaning | Recorded in `ErrorEvent`? | Reference shown? | Alert email? |
|---|---|---|---|---|
| `user` | An expected mistake the person can fix themselves (wrong password, a field left blank, a link that expired). | No — sign-in outcomes still go to `AuditLog` separately. | No. | No. |
| `security` | A refusal: access denied, a rate limit, a request for another school's row. | Yes. | No — the person can't act on a reference for something that was correctly refused, and showing one would read as an invitation to argue the refusal. | No. |
| `system` | Something on our side failed (database, Supabase, config, a bug). | Yes. | Yes — `E-XXXXXXXX`, appended to the message. | Yes, subject to the throttle below. |

`AppError` lets a throw site override the catalog's default severity (for
example `resourceNotFound(resource, { crossTenant: true })` upgrades a plain
`NOT_FOUND` to `security` when the row belongs to another school — see
`src/lib/auth/tenant.ts`'s `assertSameSchool`). Don't change severity casually;
it changes what gets recorded and whether the person sees a reference.

## Adding a new code

1. **Add the entry to the catalog** — `src/lib/errors/codes.ts`. Give it a
   `status`, a `severity`, and a `message` written for the person who'll read
   it (plain English, says what to do next). Use `{placeholder}` tokens for
   anything filled in at the throw site (`{verb}`, `{resource}`, `{wait}`,
   `{what}`, `{service}`, `{message}`) — every placeholder has a fallback in
   `DEFAULT_PARAMS` so a throw site that forgets to supply one still reads as
   a sentence, not `{resource} not found`.
2. **Throw it from the site that knows the cause**, inside code wrapped by
   `action()` or `route()`:
   ```ts
   throw new AppError("SECTION_NAME_TAKEN", { detail: `section ${name} already exists in grade ${gradeId}` });
   ```
   `detail` is for admins only — it's never sent to the browser. Use the
   `resourceNotFound`, `tooManyAttempts`, and `fieldError` helpers in
   `src/lib/errors/app-error.ts` for the common shapes instead of constructing
   `AppError` by hand.
3. **Write a test** that asserts the thrown code (or the resulting
   `ActionFailure.code`), not just the message string — messages are allowed
   to be edited for tone without breaking a test that only checks wording.

`codes.ts` has no imports, so the same file runs in the browser (the login
form classifies certain Supabase errors client-side) and on the server.

## The `action()` / `route()` pattern

Server actions and API routes each get one wrapper that turns a thrown
`AppError` (or anything else — Prisma, Supabase, a bug) into a safe result,
instead of each call site building its own try/catch.

```ts
export const doThing = action("doThing", async (formData: FormData) => {
  const user = await requireSchoolUser("TEACHER");            // 1. auth guard first
  const input = parseInput(someSchema, formToObj(formData));  // 2. throws VALIDATION_FAILED
  assertSameSchool(user.schoolId, row.schoolId, "Learner");   // 3. throws NOT_FOUND
  // 4. mutate (prisma.$transaction when multi-step)
  // 5. writeAudit({ action: AUDIT_ACTIONS.X, ... })
  // 6. revalidatePath / revalidate* helper
  return { ok: true };
}, { verb: "save the thing" });
```

What `action()` (`src/lib/errors/action.ts`) does on a throw:

1. Calls `unstable_rethrow` first, so `redirect()` and `notFound()` — which
   work by throwing — pass straight through instead of being caught here.
2. Classifies anything else into an `AppError` (`classifyError`): Prisma
   errors by name/code, Zod errors, Supabase auth errors, and everything
   unrecognized becomes `INTERNAL_ERROR`.
3. A `user` severity error is returned as `{ ok: false, code, error }` and
   never recorded.
4. `security` and `system` errors are recorded via `reportError`. Only
   `system` errors get a reference back (`ref`) — a `security` refusal is
   recorded for admins but the person sees no ref.

`route()` (`src/lib/errors/route.ts`) is the same shape for API routes, with
two differences: it returns `{ code, message, status, ref? }` JSON (server
actions always answer HTTP 200, so they carry `code` instead of `status`),
and a browser navigation that hits a 401/403 gets redirected to `/login` (or
`/admin/login` under `/api/admin`) or `/forbidden` instead of JSON.

The `{ verb }` option completes "Couldn't {verb}: …" in the database-failure
messages (`DB_ERROR`, `DB_UNAVAILABLE`, `DB_SCHEMA_OUT_OF_DATE`) — pass a
short phrase like `"save the section"`.

`ActionFailure` (`src/lib/errors/result.ts`) keeps the field name `error` for
the safe message, on purpose: dozens of components already do
`toast.error(res.error)`, and this keeps them working without an edit.
`fieldErrors` (field path → message) is present whenever the thrown `AppError`
carries it: always for `VALIDATION_FAILED`, and for any throw made with the
`fieldError` helper or an explicit `fieldErrors` option (`toFailure` in
`result.ts` copies it across).

### Field errors on sign-in codes

Some sign-in failures name the input they belong to, so the form can highlight
it (`errorOnFields` in `src/lib/actions/auth.ts`; `teacherNotFound` in
`src/lib/actions/login.ts`):

| Code | `fieldErrors` key(s) |
|---|---|
| `AUTH_TEACHER_NOT_FOUND` | `email` |
| `AUTH_INCORRECT_PASSWORD` (School Head and teacher sign-in) | `password` |
| `AUTH_INCORRECT_CREDENTIALS` (Super Admin and district admin sign-in) | `username` and `password`, both carrying the same single message, so the form never reveals whether the username exists |
| `AUTH_CURRENT_PASSWORD_INCORRECT` (change password / change email) | `currentPassword` |

### The `needs` field

A result that stopped to ask for a follow-up decision, rather than failing,
carries a machine flag `needs` next to the readable `error` sentence. The form
reads `needs`, asks, and resubmits. Two exist today:

- `possible_duplicate` — `createLearner` (`src/lib/actions/learner.ts`), when a
  learner with the same name and age may already exist; the result also carries
  `data`.
- `confirm_release` — `setTeacherAdvisorySetting`
  (`src/lib/actions/teacher.ts`), when a change would release advisory sections;
  the result also carries `releases`.

These are typed on the action's own result (`learner.ts`, `AdvisorySettingResult`),
not on `ActionFailure`.

`logoutAction` (`src/lib/actions/auth.ts`) is deliberately **not** wrapped —
it's passed straight to `<form action={logoutAction}>`, which requires
`Promise<void>`, and a form action can't read a returned result anyway.
Anything that escapes it is still caught by the page-crash handler
(`onRequestError`, see below).

Every exported server action in `src/lib/actions/*.ts` is wrapped by
`action()` except these, each unwrapped on purpose:

| Export | File | Why |
|---|---|---|
| `logoutAction` | `auth.ts` | `<form action>` target, must return `Promise<void>` (above). |
| `recordTeacherPresence` | `presence.ts` | 60-second heartbeat; a transient database hiccup is routine there, and wrapping would file an `ErrorEvent` (and possibly an alert email) for each. It swallows failures and lets the next heartbeat retry. |
| `fetchAralAssignmentAlerts`, `fetchUnlockAlerts` | `notifications.ts` | The client uses the resolved value as the alert array itself; a failed read degrades to "no alert" by design. |
| `listMyBroadcasts` | `district-announcements.ts` | A read helper called from a server component (`src/app/district/announcements/page.tsx`), not from the client. |
| `listSchoolsPublic` | `school.ts` | A read helper called from a route handler (`src/app/api/schools/list/route.ts`). |
| `listSchoolsWithTeacherStatus` | `school.ts` | A read helper called from a server component (`src/app/login/page.tsx`). |

The source comments state the reason for `logoutAction`, `recordTeacherPresence`
and the two `notifications.ts` reads. For the last three, the reason above is
inferred from their callers, not written down at the definition.

## What must never reach `ErrorEvent` or an alert email

`reportError` (`src/lib/errors/report.ts`) only stores context keys on an
allow-list — `ERROR_CONTEXT_KEYS` — so a throw site that accidentally attaches
an email address or a password on `context` can't leak it into the table.
Allowed keys: `prismaCode`, `prismaError`, `supabaseCode`, `supabaseStatus`,
`retryAfterSeconds`, `resource`, `crossTenant`, `reason`, `schoolId`,
`digest`, `userSource`, `service`. Anything else a thrower puts on
`context` is silently dropped before the row is written.

The `detail` and `stack` fields *are* stored in full (truncated to 2000 and
8000 characters) — they're meant for admins reading `/admin/errors`, which is
Super Admin only and RLS deny-all. Even so, never put a password, token,
invite secret, or activation credential into `detail` or a thrown error's
`cause` message — write the resource id or a short description instead, the
same rule as `writeAudit()` metadata.

Alert email (`src/lib/errors/alert.ts`) is stricter: the message body carries
only the code, reference, timestamp, route, school id, and a truncated
first-line summary — no stack trace, no user id, no email, no request body.
The reference links to the full record on `/admin/errors`, which is the only
place any of that detail is shown.

## How an admin uses a reference (`E-XXXXXXXX`)

A `system` error shows the person a line like:

> An unexpected error stopped this from finishing. … Reference: E-7K2P9QXM

To look it up:

- Go to `/admin/errors?ref=E-7K2P9QXM` (Super Admin only). The page filters to
  that one event and shows its code, severity, route, school, admin message,
  stack (if any), and user id inside an expandable **Details** section.
- If nothing matches (the row was purged, or the migration wasn't applied
  when the event fired), search the platform logs (Workers Logs in production)
  for the reference — every recorded event is also written as one JSON line
  tagged `"tag": "litrack.error"` (see `logLine` in `report.ts`), and that line
  is written *before* the database insert, so it survives even a database
  outage or a missing table.

A page crash (one that reaches Next's `error.tsx`) uses **Next's own digest
string as the reference** — the same value `error.tsx` displays — rather than
generating a separate one, via `onRequestError`
(`src/lib/errors/request-error.ts`, wired in `src/instrumentation.ts`). On
Node (local, Vercel) that reference resolves on `/admin/errors` like any other.
**On Cloudflare it does not**: `onRequestError` in `src/instrumentation.ts`
returns after a `console.error("[request-error]", …)` when
`LITRACK_DEPLOY_TARGET === "cloudflare"`, so a page-crash reference is found in
Workers Logs, not in `/admin/errors`. Errors caught by `action()` and `route()`
are still recorded to `ErrorEvent` on every target.

## The client side

Some failures never produce a result from the server: the device is offline, a
deploy outdated the page, the connection dropped, an action crashed. The
browser-side pieces turn those into the same `ActionFailure` shape, so a
component has one branch to handle.

- **`classifyClientFailure(err, opts?)`** (`src/lib/errors/client.ts`) — turns
  anything thrown by a request into a safe `ActionFailure`. Isomorphic, no
  React. Order: offline (`navigator.onLine === false`) → `NETWORK_OFFLINE`;
  unrecognized-action error, `ChunkLoadError` or a chunk-load message →
  `APP_UPDATED`; a `TypeError` with a fetch-failure message →
  `SERVER_UNREACHABLE`; an error with a `digest` → `DB_UNAVAILABLE` for a
  `DBU-` prefix, `DB_SCHEMA_OUT_OF_DATE` for `DBS-`, `REQUEST_TOO_LARGE` for a
  digest ending `@E394` (best effort), otherwise `INTERNAL_ERROR` with the
  digest as `ref`; Next's "An unexpected response was received from the
  server." → `SERVER_UNREACHABLE`; anything else → `INTERNAL_ERROR`. Raw error
  text is never passed through.
  - `trustDigestWhenOffline: true` skips the offline shortcut when the error
    carries a digest, because a digest proves the server answered. `RouteError`
    passes it, since it renders an error already received.
- **`isNextControlFlow(err)`** — true for `redirect()` (`NEXT_REDIRECT;replace|push`)
  and 401/403/404 `NEXT_HTTP_ERROR_FALLBACK` digests. A `redirect()` inside an
  action rejects the client promise after the router already navigated, so
  check this first and rethrow or ignore; never classify or toast it.
- **`isActionFailure(value)`** — `{ ok: false, error: string }`; `code` is
  optional so old-shape results still match.
- **`callAction(run)`** (`src/lib/ui/call-action.ts`) — runs a server action
  and never rejects, except for Next control flow, which it rethrows. When the
  browser reports offline it answers `NETWORK_OFFLINE` without sending the
  request. It does not toast; the caller toasts `res.error`.
- **`toastFailure(failure, opts?)`, `ToastedError`, `failureForRejection(err)`**
  (`src/lib/ui/toast-failure.ts`) — `toastFailure` shows the error toast;
  `NETWORK_OFFLINE`, `SERVER_UNREACHABLE`, `APP_UPDATED` and `DB_UNAVAILABLE`
  use the code as the toast id so repeated attempts replace one toast, and
  `APP_UPDATED` adds a "Reload page" action. `ToastedError` is thrown after the
  person has already been told. `failureForRejection` returns `null` for a
  `ToastedError` or control flow (show nothing) and a classified failure for
  everything else, including a plain `Error`.
- **`runOptimistic` / `settleActionResult`** (`src/lib/ui/optimistic.ts`) —
  `runOptimistic` runs the work in a transition; a rejection other than control
  flow or `ToastedError` is toasted once and rethrown as `ToastedError`.
  `settleActionResult` toasts a failed result and throws `ToastedError`, or
  toasts the success message.
- **`ConfirmAction`** (`src/components/confirm-action.tsx`) — if `onConfirm`
  resolves to an `ActionFailure` it toasts it and keeps the dialog open. A
  rejection is also toasted (unless `ToastedError` or control flow) and keeps
  the dialog open; success closes it.
- **`OfflineBanner`** (`src/components/errors/offline-banner.tsx`) — a
  persistent bottom notice while `navigator.onLine` is false, and a "You're
  back online." toast when it returns. Mounted in `src/app/layout.tsx`.
- **`ClientErrorListener`** (`src/components/errors/client-error-listener.tsx`)
  — a `window` `unhandledrejection` safety net, also mounted in the root layout.
  It toasts only offline, unreachable, app-updated, database, and too-large
  failures, or anything carrying a digest, and skips control flow,
  `ToastedError` and `AbortError`. Call sites should not rely on it.
- **`RouteError`** (`src/components/errors/route-error.tsx`) — the body of
  every route `error.tsx`. It classifies the error and picks a variant:
  offline (no button; retries by itself when the browser fires `online`),
  unreachable, app updated ("Reload page"), too large, database unavailable and
  schema out of date (both show the digest as the reference), or the generic
  "This page couldn't load". Only variants with `showReference` display the
  reference. An `AbortError` (a cancelled soft navigation) calls `reset()` and
  renders nothing.
  - `retry` re-fetches from the server and re-renders (Next 16.3's stable prop).
    `reset` only clears the boundary state and re-renders the same failed
    payload, so it cannot recover a server failure. `RouteError` uses `retry`
    for its buttons and `reset` only for the abort case.

**Rule for new client code:** call server actions through `callAction`, or go
through `runOptimistic` / `ConfirmAction`, so the failure paths above are
handled. If you show a toast yourself and then need to abort an outer handler,
throw `ToastedError` so nothing toasts twice.

## Database failures and page digests

`src/lib/db-errors.ts` decides what a caught database error means.
`classifyDbFailure(err)` returns one of:

| Kind | Meaning | Becomes (in `classifyError`) |
|---|---|---|
| `UNAVAILABLE` | Connection refused/closed, socket timeout, too many connections, statement timeout, admin shutdown, pool checkout timeout, transaction start/expiry timeout (P2028) | `DB_UNAVAILABLE` |
| `SCHEMA_OUT_OF_DATE` | A table, column or enum value the code expects is missing (P2021, P2022, P2011, SQLSTATE 42P01/42703/42704/23502, "invalid input value for enum") | `DB_SCHEMA_OUT_OF_DATE` |
| `CONFIG` | Bad credentials, missing database, access denied (P1000, P1003, P1010, 28xxx, 3D000, Supavisor "tenant or user not found") | `CONFIG_MISSING` |
| `UNKNOWN` | Anything else | `DB_ERROR` |

`classifyError` (`src/lib/errors/classify.ts`) handles P2025 (`NOT_FOUND`) and
P2002 (`DB_CONFLICT`) before consulting the kind.

What the Prisma 6 client engine with `@prisma/adapter-pg` actually surfaces
(from the comments in `db-errors.ts`): the adapter wraps pg failures in a
`DriverAdapterError` whose `cause` has a `kind` and, for Postgres errors, the
SQLSTATE as `originalCode`. Some kinds map to P-codes and keep the adapter
error at `meta.driverAdapterError`; a "postgres" kind with no dedicated code
reaches the caller as the raw `DriverAdapterError`; `$queryRaw` failures always
become P2010; and a pg error the adapter does not recognize ("Connection
terminated unexpectedly", "timeout exceeded when trying to connect", Workers'
"Network connection lost.") is rethrown as a plain `Error`. P2024 is in the
unavailable list only for safety; the code comment says the client engine does
not raise it. The classifier therefore reads `kind`, SQLSTATE and message
signatures, and reads message text only to classify, never to return.

**`markDbError` and the digest.** `src/lib/prisma.ts` wraps the client in
`withDbErrorMarking`, a query extension (`$allOperations`) that passes every
failure through `markDbError`; `$transaction` is wrapped separately
(`markTransactionFailures`), and an error thrown by an interactive transaction's
own callback is rethrown unmarked. `markDbError` does two things:

1. Stamps a non-enumerable provenance mark, so later layers know the error came
   from a query (needed to tell a pg-pool timeout from a Supabase or `fetch`
   failure that reads the same).
2. For an outage or stale schema, sets `digest` to `DBU-XXXXXXXX` or
   `DBS-XXXXXXXX` (8 characters, the same body as an `E-` reference), unless the
   error already has a digest. It never puts error text in it.

Next keeps a digest already on a thrown error, so a page render that dies on it
reaches the browser with that string instead of an opaque hash.
`classifyClientFailure` reads the prefix, so `RouteError` can say "The database
isn't responding" or "LITRACK needs a database update" and show the digest as
the reference; `onRequestError` files the `ErrorEvent` under the same string
(subject to the Cloudflare limitation above).

`loadUserByAuthId` in `src/lib/auth/session.ts` retries once, after 75 ms, when
`classifyDbFailure` says `UNAVAILABLE`.

## Retention

`ErrorEvent` rows are purged after `ERROR_EVENT_RETENTION_DAYS` days
(default 30 — see `errorRetentionDays()` in `src/lib/errors/retention.ts`).
The purge runs as part of the daily backup cron
(`src/app/api/cron/backup/route.ts`), not on its own schedule — it rides
along with that existing job rather than spending another entry from the
plan's cron allowance. A failed purge is logged and does not fail the cron
run.

## Env vars

| Var | Required? | Effect |
|---|---|---|
| `ERROR_ALERT_EMAIL` | Optional | Comma-separated recipient list. Alert emails stay off until this is set (and the two Resend vars below are configured). |
| `RESEND_API_KEY` | Required for alerts | Also used for invite/recovery email. Without it, `isEmailConfigured()` is false and alerts no-op with a one-time console warning. |
| `RESEND_FROM_EMAIL` | Required for alerts | Same as above. |
| `ERROR_EVENT_RETENTION_DAYS` | Optional | Days to keep `ErrorEvent` rows. Defaults to 30 if unset, non-numeric, or less than 1. |

All four are documented with placeholder defaults in `.env.example`. At most
one alert email is sent per error code per 15 minutes
(`ALERT_WINDOW` in `alert.ts`), so a sustained outage producing hundreds of
identical events sends one email, not hundreds.

## The full code table (52 codes)

Generated from `src/lib/errors/codes.ts` — that file is the source of truth;
if this table and the code ever disagree, trust the code.

| Code | HTTP | Severity | User message |
|---|---|---|---|
| `AUTH_INCORRECT_PASSWORD` | 401 | user | Incorrect password. Check it and try again. |
| `AUTH_INCORRECT_CREDENTIALS` | 401 | user | Incorrect username or password. *(admin sign-in: Super Admin and district admins)* |
| `AUTH_TEACHER_NOT_FOUND` | 404 | user | No teacher account uses this email at the selected school. Check the email and school, or create an account. |
| `AUTH_NO_SCHOOL_HEAD_ACCOUNT` | 404 | security | This school doesn't have a School Head account yet. Contact your division office to set one up. |
| `AUTH_SCHOOL_INACTIVE` | 403 | user | This school's LITRACK access is turned off. Contact your division office. |
| `AUTH_TOO_MANY_ATTEMPTS` | 429 | security | Too many attempts. Try again in {wait}. |
| `AUTH_PROVIDER_RATE_LIMITED` | 429 | security | Too many sign-in attempts right now. Wait about five minutes and try again — your password has not changed, so there is no need to reset it. |
| `AUTH_SERVICE_UNREACHABLE` | 503 | user | Couldn't reach the sign-in service. Check your internet connection and try again. |
| `AUTH_PROVIDER_ERROR` | 502 | system | The sign-in service couldn't finish this request. Try again in a few minutes. |
| `AUTH_ACCOUNT_DEACTIVATED` | 403 | user | Your account has been deactivated. Contact your School Head. |
| `AUTH_REGISTRATION_DECLINED` | 403 | user | Your registration was declined. Contact your School Head. |
| `AUTH_TEACHER_PENDING` | 409 | user | Your request is pending School Head approval. |
| `AUTH_ACCOUNT_DISABLED` | 403 | user | This account has been turned off. Contact your division office. |
| `AUTH_SESSION_EXPIRED` | 401 | user | Your session ended. Sign in again to continue. |
| `AUTH_NOT_SIGNED_IN` | 401 | user | Sign in to continue. |
| `AUTH_FORBIDDEN` | 403 | security | You don't have access to {what}. |
| `AUTH_RESET_LINK_EXPIRED` | 401 | user | This reset link has expired or was already used. Request a new one. |
| `AUTH_CURRENT_PASSWORD_INCORRECT` | 401 | user | Your current password is incorrect. |
| `AUTH_PASSWORD_SAME` | 422 | user | Your new password must be different from your current one. |
| `AUTH_PASSWORD_WEAK` | 422 | user | That password is too easy to guess. Use a longer one with a mix of letters and numbers. |
| `AUTH_EMAIL_UNCHANGED` | 422 | user | The new email is the same as your current one. |
| `AUTH_EMAIL_IN_USE` | 409 | user | That email is already used by another LITRACK account. |
| `AUTH_ACCOUNT_EXISTS_SIGN_IN` | 409 | user | That email already has an account. Sign in instead, or use Forgot password to reset it. |
| `AUTH_REGISTERED_SIGN_IN` | 409 | user | Your account was created. Sign in with your email and password. |
| `AUTH_SIGNUPS_DISABLED` | 503 | system | New accounts can't be created right now. Contact your School Head. |
| `AUTH_EMAIL_REJECTED` | 422 | user | That email address was rejected. Check it and try again. |
| `AUTH_EMAIL_SEND_FAILED` | 503 | system | We couldn't send the email right now. Try again in a few minutes. |
| `AUTH_EMAIL_PARTIAL_UPDATE` | 500 | system | Your sign-in email changed but LITRACK couldn't save it. Don't try again yet — contact your administrator. |
| `ADMIN_IMPERSONATE_INACTIVE` | 409 | user | This account is switched off, so signing in as it would end your own session with no way back. Turn the account back on first, then sign in as it. |
| `TEST_LAB_NOT_PREPARED` | 409 | user | The test account isn't ready yet. Prepare test data on the Test Lab page, then try again. |
| `SCHOOL_YEAR_NOT_ACTIVE` | 409 | user | Your school has no active school year yet. Ask your School Head to set the school year first. |
| `MOSY_LOCKED` | 403 | user | MOSY submissions are locked right now. Your Super Admin can open them. |
| `VALIDATION_FAILED` | 422 | user | {message} — the first field problem, e.g. "Email is required" |
| `NOT_FOUND` | 404 | user *(security when the row belongs to another school)* | {resource} not found. It may have been deleted or moved. |
| `RATE_LIMITED` | 429 | security | Too many requests. Try again in {wait}. |
| `NETWORK_OFFLINE` | 503 | user | No internet connection. Check your Wi-Fi or mobile data, then try again. If you were saving something, it may not have gone through. *(made in the browser)* |
| `SERVER_UNREACHABLE` | 503 | user | Couldn't reach LITRACK. Your internet seems to be working, so LITRACK may be busy. Wait a moment and try again. If you were saving something, it may not have gone through. *(made in the browser)* |
| `APP_UPDATED` | 409 | user | LITRACK was just updated. Reload the page to continue — anything you haven't saved on this page will need to be entered again. *(made in the browser)* |
| `REQUEST_TOO_LARGE` | 413 | user | That's too much to send at once. Use a smaller file (under 5 MB) or split it into parts, then try again. *(made in the browser)* |
| `ARCHIVE_TEACHER_PURGE_PENDING_MIGRATION` | 409 | user | This account can't be permanently deleted yet — a pending database update hasn't been applied. The account stays safely removed in the meantime; ask your division admin or developer to apply the update, then try again. |
| `AVATAR_SOURCE_TOO_LARGE` | 413 | user | That picture file is too large. Pick one smaller than 5 MB. |
| `AVATAR_FILE_INVALID` | 422 | user | That photo couldn't be used. Pick a JPG, PNG or WebP picture and try again. |
| `AVATAR_FILE_TOO_LARGE` | 413 | user | That photo is too large to save. Crop it again or pick a smaller picture. |
| `AVATAR_CHANGED` | 409 | user | Your profile photo changed somewhere else while this was uploading. Refresh the page and try again. |
| `AVATAR_STORAGE_FAILED` | 502 | system | Couldn't save the profile photo. Try again in a few minutes. |
| `DB_CONFLICT` | 409 | system | This conflicts with a record that already exists. Refresh the page and check before trying again. |
| `DB_SCHEMA_OUT_OF_DATE` | 503 | system | Couldn't {verb}: the database is missing an update this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending update. |
| `DB_UNAVAILABLE` | 503 | system | Couldn't {verb}: the database didn't respond in time. Wait a few seconds and try again. |
| `IMPORT_TIMED_OUT` | 503 | system | The import took too long to save. Split the file into smaller parts (for example one grade or section at a time) and import each part. |
| `DB_ERROR` | 500 | system | Couldn't {verb}: the database rejected the change. Try again, and if it keeps failing, contact your administrator. |
| `SERVICE_UNAVAILABLE` | 503 | system | {service} isn't responding right now. Try again in a few minutes. |
| `CONFIG_MISSING` | 503 | system | This part of LITRACK isn't set up on the server yet. Contact your administrator. |
| `INTERNAL_ERROR` | 500 | system | An unexpected error stopped this from finishing. Try again, and if it keeps happening, contact your administrator. |

`system` messages get " Reference: E-XXXXXXXX" appended when shown to the
user (`withReference`). Placeholder defaults, used when a throw site doesn't
supply a value: `{verb}` = "finish that", `{resource}` = "Record", `{wait}` =
"a few minutes", `{what}` = "this", `{service}` = "A connected service",
`{message}` = "Check the highlighted field and try again."

The four codes marked *(made in the browser)* are produced by
`classifyClientFailure` (see "The client side" below), for requests that never
came back as a normal result, so the server could not have said them.

### The `AVATAR_*` codes

`AVATAR_SOURCE_TOO_LARGE` is the only one of the five the server never throws:
it belongs to the crop dialog, which refuses an oversized source file before it
decodes it. The server receives the two re-encoded objects, not the source.

`AVATAR_FILE_INVALID` covers every way the uploaded bytes can fail
`validateAvatarUpload` (`src/lib/avatars/validate-upload.ts`) other than size —
wrong type, not square, out of the dimension range, animated, carrying EXIF or
XMP, or the two objects not agreeing on a type. One message for all of them,
because the person's next step is the same in every case, and because naming
which check failed would describe our validator to whoever is probing it.

`AVATAR_CHANGED` is the lost compare-and-swap in `src/lib/actions/avatar.ts`.
It always means "nothing was deleted": an object is removed only after a CAS
this request won.

### `ARCHIVE_TEACHER_PURGE_PENDING_MIGRATION` (transitional)

`purgeRemovedTeacher` (`src/lib/actions/admin-archive.ts`) permanently deletes
a soft-deleted teacher's `User` row. Nine "who recorded this" foreign keys
(attendance, assessments, grades, announcements, reports, unlock grants, term
window overrides, and others) are `ON DELETE RESTRICT` until migration
`20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes` is
applied. Until then, purging a teacher who ever recorded any of that fails
with Prisma `P2003`; the action catches that specific code and throws this
instead of letting it fall through to `INTERNAL_ERROR`.

It is deliberately `severity: "user"`: an unapplied migration is an
operational fact the Super Admin can act on (ask whoever applies migrations
to run the pending one), not an incident — so it records no `ErrorEvent` and
sends no alert email. The teacher's record stays soft-deleted and reachable
from `/admin/archive`; nothing is lost, and the purge can be retried once the
migration lands. `restoreRemovedTeacher` and the delete-learner actions are
unaffected.

Once that migration is applied in every environment this code fires in, the
catch site and this code become dead weight and should be deleted together —
see the comment at the catch site in `admin-archive.ts` for the exact
migration name to check for.
