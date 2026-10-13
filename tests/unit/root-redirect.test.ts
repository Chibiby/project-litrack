/**
 * `/` must be a real HTTP redirect to `/login`, answered before any page
 * renders.
 *
 * Regression: `redirect()` inside `src/app/page.tsx` streams under the root
 * layout, so production answered `/` with 200 plus a 1-second meta refresh.
 * The layout's head script had already started the Apspark intro on that
 * throwaway page, and the full reload to `/login` cut it short.
 */
import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

describe("root redirect", () => {
  it("sends / to /login from next.config, not from a rendered page", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toContainEqual(
      expect.objectContaining({ source: "/", destination: "/login", permanent: false })
    );
  });
});
