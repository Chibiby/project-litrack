import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The error pages are the last thing a person sees when everything else has
 * failed, so what they must NOT say matters as much as what they do. These are
 * repo invariants in the style of `route-isr-safety.test.ts`: the admin
 * boundary once explained Prisma, schema drift and Vercel runtime logs on a
 * page that a signed-out visitor to /admin/login could reach.
 */

const APP = path.resolve(__dirname, "../../../src/app");

function read(rel: string): string {
  return readFileSync(path.join(APP, rel), "utf8");
}

describe("error pages", () => {
  it("exists for every boundary, including the root layout", () => {
    for (const file of [
      "not-found.tsx",
      "error.tsx",
      "global-error.tsx",
      "forbidden/page.tsx",
      "admin/error.tsx",
      "teacher/(app)/error.tsx",
      "school-head/(app)/error.tsx",
      "teacher/(app)/not-found.tsx",
      "school-head/(app)/not-found.tsx",
      "admin/not-found.tsx",
    ]) {
      expect(() => read(file), file).not.toThrow();
    }
  });

  it("catches unknown URLs inside every role area", () => {
    for (const file of [
      "teacher/(app)/[...missing]/page.tsx",
      "school-head/(app)/[...missing]/page.tsx",
      "admin/[...missing]/page.tsx",
    ]) {
      expect(read(file), file).toMatch(/notFound\(\)/);
    }
  });

  it("never names our infrastructure to the person reading the page", () => {
    const banned = /prisma|supabase|postgres|schema drift|vercel|DATABASE_URL/i;
    for (const file of [
      "error.tsx",
      "global-error.tsx",
      "admin/error.tsx",
      "teacher/(app)/error.tsx",
      "school-head/(app)/error.tsx",
    ]) {
      expect(read(file), file).not.toMatch(banned);
    }
  });

  it("shows the reference a person can quote", () => {
    // Each boundary renders RouteError, which prints error.digest — the same
    // string onRequestError files the full record under.
    for (const file of [
      "error.tsx",
      "global-error.tsx",
      "admin/error.tsx",
      "teacher/(app)/error.tsx",
      "school-head/(app)/error.tsx",
    ]) {
      expect(read(file), file).toMatch(/RouteError/);
    }
    expect(
      readFileSync(
        path.resolve(__dirname, "../../../src/components/errors/route-error.tsx"),
        "utf8"
      )
    ).toMatch(/error\.digest/);
  });

  it("keeps the global boundary self-contained, since the layout it replaces may be what failed", () => {
    const globalError = read("global-error.tsx");
    expect(globalError).toMatch(/<html/);
    expect(globalError).toMatch(/<body/);
  });
});
