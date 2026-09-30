"use client";

import { toast } from "sonner";
import { classifyClientFailure, isNextControlFlow } from "@/lib/errors/client";
import type { ErrorCode } from "@/lib/errors/codes";
import type { ActionFailure } from "@/lib/errors/result";

/** Codes that describe the connection or the deploy, not the request itself. */
const STABLE_ID_CODES: ReadonlySet<ErrorCode> = new Set([
  "NETWORK_OFFLINE",
  "SERVER_UNREACHABLE",
  "APP_UPDATED",
  "DB_UNAVAILABLE",
]);

const READABLE_DURATION_MS = 8000;
const UPDATE_DURATION_MS = 20000;

/**
 * Error toast for a failed action. Connection and update failures use the code
 * as the toast id so repeated attempts replace one toast instead of stacking.
 */
export function toastFailure(
  failure: { error: string; code?: ErrorCode },
  opts?: { id?: string | number }
): string | number {
  const { code } = failure;
  const id = opts?.id ?? (code && STABLE_ID_CODES.has(code) ? code : undefined);

  if (code === "APP_UPDATED") {
    return toast.error(failure.error, {
      id,
      duration: UPDATE_DURATION_MS,
      action: { label: "Reload page", onClick: () => window.location.reload() },
    });
  }
  if (code === "NETWORK_OFFLINE" || code === "SERVER_UNREACHABLE") {
    return toast.error(failure.error, { id, duration: READABLE_DURATION_MS });
  }
  return toast.error(failure.error, id === undefined ? undefined : { id });
}

/** Thrown after the person has already been told, so outer handlers stay quiet. */
export class ToastedError extends Error {
  readonly toasted = true;
}

export function isToasted(err: unknown): err is ToastedError {
  return err instanceof ToastedError;
}

/**
 * The failure to show for a rejection, or null when nothing should be shown:
 * Next control flow or an already-toasted error. Everything else, including a
 * plain `Error`, is toasted: callers that have already told the person must
 * throw `ToastedError`, so a bug or a text/plain 4xx never fails silently.
 * The toasted check comes first so an offline device never toasts twice.
 */
export function failureForRejection(err: unknown): ActionFailure | null {
  if (isToasted(err) || isNextControlFlow(err)) return null;
  return classifyClientFailure(err);
}
