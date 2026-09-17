import { cache } from "react";
import {
  FRESH_READ_COOKIE,
  SERVER_ACTION_HEADER,
  shouldReadFresh,
} from "@/lib/db/read-consistency";

/**
 * Per-request read mode, as `prisma` consults it on every property access.
 *
 * Mutable because the decision needs `await headers()` / `await cookies()`
 * while the Prisma proxy is synchronous: `primeReadMode` resolves it once,
 * early, and later reads in the same request see the result. A read made
 * before priming uses the cached binding, which is today's behaviour.
 *
 * `cache()` scopes the object to one React server request. Outside one (a
 * script, a unit test) there is no memoization, so every call gets a new
 * `{ fresh: false }` and reads stay on the cached binding.
 */
export const currentReadMode = cache((): { fresh: boolean } => ({ fresh: false }));

/**
 * Decide this request's read mode. Called at the top of `getCurrentUser`,
 * which every authenticated page, layout, and action reaches before its own
 * queries. Never throws: outside a request scope it leaves the default.
 */
export async function primeReadMode(): Promise<void> {
  if (process.env.LITRACK_DEPLOY_TARGET !== "cloudflare") return;
  const mode = currentReadMode();
  if (mode.fresh) return;
  try {
    const { cookies, headers } = await import("next/headers");
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
    mode.fresh = shouldReadFresh({
      isServerAction: Boolean(headerStore.get(SERVER_ACTION_HEADER)),
      hasFreshCookie: cookieStore.has(FRESH_READ_COOKIE),
    });
  } catch {
    // No request scope (build, script, unstable_cache revalidation).
  }
}
