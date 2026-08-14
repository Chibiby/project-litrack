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
      const readsSession = /require(?:School)?User\s*\(|getCurrentUser\s*\(/.test(text);
      if (hasRevalidate && readsSession) {
        offenders.push(path.relative(APP, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("marks the public routes as revalidating", () => {
    // Only login/page.tsx made the cut from the brief's four candidates.
    // Excluded, and why (Task 9 session-freedom audit):
    //  - pending-approval/page.tsx: calls getCurrentUser() and renders the
    //    user's email and school name — per-user, must stay force-dynamic.
    //  - account/created/page.tsx: calls getCurrentUser() and renders the
    //    user's email and school name — per-user, must stay force-dynamic.
    //  - auth/reset/page.tsx: calls createSupabaseServerClient() and reads/
    //    exchanges the caller's auth cookie (auth.getUser /
    //    exchangeCodeForSession) on every request — inherently per-request,
    //    never cacheable.
    const publicPages = ["login/page.tsx"];
    for (const rel of publicPages) {
      const text = readFileSync(path.join(APP, rel), "utf8");
      expect(text, rel).toMatch(/export\s+const\s+revalidate\s*=\s*\d+/);
      expect(text, rel).not.toMatch(/export\s+const\s+dynamic\s*=\s*"force-dynamic"/);
    }
  });
});
