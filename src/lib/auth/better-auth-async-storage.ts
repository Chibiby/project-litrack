import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Seeds Better Auth's three AsyncLocalStorage slots synchronously.
 *
 * `@better-auth/core/async_hooks` starts `import("node:async_hooks")` at module
 * scope, and every slot is created lazily by awaiting that one promise. On
 * Cloudflare Workers a promise belongs to the request that created it: when
 * the first request in an isolate ends before the import settles (a cancelled
 * prefetch, a closed tab), the promise never settles, and every later session
 * read in that isolate fails with "This promise was created by a request that
 * has since ended". Better Auth reuses a slot that already exists, so filling
 * all three here means it never awaits the module-level promise.
 *
 * The key and slot names come from `@better-auth/core/dist/context/global.mjs`,
 * `endpoint-context.mjs`, `request-state.mjs` and `transaction.mjs`
 * (better-auth 1.7.7). A test pins them.
 */
export const BETTER_AUTH_GLOBAL_KEY = Symbol.for("better-auth:global");

export const BETTER_AUTH_STORAGE_SLOTS = [
  "endpointContextAsyncStorage",
  "requestStateAsyncStorage",
  "adapterAsyncStorage",
] as const;

type BetterAuthGlobal = { version: string; epoch: number; context: Record<string, unknown> };

export function seedBetterAuthAsyncStorage(): void {
  const store = globalThis as unknown as Record<symbol, BetterAuthGlobal | undefined>;
  // Better Auth adopts an existing global object; an empty version only makes
  // it bump `epoch`, which nothing reads.
  const shared = (store[BETTER_AUTH_GLOBAL_KEY] ??= { version: "", epoch: 1, context: {} });
  for (const slot of BETTER_AUTH_STORAGE_SLOTS) {
    shared.context[slot] ??= new AsyncLocalStorage();
  }
}
