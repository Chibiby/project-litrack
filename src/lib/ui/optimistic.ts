"use client";

import type { TransitionStartFunction } from "react";
import { toast } from "sonner";
import type { ErrorCode } from "@/lib/errors/codes";
import {
  ToastedError,
  failureForRejection,
  toastFailure,
} from "@/lib/ui/toast-failure";

/**
 * Run optimistic UI work inside a transition and return a Promise that settles
 * when the async body finishes. Use this so ConfirmAction can await completion
 * while still satisfying React’s “addOptimistic only in a transition” rule.
 *
 * Call `addOptimistic` synchronously at the start of `work` (before the first await).
 *
 * Any rejection other than a redirect or a `ToastedError` (offline, dropped
 * connection, crash, or a plain `Error` from a bug) is toasted once and rethrown
 * as `ToastedError`. Code that toasts before throwing must throw `ToastedError`;
 * redirects and `ToastedError`s are rethrown unchanged.
 */
export function runOptimistic(
  startTransition: TransitionStartFunction,
  work: () => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    startTransition(async () => {
      try {
        await work();
        resolve();
      } catch (err) {
        const failure = failureForRejection(err);
        if (!failure) {
          reject(err);
          return;
        }
        toastFailure(failure);
        reject(new ToastedError(failure.error, { cause: err }));
      }
    });
  });
}

/**
 * Toast success or error from an action result; throws on failure for ConfirmAction.
 * `code` is optional because ~30 legacy actions still return `{ ok: false, error }`.
 */
export async function settleActionResult(
  res: { ok: true } | { ok: false; error: string; code?: ErrorCode },
  successMessage: string
): Promise<void> {
  if (!res.ok) {
    toastFailure(res);
    throw new ToastedError(res.error);
  }
  toast.success(successMessage);
}

export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

export function patchById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>
): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Pure reducer helpers for list-level useOptimistic. */
export type ListOptimisticOp<T extends { id: string }> =
  | { type: "remove"; id: string }
  | { type: "patch"; id: string; patch: Partial<T> }
  | { type: "append"; item: T }
  | { type: "setExclusiveFlag"; id: string; flag: keyof T };

export function listOptimisticReducer<T extends { id: string }>(
  state: T[],
  op: ListOptimisticOp<T>
): T[] {
  switch (op.type) {
    case "remove":
      return removeById(state, op.id);
    case "patch":
      return patchById(state, op.id, op.patch);
    case "append":
      return [...state, op.item];
    case "setExclusiveFlag":
      return state.map((item) => ({
        ...item,
        [op.flag]: item.id === op.id,
      }));
    default:
      return state;
  }
}

/** Client-only temp id for optimistic creates (replaced on revalidate). */
export function tempOptimisticId(prefix = "temp"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
