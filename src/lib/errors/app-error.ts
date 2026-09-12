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
