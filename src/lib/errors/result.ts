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
  const failure: ActionFailure = {
    ok: false,
    code: err.code,
    error: withReference(err.message, ref),
  };
  if (ref) failure.ref = ref;
  if (err.fieldErrors) failure.fieldErrors = err.fieldErrors;
  return failure;
}
