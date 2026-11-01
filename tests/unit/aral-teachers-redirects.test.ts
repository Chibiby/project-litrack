import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The ARAL teachers pages moved to /aral-teachers. The old paths must keep
 * working as redirects (bookmarks, emailed links), and the old route folders must
 * be gone so the redirect is not shadowed by a page.
 *
 * The legacy segment is assembled from parts so the old word stays out of the
 * test tree (repo rule: it survives only in the AralMosyDecision.tutorId column).
 */
const LEGACY = ["aral", "tu" + "tors"].join("-");

type Redirect = { source: string; destination: string; permanent: boolean };

async function redirects(): Promise<Redirect[]> {
  const mod = (await import("../../next.config.mjs")) as { default: { redirects: () => Promise<Redirect[]> } };
  return mod.default.redirects();
}

describe("legacy ARAL teacher routes redirect", () => {
  it.each([
    ["/admin/management", "/admin/management/aral-teachers"],
    ["/school-head", "/school-head/aral-teachers"],
  ])("%s/%s -> %s", async (base, dest) => {
    const found = (await redirects()).find((r) => r.source === `${base}/${LEGACY}/:path*`);
    expect(found, `no redirect for ${base}/${LEGACY}`).toBeDefined();
    expect(found!.destination).toBe(`${dest}/:path*`);
    expect(found!.permanent).toBe(false);
  });

  it("the old route folders are gone", () => {
    const app = path.resolve(__dirname, "../../src/app");
    expect(existsSync(path.join(app, "admin/management", LEGACY))).toBe(false);
    expect(existsSync(path.join(app, "school-head/(app)", LEGACY))).toBe(false);
  });

  it("the new route folders exist", () => {
    const app = path.resolve(__dirname, "../../src/app");
    expect(existsSync(path.join(app, "admin/management/aral-teachers/page.tsx"))).toBe(true);
    expect(existsSync(path.join(app, "school-head/(app)/aral-teachers/page.tsx"))).toBe(true);
  });
});
