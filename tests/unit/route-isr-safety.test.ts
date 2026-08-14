import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../src/app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx" || entry === "layout.tsx") out.push(full);
  }
  return out;
}

/**
 * A Full Route Cache entry is shared across all users. Caching a rendered page
 * that read the session would serve one tenant's data to another — the worst
 * bug shippable in this repo (CLAUDE.md). This test makes that unshippable.
 */
describe("route ISR safety", () => {
  it("never puts `revalidate` on a route that reads the session", () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = readFileSync(file, "utf8");
      const hasRevalidate = /export\s+const\s+revalidate\s*=/.test(text);
      // Anything that makes this render vary per request, not just our auth
      // helpers: require(School)?User/getCurrentUser are the app's own
      // session guards; createSupabaseServerClient/createClient reach a
      // Supabase server client that reads the request's auth cookie
      // (auth.getUser, exchangeCodeForSession, ...); cookies()/headers() from
      // next/headers are request-scoped reads by nature in a page.tsx or
      // layout.tsx in this codebase.
      const readsSession =
        /require(?:School)?User\s*\(|getCurrentUser\s*\(|createSupabaseServerClient\s*\(|createClient\s*\(|cookies\s*\(|headers\s*\(/.test(
          text,
        );
      if (hasRevalidate && readsSession) {
        offenders.push(path.relative(APP, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no route-level ISR, because the only session-free candidate reads searchParams", () => {
    // Route-level ISR (`export const revalidate`) is currently unused across
    // the whole app. It was tried once: login/page.tsx is the only public,
    // session-free page in the app (Task 9 audit) —
    //  - pending-approval/page.tsx: calls getCurrentUser() and renders the
    //    user's email and school name — per-user, must stay force-dynamic.
    //  - account/created/page.tsx: calls getCurrentUser() and renders the
    //    user's email and school name — per-user, must stay force-dynamic.
    //  - auth/reset/page.tsx: calls createSupabaseServerClient() and reads/
    //    exchanges the caller's auth cookie (auth.getUser /
    //    exchangeCodeForSession) on every request — inherently per-request,
    //    never cacheable.
    // But login/page.tsx reads `searchParams` (for the `?error` toast), which
    // forces dynamic rendering regardless of a `revalidate` export — the
    // build confirmed it ships as `ƒ (Dynamic)`, not `● (ISR)`. So the
    // export was removed as inert configuration (Task 12 follow-up).
    //
    // If you're here because you made some route genuinely static — e.g. by
    // moving its `searchParams`/cookie/session read out of the server
    // component — update this test to allow that specific file rather than
    // deleting the check. It exists so a future `revalidate` export gets
    // verified to actually take effect, not just assumed to.
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = readFileSync(file, "utf8");
      if (/export\s+const\s+revalidate\s*=/.test(text)) {
        offenders.push(path.relative(APP, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
