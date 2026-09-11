import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who and where, for the duration of one wrapped server action or route.
 *
 * `action()`/`route()` open the scope with the route name; `requireUser` fills
 * in the verified user when one is resolved. `reportError` reads it, so an
 * error record can name the person without every throw site threading ids
 * through its signature.
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
