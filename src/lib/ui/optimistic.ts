"use client";

import type { TransitionStartFunction } from "react";
import { toast } from "sonner";

/** Common server-action result shape used across litrack mutations. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Run optimistic UI work inside a transition and return a Promise that settles
 * when the async body finishes. Use this so ConfirmAction can await completion
 * while still satisfying React’s “addOptimistic only in a transition” rule.
 *
 * Call `addOptimistic` synchronously at the start of `work` (before the first await).
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
        reject(err);
      }
    });
  });
}

/** Toast success or error from an ActionResult; throws on failure for ConfirmAction. */
export async function settleActionResult(
  res: ActionResult,
  successMessage: string
): Promise<void> {
  if (!res.ok) {
    toast.error(res.error);
    throw new Error(res.error);
  }
  toast.success(successMessage);
}

/** Toast error without throwing (for non-confirm click handlers). */
export function toastActionFailure(res: ActionResult): boolean {
  if (res.ok) return false;
  toast.error(res.error);
  return true;
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
