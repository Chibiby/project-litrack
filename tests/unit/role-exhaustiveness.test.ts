import { describe, expect, it } from "vitest";
import { roleHomePath, type AppRole } from "@/lib/auth/roles";
import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { getShellWarmHrefs } from "@/lib/nav/warm-hrefs";
import { getNavGroups, flattenNavGroups } from "@/lib/nav/nav-config";
import { USER_ROLE_LABELS } from "@/lib/constants/enum-labels";

/**
 * Every `UserRole` value, run through every role-keyed map/switch this suite
 * can reach without a database. Adding an enum value (e.g. `DISTRICT_ADMIN`,
 * spec `docs/specs/district-admin.md` §8 T18) breaks `Record<UserRole, …>`
 * maps at compile time, but a plain `switch`/`if` chain with a fallback does
 * not — it silently returns the fallback instead. This test pins the
 * non-fallback behaviour for every role so removing a case fails here, not in
 * production.
 */
const ALL_ROLES = ["SUPER_ADMIN", "SCHOOL_HEAD", "TEACHER", "DISTRICT_ADMIN"] as const;

describe("role-exhaustiveness", () => {
  it("roleHomePath returns a distinct, non-empty path for every role", () => {
    const homes = ALL_ROLES.map((role) => roleHomePath(role as AppRole));
    for (const home of homes) {
      expect(home).toBeTruthy();
      expect(home.startsWith("/")).toBe(true);
    }
    expect(new Set(homes).size).toBe(ALL_ROLES.length);
  });

  it("roleHomePath sends DISTRICT_ADMIN to /district", () => {
    expect(roleHomePath("DISTRICT_ADMIN" as AppRole)).toBe("/district");
  });

  it("notFoundLinksFor gives every role its own non-fallback links", () => {
    // The signed-out fallback: exactly this shape, never returned for a role.
    const signedOutFallback = [{ href: "/login", label: "Sign in" }];
    for (const role of ALL_ROLES) {
      const links = notFoundLinksFor(role);
      expect(links.length).toBeGreaterThan(0);
      expect(links).not.toEqual(signedOutFallback);
      for (const link of links) {
        expect(link.href).toBeTruthy();
        expect(link.label).toBeTruthy();
      }
    }
  });

  it("notFoundLinksFor still falls back for a signed-out visitor", () => {
    expect(notFoundLinksFor(null)).toEqual([{ href: "/login", label: "Sign in" }]);
  });

  it("notFoundLinksFor points DISTRICT_ADMIN at /district pages", () => {
    const links = notFoundLinksFor("DISTRICT_ADMIN");
    expect(links.some((l) => l.href === "/district")).toBe(true);
    expect(links.every((l) => l.href === "/district" || l.href.startsWith("/district/"))).toBe(true);
  });

  it("getShellWarmHrefs gives every role its home, profile and security routes", () => {
    // The role-less fallback returns one href only (security); every named role
    // must return the full three-href shape, which also proves it is not
    // silently falling through to `default`.
    for (const role of ALL_ROLES) {
      const hrefs = getShellWarmHrefs(role);
      expect(hrefs.length).toBe(3);
      expect(hrefs[0]).toBe(roleHomePath(role as AppRole));
    }
  });

  it("getNavGroups returns non-empty groups with at least one item for every role", () => {
    for (const role of ALL_ROLES) {
      const groups = getNavGroups(role);
      expect(groups.length).toBeGreaterThan(0);
      const items = flattenNavGroups(groups);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.href).toBeTruthy();
        expect(item.label).toBeTruthy();
      }
    }
  });

  it("getNavGroups returns [] only for an unrecognised role (the actual fallback)", () => {
    expect(getNavGroups("NOT_A_ROLE" as unknown as (typeof ALL_ROLES)[number])).toEqual([]);
  });

  it("getNavGroups covers every DISTRICT_ADMIN summary facet", () => {
    const items = flattenNavGroups(getNavGroups("DISTRICT_ADMIN"));
    const summaryItems = items.filter((i) => i.href.startsWith("/district/summary/"));
    expect(summaryItems.length).toBe(8);
  });

  it("USER_ROLE_LABELS has a distinct, non-empty label for every role", () => {
    const labels = ALL_ROLES.map((role) => USER_ROLE_LABELS[role]);
    for (const label of labels) {
      expect(label).toBeTruthy();
    }
    expect(new Set(labels).size).toBe(ALL_ROLES.length);
  });
});
