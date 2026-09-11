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
`fieldErrors` (field path → message) is present only for `VALIDATION_FAILED`.

`logoutAction` (`src/lib/actions/auth.ts`) is deliberately **not** wrapped —
it's passed straight to `<form action={logoutAction}>`, which requires
`Promise<void>`, and a form action can't read a returned result anyway.
Anything that escapes it is still caught by the page-crash handler
(`onRequestError`, see below).

**About 30 legacy action modules still use the old hand-rolled
`{ ok: false, error }` shape and their own try/catch** — they weren't
migrated in this slice. Unexpected errors from them are still caught and
recorded through `onRequestError`; only their *expected* error paths (a bad
password, a taken name, and so on) don't yet go through `action()`. They'll
move onto the pattern in later slices.

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
  when the event fired), search the Vercel runtime logs for the reference —
  every recorded event is also written as one JSON line tagged
  `"tag": "litrack.error"` (see `logLine` in `report.ts`), and that line is
  written *before* the database insert, so it survives even a database
  outage or a missing table.

A page crash (one that reaches Next's `error.tsx`) uses **Next's own digest
string as the reference** — the same value `error.tsx` displays — rather than
generating a separate one, via `onRequestError`
(`src/lib/errors/request-error.ts`, wired in `src/instrumentation.ts`). Both
kinds of reference resolve the same way on `/admin/errors`.

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

## The full code table (38 codes)

Generated from `src/lib/errors/codes.ts` — that file is the source of truth;
if this table and the code ever disagree, trust the code.

| Code | HTTP | Severity | User message |
|---|---|---|---|
| `AUTH_INCORRECT_PASSWORD` | 401 | user | Incorrect password. Check it and try again. |
| `AUTH_INCORRECT_CREDENTIALS` | 401 | user | Incorrect username or password. *(Super Admin only)* |
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
| `VALIDATION_FAILED` | 422 | user | {message} — the first field problem, e.g. "Email is required" |
| `NOT_FOUND` | 404 | user *(security when the row belongs to another school)* | {resource} not found. It may have been deleted or moved. |
| `RATE_LIMITED` | 429 | security | Too many requests. Try again in {wait}. |
| `DB_CONFLICT` | 409 | system | This conflicts with a record that already exists. Refresh the page and check before trying again. |
| `DB_SCHEMA_OUT_OF_DATE` | 503 | system | Couldn't {verb}: the database is missing an update this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending update. |
| `DB_UNAVAILABLE` | 503 | system | Couldn't {verb}: the database didn't respond in time. Wait a few seconds and try again. |
| `DB_ERROR` | 500 | system | Couldn't {verb}: the database rejected the change. Try again, and if it keeps failing, contact your administrator. |
| `SERVICE_UNAVAILABLE` | 503 | system | {service} isn't responding right now. Try again in a few minutes. |
| `CONFIG_MISSING` | 503 | system | This part of LITRACK isn't set up on the server yet. Contact your administrator. |
| `INTERNAL_ERROR` | 500 | system | An unexpected error stopped this from finishing. Try again, and if it keeps happening, contact your administrator. |

`system` messages get " Reference: E-XXXXXXXX" appended when shown to the
user (`withReference`). Placeholder defaults, used when a throw site doesn't
supply a value: `{verb}` = "finish that", `{resource}` = "Record", `{wait}` =
"a few minutes", `{what}` = "this", `{service}` = "A connected service",
`{message}` = "Check the highlighted field and try again."

Earlier drafts of this catalog listed 39 codes including
`NETWORK_UNREACHABLE`; that code was unused and has been removed, leaving 38.
