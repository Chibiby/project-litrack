/**
 * Read-your-writes on Cloudflare.
 *
 * The main Hyperdrive binding (`HYPERDRIVE`) caches query results, so a read
 * can return rows up to about a minute old (60s max age plus 15s
 * stale-while-revalidate). A user who saves or deletes something and then sees
 * the page re-render would get the rows from before their own write, and the
 * `revalidate*` tag busts would refill the Data Cache with those same old rows.
 *
 * The fix is a short per-browser window. Middleware stamps `FRESH_READ_COOKIE`
 * on every Server Action response; while it lives, that user's reads go
 * through `HYPERDRIVE_FRESH`, which has caching disabled. Everyone who has not
 * just written keeps the cached binding. Other users still see a write within
 * the Hyperdrive cache window — the same as before, and not what this fixes.
 *
 * Deliberately pure and Edge-safe: middleware imports it. The request-scoped
 * holder that `prisma` reads lives in `@/lib/db/read-mode`.
 */

export const FRESH_READ_COOKIE = "lt_fresh";

/**
 * Longer than Hyperdrive's 60s max age plus 15s stale-while-revalidate, so a
 * cached row from before the write has expired by the time the window closes.
 */
export const FRESH_READ_WINDOW_SECONDS = 90;

/** Header Next.js sets on a Server Action POST. */
export const SERVER_ACTION_HEADER = "next-action";

export function isServerActionRequest(
  method: string,
  getHeader: (name: string) => string | null,
): boolean {
  return method === "POST" && Boolean(getHeader(SERVER_ACTION_HEADER));
}

/**
 * Fresh when this request is itself a Server Action (its own re-render must
 * show its own write), or when the browser wrote something within the window.
 */
export function shouldReadFresh(input: {
  isServerAction: boolean;
  hasFreshCookie: boolean;
}): boolean {
  return input.isServerAction || input.hasFreshCookie;
}
