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
### Task 5: Scope, report, retention

**Files:**
- Create: `src/lib/errors/context.ts`, `src/lib/errors/report.ts`, `src/lib/errors/retention.ts`
- Test: `tests/unit/errors/report.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4
- Produces:
  - `runInErrorScope(route, fn)`, `currentErrorScope() → ErrorScope | undefined`, `noteScopeUser({ id, schoolId })`
  - `reportError(err: AppError, input?: ReportInput) → string` (the ref; I/O deferred, never throws)
  - `newReference() → string` matching `/^E-[0-9A-HJKMNP-TV-Z]{8}$/`
  - `type ReportInput = { route?; routeType?; method?; ref?; userId?; schoolId?; authId?; userSource?: "session" | "cookie" }`
  - `errorRetentionDays() → number`, `purgeExpiredErrorEvents(now?) → Promise<number>`

- [ ] **Step 1: Write the failing test** `tests/unit/errors/report.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const errorEventCreate = vi.fn();
const errorEventDeleteMany = vi.fn();
const userFindUnique = vi.fn();
const sendErrorAlert = vi.fn();
const deferred: Promise<unknown>[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    errorEvent: {
      get create() {
        return errorEventCreate;
      },
      get deleteMany() {
        return errorEventDeleteMany;
      },
    },
    user: {
      get findUnique() {
        return userFindUnique;
      },
    },
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    deferred.push(task());
  },
}));
vi.mock("@/lib/errors/alert", () => ({
  get sendErrorAlert() {
    return sendErrorAlert;
  },
}));

import { AppError } from "@/lib/errors/app-error";
import { noteScopeUser, runInErrorScope } from "@/lib/errors/context";
import { newReference, reportError } from "@/lib/errors/report";
import { errorRetentionDays, purgeExpiredErrorEvents } from "@/lib/errors/retention";

async function flush() {
  await Promise.all(deferred.splice(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  errorEventCreate.mockResolvedValue({});
  sendErrorAlert.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("newReference", () => {
  it("is short, unambiguous and random", () => {
    const a = newReference();
    expect(a).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(newReference()).not.toBe(a);
  });
});

describe("reportError", () => {
  it("returns a reference immediately and stores the event after the response", async () => {
    const cause = Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" });
    const ref = reportError(
      new AppError("DB_UNAVAILABLE", { cause, detail: "P2024 pool timeout", context: { prismaCode: "P2024" } }),
      { route: "saveSection", routeType: "action" }
    );
    expect(ref).toMatch(/^E-/);
    await flush();
    const row = errorEventCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({ ref, code: "DB_UNAVAILABLE", severity: "system", route: "saveSection", routeType: "action" });
    expect(row.message).toContain("P2024 pool timeout");
    expect(row.stack).toContain("Timed out");
    expect(row.context).toMatchObject({ prismaCode: "P2024" });
  });

  it("keeps only allow-listed context keys", async () => {
    reportError(new AppError("AUTH_FORBIDDEN", { context: { reason: "role_mismatch", email: "a@b.c", password: "x" } }));
    await flush();
    const ctx = errorEventCreate.mock.calls[0][0].data.context;
    expect(ctx.reason).toBe("role_mismatch");
    expect(ctx).not.toHaveProperty("email");
    expect(ctx).not.toHaveProperty("password");
  });

  it("uses the verified user from the action scope", async () => {
    await runInErrorScope("changePassword", async () => {
      noteScopeUser({ id: "user-1", schoolId: "school-1" });
      reportError(new AppError("AUTH_PROVIDER_ERROR"));
    });
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      schoolId: "school-1",
      route: "changePassword",
    });
  });

  it("resolves a cookie-derived auth id to a user id, marked as such", async () => {
    userFindUnique.mockResolvedValue({ id: "user-9", schoolId: "school-9" });
    reportError(new AppError("INTERNAL_ERROR"), { authId: "auth-9", userSource: "cookie" });
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data).toMatchObject({ userId: "user-9", schoolId: "school-9" });
    expect(errorEventCreate.mock.calls[0][0].data.context.userSource).toBe("cookie");
  });

  it("writes one searchable JSON line to the log", () => {
    const ref = reportError(new AppError("INTERNAL_ERROR"));
    const line = vi
      .mocked(console.error)
      .mock.calls.map((c) => String(c[0]))
      .find((s) => s.includes(ref));
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toMatchObject({ tag: "litrack.error", ref, code: "INTERNAL_ERROR" });
  });

  it("never throws when the database is down", async () => {
    errorEventCreate.mockRejectedValue(new Error("P1001 can't reach database"));
    expect(() => reportError(new AppError("DB_UNAVAILABLE"))).not.toThrow();
    await expect(flush()).resolves.toBeDefined();
  });

  it("alerts for system failures only", async () => {
    reportError(new AppError("DB_UNAVAILABLE"));
    reportError(new AppError("AUTH_FORBIDDEN"));
    await flush();
    expect(sendErrorAlert).toHaveBeenCalledTimes(1);
    expect(sendErrorAlert.mock.calls[0][0]).toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it("still alerts when the insert fails", async () => {
    errorEventCreate.mockRejectedValue(new Error("down"));
    reportError(new AppError("DB_UNAVAILABLE"));
    await flush();
    expect(sendErrorAlert).toHaveBeenCalledTimes(1);
  });

  it("files school-scoped refusals under the school", async () => {
    reportError(new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", { context: { schoolId: "school-3" } }));
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data.schoolId).toBe("school-3");
  });
});

describe("retention", () => {
  it("defaults to 30 days and honours a sane override", () => {
    delete process.env.ERROR_EVENT_RETENTION_DAYS;
    expect(errorRetentionDays()).toBe(30);
    process.env.ERROR_EVENT_RETENTION_DAYS = "7";
    expect(errorRetentionDays()).toBe(7);
    process.env.ERROR_EVENT_RETENTION_DAYS = "0";
    expect(errorRetentionDays()).toBe(30);
    delete process.env.ERROR_EVENT_RETENTION_DAYS;
  });

  it("deletes only rows older than the cutoff", async () => {
    errorEventDeleteMany.mockResolvedValue({ count: 4 });
    const now = new Date("2026-09-30T00:00:00Z");
    await expect(purgeExpiredErrorEvents(now)).resolves.toBe(4);
    expect(errorEventDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-31T00:00:00Z") } },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/errors/report.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/errors/context.ts`**

```ts
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who and where, for the duration of one wrapped server action or route.
 *
 * `action()`/`route()` open the scope with the route name; `requireUser` fills
 * in the verified user when one is resolved. `reportError` reads it, so an
 * error record names the user without every throw site passing ids around.
 */

export type ErrorScope = { route: string; userId?: string; schoolId?: string | null };

const storage = new AsyncLocalStorage<ErrorScope>();

export function runInErrorScope<T>(route: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ route }, fn);
}

export function currentErrorScope(): ErrorScope | undefined {
  return storage.getStore();
}

/** Called by `requireUser`. A no-op outside a wrapped action or route. */
export function noteScopeUser(user: { id: string; schoolId: string | null }): void {
  const scope = storage.getStore();
  if (!scope) return;
  scope.userId = user.id;
  scope.schoolId = user.schoolId;
}
```

- [ ] **Step 4: Implement `src/lib/errors/report.ts`**

```ts
import "server-only";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppError } from "./app-error";
import { currentErrorScope } from "./context";
import { sendErrorAlert } from "./alert";

/**
 * Record a failure for admins. Returns the reference synchronously; the log line
 * is written now, the ErrorEvent row and any alert after the response.
 *
 * Never throws. An error path that can itself fail is how the original error
 * gets lost — so every step is independently guarded, and the console line comes
 * first because it survives a database outage, which is exactly when the table
 * cannot be written.
 */

export type ReportInput = {
  route?: string;
  routeType?: string;
  method?: string;
  /** Use this reference instead of generating one (page errors use Next's digest). */
  ref?: string;
  userId?: string | null;
  schoolId?: string | null;
  /** Supabase auth id, resolved to a user after the response. Attribution only. */
  authId?: string | null;
  userSource?: "session" | "cookie";
};

/** Crockford base32: no I, L, O or U, so a reference read aloud survives. */
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `E-${Array.from(bytes, (b) => REF_ALPHABET[b % 32]).join("")}`;
}

/**
 * The only context keys ever stored. Everything else a thrower attaches is
 * dropped, so a stray `email` or `password` can never reach the table.
 */
export const ERROR_CONTEXT_KEYS = new Set([
  "prismaCode",
  "prismaError",
  "supabaseCode",
  "supabaseStatus",
  "retryAfterSeconds",
  "resource",
  "crossTenant",
  "reason",
  "schoolId",
  "digest",
  "userSource",
  "service",
]);

type EventRow = {
  ref: string;
  code: string;
  severity: string;
  message: string;
  stack: string | null;
  route: string | null;
  routeType: string | null;
  method: string | null;
  userId: string | null;
  schoolId: string | null;
  context: Record<string, unknown>;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function adminMessage(err: AppError): string {
  const cause = err.cause instanceof Error ? err.cause.message : typeof err.cause === "string" ? err.cause : "";
  const parts = [err.detail, cause].filter((p): p is string => Boolean(p && p.trim()));
  return truncate([...new Set(parts)].join(" | ") || err.message, 2000);
}

function adminStack(err: AppError): string | null {
  const stack = err.cause instanceof Error && err.cause.stack ? err.cause.stack : err.stack;
  return stack ? truncate(stack, 8000) : null;
}

function safeContext(err: AppError, input: ReportInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(err.context)) {
    if (ERROR_CONTEXT_KEYS.has(key)) out[key] = value;
  }
  if (input.userSource) out.userSource = input.userSource;
  if (input.ref && input.routeType && input.routeType !== "action") out.digest = input.ref;
  return out;
}

function logLine(row: EventRow): void {
  try {
    console.error(
      JSON.stringify({
        tag: "litrack.error",
        ...row,
        stack: row.stack?.split("\n").slice(0, 6).join("\n") ?? null,
      })
    );
  } catch {
    // A console replaced by a log forwarder must not fail the request.
  }
}

async function persist(row: EventRow, authId: string | null): Promise<void> {
  let { userId, schoolId } = row;
  try {
    if (!userId && authId) {
      const user = await prisma.user.findUnique({ where: { authId }, select: { id: true, schoolId: true } });
      userId = user?.id ?? null;
      schoolId = schoolId ?? user?.schoolId ?? null;
    }
    await prisma.errorEvent.create({
      data: { ...row, userId, schoolId, context: row.context as Prisma.InputJsonValue },
    });
  } catch (insertErr) {
    console.error("[errors] ErrorEvent insert failed:", insertErr instanceof Error ? insertErr.message : insertErr);
  }

  if (row.severity === "system") {
    await sendErrorAlert({
      ref: row.ref,
      code: row.code,
      route: row.route,
      schoolId,
      summary: row.message,
      at: new Date(),
    });
  }
}

/** Same contract as `deferOrRun` in `@/lib/audit`: queue after the response, or run now. */
function deferOrRun(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

export function reportError(err: AppError, input: ReportInput = {}): string {
  const scope = currentErrorScope();
  const ref = input.ref ?? newReference();
  try {
    const contextSchool = typeof err.context.schoolId === "string" ? err.context.schoolId : null;
    const row: EventRow = {
      ref,
      code: err.code,
      severity: err.severity,
      message: adminMessage(err),
      stack: adminStack(err),
      route: input.route ?? scope?.route ?? null,
      routeType: input.routeType ?? (scope ? "action" : null),
      method: input.method ?? null,
      userId: input.userId ?? scope?.userId ?? null,
      schoolId: input.schoolId ?? scope?.schoolId ?? contextSchool,
      context: safeContext(err, input),
    };
    logLine(row);
    deferOrRun(() => persist(row, input.authId ?? null));
  } catch (reportErr) {
    console.error("[errors] reportError failed:", reportErr);
  }
  return ref;
}
```

- [ ] **Step 5: Implement `src/lib/errors/retention.ts`**

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function errorRetentionDays(): number {
  const raw = Number(process.env.ERROR_EVENT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_DAYS;
}

/** Bounded by date; run from the daily cron. Returns the number of rows removed. */
export async function purgeExpiredErrorEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - errorRetentionDays() * DAY_MS);
  const { count } = await prisma.errorEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
```

- [ ] **Step 6: Run to verify it passes** — `npx vitest run tests/unit/errors` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/errors tests/unit/errors
git commit -m "feat(errors): report failures to the log, the ErrorEvent table and alerts"
```

---

### Task 6: The `action()` and `route()` wrappers

**Files:**
- Create: `src/lib/errors/action.ts`, `src/lib/errors/route.ts`
- Test: `tests/unit/errors/action.test.ts`, `tests/unit/errors/route.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5
- Produces:
  - `action<Args, R>(name, fn, options?) → (...args: Args) => Promise<R | ActionFailure>`; `type ActionOptions = { verb?: string }`
  - `route(name, handler) → (request: NextRequest) => Promise<Response>`
  - `errorResponse(request, err, ref?) → Response`

**Why this shape:** verified against the installed Next 15.5 — `ensureServerEntryExports` only requires each export of a `"use server"` file to be a function, so `export const x = action("x", async () => {})` is valid.

- [ ] **Step 1: Write the failing tests** `tests/unit/errors/action.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn(() => "E-TESTREF1");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { notFound, redirect } from "next/navigation";
import { action } from "@/lib/errors/action";
import { AppError, fieldError } from "@/lib/errors/app-error";
import { currentErrorScope } from "@/lib/errors/context";

beforeEach(() => {
  vi.clearAllMocks();
  reportError.mockReturnValue("E-TESTREF1");
});

describe("action()", () => {
  it("returns what the body returns when nothing goes wrong", async () => {
    const run = action("ok", async (n: number) => ({ ok: true as const, data: n * 2 }));
    await expect(run(21)).resolves.toEqual({ ok: true, data: 42 });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("turns an AppError into the house failure shape", async () => {
    const run = action("wrong", async () => {
      throw new AppError("AUTH_INCORRECT_PASSWORD");
    });
    await expect(run()).resolves.toEqual({
      ok: false,
      code: "AUTH_INCORRECT_PASSWORD",
      error: "Incorrect password. Check it and try again.",
    });
  });

  it("does not record an expected mistake", async () => {
    const run = action("invalid", async () => {
      throw fieldError("email", "Email is required");
    });
    const res = await run();
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", fieldErrors: { email: "Email is required" } });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("records a refusal but gives the person no reference", async () => {
    const run = action("denied", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    });
    const res = await run();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(res).not.toHaveProperty("ref");
  });

  it("records an unexpected failure and hands back a reference", async () => {
    const run = action("boom", async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'id')");
    }, { verb: "save the section" });
    const res = await run();
    expect(res).toMatchObject({ ok: false, code: "INTERNAL_ERROR", ref: "E-TESTREF1" });
    expect((res as { error: string }).error).toContain("Reference: E-TESTREF1");
    expect((res as { error: string }).error).not.toContain("undefined");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("uses the verb for database failures", async () => {
    const run = action("db", async () => {
      throw Object.assign(new Error("pool timeout"), { name: "PrismaClientKnownRequestError", code: "P2024" });
    }, { verb: "save the section" });
    const res = await run();
    expect((res as { error: string }).error).toMatch(/^Couldn't save the section: the database didn't respond/);
  });

  it("lets Next's redirect through untouched", async () => {
    const run = action("redirects", async () => {
      redirect("/teacher");
    });
    await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("lets Next's notFound() through untouched", async () => {
    const run = action("missing", async () => {
      notFound();
    });
    await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK") });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("opens a scope named after the action", async () => {
    let seen: string | undefined;
    const run = action("namedAction", async () => {
      seen = currentErrorScope()?.route;
      return { ok: true as const };
    });
    await run();
    expect(seen).toBe("namedAction");
  });
});
```

`tests/unit/errors/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn(() => "E-TESTREF2");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { AppError, tooManyAttempts } from "@/lib/errors/app-error";
import { route } from "@/lib/errors/route";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, "https://litrack.example.org"), { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  reportError.mockReturnValue("E-TESTREF2");
});

describe("route()", () => {
  it("passes a successful response through", async () => {
    const handler = route("GET /api/x", async () => NextResponse.json({ ok: true }));
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(200);
  });

  it("answers a refused request with the house JSON shape", async () => {
    const handler = route("GET /api/x", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      code: "AUTH_FORBIDDEN",
      message: "You don't have access to this.",
      status: 403,
    });
  });

  it("adds a reference for an unexpected failure", async () => {
    const handler = route("GET /api/x", async () => {
      throw new Error("kaboom");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", ref: "E-TESTREF2" });
    expect(body.message).not.toContain("kaboom");
  });

  it("sets Retry-After when the limiter says how long", async () => {
    const handler = route("GET /api/x", async () => {
      throw tooManyAttempts(30_000, "RATE_LIMITED");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("sends a browser to the right page instead of raw JSON", async () => {
    const html = { accept: "text/html,application/xhtml+xml" };
    const forbidden = await route("GET /api/admin/x", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    })(request("/api/admin/x", html));
    expect(forbidden.status).toBe(303);
    expect(forbidden.headers.get("location")).toContain("/forbidden");

    const signedOut = await route("GET /api/admin/x", async () => {
      throw new AppError("AUTH_NOT_SIGNED_IN");
    })(request("/api/admin/x", html));
    expect(signedOut.headers.get("location")).toContain("/admin/login");
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/errors/action.test.ts tests/unit/errors/route.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/errors/action.ts`**

```ts
import "server-only";
import { unstable_rethrow } from "next/navigation";
import { classifyError } from "./classify";
import { runInErrorScope } from "./context";
import { reportError } from "./report";
import { toFailure, type ActionFailure } from "./result";

/**
 * The single handler for server actions.
 *
 * Wrap each action once and let the body throw `AppError` instead of building
 * `{ ok: false, error }` by hand. Anything else that escapes — Prisma, Supabase,
 * a bug — is classified, recorded for admins, and answered with a safe message.
 *
 * `unstable_rethrow` runs FIRST and is not optional: `redirect()` and
 * `notFound()` work by throwing, `requireUser` uses both, and swallowing them
 * here would turn every sign-in redirect into a silent failure.
 */

export type ActionOptions = {
  /** Completes "Couldn't {verb}" in database messages, e.g. "save the section". */
  verb?: string;
};

export function action<Args extends unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
  options: ActionOptions = {}
): (...args: Args) => Promise<R | ActionFailure> {
  return async (...args: Args): Promise<R | ActionFailure> =>
    runInErrorScope(name, async () => {
      try {
        return await fn(...args);
      } catch (err) {
        unstable_rethrow(err);
        const appError = classifyError(err, { verb: options.verb });
        if (appError.severity === "user") return toFailure(appError);
        const ref = reportError(appError, { route: name, routeType: "action" });
        // Only a failure on our side is worth a reference: it is the code an
        // admin can look up. A refusal or a rate limit is recorded without one.
        return toFailure(appError, appError.severity === "system" ? ref : undefined);
      }
    });
}
```

- [ ] **Step 4: Implement `src/lib/errors/route.ts`**

```ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { withReference } from "./codes";
import { AppError } from "./app-error";
import { classifyError } from "./classify";
import { runInErrorScope } from "./context";
import { reportError } from "./report";

/** The same handler as `action()`, for the three API routes. */

type RouteHandler = (request: NextRequest) => Promise<Response>;

export function errorResponse(request: NextRequest, err: AppError, ref?: string): Response {
  // A download link opened in a browser should land on a page, not on JSON.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html") && (err.status === 401 || err.status === 403)) {
    const target =
      err.status === 403
        ? "/forbidden"
        : request.nextUrl.pathname.startsWith("/api/admin")
          ? "/admin/login"
          : "/login";
    return NextResponse.redirect(new URL(target, request.url), 303);
  }

  const headers = new Headers();
  const retryAfter = err.context.retryAfterSeconds;
  if (typeof retryAfter === "number") headers.set("Retry-After", String(Math.max(1, retryAfter)));

  return NextResponse.json(
    {
      code: err.code,
      message: withReference(err.message, ref),
      status: err.status,
      ...(ref ? { ref } : {}),
    },
    { status: err.status, headers }
  );
}

export function route(name: string, handler: RouteHandler): RouteHandler {
  return async (request: NextRequest): Promise<Response> =>
    runInErrorScope(name, async () => {
      try {
        return await handler(request);
      } catch (err) {
        unstable_rethrow(err);
        const appError = classifyError(err);
        if (appError.severity === "user") return errorResponse(request, appError);
        const ref = reportError(appError, { route: name, routeType: "route", method: request.method });
        return errorResponse(request, appError, appError.severity === "system" ? ref : undefined);
      }
    });
}
```

- [ ] **Step 5: Run to verify they pass** — `npx vitest run tests/unit/errors` — Expected: PASS. If importing `next/navigation` in the node test environment fails, mock it with a factory that re-exports the real `redirect`/`notFound`/`unstable_rethrow` rather than weakening the assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/errors tests/unit/errors
git commit -m "feat(errors): one wrapper for server actions, one for API routes"
```

---

### Task 7: Page-render errors reach the same log

**Files:**
- Create: `src/lib/errors/session-cookie.ts`, `src/lib/errors/request-error.ts`
- Modify: `src/instrumentation.ts`
- Test: `tests/unit/errors/session-cookie.test.ts`, `tests/unit/errors/request-error.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5
- Produces:
  - `authIdFromCookieHeader(header: string | string[] | undefined) → string | null`
  - `reportRequestError(err, request, context) → Promise<void>` (never throws)
  - `onRequestError` exported from `src/instrumentation.ts`

- [ ] **Step 1: Write the failing tests** `tests/unit/errors/session-cookie.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { authIdFromCookieHeader } from "@/lib/errors/session-cookie";

function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(payload)}.signature`;
}

function sessionCookie(authId: string): string {
  const session = { access_token: jwt({ sub: authId }), token_type: "bearer" };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

describe("authIdFromCookieHeader", () => {
  it("reads the auth id out of a base64 session cookie", () => {
    const header = `theme=dark; sb-abcdefgh-auth-token=${sessionCookie("auth-123")}`;
    expect(authIdFromCookieHeader(header)).toBe("auth-123");
  });

  it("joins the chunks of a split cookie in order", () => {
    const whole = sessionCookie("auth-456");
    const half = Math.ceil(whole.length / 2);
    const header = `sb-abcdefgh-auth-token.0=${whole.slice(0, half)}; sb-abcdefgh-auth-token.1=${whole.slice(half)}`;
    expect(authIdFromCookieHeader(header)).toBe("auth-456");
  });

  it("reads the older raw-JSON and array cookie formats", () => {
    const raw = encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: "auth-789" }) }));
    expect(authIdFromCookieHeader(`sb-x-auth-token=${raw}`)).toBe("auth-789");
    const arrayForm = encodeURIComponent(JSON.stringify([jwt({ sub: "auth-abc" }), "refresh"]));
    expect(authIdFromCookieHeader(`sb-x-auth-token=${arrayForm}`)).toBe("auth-abc");
  });

  it("returns null rather than throwing on anything unexpected", () => {
    expect(authIdFromCookieHeader(undefined)).toBeNull();
    expect(authIdFromCookieHeader("")).toBeNull();
    expect(authIdFromCookieHeader("sb-x-auth-token=not-base64-or-json")).toBeNull();
    expect(authIdFromCookieHeader("theme=dark")).toBeNull();
    expect(authIdFromCookieHeader(`sb-x-auth-token=base64-${Buffer.from("{}").toString("base64url")}`)).toBeNull();
  });
});
```

`tests/unit/errors/request-error.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn(() => "E-IGNORED");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { reportRequestError } from "@/lib/errors/request-error";

const REQUEST = { path: "/teacher/learners/abc?q=maria", method: "GET", headers: {} as Record<string, string> };
const CONTEXT = { routerKind: "App Router" as const, routePath: "/teacher/learners/[id]", routeType: "render" as const, revalidateReason: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportRequestError", () => {
  it("records a crashed render under the route pattern, using Next's digest as the reference", async () => {
    const err = Object.assign(new Error("boom"), { digest: "2847562910" });
    await reportRequestError(err, REQUEST, CONTEXT);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [appError, input] = reportError.mock.calls[0];
    expect(appError).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(input).toMatchObject({ ref: "2847562910", route: "/teacher/learners/[id]", routeType: "render", method: "GET" });
  });

  it("stores the route pattern, never the URL with its values", async () => {
    await reportRequestError(new Error("boom"), REQUEST, CONTEXT);
    expect(JSON.stringify(reportError.mock.calls[0][1])).not.toContain("maria");
  });

  it("ignores Next's control flow", async () => {
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_HTTP_ERROR_FALLBACK;404", "DYNAMIC_SERVER_USAGE"]) {
      await reportRequestError(Object.assign(new Error("control"), { digest }), REQUEST, CONTEXT);
    }
    expect(reportError).not.toHaveBeenCalled();
  });

  it("ignores an expected refusal that reached the boundary", async () => {
    const { AppError } = await import("@/lib/errors/app-error");
    await reportRequestError(new AppError("AUTH_SESSION_EXPIRED"), REQUEST, CONTEXT);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("attributes the error to the signed-in account when the cookie says who", async () => {
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${part({ alg: "HS256" })}.${part({ sub: "auth-42" })}.sig`;
    const cookie = `sb-proj-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: token })).toString("base64url")}`;
    await reportRequestError(new Error("boom"), { ...REQUEST, headers: { cookie } }, CONTEXT);
    expect(reportError.mock.calls[0][1]).toMatchObject({ authId: "auth-42", userSource: "cookie" });
  });

  it("never throws", async () => {
    reportError.mockImplementation(() => {
      throw new Error("reporting is broken");
    });
    await expect(reportRequestError(new Error("boom"), REQUEST, CONTEXT)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/errors/session-cookie.test.ts tests/unit/errors/request-error.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/errors/session-cookie.ts`**

```ts
/**
 * Who was signed in, read from the request's Supabase cookie.
 *
 * The JWT signature is NOT verified, and this must never gate access. It exists
 * so a crashed page render can be filed under an account: `onRequestError` runs
 * outside the request's React scope, where `getCurrentUser()` is unavailable.
 * Records written from it are marked `userSource: "cookie"`.
 */

const SESSION_COOKIE = /^sb-.+-auth-token(?:\.(\d+))?$/;

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : (header ?? "");
  const out = new Map<string, string>();
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  return out;
}

function decodeJwtSubject(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof json.sub === "string" && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}

export function authIdFromCookieHeader(header: string | string[] | undefined): string | null {
  try {
    const cookies = parseCookies(header);
    const names = [...cookies.keys()].filter((name) => SESSION_COOKIE.test(name));
    if (names.length === 0) return null;

    // @supabase/ssr splits a large session across `.0`, `.1`, … in order.
    const base = names[0].replace(/\.\d+$/, "");
    const chunks = names
      .filter((name) => name === base || name.startsWith(`${base}.`))
      .sort((a, b) => Number(a.split(".").pop() ?? 0) - Number(b.split(".").pop() ?? 0));
    let value = chunks.map((name) => cookies.get(name) ?? "").join("");
    if (!value) return null;

    value = decodeURIComponent(value);
    if (value.startsWith("base64-")) {
      value = Buffer.from(value.slice("base64-".length), "base64url").toString("utf8");
    }

    const session = JSON.parse(value) as unknown;
    if (Array.isArray(session)) return decodeJwtSubject(session[0]);
    if (session && typeof session === "object") {
      return decodeJwtSubject((session as { access_token?: unknown }).access_token);
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `src/lib/errors/request-error.ts`**

```ts
import "server-only";
import type { Instrumentation } from "next";
import { classifyError } from "./classify";
import { reportError } from "./report";
import { authIdFromCookieHeader } from "./session-cookie";

/**
 * Uncaught errors from page renders, route handlers, middleware, and any server
 * action not yet wrapped by `action()` — the reason every module gets admin
 * visibility from this slice, before its own migration.
 *
 * The reference stored is Next's `digest`, which is exactly what `error.tsx`
 * shows the person, so the code they read off the screen finds the record.
 */

const CONTROL_FLOW = /^(?:NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_STATIC_GEN_BAILOUT)/;

export const reportRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const digest = typeof (err as { digest?: unknown })?.digest === "string" ? (err as { digest: string }).digest : undefined;
    if (digest && CONTROL_FLOW.test(digest)) return;

    const appError = classifyError(err);
    // An expected refusal is already answered where it was thrown.
    if (appError.severity === "user") return;

    reportError(appError, {
      ref: digest,
      // The pattern ("/teacher/learners/[id]"), never the URL, which carries ids
      // and search terms.
      route: context.routePath,
      routeType: context.routeType,
      method: request.method,
      authId: authIdFromCookieHeader(request.headers.cookie),
      userSource: "cookie",
    });
  } catch (reportErr) {
    console.error("[errors] onRequestError failed:", reportErr instanceof Error ? reportErr.message : reportErr);
  }
};
```

- [ ] **Step 5: Wire it up in `src/instrumentation.ts`** — append below the existing `register()`:

```ts
/**
 * Node-runtime only, and dynamically imported for the same reason `register()`
 * is: the per-compilation NEXT_RUNTIME define folds this branch away in the edge
 * build, so middleware does not pay for Prisma and the reporting stack.
 */
export async function onRequestError(
  ...args: Parameters<Instrumentation.onRequestError>
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./lib/errors/request-error");
    await reportRequestError(...args);
  }
}
```

and add at the top of the file:

```ts
import type { Instrumentation } from "next";
```

- [ ] **Step 6: Run to verify they pass** — `npx vitest run tests/unit/errors && npm run typecheck` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/instrumentation.ts src/lib/errors tests/unit/errors
git commit -m "feat(errors): record crashed page renders under the digest the user sees"
```

---
### Task 8: Configuration failures and tenant refusals speak the catalog

**Files:**
- Modify: `src/lib/env.ts:78-82`, `src/lib/supabase/server.ts:14-18`, `src/lib/supabase/admin.ts:36-42`, `src/lib/auth/tenant.ts`, `src/app/login/page.tsx`, `src/app/admin/login/page.tsx`
- Test: `tests/unit/tenant.test.ts` (update)

**Interfaces:**
- Consumes: Tasks 1, 2, 5
- Produces: `assertSameSchool(userSchoolId, resourceSchoolId, resource = "Record")` throwing `AppError("NOT_FOUND")`; every configuration failure throwing `AppError("CONFIG_MISSING")` with the variable names in `detail`

**Security note being fixed:** the two login pages currently print env-var names and hosting details to anonymous visitors.

- [ ] **Step 1: Update `tests/unit/tenant.test.ts`** to pin the behaviour rather than the old string

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { assertSameSchool } from "@/lib/auth/tenant";

function caught(userSchoolId: string, resourceSchoolId: string | null | undefined, resource?: string) {
  try {
    assertSameSchool(userSchoolId, resourceSchoolId, resource);
    return null;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return err;
  }
}

describe("assertSameSchool", () => {
  it("passes when school ids match", () => {
    expect(caught("school-a", "school-a")).toBeNull();
  });

  it("refuses another school's row and a missing one with the SAME message", () => {
    const foreign = caught("school-a", "school-b");
    const missing = caught("school-a", null);
    expect(foreign?.code).toBe("NOT_FOUND");
    expect(missing?.code).toBe("NOT_FOUND");
    expect(foreign?.message).toBe(missing?.message);
    expect(caught("school-a", undefined)?.code).toBe("NOT_FOUND");
  });

  it("names the resource when asked, without leaking which case it was", () => {
    const err = caught("school-a", "school-b", "Learner");
    expect(err?.message).toBe("Learner not found. It may have been deleted or moved.");
    expect(err?.message).not.toContain("school-b");
  });

  it("records a cross-tenant attempt as a security event, a missing row as ordinary", () => {
    expect(caught("school-a", "school-b")?.severity).toBe("security");
    expect(caught("school-a", "school-b")?.context.crossTenant).toBe(true);
    expect(caught("school-a", null)?.severity).toBe("user");
  });

  it("keeps the other school's id for admins only", () => {
    const err = caught("school-a", "school-b");
    expect(err?.detail).toContain("school-b");
    expect(err?.message).not.toContain("school-b");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/tenant.test.ts` — Expected: FAIL (plain `Error("Not found")` is not an `AppError`).

- [ ] **Step 3: Rewrite `src/lib/auth/tenant.ts`**

```ts
import "server-only";
import { resourceNotFound } from "@/lib/errors/app-error";

/**
 * Tenant isolation.
 *
 * A row from another school and a row that does not exist produce the SAME
 * message, so existence in another tenant never leaks. Only the admin record
 * tells them apart: a cross-tenant attempt is severity "security" and carries
 * both school ids in `detail`, which is the signal worth reviewing.
 */
export function assertSameSchool(
  userSchoolId: string,
  resourceSchoolId: string | null | undefined,
  resource = "Record"
): void {
  if (!resourceSchoolId) throw resourceNotFound(resource);
  if (resourceSchoolId !== userSchoolId) {
    throw resourceNotFound(resource, {
      crossTenant: true,
      detail: `${resource} belongs to school ${resourceSchoolId}; requested from school ${userSchoolId}`,
    });
  }
}
```

- [ ] **Step 4: Make configuration failures classifiable** — three edits.

`src/lib/env.ts`, inside `getServerEnv`, replacing the `throw new Error(...)`:
```ts
  if (!parsed.success) {
    const missing = missingVarNames(parsed.error.issues);
    // Names only, never values — and now a code the handler can classify, so a
    // misconfigured server says "not set up yet" to the person and names the
    // variables only in the admin record.
    throw new AppError("CONFIG_MISSING", {
      detail: `Missing or invalid environment variables: ${missing.join(", ")}`,
      context: { reason: "env_missing" },
    });
  }
```
with `import { AppError } from "@/lib/errors/app-error";` at the top.

`src/lib/supabase/server.ts`:
```ts
  const env = getSupabasePublicEnv();
  if (!env.ok) {
    throw new AppError("CONFIG_MISSING", {
      detail: "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set",
      context: { reason: "supabase_env_missing" },
    });
  }
```

`src/lib/supabase/admin.ts` — both throws become:
```ts
    throw new AppError("CONFIG_MISSING", {
      detail: INVALID_SERVICE_ROLE_MESSAGE,
      context: { reason: "service_role_key" },
    });
```
Keep `INVALID_SERVICE_ROLE_MESSAGE` and `getInvalidServiceRoleMessage()` exactly as they are: they are now admin detail, not user copy.

- [ ] **Step 5: Stop showing env details on the two login pages**

`src/app/admin/login/page.tsx` — make the component async and replace the "Setup required" block:
```tsx
export default async function AdminLoginPage() {
  const supabaseReady = isSupabaseConfigured();
  if (!supabaseReady) {
    // Recorded once per render while misconfigured, which is the only time it
    // happens, and the only way anyone finds out before a school calls.
    reportError(
      new AppError("CONFIG_MISSING", {
        detail: SUPABASE_NOT_CONFIGURED_MESSAGE,
        context: { reason: "supabase_env_missing" },
      }),
      { route: "/admin/login", routeType: "render" }
    );
  }
  ...
          {!supabaseReady ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Sign-in unavailable</p>
              <p className="mt-1 text-amber-800/90">{formatMessage("CONFIG_MISSING")}</p>
            </div>
          ) : null}
```
with imports `import { AppError } from "@/lib/errors/app-error";`, `import { formatMessage } from "@/lib/errors/codes";`, `import { reportError } from "@/lib/errors/report";`.

`src/app/login/page.tsx` — replace the school-list `catch` and the `configUnavailable` message:
```tsx
  let schools: Awaited<ReturnType<typeof listSchoolsWithTeacherStatus>> = [];
  let schoolsUnavailable: string | null = null;

  try {
    schools = await listSchoolsWithTeacherStatus();
  } catch (err) {
    // An unreachable database and a missing DATABASE_URL are different problems
    // with different fixes; say which, and give the person a reference.
    const appError = classifyError(err, { verb: "load the school list" });
    const ref = reportError(appError, { route: "/login", routeType: "render" });
    schoolsUnavailable = withReference(appError.message, appError.severity === "system" ? ref : undefined);
  }
```
```tsx
          {schoolsUnavailable ? (
            <p className="text-center text-sm text-muted-foreground">{schoolsUnavailable}</p>
          ) : null}
```
with imports `classifyError`, `reportError`, `withReference`.

- [ ] **Step 6: Run to verify** — `npx vitest run tests/unit/tenant.test.ts && npm run typecheck` — Expected: PASS. Then `npx vitest run` and confirm the non-auth action tests that mock `@/lib/auth/tenant` are still green (they mock the module, so they are unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts src/lib/supabase src/lib/auth/tenant.ts src/app/login/page.tsx src/app/admin/login/page.tsx tests/unit/tenant.test.ts
git commit -m "fix(errors): stop showing env details to visitors; tenant refusals carry a code"
```

---

### Task 9: Tell people why they were signed out

**Files:**
- Create: `src/lib/auth/session-end.ts`
- Modify: `src/middleware.ts`, `src/lib/auth/session.ts`, `src/app/pending-approval/page.tsx:28,33`, `src/app/account/created/page.tsx:32,37`, `src/app/login/page.tsx`, `src/app/admin/login/page.tsx`
- Test: `tests/unit/errors/session-end.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5
- Produces:
  - `SESSION_END_REASONS`, `type SessionEndReason`, `sessionEndCode(value) → ErrorCode | null`
  - `loginPath(area: "admin" | "school", reason?: SessionEndReason | null) → string`
  - `hasSupabaseSessionCookie(names: Iterable<string>) → boolean`

**Security note being fixed:** `/login?error=<any text>` currently renders that text as a toast, so a crafted link can put a false message on the real login page. The allow-list ends that.

- [ ] **Step 1: Write the failing test** `tests/unit/errors/session-end.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { hasSupabaseSessionCookie, loginPath, sessionEndCode } from "@/lib/auth/session-end";

describe("sessionEndCode", () => {
  it("maps each known reason to a catalog code", () => {
    expect(sessionEndCode("session_expired")).toBe("AUTH_SESSION_EXPIRED");
    expect(sessionEndCode("account_disabled")).toBe("AUTH_ACCOUNT_DISABLED");
    expect(sessionEndCode("declined")).toBe("AUTH_REGISTRATION_DECLINED");
    expect(sessionEndCode("deactivated")).toBe("AUTH_ACCOUNT_DEACTIVATED");
  });

  it("refuses anything else, so no text from a URL is ever shown", () => {
    expect(sessionEndCode("Your account was hacked, call 0917-000-0000")).toBeNull();
    expect(sessionEndCode("__proto__")).toBeNull();
    expect(sessionEndCode("toString")).toBeNull();
    expect(sessionEndCode(undefined)).toBeNull();
    expect(sessionEndCode(["session_expired"])).toBeNull();
  });
});

describe("loginPath", () => {
  it("sends admins to the admin login and everyone else to the school login", () => {
    expect(loginPath("admin")).toBe("/admin/login");
    expect(loginPath("school")).toBe("/login");
  });

  it("carries the reason as a short token, never as a message", () => {
    expect(loginPath("school", "session_expired")).toBe("/login?reason=session_expired");
    expect(loginPath("admin", "account_disabled")).toBe("/admin/login?reason=account_disabled");
    expect(loginPath("school", null)).toBe("/login");
  });
});

describe("hasSupabaseSessionCookie", () => {
  it("recognizes whole and chunked session cookies", () => {
    expect(hasSupabaseSessionCookie(["theme", "sb-abcdef-auth-token"])).toBe(true);
    expect(hasSupabaseSessionCookie(["sb-abcdef-auth-token.1"])).toBe(true);
  });

  it("ignores other cookies, including Supabase's non-session ones", () => {
    expect(hasSupabaseSessionCookie(["theme", "litrack-sidebar"])).toBe(false);
    expect(hasSupabaseSessionCookie(["sb-abcdef-auth-token-code-verifier"])).toBe(false);
    expect(hasSupabaseSessionCookie([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/errors/session-end.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/auth/session-end.ts`**

```ts
/**
 * Why a person is looking at the login page.
 *
 * The reason travels as a short token in `?reason=`, never as a message: the
 * login page used to render `?error=<anything>` straight into a toast, which let
 * a crafted link put any sentence on the real sign-in screen. Only these four
 * tokens mean anything, and each maps to a message from the catalog.
 *
 * Pure and dependency-free (types only from the catalog) so `src/middleware.ts`
 * can use it on the edge runtime.
 */

import type { ErrorCode } from "@/lib/errors/codes";

export const SESSION_END_REASONS = {
  session_expired: "AUTH_SESSION_EXPIRED",
  account_disabled: "AUTH_ACCOUNT_DISABLED",
  declined: "AUTH_REGISTRATION_DECLINED",
  deactivated: "AUTH_ACCOUNT_DEACTIVATED",
} as const satisfies Record<string, ErrorCode>;

export type SessionEndReason = keyof typeof SESSION_END_REASONS;

export function sessionEndCode(value: unknown): ErrorCode | null {
  if (typeof value !== "string" || !Object.hasOwn(SESSION_END_REASONS, value)) return null;
  return SESSION_END_REASONS[value as SessionEndReason];
}

export function loginPath(area: "admin" | "school", reason?: SessionEndReason | null): string {
  const base = area === "admin" ? "/admin/login" : "/login";
  return reason ? `${base}?reason=${reason}` : base;
}

/** `sb-<project>-auth-token`, whole or chunked — not the PKCE verifier cookie. */
const SESSION_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

export function hasSupabaseSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) if (SESSION_COOKIE.test(name)) return true;
  return false;
}
```

- [ ] **Step 4: Middleware decides the expired case** — in `src/middleware.ts`, capture the cookie state *before* `updateSession` (which rewrites request cookies when a refresh fails), and use it in the unauthenticated redirect:

```ts
  // Read before updateSession: a failed refresh clears these cookies on the
  // request, and afterwards "expired" is indistinguishable from "never signed in".
  const hadSession = hasSupabaseSessionCookie(
    request.cookies.getAll().filter((cookie) => cookie.value).map((cookie) => cookie.name)
  );

  const { supabaseResponse, user } = await updateSession(request);
```
```ts
  if (!user) {
    const area = pathname.startsWith("/admin") ? "admin" : "school";
    return NextResponse.redirect(new URL(loginPath(area, hadSession ? "session_expired" : null), request.url));
  }
```
with `import { hasSupabaseSessionCookie, loginPath } from "@/lib/auth/session-end";`. Leave the `isSupabaseConfigured()` branch above it alone.

- [ ] **Step 5: `requireUser` passes on the reason** — in `src/lib/auth/session.ts`:

```ts
import { cache } from "react";
import { loginPath, type SessionEndReason } from "@/lib/auth/session-end";
import { noteScopeUser } from "@/lib/errors/context";

/**
 * Why `getCurrentUser` returned null, for the redirect that follows it.
 *
 * Per request via `cache()`, alongside the user lookup itself. If the memo is
 * ever unavailable the holder is simply fresh, the reason is null, and the
 * redirect is the plain one it was before — never a wrong explanation.
 */
const sessionEndNote = cache((): { reason: SessionEndReason | null } => ({ reason: null }));
```

In `getCurrentUserCached`, set the note where the user is refused:
```ts
  if (user.deletedAt) {
    sessionEndNote().reason = "account_disabled";
    try { await supabase.auth.signOut(); } catch (err) { … }
    return null;
  }
```
```ts
  if (isTeacherRejected(user)) {
    if (allowPending) return user;
    try { await supabase.auth.signOut(); } catch (err) { … }
    redirect(loginPath("school", "declined"));
  }
```
```ts
  if (!user.isActive) {
    sessionEndNote().reason = "account_disabled";
    try { await supabase.auth.signOut(); } catch (err) { … }
    return null;
  }
```

In `requireUser`, use it and record the verified user for error reports:
```ts
  const user = await getCurrentUser({ allowPending: options?.allowPending });
  if (!user) {
    const isAdminRoute =
      roles === "SUPER_ADMIN" || (Array.isArray(roles) && roles.includes("SUPER_ADMIN"));
    redirect(loginPath(isAdminRoute ? "admin" : "school", sessionEndNote().reason));
  }

  // Lets an error recorded later in this action name the person, without every
  // throw site passing ids around. No-op outside a wrapped action or route.
  noteScopeUser({ id: user.id, schoolId: user.schoolId });
```

- [ ] **Step 6: Replace the two `?error=` redirects** — in `src/app/pending-approval/page.tsx` and `src/app/account/created/page.tsx`:

```ts
  if (user.approvalStatus === "REJECTED") {
    await signOut();
    redirect(loginPath("school", "declined"));
  }

  if (isDeactivatedTeacher(user)) {
    await signOut();
    redirect(loginPath("school", "deactivated"));
  }
```
Remove the now-unused `DECLINED_REGISTRATION_MESSAGE` / `DEACTIVATED_TEACHER_MESSAGE` imports from both files and import `loginPath`.

- [ ] **Step 7: Show the reason on both login pages**

`src/app/login/page.tsx`:
```tsx
type LoginPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  // Allow-list: a token, never text from the URL.
  const endedCode = sessionEndCode(params.reason);
  const loginError = endedCode ? formatMessage(endedCode) : undefined;
```
(`LoginForm` keeps its `loginError` prop and its toast.)

`src/app/admin/login/page.tsx` — take `searchParams` the same way and render a notice above the form:
```tsx
          {endedCode ? (
            <div className="rounded-xl border border-border/80 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {formatMessage(endedCode)}
            </div>
          ) : null}
```

- [ ] **Step 8: Run to verify** — `npx vitest run tests/unit/errors/session-end.test.ts tests/unit/auth-helpers.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/session-end.ts src/middleware.ts src/lib/auth/session.ts src/app/pending-approval/page.tsx src/app/account/created/page.tsx src/app/login/page.tsx src/app/admin/login/page.tsx tests/unit/errors/session-end.test.ts
git commit -m "feat(auth): say why a session ended, from an allow-list instead of the URL"
```

---

### Task 10: Throttle account guessing without blocking a school

**Files:**
- Modify: `src/lib/rate-limit.ts` (add `peekRateLimit`), `src/app/api/schools/list/route.ts` (use the shared IP helper)
- Create: `src/lib/request-ip.ts`, `src/lib/auth/lookup-throttle.ts`
- Test: `tests/unit/rate-limit-peek.test.ts`, `tests/unit/auth/lookup-throttle.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `peekRateLimit(key, options) → Promise<RateLimitResult>` (reads the window, records nothing)
  - `clientIpFrom(headers: { get(name: string): string | null }) → string`
  - `LOOKUP_FAILURE_RATE`, `assertLookupAllowed() → Promise<void>` (throws `AUTH_TOO_MANY_ATTEMPTS`), `recordFailedLookup() → Promise<void>`

**The property that matters:** only a lookup that *fails* is charged, so a computer lab of teachers typing their real addresses never trips it; and once an address is over the limit, *every* lookup from it is refused, so the answer stops being an oracle.

- [ ] **Step 1: Write the failing tests** `tests/unit/rate-limit-peek.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// No Upstash: exercise the in-memory window, which is what dev and unconfigured
// deployments use. The Redis path is a single pipeline of the same semantics.
vi.mock("@/lib/cache/upstash", () => ({
  upstashCommand: async () => null,
  upstashPipeline: async () => null,
}));

import { checkRateLimit, peekRateLimit } from "@/lib/rate-limit";

const RATE = { limit: 3, windowMs: 60_000 } as const;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("peekRateLimit", () => {
  it("reports the window without consuming an attempt", async () => {
    const key = `peek:${Math.random()}`;
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    // Three peeks recorded nothing, so three attempts are still available.
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(false);
  });

  it("turns false once the limit is reached, and says how long to wait", async () => {
    const key = `peek:${Math.random()}`;
    for (let i = 0; i < RATE.limit; i++) await checkRateLimit(key, RATE);
    const gate = await peekRateLimit(key, RATE);
    expect(gate.ok).toBe(false);
    expect(gate.retryAfterMs).toBeGreaterThan(0);
    expect(gate.retryAfterMs).toBeLessThanOrEqual(RATE.windowMs);
  });
});
```

`tests/unit/auth/lookup-throttle.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  get peekRateLimit() {
    return peekRateLimit;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" }),
}));

import { AppError } from "@/lib/errors/app-error";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";

beforeEach(() => {
  vi.clearAllMocks();
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
});

describe("lookup throttle", () => {
  it("keys on the first address in x-forwarded-for", async () => {
    await assertLookupAllowed();
    expect(peekRateLimit).toHaveBeenCalledWith("login:lookup-miss:ip:203.0.113.9", expect.any(Object));
  });

  it("allows a lookup while the address is under the limit", async () => {
    await expect(assertLookupAllowed()).resolves.toBeUndefined();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("refuses every lookup once the address is over it, with a wait", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4 * 60_000 });
    await expect(assertLookupAllowed()).rejects.toMatchObject({
      code: "AUTH_TOO_MANY_ATTEMPTS",
      message: "Too many attempts. Try again in 4 minutes.",
    });
    await expect(assertLookupAllowed()).rejects.toBeInstanceOf(AppError);
  });

  it("charges the window only when a lookup actually failed", async () => {
    await recordFailedLookup();
    expect(checkRateLimit).toHaveBeenCalledWith("login:lookup-miss:ip:203.0.113.9", expect.any(Object));
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/rate-limit-peek.test.ts tests/unit/auth/lookup-throttle.test.ts` — Expected: FAIL.

- [ ] **Step 3: Add `peekRateLimit` to `src/lib/rate-limit.ts`** (below `checkRateLimit`)

```ts
/**
 * Read a window without recording an attempt.
 *
 * `checkRateLimit` answers "may I, and I am taking one"; this answers "may I".
 * The difference is what lets a throttle charge only the attempts that failed,
 * while still refusing everything once the limit is reached — otherwise the
 * successful answers stay available and the limit can be used as an oracle.
 */
export async function peekRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();

  const shared = await redisPeek(key, options, now);
  if (shared) return shared;

  warnDegradedOnce();
  return memoryPeek(key, options, now);
}

async function redisPeek(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): Promise<RateLimitResult | null> {
  const rkey = `rl:${key}`;
  const replies = await upstashPipeline([
    ["ZREMRANGEBYSCORE", rkey, "0", String(now - windowMs)],
    ["ZCARD", rkey],
    ["ZRANGE", rkey, "0", "0", "WITHSCORES"],
  ]);
  if (!replies) return null;

  const count = Number(replies[1]);
  if (!Number.isFinite(count)) return null;
  if (count < limit) return { ok: true, retryAfterMs: 0 };

  const oldest = replies[2];
  const oldestScore = Array.isArray(oldest) ? Number(oldest[1]) : NaN;
  const anchor = Number.isFinite(oldestScore) ? oldestScore : now;
  return { ok: false, retryAfterMs: Math.max(0, anchor + windowMs - now) };
}

function memoryPeek(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): RateLimitResult {
  const entry = store.get(key);
  if (!entry) return { ok: true, retryAfterMs: 0 };

  prune(entry, now, windowMs);
  if (entry.timestamps.length < limit) return { ok: true, retryAfterMs: 0 };

  const oldest = entry.timestamps[0] ?? now;
  return { ok: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
}
```

- [ ] **Step 4: Implement `src/lib/request-ip.ts`**

```ts
/**
 * The caller's address, as the platform reports it.
 *
 * Vercel sets `x-forwarded-for` with the client first. Falls back to
 * `x-real-ip`, then to a shared "unknown" bucket, which is deliberately strict:
 * a request whose origin cannot be told apart should share a limit, not escape it.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
```

Then use it in `src/app/api/schools/list/route.ts`, replacing the inline header reading with `clientIpFrom(hdrs)`.

- [ ] **Step 5: Implement `src/lib/auth/lookup-throttle.ts`**

```ts
import "server-only";
import { headers } from "next/headers";
import { checkRateLimit, peekRateLimit } from "@/lib/rate-limit";
import { tooManyAttempts } from "@/lib/errors/app-error";
import { clientIpFrom } from "@/lib/request-ip";

/**
 * Makes guessing which email addresses exist expensive, without making signing
 * in expensive.
 *
 * The sign-in form answers "no teacher account uses this email at this school",
 * which is genuinely useful — it is the difference between a typo and a missing
 * account. The existing limiter could not meter that answer, because its key
 * includes the email: every guessed address arrived with a fresh allowance.
 *
 * This one is keyed on the address the request came from, and is charged ONLY
 * when a lookup failed. Teachers typing their own correct addresses never spend
 * it, so a computer lab behind one NAT address is never locked out; a script
 * working through a list spends one per guess. Once over the limit, every
 * lookup from that address is refused — including the ones that would have
 * succeeded, or the block itself would answer the question.
 */

export const LOOKUP_FAILURE_RATE = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

async function lookupKey(): Promise<string> {
  return `login:lookup-miss:ip:${clientIpFrom(await headers())}`;
}

/** Call before an account lookup. Throws `AUTH_TOO_MANY_ATTEMPTS` when spent. */
export async function assertLookupAllowed(): Promise<void> {
  const gate = await peekRateLimit(await lookupKey(), LOOKUP_FAILURE_RATE);
  if (!gate.ok) throw tooManyAttempts(gate.retryAfterMs);
}

/** Call when a lookup found no usable account, or hit a registration conflict. */
export async function recordFailedLookup(): Promise<void> {
  await checkRateLimit(await lookupKey(), LOOKUP_FAILURE_RATE);
}
```

- [ ] **Step 6: Run to verify they pass** — `npx vitest run tests/unit/rate-limit-peek.test.ts tests/unit/auth/lookup-throttle.test.ts tests/unit/rate-limit.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/request-ip.ts src/lib/auth/lookup-throttle.ts src/app/api/schools/list/route.ts tests/unit/rate-limit-peek.test.ts tests/unit/auth/lookup-throttle.test.ts
git commit -m "feat(auth): meter failed account lookups per address, not per email"
```

---
### Task 11: Browser sign-in halves (`login.ts`) move onto the wrapper

**Files:**
- Create: `src/lib/auth/login-gates.ts`
- Rewrite: `src/lib/actions/login.ts`
- Test: `tests/unit/actions/login-begin.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6, 8, 10
- Produces:
  - `assertSupabaseConfigured()`, `requireActiveSchool(schoolId) → Promise<{ id: string }>`, `LOGIN_RATE`
  - `beginSchoolHeadLogin`, `finishSchoolHeadLogin`, `beginTeacherLogin`, `finishTeacherLogin`, `reportLoginFailure` — all wrapped, returning `… | ActionFailure`
  - `type BeginLoginResult`, `type FinishLoginResult`

- [ ] **Step 1: Write the failing test** `tests/unit/actions/login-begin.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser-side sign-in's server halves.
 *
 * What is worth pinning here is what the person is told and what it costs an
 * attacker: a School Head with no account gets the real reason instead of
 * "contact your administrator"; a wrong school gets "no teacher account";
 * and the per-address throttle is charged only when a lookup fails, but refuses
 * everything — including lookups that would have succeeded — once it is spent.
 */

const schoolFindUnique = vi.fn();
const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const reportError = vi.fn(() => "E-TESTREF3");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findUnique() {
        return schoolFindUnique;
      },
    },
    user: {
      get findUnique() {
        return userFindUnique;
      },
      get findFirst() {
        return userFindFirst;
      },
    },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser, signOut } }),
}));
vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  SUPABASE_NOT_CONFIGURED_MESSAGE: "supabase env missing",
}));
vi.mock("@/lib/audit", () => ({
  get writeAudit() {
    return writeAudit;
  },
  AUDIT_ACTIONS: { LOGIN_SUCCESS: "LOGIN_SUCCESS", LOGIN_DENIED: "LOGIN_DENIED" },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  get peekRateLimit() {
    return peekRateLimit;
  },
}));
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/auth/warm-routes", () => ({
  warmSchoolHeadRoutes: vi.fn(),
  warmTeacherRoutes: vi.fn(),
}));
vi.mock("@/lib/auth/synthetic-email", () => ({
  isSyntheticEmail: (email: string) => email.startsWith("sh@"),
}));

import {
  beginSchoolHeadLogin,
  beginTeacherLogin,
  finishSchoolHeadLogin,
  finishTeacherLogin,
  reportLoginFailure,
} from "@/lib/actions/login";

const SCHOOL = { id: "school-1", isActive: true, deletedAt: null };
const HEAD = { id: "head-1", email: "sh@0001.litrack.local", schoolId: "school-1" };
const TEACHER = {
  id: "teacher-1",
  role: "TEACHER" as const,
  schoolId: "school-1",
  isActive: true,
  deletedAt: null,
  approvalStatus: "APPROVED" as const,
};

const LOOKUP_KEY = "login:lookup-miss:ip:203.0.113.9";

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  schoolFindUnique.mockResolvedValue(SCHOOL);
  userFindFirst.mockResolvedValue(HEAD);
  userFindUnique.mockResolvedValue(TEACHER);
  reportError.mockReturnValue("E-TESTREF3");
});

describe("beginSchoolHeadLogin", () => {
  it("hands the synthetic address to the browser", async () => {
    await expect(beginSchoolHeadLogin("school-1")).resolves.toEqual({
      ok: true,
      mode: "browser",
      email: "sh@0001.litrack.local",
    });
  });

  it("keeps a real address on the server", async () => {
    userFindFirst.mockResolvedValue({ ...HEAD, email: "head@deped.gov.ph" });
    await expect(beginSchoolHeadLogin("school-1")).resolves.toEqual({ ok: true, mode: "server" });
  });

  it("says the school has no School Head account instead of blaming the password", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await beginSchoolHeadLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_NO_SCHOOL_HEAD_ACCOUNT" });
    expect((res as { error: string }).error).toMatch(/division office/i);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("separates a school that is missing from one that is switched off", async () => {
    schoolFindUnique.mockResolvedValue(null);
    expect(await beginSchoolHeadLogin("school-x")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    schoolFindUnique.mockResolvedValue({ ...SCHOOL, isActive: false });
    expect(await beginSchoolHeadLogin("school-1")).toMatchObject({ ok: false, code: "AUTH_SCHOOL_INACTIVE" });
  });

  it("says how long to wait when the limiter refuses", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4 * 60_000 });
    const res = await beginSchoolHeadLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect((res as { error: string }).error).toBe("Too many attempts. Try again in 4 minutes.");
  });

  it("asks for a school before anything else", async () => {
    expect(await beginSchoolHeadLogin("")).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(schoolFindUnique).not.toHaveBeenCalled();
  });
});

describe("beginTeacherLogin", () => {
  it("hands back the address the teacher typed", async () => {
    await expect(beginTeacherLogin("school-1", " Teacher@School.edu ")).resolves.toEqual({
      ok: true,
      mode: "browser",
      email: "teacher@school.edu",
    });
  });

  it("does not charge the throttle for an account that exists", async () => {
    await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(checkRateLimit).not.toHaveBeenCalledWith(LOOKUP_KEY, expect.anything());
  });

  it("charges the throttle when no account matches", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await beginTeacherLogin("school-1", "guess@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(checkRateLimit).toHaveBeenCalledWith(LOOKUP_KEY, expect.any(Object));
  });

  it("treats a teacher from another school as no account here", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, schoolId: "school-2" });
    expect(await beginTeacherLogin("school-1", "teacher@school.edu")).toMatchObject({
      ok: false,
      code: "AUTH_TEACHER_NOT_FOUND",
    });
  });

  it("refuses every lookup once the address is over the limit — even a real one", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });
    const res = await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TOO_MANY_ATTEMPTS" });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("explains a declined or deactivated account before a password is sent", async () => {
    userFindUnique.mockResolvedValue({ ...TEACHER, approvalStatus: "REJECTED" });
    expect(await beginTeacherLogin("school-1", "teacher@school.edu")).toMatchObject({
      ok: false,
      code: "AUTH_REGISTRATION_DECLINED",
    });

    userFindUnique.mockResolvedValue({ ...TEACHER, isActive: false });
    const res = await beginTeacherLogin("school-1", "teacher@school.edu");
    expect(res).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DEACTIVATED" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_DENIED", metadata: expect.objectContaining({ reason: "deactivated" }) })
    );
  });
});

describe("finishTeacherLogin", () => {
  it("admits an approved teacher and records the sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue(TEACHER);
    await expect(finishTeacherLogin("school-1")).resolves.toEqual({ ok: true, redirectTo: "/teacher" });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN_SUCCESS" }));
  });

  it("sends a pending teacher to the waiting page", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({ ...TEACHER, approvalStatus: "PENDING", isActive: false });
    await expect(finishTeacherLogin("school-1")).resolves.toEqual({ ok: true, redirectTo: "/pending-approval" });
  });

  it("signs out a session that does not belong to this school", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    userFindUnique.mockResolvedValue({ ...TEACHER, schoolId: "school-2" });
    const res = await finishTeacherLogin("school-1");
    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(signOut).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "not_authorized", cause: "school_mismatch" }) })
    );
  });

  it("calls a missing session what it is", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect(await finishTeacherLogin("school-1")).toMatchObject({ ok: false, code: "AUTH_SESSION_EXPIRED" });
  });
});

describe("finishSchoolHeadLogin", () => {
  it("admits the school's head", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-2" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      isActive: true,
      deletedAt: null,
    });
    await expect(finishSchoolHeadLogin("school-1")).resolves.toEqual({ ok: true, redirectTo: "/school-head" });
  });

  it("refuses and signs out a deactivated head", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-2" } }, error: null });
    userFindUnique.mockResolvedValue({
      id: "head-1",
      role: "SCHOOL_HEAD",
      schoolId: "school-1",
      isActive: false,
      deletedAt: null,
    });
    expect(await finishSchoolHeadLogin("school-1")).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DISABLED" });
    expect(signOut).toHaveBeenCalled();
  });
});

describe("reportLoginFailure", () => {
  it("normalizes a reason it does not recognize", async () => {
    await reportLoginFailure({ schoolId: "school-1", role: "SCHOOL_HEAD", reason: "whatever-the-client-says" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "incorrect_credentials" }) })
    );
  });

  it("keeps the new reasons the browser can now tell apart", async () => {
    await reportLoginFailure({ schoolId: "school-1", role: "SCHOOL_HEAD", reason: "service_unreachable" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "service_unreachable" }) })
    );
  });

  it("does not credit a teacher from another school to this one", async () => {
    userFindUnique.mockResolvedValue({ id: "teacher-9", email: "t@x.edu", schoolId: "school-2" });
    await reportLoginFailure({ schoolId: "school-1", role: "TEACHER", email: "t@x.edu", reason: "incorrect_credentials" });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("records a provider failure for admins, but never as a system alert", async () => {
    await reportLoginFailure({ schoolId: "school-1", role: "TEACHER", reason: "provider_error" });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatchObject({ severity: "security" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/actions/login-begin.test.ts` — Expected: FAIL.

- [ ] **Step 3: Create `src/lib/auth/login-gates.ts`**

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";

/** Pre-flight checks shared by the server-side and browser-side sign-in halves. */

export const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;

export function assertSupabaseConfigured(): void {
  if (isSupabaseConfigured()) return;
  // The variable names are admin detail; the person is told the server is not
  // set up, which is all they can act on.
  throw new AppError("CONFIG_MISSING", {
    detail: SUPABASE_NOT_CONFIGURED_MESSAGE,
    context: { reason: "supabase_env_missing" },
  });
}

/**
 * "Missing" and "switched off" are different problems for different people: one
 * is a stale dropdown, the other is a division-office decision.
 */
export async function requireActiveSchool(schoolId: string): Promise<{ id: string }> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || school.deletedAt) throw resourceNotFound("School");
  if (!school.isActive) throw new AppError("AUTH_SCHOOL_INACTIVE", { context: { schoolId } });
  return { id: school.id };
}
```

- [ ] **Step 4: Rewrite `src/lib/actions/login.ts`**

Keep the existing file header comment (the Supabase per-IP reasoning) verbatim; replace everything below it with:

```ts
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { warmSchoolHeadRoutes, warmTeacherRoutes } from "@/lib/auth/warm-routes";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { isDeactivatedTeacher } from "@/lib/auth/teacher-registration-helpers";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, tooManyAttempts } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import type { ActionFailure } from "@/lib/errors/result";
import { LOGIN_FAILURE_REASONS, type LoginFailureReason } from "@/lib/errors/supabase";
import { assertSupabaseConfigured, requireActiveSchool, LOGIN_RATE } from "@/lib/auth/login-gates";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";
import { clientIpFrom } from "@/lib/request-ip";

/**
 * Where the password grant should be made.
 *
 * `browser` carries the address to sign in with; `server` means the caller must
 * use the server-side action instead.
 */
type BeginLoginSuccess = { ok: true; mode: "browser"; email: string } | { ok: true; mode: "server" };

export type BeginLoginResult = BeginLoginSuccess | ActionFailure;
export type FinishLoginResult = { ok: true; redirectTo: string } | ActionFailure;
export type { LoginFailureReason };

/** Attempts the browser may report per address, so the audit trail cannot be flooded. */
const REPORT_RATE = { limit: 30, windowMs: 10 * 60 * 1000 } as const;

function normalizeReason(reason: string): LoginFailureReason {
  return (LOGIN_FAILURE_REASONS as readonly string[]).includes(reason)
    ? (reason as LoginFailureReason)
    : "incorrect_credentials";
}

/**
 * School Head: resolve the school's sign-in address for the browser.
 *
 * The address is only handed out when it is synthetic (`sh@<schoolIdCode>.…`),
 * which is derived from the School ID already printed on the public schools
 * table. A head who has swapped in a real address gets `mode: "server"`: that
 * address is personal data, and a login page that returns it on demand would be
 * an enumeration endpoint for every School Head's real email.
 */
export const beginSchoolHeadLogin = action(
  "beginSchoolHeadLogin",
  async (schoolId: string): Promise<BeginLoginSuccess> => {
    assertSupabaseConfigured();
    if (!schoolId) throw fieldError("schoolId", "Please select a school");

    const rate = await checkRateLimit(`login:school-head:${schoolId}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const school = await requireActiveSchool(schoolId);

    const head = await findSchoolHead(school.id);
    if (!head) {
      // Not a password problem, and never was: the school has no head account.
      // Recorded because only an admin can fix it.
      throw new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", {
        detail: `School ${school.id} has no active School Head account`,
        context: { schoolId: school.id, reason: "no_school_head" },
      });
    }

    if (!isSyntheticEmail(head.email)) return { ok: true, mode: "server" };
    return { ok: true, mode: "browser", email: head.email };
  }
);

/**
 * School Head: verify the session the browser just established, then admit it.
 *
 * Everything here is re-derived from cookies and Prisma. The `schoolId` the
 * client passes is only used to confirm it agrees with the account that actually
 * signed in — a mismatch signs the session straight back out.
 */
export const finishSchoolHeadLogin = action(
  "finishSchoolHeadLogin",
  async (schoolId: string): Promise<{ ok: true; redirectTo: string }> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new AppError("AUTH_SESSION_EXPIRED", {
        detail: `No session after the browser grant: ${error?.message ?? "no user"}`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { authId: data.user.id },
      select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true },
    });

    const cause = schoolHeadDenial(user, schoolId);
    if (cause) {
      await supabase.auth.signOut();
      await writeAudit({
        userId: user?.id,
        schoolId: user?.schoolId ?? schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: "SCHOOL_HEAD", schoolId, reason: "not_authorized", cause },
      });
      throw new AppError(cause === "deleted" || cause === "inactive" ? "AUTH_ACCOUNT_DISABLED" : "AUTH_FORBIDDEN", {
        params: { what: "this school" },
        detail: `School Head sign-in refused: ${cause}`,
        context: { schoolId, reason: cause },
      });
    }

    await writeAudit({
      userId: user!.id,
      schoolId: user!.schoolId!,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: user!.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: user!.schoolId, method: "browser_password" },
    });

    await warmSchoolHeadRoutes(user!.schoolId!);

    return { ok: true, redirectTo: SCHOOL_HEAD_ROUTES.dashboard };
  }
);

/**
 * Teacher: run the pre-flight gates and hand the address back for the browser.
 *
 * Always `mode: "browser"` on success — the teacher supplied the address. The
 * gates run before any password leaves the browser, so a declined or deactivated
 * account gets its real explanation instead of a failed grant.
 */
export const beginTeacherLogin = action(
  "beginTeacherLogin",
  async (schoolId: string, rawEmail: string): Promise<BeginLoginSuccess> => {
    assertSupabaseConfigured();
    if (!schoolId) throw fieldError("schoolId", "Please select a school");

    const email = rawEmail.trim().toLowerCase();
    if (!email) throw fieldError("email", "Email is required");

    const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    // Before the lookup, so that once an address has spent its allowance every
    // answer is the same and the endpoint stops being an oracle.
    await assertLookupAllowed();
    await requireActiveSchool(schoolId);

    const teacher = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true, approvalStatus: true },
    });

    if (!teacher || teacher.deletedAt || teacher.role !== "TEACHER" || teacher.schoolId !== schoolId) {
      await recordFailedLookup();
      throw new AppError("AUTH_TEACHER_NOT_FOUND", { context: { schoolId } });
    }
    if (teacher.approvalStatus === "REJECTED") throw new AppError("AUTH_REGISTRATION_DECLINED");
    if (isDeactivatedTeacher(teacher)) {
      await writeAudit({
        userId: teacher.id,
        schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: teacher.id,
        metadata: { role: "TEACHER", schoolId, reason: "deactivated" },
      });
      throw new AppError("AUTH_ACCOUNT_DEACTIVATED");
    }

    return { ok: true, mode: "browser", email };
  }
);

/** Teacher counterpart to `finishSchoolHeadLogin`; see that function for the reasoning. */
export const finishTeacherLogin = action(
  "finishTeacherLogin",
  async (schoolId: string): Promise<{ ok: true; redirectTo: string }> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new AppError("AUTH_SESSION_EXPIRED", {
        detail: `No session after the browser grant: ${error?.message ?? "no user"}`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { authId: data.user.id },
      select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true, approvalStatus: true },
    });

    const cause = teacherDenial(user, schoolId);
    if (cause) {
      await supabase.auth.signOut();
      await writeAudit({
        userId: user?.id,
        schoolId: user?.schoolId ?? schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: "TEACHER", schoolId, reason: "not_authorized", cause },
      });
      throw new AppError(
        cause === "declined"
          ? "AUTH_REGISTRATION_DECLINED"
          : cause === "deactivated"
            ? "AUTH_ACCOUNT_DEACTIVATED"
            : "AUTH_TEACHER_NOT_FOUND",
        { detail: `Teacher sign-in refused: ${cause}`, context: { schoolId, reason: cause } }
      );
    }

    await writeAudit({
      userId: user!.id,
      schoolId: user!.schoolId!,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: user!.id,
      metadata: { role: "TEACHER", schoolId: user!.schoolId, method: "browser_password" },
    });

    const pending = user!.approvalStatus === "PENDING";
    if (!pending) {
      await warmTeacherRoutes({ schoolId: user!.schoolId!, teacherId: user!.id, isSuperAdmin: false });
    }

    return { ok: true, redirectTo: pending ? "/pending-approval" : "/teacher" };
  }
);

/**
 * Record an attempt that failed at the browser's grant.
 *
 * The audit row is the only part of a failed browser sign-in the server would
 * otherwise never see. Nothing here trusts the caller: the subject is resolved
 * from the school and role, and `reason` is narrowed to the values the login
 * form can legitimately report.
 *
 * A provider failure is recorded for admins at "security" severity rather than
 * "system": the input comes from the browser, and a client-triggered alert is a
 * way to flood an inbox.
 */
export const reportLoginFailure = action(
  "reportLoginFailure",
  async (input: {
    schoolId: string;
    role: "SCHOOL_HEAD" | "TEACHER";
    reason: string;
    email?: string;
  }): Promise<{ ok: true }> => {
    const reason = normalizeReason(input.reason);
    if (!input.schoolId) return { ok: true };

    const gate = await checkRateLimit(`login:report:${clientIpFrom(await headers())}`, REPORT_RATE);
    if (!gate.ok) return { ok: true };

    const subject =
      input.role === "SCHOOL_HEAD"
        ? await findSchoolHead(input.schoolId)
        : input.email
          ? await prisma.user.findUnique({
              where: { email: input.email.trim().toLowerCase() },
              select: { id: true, email: true, schoolId: true },
            })
          : null;

    // A teacher row from another school must not be credited to this one.
    const userId =
      subject && (input.role === "SCHOOL_HEAD" || subject.schoolId === input.schoolId) ? subject.id : null;

    await writeAudit({
      userId,
      schoolId: input.schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: userId,
      metadata: { role: input.role, schoolId: input.schoolId, reason },
    });

    if (reason === "rate_limited" || reason === "provider_error") {
      reportError(
        new AppError(reason === "rate_limited" ? "AUTH_PROVIDER_RATE_LIMITED" : "AUTH_PROVIDER_ERROR", {
          severity: "security",
          detail: `Reported by the browser after a failed password grant (${input.role})`,
          context: { schoolId: input.schoolId, reason },
        }),
        { route: "reportLoginFailure", userId, schoolId: input.schoolId }
      );
    }

    return { ok: true };
  }
);

type SchoolHeadRow = { id: string; role: string; schoolId: string | null; isActive: boolean; deletedAt: Date | null } | null;

function schoolHeadDenial(user: SchoolHeadRow, schoolId: string): string | null {
  if (!user) return "no_account";
  if (user.deletedAt) return "deleted";
  if (!user.isActive) return "inactive";
  if (user.role !== "SCHOOL_HEAD") return "role_mismatch";
  if (!user.schoolId || user.schoolId !== schoolId) return "school_mismatch";
  return null;
}

type TeacherRow =
  | { id: string; role: string; schoolId: string | null; isActive: boolean; deletedAt: Date | null; approvalStatus: string }
  | null;

function teacherDenial(user: TeacherRow, schoolId: string): string | null {
  if (!user) return "no_account";
  if (user.deletedAt) return "deleted";
  if (user.role !== "TEACHER") return "role_mismatch";
  if (!user.schoolId || user.schoolId !== schoolId) return "school_mismatch";
  if (user.approvalStatus === "REJECTED") return "declined";
  if (isDeactivatedTeacher(user as Parameters<typeof isDeactivatedTeacher>[0])) return "deactivated";
  return null;
}

/**
 * The school's School Head account.
 *
 * `orderBy createdAt asc` is not cosmetic. The Super Admin console's reset
 * targets the oldest row, so an unordered lookup could authenticate against a
 * different account than the one an admin just reset — and the reset would
 * appear to do nothing. One head per school is not enforced in the schema, so
 * the two lookups have to agree by construction.
 */
async function findSchoolHead(schoolId: string) {
  return prisma.user.findFirst({
    where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null, isActive: true },
    select: { id: true, email: true, schoolId: true },
    orderBy: { createdAt: "asc" },
  });
}
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run tests/unit/actions/login-begin.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/login-gates.ts src/lib/actions/login.ts tests/unit/actions/login-begin.test.ts
git commit -m "feat(auth): browser sign-in halves say what actually failed"
```

---

### Task 12: Server-side sign-in actions (`auth.ts`)

**Files:**
- Modify: `src/lib/actions/auth.ts` (`loginSchoolHead`, `loginTeacher`, `loginAdmin`; delete `requireSupabaseConfigured`, `assertActiveSchool`, `mapSupabaseAuthError`)
- Test: `tests/unit/actions/admin-login.test.ts` (update), `tests/unit/actions/login-server.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 2, 6, 10, 11
- Produces: the three sign-in actions wrapped, each returning `ActionFailure` on failure

- [ ] **Step 1: Update `tests/unit/actions/admin-login.test.ts`**

Three edits only — the behaviour under test does not change:

1. Add `unstable_rethrow` to the `next/navigation` mock, because the wrapper uses it to let redirects through:
```ts
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // code after it unreachable here too.
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));
```
2. Add the mocks the wrapper's dependencies need:
```ts
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF4") }));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
```
3. Update the two assertions that pinned the old strings, and make the wrong-password mock realistic:
```ts
  it("never reaches Supabase for an unknown handle", async () => {
    userFindFirst.mockResolvedValue(null);

    const result = await run(form("nobody", "s3cret"));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: "AUTH_INCORRECT_CREDENTIALS",
      error: "Incorrect username or password.",
    });
  });

  it("gives an unknown handle and a wrong password the same message", async () => {
    userFindFirst.mockResolvedValue(null);
    const unknown = await run(form("nobody", "s3cret"));

    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ ok: true });
    userFindFirst.mockResolvedValue(ADMIN_ROW);
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const wrongPassword = await run(form("admin", "wrong"));

    expect(unknown).toEqual(wrongPassword);
  });

  it("rejects a blank username before hitting the database", async () => {
    const result = await run(form("   ", "s3cret"));

    expect(userFindFirst).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: "Username required" });
  });
```

- [ ] **Step 2: Write `tests/unit/actions/login-server.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server-side sign-in fallback. The point of these cases is that the message
 * now matches the cause: a School Head with a wrong password is told the
 * password is wrong, instead of "Login failed. Please contact your
 * administrator." — the sentence that sent schools to reset passwords that were
 * fine.
 */

const schoolFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const signInWithPassword = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const redirect = vi.fn();
const reportError = vi.fn(() => "E-TESTREF5");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { get findUnique() { return schoolFindUnique; } },
    user: {
      get findFirst() { return userFindFirst; },
      get findUnique() { return userFindUnique; },
      get update() { return userUpdate; },
    },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword, signOut: vi.fn(), getUser: vi.fn(), updateUser: vi.fn() } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true, SUPABASE_NOT_CONFIGURED_MESSAGE: "env missing" }));
vi.mock("@/lib/audit", () => ({
  get writeAudit() { return writeAudit; },
  AUDIT_ACTIONS: { LOGIN_SUCCESS: "LOGIN_SUCCESS", LOGIN_DENIED: "LOGIN_DENIED", PASSWORD_CHANGE: "PASSWORD_CHANGE", EMAIL_CHANGE: "EMAIL_CHANGE", PASSWORD_RESET_REQUEST: "PASSWORD_RESET_REQUEST", TEACHER_REGISTER: "TEACHER_REGISTER" },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() { return checkRateLimit; },
  get peekRateLimit() { return peekRateLimit; },
}));
vi.mock("@/lib/errors/report", () => ({ get reportError() { return reportError; } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), roleHomePath: () => "/school-head", roleSecurityPath: () => "/school-head/settings" }));
vi.mock("@/lib/auth/warm-routes", () => ({ warmAdminRoutes: vi.fn(), warmSchoolHeadRoutes: vi.fn(), warmTeacherRoutes: vi.fn() }));
vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/auth/synthetic-email", () => ({ isSyntheticEmail: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

import { loginSchoolHead, loginTeacher } from "@/lib/actions/auth";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function run(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) return { redirected: true };
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  schoolFindUnique.mockResolvedValue({ id: "school-1", isActive: true, deletedAt: null });
  userFindFirst.mockResolvedValue({ id: "head-1", email: "sh@0001.litrack.local", isActive: true });
  reportError.mockReturnValue("E-TESTREF5");
});

describe("loginSchoolHead", () => {
  it("says the password is wrong when the password is wrong", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });

    const res = await run(() => loginSchoolHead(form({ schoolId: "school-1", password: "nope" })));

    expect(res).toMatchObject({ ok: false, code: "AUTH_INCORRECT_PASSWORD" });
    expect((res as { error: string }).error).toBe("Incorrect password. Check it and try again.");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "incorrect_credentials" }) })
    );
  });

  it("never calls a rate limit a wrong password", async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 429, message: "Request rate limit reached" } });

    const res = await run(() => loginSchoolHead(form({ schoolId: "school-1", password: "right" })));

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_RATE_LIMITED" });
    expect((res as { error: string }).error).toMatch(/no need to reset/i);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "rate_limited" }) })
    );
  });

  it("treats an unreachable auth service as our problem, with a reference", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } });

    const res = await run(() => loginSchoolHead(form({ schoolId: "school-1", password: "right" })));

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR", ref: "E-TESTREF5" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "provider_error" }) })
    );
  });

  it("names a school with no School Head account", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await run(() => loginSchoolHead(form({ schoolId: "school-1", password: "x" })));
    expect(res).toMatchObject({ ok: false, code: "AUTH_NO_SCHOOL_HEAD_ACCOUNT" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in and redirects when the password is right", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const res = await run(() => loginSchoolHead(form({ schoolId: "school-1", password: "right" })));
    expect(res).toEqual({ redirected: true });
    expect(redirect).toHaveBeenCalledWith("/school-head");
  });
});

describe("loginTeacher", () => {
  it("charges the lookup throttle only when no account matches", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await run(() => loginTeacher(form({ schoolId: "school-1", email: "guess@school.edu", password: "x" })));
    expect(res).toMatchObject({ ok: false, code: "AUTH_TEACHER_NOT_FOUND" });
    expect(checkRateLimit).toHaveBeenCalledWith("login:lookup-miss:ip:203.0.113.9", expect.any(Object));
  });

  it("says the password is wrong for a real account", async () => {
    userFindUnique.mockResolvedValue({
      id: "teacher-1",
      role: "TEACHER",
      schoolId: "school-1",
      isActive: true,
      deletedAt: null,
      approvalStatus: "APPROVED",
    });
    signInWithPassword.mockResolvedValue({ error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } });

    const res = await run(() => loginTeacher(form({ schoolId: "school-1", email: "t@school.edu", password: "nope" })));

    expect(res).toMatchObject({ ok: false, code: "AUTH_INCORRECT_PASSWORD" });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npx vitest run tests/unit/actions/admin-login.test.ts tests/unit/actions/login-server.test.ts` — Expected: FAIL.

- [ ] **Step 4: Rewrite the three sign-in actions in `src/lib/actions/auth.ts`**

Remove `requireSupabaseConfigured`, `assertActiveSchool` and `mapSupabaseAuthError` entirely, and add these imports:
```ts
import { action } from "@/lib/errors/action";
import { AppError, fieldError, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";
import { reportError } from "@/lib/errors/report";
import { assertSupabaseConfigured, requireActiveSchool, LOGIN_RATE } from "@/lib/auth/login-gates";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";
```
(delete the local `type ActionResult`, `LOGIN_RATE` and `AUTH_RATE_LIMITED_MESSAGE`/`isAuthRateLimitError` imports where they become unused; keep `REGISTER_RATE`, `RECOVERY_RATE`, `PASSWORD_RATE`, `EMAIL_RATE`).

```ts
/**
 * School Head login: school selection + password (activation credential or
 * private password). Sign-in uses the SH account's stored Prisma email.
 */
export const loginSchoolHead = action("loginSchoolHead", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const input = parseInput(schoolLoginSchema, {
    schoolId: formData.get("schoolId"),
    role: "SCHOOL_HEAD",
    password: formData.get("password"),
  });

  const rate = await checkRateLimit(`login:school-head:${input.schoolId}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  const school = await requireActiveSchool(input.schoolId);

  const shUser = await prisma.user.findFirst({
    where: { role: "SCHOOL_HEAD", schoolId: school.id, deletedAt: null, isActive: true },
    select: { id: true, email: true, isActive: true },
    // Must match `findSchoolHead` in ./school-accounts, which the Super Admin
    // reset targets. Unordered, a school with two head rows could authenticate
    // against one account while the admin resets the other — and the reset would
    // look like it did nothing.
    orderBy: { createdAt: "asc" },
  });
  if (!shUser) {
    throw new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", {
      detail: `School ${school.id} has no active School Head account`,
      context: { schoolId: school.id, reason: "no_school_head" },
    });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: shUser.email, password: input.password });
  if (error) {
    const code = mapSupabaseAuthError(error, "server");
    await writeAudit({
      userId: shUser.id,
      schoolId: school.id,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: shUser.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: school.id, reason: loginFailureReasonFor(code) },
    });
    throw new AppError(code, { cause: error, context: { schoolId: school.id } });
  }

  await writeAudit({
    userId: shUser.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: shUser.id,
    metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
  });

  await warmSchoolHeadRoutes(school.id);

  redirect(SCHOOL_HEAD_ROUTES.dashboard);
});

/** Teacher login with email + password only (no OTP / codes). */
export const loginTeacher = action("loginTeacher", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const input = parseInput(teacherLoginSchema, {
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const email = input.email.toLowerCase().trim();
  const { schoolId, password } = input;

  const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  await assertLookupAllowed();
  await requireActiveSchool(schoolId);

  const teacher = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true, approvalStatus: true },
  });

  if (!teacher || teacher.deletedAt || teacher.role !== "TEACHER" || teacher.schoolId !== schoolId) {
    await recordFailedLookup();
    throw new AppError("AUTH_TEACHER_NOT_FOUND", { context: { schoolId } });
  }
  if (teacher.approvalStatus === "REJECTED") throw new AppError("AUTH_REGISTRATION_DECLINED");
  if (isDeactivatedTeacher(teacher)) {
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: "deactivated" },
    });
    throw new AppError("AUTH_ACCOUNT_DEACTIVATED");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const code = mapSupabaseAuthError(error, "server");
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: loginFailureReasonFor(code) },
    });
    throw new AppError(code, { cause: error, context: { schoolId } });
  }

  await writeAudit({
    userId: teacher.id,
    schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: teacher.id,
    metadata: { role: "TEACHER", schoolId, method: "password" },
  });

  // REJECTED / deactivated already returned above.
  const pending = teacher.approvalStatus === "PENDING";
  if (!pending) {
    await warmTeacherRoutes({ schoolId, teacherId: teacher.id, isSuperAdmin: false });
  }

  redirect(pending ? "/pending-approval" : "/teacher");
});
```

And `loginAdmin` — same body as today minus the `try/catch` that sniffed env strings (the wrapper classifies those now), with the refusals given codes:

```ts
export const loginAdmin = action("loginAdmin", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const { username, password } = parseInput(adminLoginSchema, {
    username: formData.get("username"),
    password: formData.get("password"),
  });

  const rate = await checkRateLimit(`login:admin:${username}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  // Supabase Auth authenticates on an email address, so the handle has to be
  // resolved to one first. Scoping the lookup to a live Super Admin is the point
  // of doing it here: a handle left on a revoked or lower-privileged row never
  // reaches Supabase, so a stale username cannot be used to probe for a live
  // password.
  const account = await prisma.user.findFirst({
    where: { username, role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!account) {
    await writeAudit({
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      // The username itself is deliberately not logged — an audit row for a
      // failed attempt would otherwise record whatever a stranger typed.
      metadata: { role: "SUPER_ADMIN", reason: "unknown_username" },
    });
    // Identical to the wrong-password message below, so the field cannot be used
    // to enumerate which handles exist. This is the one login where the generic
    // message is deliberate: these are the highest-value accounts in the system.
    throw new AppError("AUTH_INCORRECT_CREDENTIALS");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error || !data.user) {
    const mapped = error ? mapSupabaseAuthError(error, "server") : "AUTH_INCORRECT_PASSWORD";
    await writeAudit({
      userId: account.id,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: account.id,
      metadata: { role: "SUPER_ADMIN", reason: loginFailureReasonFor(mapped) },
    });
    throw new AppError(mapped === "AUTH_INCORRECT_PASSWORD" ? "AUTH_INCORRECT_CREDENTIALS" : mapped, {
      cause: error ?? undefined,
    });
  }

  const user = await prisma.user.findUnique({ where: { authId: data.user.id } });
  if (!user || user.role !== "SUPER_ADMIN" || !user.isActive || user.deletedAt) {
    await supabase.auth.signOut();
    await writeAudit({
      userId: user?.id,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: user?.id,
      metadata: { role: user?.role ?? "UNKNOWN", reason: "not_authorized" },
    });
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "the admin console" },
      detail: `Signed in, but the account is not an active Super Admin (role ${user?.role ?? "none"})`,
      context: { reason: "not_super_admin" },
    });
  }

  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: user.id,
    metadata: { role: "SUPER_ADMIN" },
  });

  await warmAdminRoutes();

  redirect("/admin");
});
```

- [ ] **Step 5: Run to verify they pass** — `npx vitest run tests/unit/actions/admin-login.test.ts tests/unit/actions/login-server.test.ts && npm run typecheck` — Expected: PASS. (`auth.ts` still has its other actions unwrapped at this point; that is Tasks 13–14.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/auth.ts tests/unit/actions/admin-login.test.ts tests/unit/actions/login-server.test.ts
git commit -m "fix(auth): a wrong School Head password says so, instead of blaming the administrator"
```

---
### Task 13: Password and email changes say what Supabase refused

**Files:**
- Modify: `src/lib/actions/auth.ts` (`setPasswordAction`, `skipPasswordChange`, `changePasswordAction`, `changeEmailAction`, `requestPasswordReset`, `completePasswordReset`, `logoutAction`)
- Test: `tests/unit/actions/account-security.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 12
- Produces: the six account actions wrapped, each returning `{ ok: true } | ActionFailure` (the two that redirect keep redirecting)

- [ ] **Step 1: Write the failing test** `tests/unit/actions/account-security.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Changing a password or an email.
 *
 * Every failure here used to read "Failed to update password. Please try again."
 * — advice that is wrong for three of the four real causes: a reused password, a
 * password the project's policy rejects, and a rate limit all fail again on the
 * next try. The cases below pin the specific answer to each.
 *
 * The email change has one failure that is not the user's problem at all: the
 * address changed in Supabase but the rollback ALSO failed, so the two systems
 * now disagree. That is the only one that pages an admin.
 */

const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const getUser = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUserById = vi.fn();
const writeAudit = vi.fn();
const checkRateLimit = vi.fn();
const requireUser = vi.fn();
const reportError = vi.fn(() => "E-TESTREF6");
const redirect = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get update() { return userUpdate; },
      get findUnique() { return userFindUnique; },
      get findFirst() { return userFindFirst; },
    },
    school: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword, updateUser, getUser, resetPasswordForEmail, signOut: vi.fn() },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true, SUPABASE_NOT_CONFIGURED_MESSAGE: "env missing" }));
vi.mock("@/lib/audit", () => ({
  get writeAudit() { return writeAudit; },
  AUDIT_ACTIONS: { PASSWORD_CHANGE: "PASSWORD_CHANGE", EMAIL_CHANGE: "EMAIL_CHANGE", PASSWORD_RESET_REQUEST: "PASSWORD_RESET_REQUEST", LOGOUT: "LOGOUT", LOGIN_DENIED: "LOGIN_DENIED", LOGIN_SUCCESS: "LOGIN_SUCCESS" },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() { return checkRateLimit; },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/errors/report", () => ({ get reportError() { return reportError; } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/session", () => ({
  get requireUser() { return requireUser; },
  roleHomePath: () => "/teacher",
  roleSecurityPath: () => "/teacher/settings",
}));
vi.mock("@/lib/auth/warm-routes", () => ({ warmAdminRoutes: vi.fn(), warmSchoolHeadRoutes: vi.fn(), warmTeacherRoutes: vi.fn() }));
vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/auth/synthetic-email", () => ({ isSyntheticEmail: (e: string) => e.endsWith(".litrack.local") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

import {
  changeEmailAction,
  changePasswordAction,
  completePasswordReset,
  requestPasswordReset,
  setPasswordAction,
} from "@/lib/actions/auth";

const USER = {
  id: "user-1",
  authId: "auth-1",
  email: "teacher@school.edu",
  role: "TEACHER" as const,
  schoolId: "school-1",
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function run(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) return { redirected: true };
    throw err;
  }
}

const GOOD = { currentPassword: "current-pass", password: "N3wStrongPass", confirmPassword: "N3wStrongPass" };

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  requireUser.mockResolvedValue(USER);
  signInWithPassword.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ error: null });
  userUpdate.mockResolvedValue(USER);
  reportError.mockReturnValue("E-TESTREF6");
});

describe("changePasswordAction", () => {
  it("names a reused password instead of telling the person to try again", async () => {
    updateUser.mockResolvedValue({ error: { status: 422, code: "same_password", message: "New password should be different from the old password." } });
    const res = await run(() => changePasswordAction(form(GOOD)));
    expect(res).toMatchObject({ ok: false, code: "AUTH_PASSWORD_SAME" });
    expect((res as { error: string }).error).toBe("Your new password must be different from your current one.");
  });

  it("names a password the policy rejects", async () => {
    updateUser.mockResolvedValue({ error: { status: 422, code: "weak_password", message: "Password should contain at least one character of each" } });
    expect(await run(() => changePasswordAction(form(GOOD)))).toMatchObject({ ok: false, code: "AUTH_PASSWORD_WEAK" });
  });

  it("keeps saying the current password is wrong when it is", async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } });
    const res = await run(() => changePasswordAction(form(GOOD)));
    expect(res).toMatchObject({ ok: false, code: "AUTH_CURRENT_PASSWORD_INCORRECT" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("never calls a rate limit a wrong password — the reason resets were wasted", async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 429, message: "Request rate limit reached" } });
    const res = await run(() => changePasswordAction(form(GOOD)));
    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_RATE_LIMITED" });
  });

  it("clears the first-login flags once the password really changed", async () => {
    await run(() => changePasswordAction(form(GOOD)));
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mustChangePassword: false, passwordIsSchoolId: false } })
    );
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PASSWORD_CHANGE" }));
  });
});

describe("setPasswordAction", () => {
  it("redirects home when the password is saved", async () => {
    expect(await run(() => setPasswordAction(form({ password: "N3wStrongPass", confirmPassword: "N3wStrongPass" })))).toEqual({ redirected: true });
    expect(redirect).toHaveBeenCalledWith("/teacher");
  });

  it("reports a provider outage with a reference instead of 'try again'", async () => {
    updateUser.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } });
    const res = await run(() => setPasswordAction(form({ password: "N3wStrongPass", confirmPassword: "N3wStrongPass" })));
    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR", ref: "E-TESTREF6" });
  });
});

describe("completePasswordReset", () => {
  it("says the link expired rather than blaming the password", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await run(() => completePasswordReset(form({ password: "N3wStrongPass", confirmPassword: "N3wStrongPass" })))).toMatchObject({
      ok: false,
      code: "AUTH_RESET_LINK_EXPIRED",
    });
  });
});

describe("changeEmailAction", () => {
  const EMAIL_FORM = { newEmail: "new@school.edu", confirmEmail: "new@school.edu", currentPassword: "current-pass" };

  beforeEach(() => {
    userFindFirst.mockResolvedValue(null);
    updateUserById.mockResolvedValue({ error: null });
  });

  it("refuses an address that is already in use", async () => {
    userFindFirst.mockResolvedValue({ id: "other" });
    expect(await run(() => changeEmailAction(form(EMAIL_FORM)))).toMatchObject({ ok: false, code: "AUTH_EMAIL_IN_USE" });
  });

  it("refuses the address the account already has", async () => {
    expect(await run(() => changeEmailAction(form({ ...EMAIL_FORM, newEmail: "teacher@school.edu", confirmEmail: "teacher@school.edu" })))).toMatchObject({
      ok: false,
      code: "AUTH_EMAIL_UNCHANGED",
    });
  });

  it("rolls the address back when our own write fails, and says so plainly", async () => {
    userUpdate.mockRejectedValue(Object.assign(new Error("pool timeout"), { name: "PrismaClientKnownRequestError", code: "P2024" }));
    const res = await run(() => changeEmailAction(form(EMAIL_FORM)));
    expect(updateUserById).toHaveBeenCalledTimes(2); // change, then rollback
    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
  });

  it("pages an admin when the rollback fails too and the two systems disagree", async () => {
    userUpdate.mockRejectedValue(new Error("write failed"));
    updateUserById.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "rollback failed" } });
    const res = await run(() => changeEmailAction(form(EMAIL_FORM)));
    expect(res).toMatchObject({ ok: false, code: "AUTH_EMAIL_PARTIAL_UPDATE", ref: "E-TESTREF6" });
    expect(reportError.mock.calls.at(-1)?.[0]).toMatchObject({ severity: "system" });
  });
});

describe("requestPasswordReset", () => {
  it("answers the same whether or not the account exists", async () => {
    userFindUnique.mockResolvedValue(null);
    const unknown = await run(() => requestPasswordReset(form({ email: "nobody@school.edu" })));
    userFindUnique.mockResolvedValue({ id: "user-1", schoolId: "school-1", isActive: true, deletedAt: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const known = await run(() => requestPasswordReset(form({ email: "teacher@school.edu" })));
    expect(unknown).toEqual({ ok: true });
    expect(known).toEqual({ ok: true });
  });

  it("records a failed send that the person is deliberately not told about", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", schoolId: "school-1", isActive: true, deletedAt: null });
    resetPasswordForEmail.mockResolvedValue({ error: { message: "Error sending recovery email" } });
    expect(await run(() => requestPasswordReset(form({ email: "teacher@school.edu" })))).toEqual({ ok: true });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatchObject({ code: "AUTH_EMAIL_SEND_FAILED" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/actions/account-security.test.ts` — Expected: FAIL.

- [ ] **Step 3: Rewrite the six account actions in `src/lib/actions/auth.ts`**

Each becomes `export const X = action("X", async (…) => …)`. The changed logic, in full:

```ts
/** Forced first-login / activation password change (current session). */
export const setPasswordAction = action("setPasswordAction", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const user = await requireUser(undefined, true, { allowMustChangePassword: true });

  const rate = await checkRateLimit(`password:set:${user.id}`, PASSWORD_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  const input = parseInput(setPasswordSchema, {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  // A reused or policy-rejected password fails again on the next attempt, so
  // "please try again" was advice that could not work.
  if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false, passwordIsSchoolId: false },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    resource: "User",
    resourceId: user.id,
    metadata: { reason: "set_password" },
  });

  redirect(roleHomePath(user.role));
});
```

`skipPasswordChange` keeps its body verbatim (including the comment about `passwordIsSchoolId`), wrapped as `action("skipPasswordChange", …)`.

```ts
/** Voluntary password change — requires verifying the current password first. */
export const changePasswordAction = action("changePasswordAction", async (formData: FormData): Promise<{ ok: true }> => {
  assertSupabaseConfigured();

  const user = await requireUser();

  const rate = await checkRateLimit(`password:change:${user.id}`, PASSWORD_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  const input = parseInput(changePasswordSchema, {
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  const supabase = await createSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verifyErr) {
    // A 429 here means Supabase declined to check the password at all. Saying
    // "incorrect" would send the person off to reset a password that is fine.
    const code = mapSupabaseAuthError(verifyErr, "server");
    throw new AppError(code === "AUTH_INCORRECT_PASSWORD" ? "AUTH_CURRENT_PASSWORD_INCORRECT" : code, { cause: verifyErr });
  }

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false, passwordIsSchoolId: false },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    resource: "User",
    resourceId: user.id,
    metadata: { reason: "change_password" },
  });

  return { ok: true };
});
```

```ts
/** Change account email — re-auth with current password, then dual-write Auth + Prisma. */
export const changeEmailAction = action("changeEmailAction", async (formData: FormData): Promise<{ ok: true }> => {
  assertSupabaseConfigured();

  const user = await requireUser();

  const rate = await checkRateLimit(`email:change:${user.id}`, EMAIL_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  const input = parseInput(changeEmailSchema, {
    newEmail: formData.get("newEmail"),
    confirmEmail: formData.get("confirmEmail"),
    currentPassword: formData.get("currentPassword"),
  });

  const newEmail = input.newEmail.trim().toLowerCase();
  if (newEmail === user.email.trim().toLowerCase()) throw new AppError("AUTH_EMAIL_UNCHANGED");

  const supabase = await createSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verifyErr) {
    const code = mapSupabaseAuthError(verifyErr, "server");
    throw new AppError(code === "AUTH_INCORRECT_PASSWORD" ? "AUTH_CURRENT_PASSWORD_INCORRECT" : code, { cause: verifyErr });
  }

  const taken = await prisma.user.findFirst({
    where: { email: newEmail, deletedAt: null, NOT: { id: user.id } },
    select: { id: true },
  });
  if (taken) throw new AppError("AUTH_EMAIL_IN_USE");

  const previousWasSynthetic = isSyntheticEmail(user.email);
  const oldEmail = user.email;

  // Throws CONFIG_MISSING when the service-role key is absent; the wrapper turns
  // that into "not set up yet" plus a reference, instead of the old
  // "temporarily unavailable" that no one could act on.
  const admin = createSupabaseAdminClient();

  const { error: authErr } = await admin.auth.admin.updateUserById(user.authId, {
    email: newEmail,
    email_confirm: true,
  });
  if (authErr) throw new AppError(mapSupabaseAuthError(authErr, "server"), { cause: authErr });

  try {
    await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });
  } catch (dbErr) {
    // Put the address back, or the person signs in with an address LITRACK does
    // not know. If even that fails the two systems disagree and only an admin
    // can fix it — the one failure in this action that pages someone.
    const { error: rollbackErr } = await admin.auth.admin.updateUserById(user.authId, {
      email: oldEmail,
      email_confirm: true,
    });
    if (rollbackErr) {
      throw new AppError("AUTH_EMAIL_PARTIAL_UPDATE", {
        cause: dbErr,
        detail: `Auth email changed to the new address but the LITRACK row still holds the old one, and the rollback failed: ${rollbackErr.message}`,
        context: { reason: "email_rollback_failed" },
      });
    }
    throw dbErr;
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.EMAIL_CHANGE,
    resource: "User",
    resourceId: user.id,
    metadata: { previousWasSynthetic },
  });

  revalidatePath(roleSecurityPath(user.role));

  return { ok: true };
}, { verb: "save your new email" });
```

```ts
/**
 * Email recovery for accounts with a real (non-synthetic) email.
 * Always returns the same success message (no account enumeration).
 */
export const requestPasswordReset = action("requestPasswordReset", async (formData: FormData): Promise<{ ok: true }> => {
  assertSupabaseConfigured();

  const input = parseInput(forgotPasswordSchema, { email: formData.get("email") });

  const email = input.email.toLowerCase();
  const rate = await checkRateLimit(`password:forgot:${email}`, RECOVERY_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  // Do not reveal whether the account exists. Skip reset for synthetic emails.
  if (!isSyntheticEmail(email)) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, schoolId: true, isActive: true, deletedAt: true },
    });
    if (existing && existing.isActive && !existing.deletedAt) {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl()}/auth/reset`,
      });
      if (error) {
        // The person must still see "sent" — telling them it failed would tell a
        // stranger the account exists. But a mail sender that has stopped
        // working is invisible to everyone otherwise, so it is recorded here.
        reportError(
          new AppError("AUTH_EMAIL_SEND_FAILED", {
            cause: error,
            detail: `resetPasswordForEmail failed: ${error.message}`,
            context: { reason: "reset_email_failed", schoolId: existing.schoolId },
          }),
          { route: "requestPasswordReset", userId: existing.id, schoolId: existing.schoolId }
        );
      }
      await writeAudit({
        userId: existing.id,
        schoolId: existing.schoolId,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUEST,
        resource: "User",
        resourceId: existing.id,
      });
    }
  }

  return { ok: true };
});
```

```ts
/** Complete password recovery after Supabase redirects to /auth/reset with a recovery session. */
export const completePasswordReset = action("completePasswordReset", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const input = parseInput(setPasswordSchema, {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) throw new AppError("AUTH_RESET_LINK_EXPIRED");

  const rate = await checkRateLimit(`password:reset:${authUser.id}`, PASSWORD_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

  // …unchanged from here: update flags, write the audit row, redirect.
});
```

`logoutAction` is wrapped as `action("logoutAction", …)` with its body unchanged.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/unit/actions && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/auth.ts tests/unit/actions/account-security.test.ts
git commit -m "fix(auth): password and email failures name the actual refusal"
```

---

### Task 14: Registration conflicts speak the catalog

**Files:**
- Modify: `src/lib/auth/teacher-registration-helpers.ts`, `src/lib/auth/teacher-registration.ts`, `src/lib/actions/auth.ts` (`registerTeacher`, `createOrAdoptTeacherAuthUser`, `finishTeacherRegister`)
- Test: `tests/unit/auth-helpers.test.ts` (update), `tests/unit/actions/register-teacher.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 2, 6, 10, 12
- Produces:
  - `registerConflictCode(user, schoolId) → ErrorCode`; `registerConflictError(user, schoolId) → string` kept as a thin wrapper
  - `CompleteTeacherAuthResult` failure member becomes `{ ok: false; error: AppError; signOut: boolean }`
  - `registerTeacher` wrapped, returning `{ ok: true; redirectTo } | ActionFailure`

- [ ] **Step 1: Update `tests/unit/auth-helpers.test.ts`** — replace the "maps register conflict messages" case with one that pins codes, and keep a message assertion so the copy stays stable:

```ts
  it("maps register conflicts to codes, and keeps the wording", () => {
    expect(registerConflictCode(base, "school-1")).toBe("AUTH_TEACHER_PENDING");
    expect(registerConflictCode({ ...base, approvalStatus: "REJECTED" }, "school-1")).toBe("AUTH_REGISTRATION_DECLINED");
    expect(registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: false }, "school-1")).toBe("AUTH_ACCOUNT_DEACTIVATED");
    expect(registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: true }, "school-1")).toBe("AUTH_ACCOUNT_EXISTS_SIGN_IN");
    // An account at ANOTHER school must not be described as one at this school.
    expect(registerConflictCode(base, "other-school")).toBe("AUTH_EMAIL_IN_USE");

    expect(registerConflictError(base, "school-1")).toBe("Your request is pending School Head approval.");
    expect(registerConflictError(base, "other-school")).toBe("That email is already used by another LITRACK account.");
  });
```
Add `registerConflictCode` to the import list at the top of that file.

- [ ] **Step 2: Write `tests/unit/actions/register-teacher.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teacher self-registration. Every conflict here is something the person can act
 * on — sign in instead, wait for approval, contact the School Head — so each one
 * gets its own answer. The throttle is charged on a conflict too: registration
 * answers the same question as sign-in ("does this address have an account?").
 */

const userFindUnique = vi.fn();
const schoolFindUnique = vi.fn();
const createUser = vi.fn();
const signInWithPassword = vi.fn();
const getSession = vi.fn();
const completeTeacherAuthAfterVerify = vi.fn();
const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();
const reportError = vi.fn(() => "E-TESTREF7");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { get findUnique() { return userFindUnique; }, update: vi.fn(), findFirst: vi.fn() },
    school: { get findUnique() { return schoolFindUnique; } },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword, getSession, signOut: vi.fn() } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ auth: { admin: { createUser } } }) }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true, SUPABASE_NOT_CONFIGURED_MESSAGE: "env missing" }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), AUDIT_ACTIONS: { TEACHER_REGISTER: "TEACHER_REGISTER" } }));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() { return checkRateLimit; },
  get peekRateLimit() { return peekRateLimit; },
}));
vi.mock("@/lib/errors/report", () => ({ get reportError() { return reportError; } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), roleHomePath: () => "/teacher", roleSecurityPath: () => "/x" }));
vi.mock("@/lib/auth/warm-routes", () => ({ warmAdminRoutes: vi.fn(), warmSchoolHeadRoutes: vi.fn(), warmTeacherRoutes: vi.fn() }));
vi.mock("@/lib/auth/teacher-registration", () => ({
  get completeTeacherAuthAfterVerify() { return completeTeacherAuthAfterVerify; },
}));
vi.mock("@/lib/auth/synthetic-email", () => ({ isSyntheticEmail: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (p: string) => { throw new Error(`NEXT_REDIRECT:${p}`); },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

import { registerTeacher } from "@/lib/actions/auth";

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base = {
    schoolId: "school-1",
    email: "new@school.edu",
    firstName: "Maria",
    lastName: "Santos",
    isAralVolunteer: "false",
    password: "N3wStrongPass",
    confirmPassword: "N3wStrongPass",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  schoolFindUnique.mockResolvedValue({ id: "school-1", isActive: true, deletedAt: null });
  userFindUnique.mockResolvedValue(null);
  createUser.mockResolvedValue({ data: { user: { id: "auth-new" } }, error: null });
  getSession.mockResolvedValue({ data: { session: { user: { id: "auth-new" } } } });
  completeTeacherAuthAfterVerify.mockResolvedValue({ ok: true, outcome: "pending" });
  reportError.mockReturnValue("E-TESTREF7");
});

describe("registerTeacher", () => {
  it("creates the account and sends the teacher to the waiting page", async () => {
    await expect(registerTeacher(form())).resolves.toEqual({ ok: true, redirectTo: "/account/created" });
  });

  it("tells someone who already has an account to sign in", async () => {
    userFindUnique.mockResolvedValue({
      id: "t-1", role: "TEACHER", schoolId: "school-1", approvalStatus: "APPROVED", isActive: true, deletedAt: null,
    });
    const res = await registerTeacher(form());
    expect(res).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_EXISTS_SIGN_IN" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("tells someone already waiting that they are waiting", async () => {
    userFindUnique.mockResolvedValue({
      id: "t-1", role: "TEACHER", schoolId: "school-1", approvalStatus: "PENDING", isActive: false, deletedAt: null,
    });
    expect(await registerTeacher(form())).toMatchObject({ ok: false, code: "AUTH_TEACHER_PENDING" });
  });

  it("does not reveal that the address belongs to another school", async () => {
    userFindUnique.mockResolvedValue({
      id: "t-1", role: "TEACHER", schoolId: "school-2", approvalStatus: "APPROVED", isActive: true, deletedAt: null,
    });
    const res = await registerTeacher(form());
    expect(res).toMatchObject({ ok: false, code: "AUTH_EMAIL_IN_USE" });
    expect((res as { error: string }).error).not.toMatch(/school-2|another school/i);
  });

  it("charges the lookup throttle on a conflict, because it answers the same question", async () => {
    userFindUnique.mockResolvedValue({
      id: "t-1", role: "TEACHER", schoolId: "school-1", approvalStatus: "APPROVED", isActive: true, deletedAt: null,
    });
    await registerTeacher(form());
    expect(checkRateLimit).toHaveBeenCalledWith("login:lookup-miss:ip:203.0.113.9", expect.any(Object));
  });

  it("says sign-ups are switched off when the project refuses them", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: "signup_disabled", message: "Signups not allowed for this instance" } });
    expect(await registerTeacher(form())).toMatchObject({ ok: false, code: "AUTH_SIGNUPS_DISABLED", ref: "E-TESTREF7" });
  });

  it("tells the teacher to sign in when the account exists but the auto sign-in failed", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInWithPassword.mockResolvedValue({ error: { status: 400, message: "Invalid login credentials" } });
    expect(await registerTeacher(form())).toMatchObject({ ok: false, code: "AUTH_REGISTERED_SIGN_IN" });
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `npx vitest run tests/unit/auth-helpers.test.ts tests/unit/actions/register-teacher.test.ts` — Expected: FAIL.

- [ ] **Step 4: Add `registerConflictCode` to `src/lib/auth/teacher-registration-helpers.ts`**

```ts
import type { ErrorCode } from "@/lib/errors/codes";
import { formatMessage } from "@/lib/errors/codes";

/**
 * Why a registration cannot proceed for an address that already has an account.
 *
 * An account at ANOTHER school is deliberately the vaguest answer: naming it
 * would tell a stranger where a colleague works.
 */
export function registerConflictCode(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "isActive">,
  schoolId: string
): ErrorCode {
  if (user.role === "TEACHER" && user.schoolId === schoolId) {
    if (user.approvalStatus === "PENDING") return "AUTH_TEACHER_PENDING";
    if (user.approvalStatus === "REJECTED") return "AUTH_REGISTRATION_DECLINED";
    if (user.approvalStatus === "APPROVED" && !user.isActive) return "AUTH_ACCOUNT_DEACTIVATED";
    if (user.approvalStatus === "APPROVED" || user.isActive) return "AUTH_ACCOUNT_EXISTS_SIGN_IN";
  }
  return "AUTH_EMAIL_IN_USE";
}

/** Kept for callers that only want the sentence. */
export function registerConflictError(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "isActive">,
  schoolId: string
): string {
  return formatMessage(registerConflictCode(user, schoolId));
}
```
Replace `DECLINED_REGISTRATION_MESSAGE` / `DEACTIVATED_TEACHER_MESSAGE` with re-exports so existing importers keep working:
```ts
/** @deprecated Use `formatMessage("AUTH_REGISTRATION_DECLINED")`. Kept while callers migrate. */
export const DECLINED_REGISTRATION_MESSAGE = formatMessage("AUTH_REGISTRATION_DECLINED");
/** @deprecated Use `formatMessage("AUTH_ACCOUNT_DEACTIVATED")`. Kept while callers migrate. */
export const DEACTIVATED_TEACHER_MESSAGE = formatMessage("AUTH_ACCOUNT_DEACTIVATED");
```

- [ ] **Step 5: `teacher-registration.ts` carries an `AppError` instead of a string**

```ts
export type CompleteTeacherAuthResult =
  | { ok: true; outcome: "pending" | "approved" }
  | { ok: false; error: AppError; signOut: boolean };
```
Then each failure return becomes an `AppError`:
- `"First and last name are required."` → `fieldError("firstName", "First and last name are required.")`
- `"Registration failed. Please try again."` → `classifyError(err, { verb: "create your account" })` (the caught Prisma error, so a pool timeout says so and carries a reference)
- the three `"No teacher account found for this school. Create an account first."` → `new AppError("AUTH_TEACHER_NOT_FOUND", { context: { schoolId } })`
- `registerConflictError(existing, schoolId)` → `new AppError(registerConflictCode(existing, schoolId))`
- `DECLINED_REGISTRATION_MESSAGE` → `new AppError("AUTH_REGISTRATION_DECLINED")`
- `DEACTIVATED_TEACHER_MESSAGE` → `new AppError("AUTH_ACCOUNT_DEACTIVATED")`

- [ ] **Step 6: `registerTeacher` in `src/lib/actions/auth.ts`**

```ts
export const registerTeacher = action("registerTeacher", async (formData: FormData): Promise<{ ok: true; redirectTo: string }> => {
  assertSupabaseConfigured();

  const input = parseInput(teacherRegisterSchema, {
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    firstName: formData.get("firstName") || undefined,
    middleName: formData.get("middleName") || undefined,
    lastName: formData.get("lastName") || undefined,
    // Unticked checkboxes send nothing, so absence is `false` — and the string
    // "false" must be false too, since the client posts the flag explicitly.
    isAralVolunteer: formData.get("isAralVolunteer") === "true",
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  const email = input.email.toLowerCase().trim();
  const { schoolId, password } = input;
  const names: TeacherRegisterNames = {
    firstName: input.firstName.trim(),
    middleName: input.middleName?.trim() || undefined,
    lastName: input.lastName.trim(),
  };

  const rate = await checkRateLimit(`register:teacher:${schoolId}:${email}`, REGISTER_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  await assertLookupAllowed();
  await requireActiveSchool(schoolId);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    // A conflict answers the same question sign-in does — "does this address
    // have an account?" — so it costs the same allowance.
    await recordFailedLookup();
    throw new AppError(registerConflictCode(existing, schoolId));
  }

  const supabase = await createSupabaseServerClient();
  const authId = await createOrAdoptTeacherAuthUser(supabase, { email, password, schoolId });

  // Sign in so the browser holds a session for /account/created. If this fails
  // the auth user exists but no LITRACK row does yet — signing in and creating
  // the account again recovers it through the adopt path above.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.id !== authId) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw new AppError("AUTH_REGISTERED_SIGN_IN", { cause: signInError });
  }

  return finishTeacherRegister(supabase, { authId, email, schoolId, names, isAralVolunteer: input.isAralVolunteer });
}, { verb: "create your account" });
```

`createOrAdoptTeacherAuthUser` now returns `Promise<string>` (the auth id) and throws:
```ts
  const { data, error } = await admin.auth.admin.createUser({ … });
  if (!error && data.user) return data.user.id;

  const message = (error?.message ?? "").toLowerCase();
  const alreadyRegistered =
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already exists");

  if (!alreadyRegistered) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

  // An auth user can already exist without a LITRACK row (the Prisma conflict
  // check above ran first): that is an abandoned earlier attempt, so adopt it
  // when the same password signs in rather than dead-ending the teacher.
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) throw new AppError("AUTH_ACCOUNT_EXISTS_SIGN_IN", { cause: signInError ?? undefined });
  return signInData.user.id;
```
and its `createSupabaseAdminClient()` try/catch is deleted — the client throws `CONFIG_MISSING` itself now.

`finishTeacherRegister` returns `{ ok: true; redirectTo }` and rethrows `result.error` (the `AppError`) after the sign-out branch.

- [ ] **Step 7: Run to verify** — `npx vitest run tests/unit && npm run typecheck` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/teacher-registration-helpers.ts src/lib/auth/teacher-registration.ts src/lib/actions/auth.ts tests/unit/auth-helpers.test.ts tests/unit/actions/register-teacher.test.ts
git commit -m "feat(auth): registration conflicts each get their own answer"
```

---

### Task 15: The login form stops guessing

**Files:**
- Modify: `src/components/forms/login-form.tsx:187-196,304-315,265-269`
- Test: `tests/components/login-form-errors.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 11
- Produces: the browser grant classified through `mapSupabaseAuthError(err, "browser")`; no hard-coded sentences left in the component

**The bug being fixed:** when the browser cannot reach Supabase at all, the form currently says "Incorrect password" — the password was never checked.

- [ ] **Step 1: Write the failing test** `tests/components/login-form-errors.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { formatMessage } from "@/lib/errors/codes";
import { mapSupabaseAuthError } from "@/lib/errors/supabase";
import { loginFailureReasonFor } from "@/lib/errors/supabase";

/**
 * What the login form says after the browser's own password grant fails.
 *
 * The component hands the error to `mapSupabaseAuthError(err, "browser")` and
 * shows the catalog message for the code, so these cases pin the same decision
 * the form makes, without rendering it.
 */

const WRONG_PASSWORD = { status: 400, code: "invalid_credentials", message: "Invalid login credentials" };
const RATE_LIMITED = { status: 429, message: "Request rate limit reached" };
const OFFLINE = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };

describe("browser sign-in failures", () => {
  it("says the password is wrong only when it was actually checked", () => {
    const code = mapSupabaseAuthError(WRONG_PASSWORD, "browser");
    expect(code).toBe("AUTH_INCORRECT_PASSWORD");
    expect(formatMessage(code)).toBe("Incorrect password. Check it and try again.");
  });

  it("blames the connection when the request never arrived", () => {
    const code = mapSupabaseAuthError(OFFLINE, "browser");
    expect(code).toBe("AUTH_SERVICE_UNREACHABLE");
    expect(formatMessage(code)).toMatch(/internet connection/i);
    expect(formatMessage(code)).not.toMatch(/password/i);
  });

  it("tells someone rate-limited not to reset a password that is fine", () => {
    const code = mapSupabaseAuthError(RATE_LIMITED, "browser");
    expect(formatMessage(code)).toMatch(/no need to reset/i);
  });

  it("records each cause under its own audit reason", () => {
    expect(loginFailureReasonFor(mapSupabaseAuthError(WRONG_PASSWORD, "browser"))).toBe("incorrect_credentials");
    expect(loginFailureReasonFor(mapSupabaseAuthError(RATE_LIMITED, "browser"))).toBe("rate_limited");
    expect(loginFailureReasonFor(mapSupabaseAuthError(OFFLINE, "browser"))).toBe("service_unreachable");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/components/login-form-errors.test.tsx` — Expected: PASS once Task 2 is in (this test guards the mapping the component will use). If it already passes, proceed: Step 3 is what changes the component.

- [ ] **Step 3: Use the mapping in `src/components/forms/login-form.tsx`**

Replace the `AUTH_RATE_LIMITED_MESSAGE`/`isAuthRateLimitError` import with:
```tsx
import { formatMessage } from "@/lib/errors/codes";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";
```

Teacher grant (was lines 187–196):
```tsx
      if (error) {
        // The browser made this request, so it is the only place that can tell
        // "the server said no" from "the request never arrived". Saying
        // "incorrect password" for a dropped connection is what sent people to
        // reset passwords that were never wrong.
        const code = mapSupabaseAuthError(error, "browser");
        await reportLoginFailure({
          schoolId,
          role: "TEACHER",
          email: begin.email,
          reason: loginFailureReasonFor(code),
        });
        toast.error(formatMessage(code));
        return;
      }
```

School Head grant (was lines 304–315):
```tsx
      if (error) {
        const code = mapSupabaseAuthError(error, "browser");
        await reportLoginFailure({
          schoolId,
          role: "SCHOOL_HEAD",
          reason: loginFailureReasonFor(code),
        });
        toast.error(formatMessage(code));
        return;
      }
```

Register catch (was lines 265–269):
```tsx
      } catch (err) {
        console.error("[login-form] teacher register failed:", err);
        registerLock.current = false;
        toast.error(formatMessage("INTERNAL_ERROR"));
      }
```

- [ ] **Step 4: Run to verify** — `npx vitest run tests/components && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/login-form.tsx tests/components/login-form-errors.test.tsx
git commit -m "fix(auth): an unreachable sign-in service no longer reads as a wrong password"
```

---
### Task 16: API routes and the retention job

**Files:**
- Modify: `src/app/api/schools/list/route.ts`, `src/app/api/cron/backup/route.ts`, `src/app/api/admin/backups/download/route.ts`
- Test: `tests/unit/api/route-errors.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 10
- Produces: all three routes wrapped in `route()`; the daily cron also purges expired `ErrorEvent` rows

**Security note being fixed:** the cron route currently returns `err.message` in its 500 body.

- [ ] **Step 1: Write the failing test** `tests/unit/api/route-errors.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSchoolsPublic = vi.fn();
const checkRateLimit = vi.fn();
const reportError = vi.fn(() => "E-TESTREF8");
const purgeExpiredErrorEvents = vi.fn();
const createSnapshot = vi.fn();
const saveBackup = vi.fn();

vi.mock("@/lib/actions/school", () => ({ get listSchoolsPublic() { return listSchoolsPublic; } }));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() { return checkRateLimit; },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/errors/report", () => ({ get reportError() { return reportError; } }));
vi.mock("@/lib/errors/retention", () => ({ get purgeExpiredErrorEvents() { return purgeExpiredErrorEvents; } }));
vi.mock("@/lib/db/snapshot", () => ({ get createSnapshot() { return createSnapshot; } }));
vi.mock("@/lib/db/backup-store", () => ({
  isBackupStoreConfigured: () => true,
  get saveBackup() { return saveBackup; },
  readBackupBytes: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), AUDIT_ACTIONS: { DB_BACKUP_CREATE: "DB_BACKUP_CREATE", DB_BACKUP_DOWNLOAD: "DB_BACKUP_DOWNLOAD" } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));

import { NextRequest } from "next/server";
import { GET as listSchools } from "@/app/api/schools/list/route";
import { GET as cronBackup } from "@/app/api/cron/backup/route";

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, "https://litrack.example.org"), { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  listSchoolsPublic.mockResolvedValue([{ id: "s1", name: "School" }]);
  purgeExpiredErrorEvents.mockResolvedValue(3);
  createSnapshot.mockResolvedValue({ meta: { totalRows: 10 } });
  saveBackup.mockResolvedValue({ pathname: "daily/x.gz", size: 100, stamp: "2026-09-11" });
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/schools/list", () => {
  it("answers with the schools", async () => {
    const res = await listSchools(request("/api/schools/list"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ schools: [{ id: "s1" }] });
  });

  it("says the database is unavailable, with a reference, not 'no schools'", async () => {
    listSchoolsPublic.mockRejectedValue(Object.assign(new Error("pool timeout"), { name: "PrismaClientKnownRequestError", code: "P2024" }));
    const res = await listSchools(request("/api/schools/list"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ code: "DB_UNAVAILABLE", ref: "E-TESTREF8" });
    expect(body.message).not.toMatch(/prisma|pool timeout/i);
  });
});

describe("/api/cron/backup", () => {
  it("refuses a request without the shared secret", async () => {
    const res = await cronBackup(request("/api/cron/backup?kind=daily"));
    expect(res.status).toBe(401);
  });

  it("never echoes the underlying error text", async () => {
    createSnapshot.mockRejectedValue(new Error("relation \"Learner\" does not exist"));
    const res = await cronBackup(request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/relation|Learner/);
    expect(body).toHaveProperty("ref");
  });

  it("purges expired error records alongside the backup", async () => {
    const res = await cronBackup(request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    expect(purgeExpiredErrorEvents).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ ok: true, errorEventsPurged: 3 });
  });

  it("still reports a successful backup when the purge fails", async () => {
    purgeExpiredErrorEvents.mockRejectedValue(new Error("delete failed"));
    const res = await cronBackup(request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("does not purge on the weekly run", async () => {
    await cronBackup(request("/api/cron/backup?kind=weekly", { authorization: "Bearer s3cret" }));
    expect(purgeExpiredErrorEvents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/api/route-errors.test.ts` — Expected: FAIL.

- [ ] **Step 3: Wrap `src/app/api/schools/list/route.ts`**

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { listSchoolsPublic } from "@/lib/actions/school";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { route } from "@/lib/errors/route";
import { tooManyAttempts } from "@/lib/errors/app-error";

// Must stay dynamic: prerendering this at build time requires a reachable
// database, which is not guaranteed in the Vercel build environment.
export const dynamic = "force-dynamic";

/** Soft abuse protection for unauthenticated school enumeration (id + name only). */
const PUBLIC_LIST_RATE = { limit: 60, windowMs: 60_000 };

export const GET = route("GET /api/schools/list", async () => {
  const ip = clientIpFrom(await headers());
  const rate = await checkRateLimit(`api:schools-list:${ip}`, PUBLIC_LIST_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

  // An unreachable database must not masquerade as "there are no schools" —
  // that renders an empty picker on /login and hides the outage entirely. The
  // wrapper turns the throw into a 503 naming the cause.
  return NextResponse.json({ schools: await listSchoolsPublic() });
});
```

- [ ] **Step 4: Wrap `src/app/api/cron/backup/route.ts`** — keep `isAuthorized` and the header comment; replace the handler:

```ts
export const GET = route("GET /api/cron/backup", async (request: NextRequest) => {
  if (!isAuthorized(request)) throw new AppError("AUTH_NOT_SIGNED_IN", { detail: "Missing or wrong CRON_SECRET" });

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: BackupKind = kindParam === "weekly" ? "weekly" : "daily";

  if (!isBackupStoreConfigured()) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      params: { service: "Backup storage" },
      detail: "BLOB_READ_WRITE_TOKEN is not set; no backup store to write to.",
      context: { service: "blob" },
    });
  }

  const snapshot = await createSnapshot();
  const saved = await saveBackup(kind, snapshot);

  await writeAudit({
    action: AUDIT_ACTIONS.DB_BACKUP_CREATE,
    resource: "Database",
    resourceId: saved.pathname,
    metadata: { trigger: "cron", kind, totalRows: snapshot.meta.totalRows, bytes: saved.size },
  });

  // Housekeeping rides on the daily run rather than its own cron entry: one
  // schedule fewer to keep working, and the plan's cron allowance is finite.
  // A failed purge must never fail a backup.
  let errorEventsPurged: number | null = null;
  if (kind === "daily") {
    try {
      errorEventsPurged = await purgeExpiredErrorEvents();
    } catch (err) {
      console.error("[cron/backup] ErrorEvent purge failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    ok: true,
    kind,
    stamp: saved.stamp,
    bytes: saved.size,
    totalRows: snapshot.meta.totalRows,
    errorEventsPurged,
  });
});
```
The old `catch` that returned `err.message` is gone: `route()` records the full error and answers with a reference. (`maxDuration = 300` stays.)

- [ ] **Step 5: Wrap `src/app/api/admin/backups/download/route.ts`** — keep the header comment and the `getCurrentUser` gate; replace the refusals and the `catch`:

```ts
export const GET = route("GET /api/admin/backups/download", async (request: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTH_NOT_SIGNED_IN");
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "database backups" },
      detail: `Role ${user.role} requested a backup download`,
      context: { reason: "not_super_admin" },
    });
  }

  if (!isBackupStoreConfigured()) {
    throw new AppError("SERVICE_UNAVAILABLE", { params: { service: "Backup storage" }, context: { service: "blob" } });
  }

  const pathname = request.nextUrl.searchParams.get("path");
  if (!pathname) throw fieldError("path", "Which backup? The link is missing its file name.");

  // `readBackupBytes` rejects anything outside the backup layout, so a crafted
  // `path` cannot turn this into a read of an arbitrary blob.
  const bytes = await readBackupBytes(pathname);
  if (!bytes) throw resourceNotFound("Backup");

  await writeAudit({ … });   // unchanged

  return new NextResponse(new Uint8Array(bytes), { headers: { … } });   // unchanged
});
```
Because this link is opened by a browser, `errorResponse` sends a signed-out admin to `/admin/login` and a wrong role to `/forbidden` instead of showing JSON.

- [ ] **Step 6: Run to verify** — `npx vitest run tests/unit/api && npm run typecheck` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api tests/unit/api
git commit -m "feat(errors): API routes answer in one shape, and the cron stops echoing raw errors"
```

---

### Task 17: 404, 403 and 500 pages

**Files:**
- Create: `src/lib/nav/not-found-links.ts`, `src/components/errors/error-card.tsx`, `src/components/errors/route-error.tsx`, `src/components/errors/not-found-content.tsx`, `src/app/forbidden/page.tsx`, `src/app/global-error.tsx`, `src/app/teacher/(app)/[...missing]/page.tsx`, `src/app/teacher/(app)/not-found.tsx`, `src/app/school-head/(app)/[...missing]/page.tsx`, `src/app/school-head/(app)/not-found.tsx`, `src/app/admin/[...missing]/page.tsx`, `src/app/admin/not-found.tsx`
- Modify: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/admin/error.tsx`, `src/app/teacher/(app)/error.tsx`, `src/app/school-head/(app)/error.tsx`, `src/lib/auth/session.ts` (add `peekCurrentUser`)
- Test: `tests/unit/errors/not-found-links.test.ts`, `tests/unit/errors/error-pages.test.ts`, `e2e/not-found.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 9
- Produces:
  - `notFoundLinksFor(role: UserRole | null) → Array<{ href: string; label: string }>`
  - `<ErrorCard icon title description reference? actions>`, `<RouteError error reset homeHref homeLabel title description>`, `<NotFoundContent links />`
  - `peekCurrentUser()` — the current user or null, never redirecting

- [ ] **Step 1: Write the failing tests** `tests/unit/errors/not-found-links.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { notFoundLinksFor } from "@/lib/nav/not-found-links";

describe("notFoundLinksFor", () => {
  it("offers a signed-out visitor only the way in", () => {
    expect(notFoundLinksFor(null)).toEqual([{ href: "/login", label: "Sign in" }]);
  });

  it("offers each role its own main pages", () => {
    expect(notFoundLinksFor("TEACHER").map((l) => l.href)).toEqual(["/teacher", "/teacher/aral", "/teacher/learners"]);
    expect(notFoundLinksFor("SCHOOL_HEAD")[0].href).toBe("/school-head");
    expect(notFoundLinksFor("SUPER_ADMIN").map((l) => l.href)).toContain("/admin/schools");
  });

  it("labels every link", () => {
    for (const role of [null, "TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      for (const link of notFoundLinksFor(role)) {
        expect(link.label.length).toBeGreaterThan(2);
        expect(link.href.startsWith("/")).toBe(true);
      }
    }
  });
});
```

`tests/unit/errors/error-pages.test.ts` — a repo invariant, in the style of `route-isr-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../../src/app");

function read(rel: string): string {
  return readFileSync(path.join(APP, rel), "utf8");
}

/**
 * The error pages are the last thing a person sees when everything else failed,
 * so what they must NOT say matters as much as what they do.
 */
describe("error pages", () => {
  it("exists for every boundary, including the root layout", () => {
    for (const file of [
      "not-found.tsx",
      "error.tsx",
      "global-error.tsx",
      "forbidden/page.tsx",
      "admin/error.tsx",
      "teacher/(app)/error.tsx",
      "school-head/(app)/error.tsx",
      "teacher/(app)/not-found.tsx",
      "school-head/(app)/not-found.tsx",
      "admin/not-found.tsx",
    ]) {
      expect(() => read(file), file).not.toThrow();
    }
  });

  it("catches unknown URLs inside every role area", () => {
    for (const file of [
      "teacher/(app)/[...missing]/page.tsx",
      "school-head/(app)/[...missing]/page.tsx",
      "admin/[...missing]/page.tsx",
    ]) {
      expect(read(file), file).toMatch(/notFound\(\)/);
    }
  });

  it("never names our infrastructure to the person reading the page", () => {
    const banned = /prisma|supabase|postgres|schema drift|vercel|DATABASE_URL/i;
    for (const file of ["error.tsx", "global-error.tsx", "admin/error.tsx", "teacher/(app)/error.tsx", "school-head/(app)/error.tsx"]) {
      expect(read(file), file).not.toMatch(banned);
    }
  });

  it("shows the reference a person can quote", () => {
    for (const file of ["error.tsx", "global-error.tsx", "admin/error.tsx", "teacher/(app)/error.tsx", "school-head/(app)/error.tsx"]) {
      expect(read(file), file).toMatch(/digest/);
    }
  });

  it("keeps the global boundary self-contained, since the layout it replaces may be what failed", () => {
    const globalError = read("global-error.tsx");
    expect(globalError).toMatch(/<html/);
    expect(globalError).toMatch(/<body/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/errors/not-found-links.test.ts tests/unit/errors/error-pages.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/nav/not-found-links.ts`**

```ts
import type { UserRole } from "@prisma/client";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Where to offer to go from a page that does not exist.
 *
 * Deliberately three links, not the whole sidebar: a 404 is a wrong turn, and a
 * menu of twelve options is not more helpful than the two or three places
 * someone actually meant. Signed-out visitors get the one thing they can do.
 */
export function notFoundLinksFor(role: UserRole | null): Array<{ href: string; label: string }> {
  switch (role) {
    case "TEACHER":
      return [
        { href: "/teacher", label: "Dashboard" },
        { href: "/teacher/aral", label: "ARAL classes" },
        { href: "/teacher/learners", label: "Learners" },
      ];
    case "SCHOOL_HEAD":
      return [
        { href: SCHOOL_HEAD_ROUTES.dashboard, label: "Dashboard" },
        { href: SCHOOL_HEAD_ROUTES.teachers, label: "Teachers" },
        { href: SCHOOL_HEAD_ROUTES.reports, label: "Reports" },
      ];
    case "SUPER_ADMIN":
      return [
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/schools", label: "Schools" },
        { href: "/admin/audit", label: "Audit" },
      ];
    default:
      return [{ href: "/login", label: "Sign in" }];
  }
}
```

- [ ] **Step 4: Add `peekCurrentUser` to `src/lib/auth/session.ts`**

```ts
/**
 * The signed-in user, or null, with no redirect of any kind.
 *
 * For pages that must render for anyone — the 404 above all. `getCurrentUser`
 * redirects pending and declined teachers, which on a 404 would bounce someone
 * away from the page explaining where they are.
 */
export async function peekCurrentUser(): Promise<User | null> {
  try {
    return await getCurrentUser({ allowPending: true });
  } catch {
    // A 404 must render even when the session or the database is unavailable.
    return null;
  }
}
```

- [ ] **Step 5: Implement the shared components**

`src/components/errors/error-card.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";

/**
 * The one card every error page uses: icon in a tinted circle, title, an
 * explanation, an optional reference, and the ways out. Matches the app's card
 * style (`bg-card`, `shadow-card`); violet stays reserved for ARAL.
 */
export function ErrorCard({
  icon: Icon,
  tone = "destructive",
  title,
  description,
  reference,
  children,
}: {
  icon: LucideIcon;
  tone?: "destructive" | "primary";
  title: string;
  description: React.ReactNode;
  reference?: string | null;
  children?: React.ReactNode;
}) {
  const toneClasses = tone === "primary" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-card">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${toneClasses}`}>
          <Icon className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>
        {reference ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: <span className="font-mono">{reference}</span>
          </p>
        ) : null}
        {children ? <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div> : null}
      </div>
    </main>
  );
}
```

`src/components/errors/route-error.tsx` — one client component behind all five `error.tsx` files:
```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";

/**
 * The body of every route error boundary.
 *
 * The person is told what to do, never what broke: the digest is the whole of
 * what is safe to show, and `onRequestError` has already filed the full error
 * under that same digest for `/admin/errors`.
 */
export function RouteError({
  error,
  reset,
  scope,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
  homeHref: string;
  homeLabel: string;
}) {
  useEffect(() => {
    // A cancelled soft navigation should not leave the person on a fatal modal.
    if (error.name === "AbortError") {
      reset();
      return;
    }
    console.error(`${scope} route error:`, error);
  }, [error, reset, scope]);

  if (error.name === "AbortError") return null;

  return (
    <ErrorCard
      icon={AlertTriangle}
      title="This page couldn't load"
      description="Something went wrong on our side. Try again — if it keeps happening, give your administrator the reference below."
      reference={error.digest ?? null}
    >
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      <Button asChild variant="outline">
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </ErrorCard>
  );
}
```

`src/components/errors/not-found-content.tsx`:
```tsx
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";

export function NotFoundContent({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <ErrorCard
      icon={FileQuestion}
      tone="primary"
      title="Page not found"
      description={
        <>
          <span className="block text-sm font-medium text-primary">404</span>
          This page doesn&apos;t exist, or it may have moved. Here&apos;s where you can go instead.
        </>
      }
    >
      {links.map((link, index) => (
        <Button key={link.href} asChild variant={index === 0 ? "default" : "outline"}>
          <Link href={link.href}>{link.label}</Link>
        </Button>
      ))}
    </ErrorCard>
  );
}
```

- [ ] **Step 6: Rewrite the pages**

`src/app/not-found.tsx`:
```tsx
import { peekCurrentUser } from "@/lib/auth/session";
import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default async function NotFound() {
  const user = await peekCurrentUser();
  return <NotFoundContent links={notFoundLinksFor(user?.role ?? null)} />;
}
```

Each role `not-found.tsx` is the same three lines with the role fixed, so the sidebar stays mounted:
```tsx
import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default function TeacherNotFound() {
  return <NotFoundContent links={notFoundLinksFor("TEACHER")} />;
}
```

Each `[...missing]/page.tsx` is:
```tsx
import { notFound } from "next/navigation";

/**
 * Unknown URLs under this role area render the in-shell 404 instead of the bare
 * root one, so the sidebar stays put. A catch-all has the lowest routing
 * priority, so no real route is shadowed by it.
 */
export default function MissingTeacherRoute() {
  notFound();
}
```

The five `error.tsx` files become:
```tsx
"use client";

import { RouteError } from "@/components/errors/route-error";

export default function TeacherError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="Teacher" homeHref="/teacher" homeLabel="Back to dashboard" />;
}
```
(root: `scope="App"`, `homeHref="/"`, `homeLabel="Back to home"`; admin: `/admin`; school head: `SCHOOL_HEAD_ROUTES.dashboard`.) The admin page's Prisma/Vercel/schema-drift paragraph is deleted — that detail now lives in `/admin/errors`, which is where an admin can actually act on it.

`src/app/global-error.tsx`:
```tsx
"use client";

import { RouteError } from "@/components/errors/route-error";

/**
 * The boundary for failures in the root layout itself. It replaces `<html>`, so
 * it must render its own — and it cannot rely on anything the layout provides,
 * including the theme script, hence the plain background.
 */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <RouteError {...props} scope="App" homeHref="/" homeLabel="Back to home" />
      </body>
    </html>
  );
}
```

`src/app/forbidden/page.tsx`:
```tsx
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";
import { peekCurrentUser } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/auth/roles";
import { ROLE_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

/**
 * Reached when a request is refused rather than redirected — today that is an
 * API route opened in a browser (a stale backup-download link, say). Wrong-role
 * page visits still bounce quietly to the person's own home.
 */
export default async function ForbiddenPage() {
  const user = await peekCurrentUser();
  const home = user ? roleHomePath(user.role) : "/login";

  return (
    <ErrorCard
      icon={ShieldAlert}
      title="You don't have access to this page"
      description={
        user
          ? `You're signed in as ${ROLE_LABELS[user.role]}, which can't open this page. If you think you should have access, ask your administrator.`
          : "Sign in to continue. If you're already signed in on another tab, refresh and try again."
      }
    >
      <Button asChild>
        <Link href={home}>{user ? "Back to your dashboard" : "Sign in"}</Link>
      </Button>
    </ErrorCard>
  );
}
```
(Check the exact export name for role labels in `src/lib/constants/enum-labels.ts` and use it; the file defines a label per `UserRole`.)

- [ ] **Step 7: Write `e2e/not-found.spec.ts`** — following the opt-in pattern of `e2e/school-head-login.spec.ts` (reuse its `isServerReachable` guard and `test.skip` when unreachable):

```ts
import { test, expect } from "@playwright/test";

/**
 * Unknown URLs must reach a 404 rather than a blank page or a redirect loop —
 * including inside a role area, where the layout authenticates first.
 *
 * Opt-in like the other specs: `playwright.config.ts` has no `webServer`, so
 * start `npm run dev` yourself or set PLAYWRIGHT_BASE_URL. Never point it at
 * production.
 */

test("an unknown public URL renders the 404 page", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
});

test("an unknown role URL sends a signed-out visitor to sign in first", async ({ page }) => {
  await page.goto("/teacher/does-not-exist");
  await expect(page).toHaveURL(/\/login/);
});

test("the forbidden page explains itself", async ({ page }) => {
  await page.goto("/forbidden");
  await expect(page.getByRole("heading", { name: /don't have access/i })).toBeVisible();
});
```

- [ ] **Step 8: Run to verify** — `npx vitest run tests/unit/errors && npm run typecheck && npm run lint` — Expected: PASS. (`no-hardcoded-colors` and `shadcn-coverage` cover the new components; keep to tokens and `Button`.)

- [ ] **Step 9: Commit**

```bash
git add src/app src/components/errors src/lib/nav/not-found-links.ts src/lib/auth/session.ts tests/unit/errors e2e/not-found.spec.ts
git commit -m "feat(ui): 404 that offers a way on, a real 403, and error pages that show a reference"
```

---

### Task 18: `/admin/errors`

**Files:**
- Create: `src/app/admin/errors/page.tsx`, `src/app/admin/errors/loading.tsx`, `src/components/admin/error-log-table.tsx`, `src/components/admin/error-log-filters.tsx`
- Modify: `src/lib/nav/nav-config.ts` (one item after Audit)
- Test: `tests/unit/errors/error-log-query.test.ts`
- Create: `src/lib/admin/error-log.ts`

**Interfaces:**
- Consumes: Tasks 1, 3
- Produces: `ERROR_LOG_WINDOWS`, `buildErrorLogQuery(params, now?) → Prisma.ErrorEventWhereInput`, `parseErrorLogParams(searchParams)`

- [ ] **Step 1: Write the failing test** `tests/unit/errors/error-log-query.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildErrorLogQuery, parseErrorLogParams } from "@/lib/admin/error-log";

const NOW = new Date("2026-09-11T12:00:00Z");

describe("parseErrorLogParams", () => {
  it("defaults to the last 24 hours and no filters", () => {
    expect(parseErrorLogParams({})).toEqual({ ref: null, code: null, severity: null, schoolId: null, window: "24h" });
  });

  it("accepts only known windows and severities", () => {
    expect(parseErrorLogParams({ window: "7d" }).window).toBe("7d");
    expect(parseErrorLogParams({ window: "all-time" }).window).toBe("24h");
    expect(parseErrorLogParams({ severity: "system" }).severity).toBe("system");
    expect(parseErrorLogParams({ severity: "user" }).severity).toBeNull();
  });

  it("keeps a reference exactly as typed, trimmed", () => {
    expect(parseErrorLogParams({ ref: "  E-7K2P9QXM " }).ref).toBe("E-7K2P9QXM");
  });
});

describe("buildErrorLogQuery", () => {
  it("looks up a reference on its own, ignoring the time window", () => {
    const where = buildErrorLogQuery({ ref: "E-7K2P9QXM", code: null, severity: null, schoolId: null, window: "24h" }, NOW);
    expect(where).toEqual({ ref: "E-7K2P9QXM" });
  });

  it("filters by window, code, severity and school together", () => {
    const where = buildErrorLogQuery(
      { ref: null, code: "DB_UNAVAILABLE", severity: "system", schoolId: "school-1", window: "7d" },
      NOW
    );
    expect(where).toEqual({
      createdAt: { gte: new Date("2026-09-04T12:00:00Z") },
      code: "DB_UNAVAILABLE",
      severity: "system",
      schoolId: "school-1",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/errors/error-log-query.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/admin/error-log.ts`**

```ts
import type { Prisma } from "@prisma/client";

/** Filters for `/admin/errors`, kept out of the page so they can be tested. */

export const ERROR_LOG_WINDOWS = { "24h": 1, "7d": 7, "30d": 30 } as const;
export type ErrorLogWindow = keyof typeof ERROR_LOG_WINDOWS;

export type ErrorLogParams = {
  ref: string | null;
  code: string | null;
  severity: "security" | "system" | null;
  schoolId: string | null;
  window: ErrorLogWindow;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseErrorLogParams(searchParams: Record<string, string | string[] | undefined>): ErrorLogParams {
  const windowParam = str(searchParams.window);
  const severity = str(searchParams.severity);
  return {
    ref: str(searchParams.ref),
    code: str(searchParams.code),
    severity: severity === "security" || severity === "system" ? severity : null,
    schoolId: str(searchParams.schoolId),
    window: windowParam && Object.hasOwn(ERROR_LOG_WINDOWS, windowParam) ? (windowParam as ErrorLogWindow) : "24h",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildErrorLogQuery(params: ErrorLogParams, now: Date = new Date()): Prisma.ErrorEventWhereInput {
  // A reference is a direct lookup: someone read it off a screen, and the time
  // window is exactly the thing they do not know.
  if (params.ref) return { ref: params.ref };

  const where: Prisma.ErrorEventWhereInput = {
    createdAt: { gte: new Date(now.getTime() - ERROR_LOG_WINDOWS[params.window] * DAY_MS) },
  };
  if (params.code) where.code = params.code;
  if (params.severity) where.severity = params.severity;
  if (params.schoolId) where.schoolId = params.schoolId;
  return where;
}
```

- [ ] **Step 4: Build the page**, mirroring `src/app/admin/audit/page.tsx`: `export const dynamic = "force-dynamic"`, `requireUser("SUPER_ADMIN")`, `AppShell` with title "Errors" and subtitle "Server-side failures across all schools", a `Suspense` around the table with `TableSectionSkeleton`, `EmptyState` when there are none. Columns: When · Code · Severity · Where · School · Reference. Take 150 rows, newest first, resolving school names the same way the audit page does. Each row expands (a `<details>` inside the cell, or a `Collapsible`) to show `message`, `stack` in a `<pre className="overflow-x-auto">`, `context` as JSON, and the user id. Filters go in `src/components/admin/error-log-filters.tsx` as a client component that pushes `?ref=&code=&severity=&schoolId=&window=` — the same query shape `parseErrorLogParams` reads, so the alert email's `?ref=` link lands correctly.

- [ ] **Step 5: Add the nav item** in `src/lib/nav/nav-config.ts`, directly after `admin-audit`:
```ts
            { id: "admin-errors", label: "Errors", href: "/admin/errors", icon: TriangleAlert },
```
with `TriangleAlert` added to the lucide import block.

- [ ] **Step 6: Run to verify** — `npx vitest run && npm run typecheck && npm run lint` — Expected: PASS. Check the nav test in `tests/unit/nav` if one asserts the item list, and update it if so.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/errors src/components/admin/error-log-table.tsx src/components/admin/error-log-filters.tsx src/lib/admin/error-log.ts src/lib/nav/nav-config.ts tests/unit/errors/error-log-query.test.ts
git commit -m "feat(admin): an error log a Super Admin can search by reference"
```

---

### Task 19: Documentation and the full gate

**Files:**
- Create: `docs/errors.md`
- Modify: `CLAUDE.md`, `.claude/agents/backend-developer.md`, `docs/runbook.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: every earlier task

- [ ] **Step 1: Write `docs/errors.md`** covering: the three severities and what each one triggers; how to add a code (catalog entry → throw site → test); the `action()` / `route()` house pattern with a full example; what must never reach `ErrorEvent` or an alert email; how an admin uses a reference (`/admin/errors?ref=…`, or search Vercel logs for `litrack.error`); retention and the env vars; and the full code table from the spec.

- [ ] **Step 2: Update the house pattern in `CLAUDE.md`** — replace the server-actions block with:

````md
### Server actions — the house pattern

Actions live in `src/lib/actions/*.ts`, all `"use server"`, wrapped once by
`action()` so a single handler converts throws into results:

```ts
export const doThing = action("doThing", async (formData: FormData) => {
  const user = await requireSchoolUser("TEACHER");           // 1. auth guard first
  const input = parseInput(someSchema, formToObj(formData)); // 2. throws VALIDATION_FAILED
  // 3. ownership check scoped to user.schoolId (assertSameSchool throws NOT_FOUND)
  // 4. mutate (prisma.$transaction when multi-step)
  // 5. writeAudit({ action: AUDIT_ACTIONS.X, ... })
  // 6. revalidatePath / revalidate* helper
  return { ok: true };
}, { verb: "save the thing" });
```

Failures are thrown, never returned: `throw new AppError("CODE", { detail })`.
The wrapper classifies anything else (Prisma, Supabase, bugs), records
non-user errors to `ErrorEvent` + Vercel logs (+ an alert for `system`), and
returns `{ ok: false, code, error, ref?, fieldErrors? }` — `error` is always
the safe user message. Codes and messages live in `src/lib/errors/codes.ts`;
see `docs/errors.md`.
````
Add a line to the Docs map: `docs/errors.md` (error codes, severities, admin log).

- [ ] **Step 3: Update `.claude/agents/backend-developer.md`** — replace its `ActionResult` snippet with the same pattern, so a dispatched agent does not reintroduce the old shape.

- [ ] **Step 4: Add to `docs/runbook.md`** a short section: *A user quotes a reference (E-XXXXXXXX)* → open `/admin/errors?ref=<ref>`, or search Vercel runtime logs for that ref (every event is one `litrack.error` JSON line); what each severity means; and that alert emails need `ERROR_ALERT_EMAIL` + the Resend vars. In `docs/deployment.md`, list the three new env vars.

- [ ] **Step 5: Run the full gate**

```bash
npx prisma generate
npm run typecheck
npm run lint
npm run test
npm run build
```
Expected: all five pass. CI is billing-locked, so this local run is the only gate before the branch is shippable. If `npm run build` fails on the new `ErrorEvent` client access, confirm Task 3's `prisma generate` ran against the updated schema.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md .claude/agents/backend-developer.md
git commit -m "docs: how the error system works, and how to add to it"
```

- [ ] **Step 7: Report to the user** — the summary table of every code (from `docs/errors.md`), the security findings fixed, and the deploy order: **apply the `ErrorEvent` migration first**, then push `main`, then set `ERROR_ALERT_EMAIL` (and the Resend vars) in Vercel. Do not push or deploy without being asked.

---

## Self-review

**Spec coverage.** §1 catalog → Task 1. §1 Supabase/DB reuse → Task 2. §2 action/route handlers → Task 6; `onRequestError` → Task 7. §3 table → Task 3; report/log/retention → Task 5; alerts → Task 4; `/admin/errors` → Task 18. §4 sign-in table → Tasks 11, 12; account flows → Task 13; registration → Task 14; browser classification → Task 15; enumeration throttle → Task 10; session-ended reasons → Task 9; config leaks → Task 8. §5 pages → Task 17. §6 tests are inside each task; docs and the gate → Task 19. API routes and the cron purge → Task 16.

**Interface consistency.** `formatMessage`/`withReference`/`formatWait` (Task 1) are used unchanged in 8, 9, 14, 15. `toFailure(err, ref?)` is called only by `action()`. `mapSupabaseAuthError(err, side)` keeps its two-argument shape in Tasks 12–15. `reportError(err, input)` keeps one shape across Tasks 5, 7, 11, 13. `assertSameSchool` gains an optional third argument, so its 9 existing call sites still compile.

**Ordering.** Task 3 (schema) precedes Task 5 (which writes the table). Task 10 precedes Tasks 11, 12 and 14, which call the throttle. Task 9 precedes Task 17, which uses `peekCurrentUser`. Tasks 1, 2 precede everything.

**Known gap, deliberate.** The ~30 non-auth action modules keep their own `ActionResult` and their own try/catch in this slice. They still get admin visibility through `onRequestError` (Task 7). Their migration is slices 2–5 in the spec.
