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
