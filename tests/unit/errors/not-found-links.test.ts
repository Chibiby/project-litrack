import { describe, expect, it } from "vitest";
import { notFoundLinksFor } from "@/lib/nav/not-found-links";

describe("notFoundLinksFor", () => {
  it("offers a signed-out visitor only the way in", () => {
    expect(notFoundLinksFor(null)).toEqual([{ href: "/login", label: "Sign in" }]);
  });

  it("offers each role its own main pages", () => {
    expect(notFoundLinksFor("TEACHER").map((l) => l.href)).toEqual([
      "/teacher",
      "/teacher/aral",
      "/teacher/learners",
    ]);
    expect(notFoundLinksFor("SCHOOL_HEAD")[0].href).toBe("/school-head");
    expect(notFoundLinksFor("SUPER_ADMIN").map((l) => l.href)).toContain("/admin/schools");
  });

  it("labels every link, and points every one somewhere real", () => {
    for (const role of [null, "TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] as const) {
      for (const link of notFoundLinksFor(role)) {
        expect(link.label.length).toBeGreaterThan(2);
        expect(link.href.startsWith("/")).toBe(true);
      }
    }
  });
});
