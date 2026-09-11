# Error Handling Slice 1 (Foundation + Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One error catalog, one `AppError`, one handler per boundary (server action, API route, page render), an admin error log with alerts, specific auth messages, and matching 404/403/500 pages.

**Architecture:** Actions throw `AppError`. An `action()` wrapper classifies anything thrown, reports non-user errors to `ErrorEvent` + Vercel logs (+ email for `system`), and returns `{ ok: false, code, error, ref?, fieldErrors? }`. `route()` does the same for API routes. `onRequestError` does it for page renders using Next's digest as the reference. Only auth flows migrate in this slice.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript strict, Prisma 5, Supabase Auth, Zod, Vitest, Playwright, Resend.

**Spec:** `docs/superpowers/specs/2026-09-11-error-handling-design.md`

## Global Constraints

- Never apply migrations or run `prisma migrate dev/deploy/reset` or `db push`. Author SQL only. A human applies it.
- User messages: English, plain, say what happened and what to do next. They must never contain "Prisma", "Supabase", "SQL", "Postgres", "Vercel", an env var name, a file path, or a stack trace.
- `ActionFailure` keeps the field name `error` (the user message) so the 46 components reading `.error` keep working.
- Existing `AuditLog` `reason` strings stay as they are, because `scripts/diagnose-login-trail.ts` reads them: `incorrect_credentials`, `rate_limited`, `not_authorized`, `deactivated`, `unknown_username`. New values may be added.
- Never store passwords, tokens, cookies, typed emails/usernames, FormData or learner values in `ErrorEvent`, alert emails, or audit metadata.
- Do not migrate non-auth action modules in this slice. Their tests must stay untouched and green.
- `server-only` modules must not be imported by client components or by `src/middleware.ts`.
- Every task ends green on `npx vitest run <its tests>`. Tasks 8, 13, 17 and 19 also run `npm run typecheck`.
- Final gate (Task 19): `npx prisma generate` → `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
- Commit after each task. End every message with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WUTNmGNC79wB8Nued2pojQ
  ```

## File map

| File | Responsibility |
|---|---|
| `src/lib/errors/codes.ts` | Catalog + message formatting (isomorphic, no imports) |
| `src/lib/errors/app-error.ts` | `AppError` + constructors for common cases |
| `src/lib/errors/validation.ts` | Zod → `VALIDATION_FAILED` |
| `src/lib/errors/result.ts` | `ActionResult`, `ActionFailure`, `toFailure` |
| `src/lib/errors/supabase.ts` | Supabase auth error → catalog code (isomorphic) |
| `src/lib/errors/classify.ts` | Anything thrown → `AppError` |
| `src/lib/errors/context.ts` | AsyncLocalStorage scope (route + verified user) |
| `src/lib/errors/report.ts` | Ref, console line, `ErrorEvent` insert, alert hand-off |
| `src/lib/errors/retention.ts` | Purge old `ErrorEvent` rows |
| `src/lib/errors/alert.ts` | Throttled alert email |
| `src/lib/email.ts` | Resend wrapper |
| `src/lib/errors/action.ts` | `action()` server-action wrapper |
| `src/lib/errors/route.ts` | `route()` API wrapper + `errorResponse` |
| `src/lib/errors/session-cookie.ts` | Supabase cookie → auth id (attribution only) |
| `src/lib/errors/request-error.ts` | `onRequestError` body |
| `src/lib/auth/session-end.ts` | `?reason=` allow-list, `loginPath` (edge-safe) |
| `src/lib/auth/login-gates.ts` | Shared sign-in pre-flight checks |
| `src/lib/auth/lookup-throttle.ts` | Per-IP failed-lookup throttle |
| `src/lib/request-ip.ts` | Client IP from headers |
| `src/lib/nav/not-found-links.ts` | Role quick links for 404 |
| `src/components/errors/*` | `ErrorCard`, `RouteError`, `NotFoundContent` |
| `src/app/admin/errors/page.tsx` | Super Admin error log |

---

### Task 1: Catalog, AppError, result, validation

**Files:**
- Create: `src/lib/errors/codes.ts`, `src/lib/errors/app-error.ts`, `src/lib/errors/result.ts`, `src/lib/errors/validation.ts`
- Test: `tests/unit/errors/codes.test.ts`, `tests/unit/errors/app-error.test.ts`

**Interfaces:**
- Produces:
  - `ERRORS`, `type ErrorCode`, `type ErrorSeverity`, `type ErrorParams = Record<string, string | number>`
  - `formatMessage(code, params?) → string`, `withReference(message, ref?) → string`, `formatWait(ms) → string`, `isErrorCode(v)`
  - `class AppError { code; status; severity; params; detail?; fieldErrors?; context }`
  - `type ErrorContext = Record<string, string | number | boolean | null>`
  - `resourceNotFound(resource, { crossTenant?, detail? })`, `tooManyAttempts(retryAfterMs, code?)`, `fieldError(field, message)`
  - `type ActionFailure`, `type ActionResult<T>`, `toFailure(err, ref?)`
  - `fieldErrorsFrom(zodError)`, `validationError(zodError)`, `parseInput(schema, input)`

- [ ] **Step 1: Write the failing tests**

`tests/unit/errors/codes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ERRORS, formatMessage, formatWait, isErrorCode, withReference, type ErrorCode } from "@/lib/errors/codes";

const CODES = Object.keys(ERRORS) as ErrorCode[];
const INTERNAL_WORDS = /prisma|supabase|postgres|\bsql\b|vercel|database_url|env var|stack|undefined|null\b|\.tsx?\b/i;

describe("error catalog", () => {
  it("gives every code a status, a severity and a message", () => {
    for (const code of CODES) {
      const def = ERRORS[code];
      expect(def.status, code).toBeGreaterThanOrEqual(400);
      expect(["user", "security", "system"], code).toContain(def.severity);
      expect(def.message.length, code).toBeGreaterThan(10);
    }
  });

  it("fills every placeholder even when no params are passed", () => {
    for (const code of CODES) {
      const text = formatMessage(code);
      expect(text, code).not.toMatch(/[{}]/);
      expect(text.trim(), code).toBe(text);
    }
  });

  it("never names internals in a message a person reads", () => {
    for (const code of CODES) {
      expect(ERRORS[code].message, code).not.toMatch(INTERNAL_WORDS);
    }
  });

  it("uses AREA_REASON upper snake case for every code", () => {
    for (const code of CODES) expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)+$/);
  });

  it("substitutes params", () => {
    expect(formatMessage("NOT_FOUND", { resource: "Learner" })).toBe(
      "Learner not found. It may have been deleted or moved."
    );
    expect(formatMessage("AUTH_TOO_MANY_ATTEMPTS", { wait: "4 minutes" })).toBe(
      "Too many attempts. Try again in 4 minutes."
    );
  });

  it("keeps the wording existing callers and tests rely on", () => {
    expect(formatMessage("AUTH_REGISTRATION_DECLINED")).toBe("Your registration was declined. Contact your School Head.");
    expect(formatMessage("AUTH_ACCOUNT_DEACTIVATED")).toBe("Your account has been deactivated. Contact your School Head.");
    expect(formatMessage("AUTH_TEACHER_PENDING")).toBe("Your request is pending School Head approval.");
    expect(formatMessage("AUTH_PROVIDER_RATE_LIMITED")).toMatch(/no need to reset/i);
  });

  it("appends a reference only when there is one", () => {
    expect(withReference("Couldn't save.", "E-ABCD1234")).toBe("Couldn't save. Reference: E-ABCD1234");
    expect(withReference("Couldn't save.", undefined)).toBe("Couldn't save.");
  });

  it("says how long to wait in whole minutes, never zero", () => {
    expect(formatWait(0)).toBe("1 minute");
    expect(formatWait(59_000)).toBe("1 minute");
    expect(formatWait(61_000)).toBe("2 minutes");
    expect(formatWait(4 * 60_000)).toBe("4 minutes");
  });

  it("recognizes only real codes", () => {
    expect(isErrorCode("NOT_FOUND")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("__proto__")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
```

`tests/unit/errors/app-error.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, fieldError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { toFailure } from "@/lib/errors/result";
import { parseInput, validationError } from "@/lib/errors/validation";

describe("AppError", () => {
  it("carries the catalog status and severity and a user-safe message", () => {
    const err = new AppError("DB_UNAVAILABLE", { detail: "P2024 pool timeout on User.findUnique" });
    expect(err.status).toBe(503);
    expect(err.severity).toBe("system");
    expect(err.message).not.toContain("P2024");
    expect(String(err)).not.toContain("pool timeout");
    expect(err.detail).toContain("P2024");
  });

  it("lets a throw override severity", () => {
    expect(new AppError("NOT_FOUND").severity).toBe("user");
    expect(new AppError("NOT_FOUND", { severity: "security" }).severity).toBe("security");
  });

  it("keeps the cause for admins", () => {
    const cause = new Error("boom");
    expect(new AppError("INTERNAL_ERROR", { cause }).cause).toBe(cause);
  });
});

describe("resourceNotFound", () => {
  it("gives a missing row and another school's row the same message", () => {
    const missing = resourceNotFound("Learner");
    const foreign = resourceNotFound("Learner", { crossTenant: true, detail: "belongs to school-b" });
    expect(missing.message).toBe(foreign.message);
    expect(missing.severity).toBe("user");
    expect(foreign.severity).toBe("security");
    expect(foreign.context.crossTenant).toBe(true);
  });
});

describe("tooManyAttempts", () => {
  it("states the wait and exposes Retry-After seconds", () => {
    const err = tooManyAttempts(3 * 60_000 + 1);
    expect(err.code).toBe("AUTH_TOO_MANY_ATTEMPTS");
    expect(err.message).toBe("Too many attempts. Try again in 4 minutes.");
    expect(err.context.retryAfterSeconds).toBe(181);
    expect(tooManyAttempts(1000, "RATE_LIMITED").code).toBe("RATE_LIMITED");
  });
});

describe("validation", () => {
  const schema = z.object({ email: z.string().min(1, "Email is required"), age: z.number() });

  it("uses the first issue as the message and maps each field", () => {
    const parsed = schema.safeParse({ email: "", age: "x" });
    if (parsed.success) throw new Error("expected failure");
    const err = validationError(parsed.error);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("Email is required");
    expect(err.fieldErrors).toMatchObject({ email: "Email is required" });
    expect(Object.keys(err.fieldErrors ?? {})).toContain("age");
  });

  it("parseInput returns data or throws VALIDATION_FAILED", () => {
    expect(parseInput(schema, { email: "a", age: 1 })).toEqual({ email: "a", age: 1 });
    expect(() => parseInput(schema, {})).toThrow(AppError);
  });

  it("fieldError names one field", () => {
    const err = fieldError("schoolId", "Please select a school");
    expect(err.message).toBe("Please select a school");
    expect(err.fieldErrors).toEqual({ schoolId: "Please select a school" });
  });
});

describe("toFailure", () => {
  it("returns the house result shape", () => {
    expect(toFailure(new AppError("AUTH_INCORRECT_PASSWORD"))).toEqual({
      ok: false,
      code: "AUTH_INCORRECT_PASSWORD",
      error: "Incorrect password. Check it and try again.",
    });
  });

  it("puts the reference in both the message and its own field", () => {
    const f = toFailure(new AppError("INTERNAL_ERROR"), "E-7K2P9QXM");
    expect(f.ref).toBe("E-7K2P9QXM");
    expect(f.error.endsWith("Reference: E-7K2P9QXM")).toBe(true);
  });

  it("includes field errors for validation", () => {
    expect(toFailure(fieldError("email", "Email is required")).fieldErrors).toEqual({ email: "Email is required" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/errors`
Expected: FAIL, "Failed to resolve import @/lib/errors/codes".

- [ ] **Step 3: Implement `src/lib/errors/codes.ts`**

```ts
/**
 * Every error LITRACK can show a person, in one place.
 *
 * Pure and dependency-free, so the browser (the login form) and the server share
 * one list. Messages are plain strings with {placeholders}, never functions, so
 * this file can be handed to a translator as it is.
 *
 * Severity decides where an error is recorded, not how it reads:
 *   user     — an expected mistake the person can fix. Not recorded as an error
 *              (sign-in outcomes still go to AuditLog).
 *   security — someone was refused: access, a rate limit, another school's row.
 *              Recorded in ErrorEvent.
 *   system   — something on our side failed. Recorded, eligible for an alert
 *              email, and the person gets a reference to quote.
 *
 * Adding a code: see docs/errors.md.
 */

export type ErrorSeverity = "user" | "security" | "system";

export type ErrorDefinition = {
  status: number;
  severity: ErrorSeverity;
  message: string;
};

export type ErrorParams = Record<string, string | number>;

export const ERRORS = {
  // ── Sign-in ──────────────────────────────────────────────────────────────
  AUTH_INCORRECT_PASSWORD: {
    status: 401,
    severity: "user",
    message: "Incorrect password. Check it and try again.",
  },
  AUTH_INCORRECT_CREDENTIALS: {
    status: 401,
    severity: "user",
    message: "Incorrect username or password.",
  },
  AUTH_TEACHER_NOT_FOUND: {
    status: 404,
    severity: "user",
    message:
      "No teacher account uses this email at the selected school. Check the email and school, or create an account.",
  },
  AUTH_NO_SCHOOL_HEAD_ACCOUNT: {
    status: 404,
    severity: "security",
    message:
      "This school doesn't have a School Head account yet. Contact your division office to set one up.",
  },
  AUTH_SCHOOL_INACTIVE: {
    status: 403,
    severity: "user",
    message: "This school's LITRACK access is turned off. Contact your division office.",
  },
  AUTH_TOO_MANY_ATTEMPTS: {
    status: 429,
    severity: "security",
    message: "Too many attempts. Try again in {wait}.",
  },
  AUTH_PROVIDER_RATE_LIMITED: {
    status: 429,
    severity: "security",
    message:
      "Too many sign-in attempts right now. Wait about five minutes and try again — your password has not changed, so there is no need to reset it.",
  },
  AUTH_SERVICE_UNREACHABLE: {
    status: 503,
    severity: "user",
    message: "Couldn't reach the sign-in service. Check your internet connection and try again.",
  },
  AUTH_PROVIDER_ERROR: {
    status: 502,
    severity: "system",
    message: "The sign-in service couldn't finish this request. Try again in a few minutes.",
  },
  AUTH_ACCOUNT_DEACTIVATED: {
    status: 403,
    severity: "user",
    message: "Your account has been deactivated. Contact your School Head.",
  },
  AUTH_REGISTRATION_DECLINED: {
    status: 403,
    severity: "user",
    message: "Your registration was declined. Contact your School Head.",
  },
  AUTH_TEACHER_PENDING: {
    status: 409,
    severity: "user",
    message: "Your request is pending School Head approval.",
  },
  AUTH_ACCOUNT_DISABLED: {
    status: 403,
    severity: "user",
    message: "This account has been turned off. Contact your division office.",
  },
  AUTH_SESSION_EXPIRED: {
    status: 401,
    severity: "user",
    message: "Your session ended. Sign in again to continue.",
  },
  AUTH_NOT_SIGNED_IN: {
    status: 401,
    severity: "user",
    message: "Sign in to continue.",
  },
  AUTH_FORBIDDEN: {
    status: 403,
    severity: "security",
    message: "You don't have access to {what}.",
  },
  AUTH_RESET_LINK_EXPIRED: {
    status: 401,
    severity: "user",
    message: "This reset link has expired or was already used. Request a new one.",
  },
  AUTH_CURRENT_PASSWORD_INCORRECT: {
    status: 401,
    severity: "user",
    message: "Your current password is incorrect.",
  },
  AUTH_PASSWORD_SAME: {
    status: 422,
    severity: "user",
    message: "Your new password must be different from your current one.",
  },
  AUTH_PASSWORD_WEAK: {
    status: 422,
    severity: "user",
    message: "That password is too easy to guess. Use a longer one with a mix of letters and numbers.",
  },
  AUTH_EMAIL_UNCHANGED: {
    status: 422,
    severity: "user",
    message: "The new email is the same as your current one.",
  },
  AUTH_EMAIL_IN_USE: {
    status: 409,
    severity: "user",
    message: "That email is already used by another LITRACK account.",
  },
  AUTH_ACCOUNT_EXISTS_SIGN_IN: {
    status: 409,
    severity: "user",
    message: "That email already has an account. Sign in instead, or use Forgot password to reset it.",
  },
  AUTH_REGISTERED_SIGN_IN: {
    status: 409,
    severity: "user",
    message: "Your account was created. Sign in with your email and password.",
  },
  AUTH_SIGNUPS_DISABLED: {
    status: 503,
    severity: "system",
    message: "New accounts can't be created right now. Contact your School Head.",
  },
  AUTH_EMAIL_REJECTED: {
    status: 422,
    severity: "user",
    message: "That email address was rejected. Check it and try again.",
  },
  AUTH_EMAIL_SEND_FAILED: {
    status: 503,
    severity: "system",
    message: "We couldn't send the email right now. Try again in a few minutes.",
  },
  AUTH_EMAIL_PARTIAL_UPDATE: {
    status: 500,
    severity: "system",
    message:
      "Your sign-in email changed but LITRACK couldn't save it. Don't try again yet — contact your administrator.",
  },

  // ── Requests ─────────────────────────────────────────────────────────────
  VALIDATION_FAILED: {
    status: 422,
    severity: "user",
    message: "{message}",
  },
  NOT_FOUND: {
    status: 404,
    severity: "user",
    message: "{resource} not found. It may have been deleted or moved.",
  },
  RATE_LIMITED: {
    status: 429,
    severity: "security",
    message: "Too many requests. Try again in {wait}.",
  },
  NETWORK_UNREACHABLE: {
    status: 503,
    severity: "user",
    message: "Couldn't reach LITRACK. Check your internet connection and try again.",
  },

  // ── Our side ─────────────────────────────────────────────────────────────
  DB_CONFLICT: {
    status: 409,
    severity: "system",
    message: "This conflicts with a record that already exists. Refresh the page and check before trying again.",
  },
  DB_SCHEMA_OUT_OF_DATE: {
    status: 503,
    severity: "system",
    message:
      "Couldn't {verb}: the database is missing an update this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending update.",
  },
  DB_UNAVAILABLE: {
    status: 503,
    severity: "system",
    message: "Couldn't {verb}: the database didn't respond in time. Wait a few seconds and try again.",
  },
  DB_ERROR: {
    status: 500,
    severity: "system",
    message:
      "Couldn't {verb}: the database rejected the change. Try again, and if it keeps failing, contact your administrator.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    severity: "system",
    message: "{service} isn't responding right now. Try again in a few minutes.",
  },
  CONFIG_MISSING: {
    status: 503,
    severity: "system",
    message: "This part of LITRACK isn't set up on the server yet. Contact your administrator.",
  },
  INTERNAL_ERROR: {
    status: 500,
    severity: "system",
    message:
      "An unexpected error stopped this from finishing. Try again, and if it keeps happening, contact your administrator.",
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERRORS;

/** What a placeholder says when the thrower did not supply it. */
const DEFAULT_PARAMS: Readonly<Record<string, string>> = {
  verb: "finish that",
  resource: "Record",
  service: "A connected service",
  wait: "a few minutes",
  what: "this",
  message: "Check the highlighted field and try again.",
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERRORS, value);
}

export function formatMessage(code: ErrorCode, params: ErrorParams = {}): string {
  return ERRORS[code].message.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = Object.hasOwn(params, key) ? params[key] : DEFAULT_PARAMS[key];
    return value === undefined ? "" : String(value);
  });
}

/** The reference goes last, where a person copying it will look. */
export function withReference(message: string, ref: string | undefined): string {
  return ref ? `${message} Reference: ${ref}` : message;
}

/** "1 minute" / "4 minutes" — never "0 minutes", which reads as "now". */
export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
```

- [ ] **Step 4: Implement `src/lib/errors/app-error.ts`**

```ts
import {
  ERRORS,
  formatMessage,
  formatWait,
  type ErrorCode,
  type ErrorParams,
  type ErrorSeverity,
} from "./codes";

/** Ids and codes that help an admin. Only allow-listed keys are ever stored. */
export type ErrorContext = Record<string, string | number | boolean | null>;

export type AppErrorOptions = {
  params?: ErrorParams;
  /** For admins only. Never sent to the browser. */
  detail?: string;
  cause?: unknown;
  fieldErrors?: Record<string, string>;
  severity?: ErrorSeverity;
  context?: ErrorContext;
};

/**
 * An error whose code, status and user message come from the catalog.
 *
 * `.message` is the formatted *user* message on purpose: anything that ends up
 * stringifying the error (a log line, a toast, `String(err)`) shows the safe
 * sentence, and the admin-only `detail` has to be asked for by name.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly severity: ErrorSeverity;
  readonly params: ErrorParams;
  readonly detail?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(formatMessage(code, options.params), { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERRORS[code].status;
    this.severity = options.severity ?? ERRORS[code].severity;
    this.params = options.params ?? {};
    this.detail = options.detail;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context ?? {};
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * A row that is missing, or belongs to another school. The two read the same to
 * the person (so existence in another tenant never leaks); only the admin
 * record and the severity say which it was.
 */
export function resourceNotFound(
  resource: string,
  options: { crossTenant?: boolean; detail?: string } = {}
): AppError {
  return new AppError("NOT_FOUND", {
    params: { resource },
    severity: options.crossTenant ? "security" : undefined,
    detail: options.detail,
    context: { resource, crossTenant: Boolean(options.crossTenant) },
  });
}

export function tooManyAttempts(
  retryAfterMs: number,
  code: "AUTH_TOO_MANY_ATTEMPTS" | "RATE_LIMITED" = "AUTH_TOO_MANY_ATTEMPTS"
): AppError {
  return new AppError(code, {
    params: { wait: formatWait(retryAfterMs) },
    context: { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  });
}

/** One field is wrong, and the form can say which. */
export function fieldError(field: string, message: string): AppError {
  return new AppError("VALIDATION_FAILED", {
    params: { message },
    fieldErrors: { [field]: message },
  });
}
```

- [ ] **Step 5: Implement `src/lib/errors/validation.ts`**

```ts
import type { z, ZodError } from "zod";
import { AppError } from "./app-error";

/** First message per field path; the form-level issue (empty path) is `_form`. */
export function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    if (!Object.hasOwn(out, key)) out[key] = issue.message;
  }
  return out;
}

/** Zod messages in this repo are already written for people ("Email is required"). */
export function validationError(error: ZodError): AppError {
  const first = error.issues[0]?.message;
  return new AppError("VALIDATION_FAILED", {
    params: first ? { message: first } : {},
    fieldErrors: fieldErrorsFrom(error),
  });
}

/** `safeParse` that throws `VALIDATION_FAILED`, for use inside `action()`. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}
```

- [ ] **Step 6: Implement `src/lib/errors/result.ts`**

```ts
import { withReference, type ErrorCode } from "./codes";
import type { AppError } from "./app-error";

/**
 * What a failed server action returns.
 *
 * `error` keeps its historical name and is always the safe user sentence, so
 * every component that already does `toast.error(res.error)` keeps working.
 */
export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  error: string;
  /** Present only for `system` failures: the code a person quotes to support. */
  ref?: string;
  /** Present only for `VALIDATION_FAILED`: field path → reason. */
  fieldErrors?: Record<string, string>;
};

export type ActionResult<T = unknown> = { ok: true; data?: T } | ActionFailure;

export function toFailure(err: AppError, ref?: string): ActionFailure {
  const failure: ActionFailure = { ok: false, code: err.code, error: withReference(err.message, ref) };
  if (ref) failure.ref = ref;
  if (err.fieldErrors) failure.fieldErrors = err.fieldErrors;
  return failure;
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run tests/unit/errors`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/errors tests/unit/errors
git commit -m "feat(errors): one catalog of codes and messages, and the AppError that carries them"
```

---

### Task 2: Supabase mapping and the classifier

**Files:**
- Create: `src/lib/errors/supabase.ts`, `src/lib/errors/classify.ts`
- Test: `tests/unit/errors/supabase.test.ts`, `tests/unit/errors/classify.test.ts`

**Interfaces:**
- Consumes: Task 1; `isAuthRateLimitError` (`@/lib/auth/auth-errors`); `classifyDbFailure` (`@/lib/db-errors`)
- Produces:
  - `mapSupabaseAuthError(err, side: "browser" | "server") → ErrorCode`
  - `type LoginFailureReason = "incorrect_credentials" | "rate_limited" | "service_unreachable" | "provider_error"`
  - `LOGIN_FAILURE_REASONS`, `loginFailureReasonFor(code) → LoginFailureReason`
  - `classifyError(err, { verb? }) → AppError`

- [ ] **Step 1: Write the failing tests**

`tests/unit/errors/supabase.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";

describe("mapSupabaseAuthError", () => {
  it("reads a wrong password as a wrong password", () => {
    expect(mapSupabaseAuthError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, "browser")).toBe("AUTH_INCORRECT_PASSWORD");
    expect(mapSupabaseAuthError({ status: 400, message: "Invalid login credentials" }, "server")).toBe("AUTH_INCORRECT_PASSWORD");
  });

  it("never reads a rate limit as a wrong password", () => {
    expect(mapSupabaseAuthError({ status: 429, message: "Request rate limit reached" }, "browser")).toBe("AUTH_PROVIDER_RATE_LIMITED");
  });

  it("separates a network failure from a wrong password", () => {
    const fetchFailure = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };
    expect(mapSupabaseAuthError(fetchFailure, "browser")).toBe("AUTH_SERVICE_UNREACHABLE");
    expect(mapSupabaseAuthError(fetchFailure, "server")).toBe("AUTH_PROVIDER_ERROR");
    expect(mapSupabaseAuthError({ status: 503, message: "upstream" }, "browser")).toBe("AUTH_SERVICE_UNREACHABLE");
  });

  it("names the password-policy refusals", () => {
    expect(mapSupabaseAuthError({ status: 422, code: "same_password" }, "server")).toBe("AUTH_PASSWORD_SAME");
    expect(mapSupabaseAuthError({ status: 422, code: "weak_password" }, "server")).toBe("AUTH_PASSWORD_WEAK");
  });

  it("names account and email refusals", () => {
    expect(mapSupabaseAuthError({ code: "signup_disabled" }, "server")).toBe("AUTH_SIGNUPS_DISABLED");
    expect(mapSupabaseAuthError({ code: "email_address_invalid" }, "server")).toBe("AUTH_EMAIL_REJECTED");
    expect(mapSupabaseAuthError({ code: "email_exists" }, "server")).toBe("AUTH_EMAIL_IN_USE");
    expect(mapSupabaseAuthError({ message: "A user with this email address has already been registered" }, "server")).toBe("AUTH_EMAIL_IN_USE");
    expect(mapSupabaseAuthError({ message: "Error sending recovery email" }, "server")).toBe("AUTH_EMAIL_SEND_FAILED");
    expect(mapSupabaseAuthError({ code: "session_not_found" }, "server")).toBe("AUTH_SESSION_EXPIRED");
  });

  it("does not guess: an unrecognized failure is a provider error", () => {
    expect(mapSupabaseAuthError({ status: 400, message: "Something new happened after the upgrade" }, "server")).toBe("AUTH_PROVIDER_ERROR");
    expect(mapSupabaseAuthError(null, "browser")).toBe("AUTH_PROVIDER_ERROR");
  });
});

describe("loginFailureReasonFor", () => {
  it("keeps the audit reason strings the diagnose script reads", () => {
    expect(loginFailureReasonFor("AUTH_INCORRECT_PASSWORD")).toBe("incorrect_credentials");
    expect(loginFailureReasonFor("AUTH_PROVIDER_RATE_LIMITED")).toBe("rate_limited");
    expect(loginFailureReasonFor("AUTH_SERVICE_UNREACHABLE")).toBe("service_unreachable");
    expect(loginFailureReasonFor("AUTH_PROVIDER_ERROR")).toBe("provider_error");
  });
});
```

`tests/unit/errors/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthApiError } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors/app-error";
import { classifyError } from "@/lib/errors/classify";

function prismaKnown(code: string, message = `\nInvalid \`prisma.user.update()\` invocation:\n\n${code} failure`) {
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code, clientVersion: "5.22.0" });
}

describe("classifyError", () => {
  it("passes an AppError through untouched", () => {
    const err = new AppError("AUTH_FORBIDDEN");
    expect(classifyError(err)).toBe(err);
  });

  it("turns a thrown ZodError into VALIDATION_FAILED", () => {
    const parsed = z.object({ name: z.string().min(1, "Name is required") }).safeParse({ name: "" });
    if (parsed.success) throw new Error("expected failure");
    const out = classifyError(parsed.error);
    expect(out.code).toBe("VALIDATION_FAILED");
    expect(out.message).toBe("Name is required");
  });

  it("maps Prisma failures by what retrying can do", () => {
    expect(classifyError(prismaKnown("P2024"), { verb: "save the section" }).message).toMatch(/^Couldn't save the section: the database didn't respond/);
    expect(classifyError(prismaKnown("P2022")).code).toBe("DB_SCHEMA_OUT_OF_DATE");
    expect(classifyError(prismaKnown("P2002")).code).toBe("DB_CONFLICT");
    expect(classifyError(prismaKnown("P2025")).code).toBe("NOT_FOUND");
    expect(classifyError(prismaKnown("P2003")).code).toBe("DB_ERROR");
  });

  it("keeps the Prisma code for admins but not in the user message", () => {
    const out = classifyError(prismaKnown("P2024"));
    expect(out.context.prismaCode).toBe("P2024");
    expect(out.message).not.toContain("P2024");
    expect(out.detail).toContain("P2024");
  });

  it("reads a Prisma query-shape error as our bug", () => {
    const err = Object.assign(new Error("Unknown argument `nmae`"), { name: "PrismaClientValidationError" });
    expect(classifyError(err).code).toBe("INTERNAL_ERROR");
  });

  it("reads a missing DATABASE_URL as missing configuration", () => {
    const err = Object.assign(new Error("error: Environment variable not found: DATABASE_URL."), { name: "PrismaClientInitializationError" });
    expect(classifyError(err).code).toBe("CONFIG_MISSING");
  });

  it("maps Supabase auth errors thrown on the server", () => {
    expect(classifyError(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")).code).toBe("AUTH_PROVIDER_RATE_LIMITED");
    expect(classifyError(new AuthApiError("New password should be different from the old password.", 422, "same_password")).code).toBe("AUTH_PASSWORD_SAME");
  });

  it("calls anything else an internal error and keeps the cause", () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'id')");
    const out = classifyError(boom);
    expect(out.code).toBe("INTERNAL_ERROR");
    expect(out.cause).toBe(boom);
    expect(out.message).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/errors/supabase.test.ts tests/unit/errors/classify.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `src/lib/errors/supabase.ts`**

```ts
/**
 * Supabase Auth failures → catalog codes. Isomorphic: the login form classifies
 * the browser's password grant with the same function the server uses.
 *
 * Code first (supabase-js puts a machine-readable `code` on AuthApiError), then
 * the documented messages for older auth servers that send none. Anything not
 * recognized is AUTH_PROVIDER_ERROR — never "incorrect password", which is the
 * guess that sent schools off resetting passwords that were fine.
 */

import { isAuthRateLimitError } from "@/lib/auth/auth-errors";
import type { ErrorCode } from "./codes";

type Side = "browser" | "server";

type AuthErrorLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown };

function asAuthError(err: unknown): AuthErrorLike | null {
  return err && typeof err === "object" ? (err as AuthErrorLike) : null;
}

/** The request never got a real answer: network, DNS, or the auth server itself. */
export function isAuthServiceUnreachable(err: unknown): boolean {
  const e = asAuthError(err);
  if (!e) return false;
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number" && (e.status === 0 || e.status >= 500)) return true;
  return typeof e.message === "string" && /failed to fetch|fetch failed|networkerror|load failed/i.test(e.message);
}

const BY_CODE: Record<string, ErrorCode> = {
  invalid_credentials: "AUTH_INCORRECT_PASSWORD",
  same_password: "AUTH_PASSWORD_SAME",
  weak_password: "AUTH_PASSWORD_WEAK",
  signup_disabled: "AUTH_SIGNUPS_DISABLED",
  email_address_invalid: "AUTH_EMAIL_REJECTED",
  email_exists: "AUTH_EMAIL_IN_USE",
  user_already_exists: "AUTH_EMAIL_IN_USE",
  session_not_found: "AUTH_SESSION_EXPIRED",
  session_expired: "AUTH_SESSION_EXPIRED",
  refresh_token_not_found: "AUTH_SESSION_EXPIRED",
  refresh_token_already_used: "AUTH_SESSION_EXPIRED",
};

const BY_MESSAGE: Array<[RegExp, ErrorCode]> = [
  [/invalid login credentials/i, "AUTH_INCORRECT_PASSWORD"],
  [/should be different from the old password/i, "AUTH_PASSWORD_SAME"],
  [/password should (?:be|contain)/i, "AUTH_PASSWORD_WEAK"],
  [/signups? not allowed/i, "AUTH_SIGNUPS_DISABLED"],
  [/already (?:been )?registered|already exists/i, "AUTH_EMAIL_IN_USE"],
  [/error sending|smtp/i, "AUTH_EMAIL_SEND_FAILED"],
];

export function mapSupabaseAuthError(err: unknown, side: Side): ErrorCode {
  const e = asAuthError(err);
  if (!e) return "AUTH_PROVIDER_ERROR";
  if (isAuthRateLimitError(err)) return "AUTH_PROVIDER_RATE_LIMITED";
  if (isAuthServiceUnreachable(err)) {
    // From the browser it is usually the person's connection. From our server
    // it is our infrastructure, and the connection advice would be wrong.
    return side === "browser" ? "AUTH_SERVICE_UNREACHABLE" : "AUTH_PROVIDER_ERROR";
  }
  if (typeof e.code === "string" && Object.hasOwn(BY_CODE, e.code)) return BY_CODE[e.code];
  if (typeof e.message === "string") {
    for (const [pattern, code] of BY_MESSAGE) if (pattern.test(e.message)) return code;
  }
  return "AUTH_PROVIDER_ERROR";
}

/** Audit `reason` values. The first two predate this module and must not change. */
export type LoginFailureReason = "incorrect_credentials" | "rate_limited" | "service_unreachable" | "provider_error";

export const LOGIN_FAILURE_REASONS: readonly LoginFailureReason[] = [
  "incorrect_credentials",
  "rate_limited",
  "service_unreachable",
  "provider_error",
];

export function loginFailureReasonFor(code: ErrorCode): LoginFailureReason {
  switch (code) {
    case "AUTH_INCORRECT_PASSWORD":
    case "AUTH_INCORRECT_CREDENTIALS":
      return "incorrect_credentials";
    case "AUTH_PROVIDER_RATE_LIMITED":
      return "rate_limited";
    case "AUTH_SERVICE_UNREACHABLE":
      return "service_unreachable";
    default:
      return "provider_error";
  }
}
```

- [ ] **Step 4: Implement `src/lib/errors/classify.ts`**

```ts
/**
 * Anything thrown → AppError. Pure (no Prisma import: detection is by name and
 * code, as in `@/lib/db-errors`), so it runs in tests and on any server path.
 */

import { ZodError } from "zod";
import { isAuthError } from "@supabase/supabase-js";
import { classifyDbFailure } from "@/lib/db-errors";
import { AppError, type ErrorContext } from "./app-error";
import { validationError } from "./validation";
import { mapSupabaseAuthError } from "./supabase";

export type ClassifyOptions = {
  /** Completes "Couldn't {verb}" in database messages, e.g. "save the section". */
  verb?: string;
};

const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

function prop(err: unknown, key: string): unknown {
  return err && typeof err === "object" ? (err as Record<string, unknown>)[key] : undefined;
}

function prismaName(err: unknown): string | null {
  const name = prop(err, "name");
  if (typeof name === "string" && PRISMA_ERROR_NAMES.has(name)) return name;
  const code = prop(err, "code");
  return typeof code === "string" && /^P\d{4}$/.test(code) ? "PrismaClientKnownRequestError" : null;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

/** Admin detail: the whole message, bounded. Prisma's first line is often just "Invalid … invocation:". */
function detailOf(err: unknown): string {
  return rawMessage(err).replace(/\s+/g, " ").trim().slice(0, 2000);
}

export function classifyError(err: unknown, options: ClassifyOptions = {}): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return validationError(err);

  const params = options.verb ? { verb: options.verb } : {};
  const name = prismaName(err);
  if (name) {
    const code = prop(err, "code");
    const context: ErrorContext = { prismaError: name };
    if (typeof code === "string") context.prismaCode = code;
    const base = { cause: err, detail: detailOf(err), context };

    if (name === "PrismaClientValidationError") return new AppError("INTERNAL_ERROR", base);
    if (name === "PrismaClientInitializationError" && /environment variable not found/i.test(rawMessage(err))) {
      return new AppError("CONFIG_MISSING", base);
    }
    if (code === "P2025") return new AppError("NOT_FOUND", base);
    if (code === "P2002") return new AppError("DB_CONFLICT", base);

    const kind = classifyDbFailure(err);
    const appCode =
      kind === "SCHEMA_OUT_OF_DATE" ? "DB_SCHEMA_OUT_OF_DATE" : kind === "UNAVAILABLE" ? "DB_UNAVAILABLE" : "DB_ERROR";
    return new AppError(appCode, { ...base, params });
  }

  if (isAuthError(err)) {
    return new AppError(mapSupabaseAuthError(err, "server"), {
      cause: err,
      detail: detailOf(err),
      context: {
        supabaseCode: typeof err.code === "string" ? err.code : null,
        supabaseStatus: typeof err.status === "number" ? err.status : null,
      },
    });
  }

  return new AppError("INTERNAL_ERROR", { cause: err, detail: detailOf(err) });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/errors`
Expected: PASS. If `AuthApiError`'s constructor signature differs in the installed supabase-js, check `node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts` and adjust only the test's construction.

- [ ] **Step 6: Commit**

```bash
git add src/lib/errors tests/unit/errors
git commit -m "feat(errors): classify anything thrown, and read Supabase refusals by code"
```

---
### Task 3: `ErrorEvent` table (database-engineer)

**Files:**
- Modify: `prisma/schema.prisma` (append the model), `prisma/rls-policies.sql` (enable list)
- Create: `prisma/migrations/20260911000003_add_error_event/migration.sql`
- Test: `tests/unit/rls-coverage.test.ts` (existing, unchanged)

**Interfaces:**
- Produces: `prisma.errorEvent` with `id, ref, code, severity, message, stack, route, routeType, method, userId, schoolId, context, createdAt`

Route this task to the `database-engineer` agent (CLAUDE.md: single owner of `prisma/**`) with these steps.

- [ ] **Step 1: Append the model to `prisma/schema.prisma`**

```prisma
/// One server-side failure worth an admin's attention: a `security` refusal or a
/// `system` failure. Written by `src/lib/errors/report.ts`, read only by the
/// Super Admin page `/admin/errors`.
///
/// Deliberately unrelated to User/School (plain id columns, no FKs): a failure
/// must be recordable while the rows it concerns are broken or gone, and a
/// deleted school must not cascade its error history away before retention does.
/// `ref` is not unique: a Next.js digest repeats for the same underlying error,
/// and searching one should show every occurrence. Purged after
/// ERROR_EVENT_RETENTION_DAYS (default 30) by the daily cron.
model ErrorEvent {
  id        String   @id @default(uuid())
  ref       String
  code      String
  severity  String
  message   String
  stack     String?
  route     String?
  routeType String?
  method    String?
  userId    String?
  schoolId  String?
  context   Json?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([ref])
  @@index([code, createdAt])
  @@index([schoolId, createdAt])
}
```

- [ ] **Step 2: Author the migration offline**

```bash
mkdir -p prisma/migrations/20260911000003_add_error_event
git show HEAD:prisma/schema.prisma > "<scratchpad>/schema.before.prisma"
npx prisma migrate diff --from-schema-datamodel "<scratchpad>/schema.before.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260911000003_add_error_event/migration.sql
```
Expected: only `CREATE TABLE "ErrorEvent"` plus four `CREATE INDEX`. Prepend a header comment (additive, no backfill, safe to apply before or after the code deploy). Follow repo convention on whether create-table migrations also `ENABLE ROW LEVEL SECURITY` (check the most recent create-table migration).

- [ ] **Step 3: Add `ALTER TABLE "ErrorEvent" ENABLE ROW LEVEL SECURITY;` to the enable list in `prisma/rls-policies.sql`.** No policies: deny-all is the point.

- [ ] **Step 4: Validate offline**

Run: `npx prisma validate && npx prisma format && npx prisma generate && npx vitest run tests/unit/rls-coverage.test.ts`
Expected: all pass. Never run `migrate dev/deploy`, `db push`, or anything against a database.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/rls-policies.sql prisma/migrations/20260911000003_add_error_event
git commit -m "feat(db): an ErrorEvent table for failures admins need to see"
```

---

### Task 4: Email sender and throttled alerts

**Files:**
- Create: `src/lib/email.ts`, `src/lib/errors/alert.ts`
- Modify: `.env.example`
- Test: `tests/unit/errors/alert.test.ts`

**Interfaces:**
- Consumes: `checkRateLimit` (`@/lib/rate-limit`)
- Produces:
  - `isEmailConfigured() → boolean`, `sendEmail({ to: string[]; subject; text }) → Promise<void>` (throws on failure)
  - `alertRecipients() → string[]`
  - `sendErrorAlert(event: AlertEvent) → Promise<void>` (never throws)
  - `type AlertEvent = { ref; code; route: string | null; schoolId: string | null; summary: string; at: Date }`

- [ ] **Step 1: Write the failing test** `tests/unit/errors/alert.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  get sendEmail() {
    return sendEmail;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
}));

import { alertRecipients, sendErrorAlert } from "@/lib/errors/alert";

const EVENT = {
  ref: "E-7K2P9QXM",
  code: "DB_UNAVAILABLE",
  route: "saveSection",
  schoolId: "school-1",
  summary: "P2024 Timed out fetching a new connection from the connection pool",
  at: new Date("2026-09-11T02:00:00Z"),
};

const ENV_KEYS = ["ERROR_ALERT_EMAIL", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "NEXT_PUBLIC_APP_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ERROR_ALERT_EMAIL = "ops@example.org, lead@example.org";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "LITRACK <noreply@example.org>";
  process.env.NEXT_PUBLIC_APP_URL = "https://litrack.example.org";
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  sendEmail.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sendErrorAlert", () => {
  it("splits the recipient list", () => {
    expect(alertRecipients()).toEqual(["ops@example.org", "lead@example.org"]);
  });

  it("emails the code, reference and a deep link — and no stack", async () => {
    await sendErrorAlert(EVENT);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["ops@example.org", "lead@example.org"]);
    expect(mail.subject).toContain("DB_UNAVAILABLE");
    expect(mail.subject).toContain("E-7K2P9QXM");
    expect(mail.text).toContain("https://litrack.example.org/admin/errors?ref=E-7K2P9QXM");
    expect(mail.text).not.toMatch(/\n\s+at /);
  });

  it("throttles per code", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });
    await sendErrorAlert(EVENT);
    expect(checkRateLimit).toHaveBeenCalledWith("alert:DB_UNAVAILABLE", expect.objectContaining({ limit: 1 }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stays off without a recipient or a sender", async () => {
    delete process.env.ERROR_ALERT_EMAIL;
    await sendErrorAlert(EVENT);
    process.env.ERROR_ALERT_EMAIL = "ops@example.org";
    delete process.env.RESEND_API_KEY;
    await sendErrorAlert(EVENT);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never throws when the email provider fails", async () => {
    sendEmail.mockRejectedValue(new Error("Resend 500"));
    await expect(sendErrorAlert(EVENT)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/errors/alert.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/email.ts`**

```ts
import "server-only";
import { Resend } from "resend";

/**
 * The one place LITRACK sends email through Resend. Reads env directly rather
 * than through `getServerEnv`, so a half-configured deployment degrades to
 * "email off" instead of throwing inside an error path.
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

export async function sendEmail(input: { to: string[]; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) throw new Error("Email is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)");

  const { error } = await new Resend(key).emails.send({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
}
```

- [ ] **Step 4: Implement `src/lib/errors/alert.ts`**

```ts
import "server-only";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email";

/**
 * Email an admin when something on our side fails.
 *
 * One email per code per 15 minutes: an outage produces hundreds of identical
 * events, and the first one is the only one that tells anybody anything. With
 * Upstash the window is global; without it, per instance (the documented
 * limitation of the rate limiter), so a duplicate can occasionally slip through.
 *
 * No stack and no personal data in the body — email is the least protected
 * place this information could go. The link leads to the full record.
 */

export type AlertEvent = {
  ref: string;
  code: string;
  route: string | null;
  schoolId: string | null;
  summary: string;
  at: Date;
};

const ALERT_WINDOW = { limit: 1, windowMs: 15 * 60 * 1000 } as const;

let warnedOff = false;

export function alertRecipients(): string[] {
  return (process.env.ERROR_ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendErrorAlert(event: AlertEvent): Promise<void> {
  try {
    const to = alertRecipients();
    if (to.length === 0 || !isEmailConfigured()) {
      if (!warnedOff) {
        warnedOff = true;
        console.warn(
          "[errors] Alert emails are off: set ERROR_ALERT_EMAIL, RESEND_API_KEY and RESEND_FROM_EMAIL to turn them on."
        );
      }
      return;
    }

    const gate = await checkRateLimit(`alert:${event.code}`, ALERT_WINDOW);
    if (!gate.ok) return;

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const link = `${base}/admin/errors?ref=${encodeURIComponent(event.ref)}`;

    await sendEmail({
      to,
      subject: `[LITRACK] ${event.code} — ${event.ref}`,
      text: [
        "LITRACK recorded a server-side failure.",
        "",
        `Code:      ${event.code}`,
        `Reference: ${event.ref}`,
        `When:      ${event.at.toISOString()}`,
        `Where:     ${event.route ?? "unknown"}`,
        `School:    ${event.schoolId ?? "none"}`,
        `Summary:   ${event.summary.split("\n")[0].slice(0, 300)}`,
        "",
        `Full record: ${link}`,
        "",
        "Further failures with this code are not emailed for the next 15 minutes.",
      ].join("\n"),
    });
  } catch (err) {
    console.error("[errors] alert email failed:", err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 5: Document the env vars** — append to `.env.example`:

```bash
# Error alerts (optional). Comma-separated recipients for emails about
# server-side failures; needs RESEND_API_KEY and RESEND_FROM_EMAIL too.
ERROR_ALERT_EMAIL=""
# Days to keep rows in the ErrorEvent table (default 30).
ERROR_EVENT_RETENTION_DAYS="30"
```

- [ ] **Step 6: Run to verify it passes** — `npx vitest run tests/unit/errors/alert.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email.ts src/lib/errors/alert.ts tests/unit/errors/alert.test.ts .env.example
git commit -m "feat(errors): throttled alert emails through Resend"
```

---
