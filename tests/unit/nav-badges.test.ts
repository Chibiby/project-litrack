import { describe, expect, it } from "vitest";
import { applyNavBadges, formatNavBadge, getNavGroups } from "@/lib/nav/nav-config";

/**
 * Sidebar count badges: keyed by nav item id, zero or missing shows nothing,
 * and big numbers stay narrow.
 */

function badgeOf(groups: ReturnType<typeof getNavGroups>, id: string) {
  return groups.flatMap((g) => g.items).find((i) => i.id === id)?.badge;
}

describe("applyNavBadges", () => {
  it("puts each count on the row with that id", () => {
    const groups = applyNavBadges(getNavGroups("SUPER_ADMIN"), { "admin-support": 4 });
    expect(badgeOf(groups, "admin-support")).toBe(4);
    expect(badgeOf(groups, "admin-dashboard")).toBeUndefined();
  });

  it("drops a zero so no '0' badge renders", () => {
    const groups = applyNavBadges(getNavGroups("SUPER_ADMIN"), { "admin-support": 0 });
    expect(badgeOf(groups, "admin-support")).toBeUndefined();
  });

  it("keeps a badge the menu already set when no count is given for it", () => {
    const base = getNavGroups("SCHOOL_HEAD", [], { pendingTeacherCount: 2 });
    const groups = applyNavBadges(base, { "school-head-transfer": 1 });
    expect(badgeOf(groups, "school-head-teachers")).toBe(2);
    expect(badgeOf(groups, "school-head-transfer")).toBe(1);
  });

  it("returns the same groups when there is nothing to apply", () => {
    const base = getNavGroups("SUPER_ADMIN");
    expect(applyNavBadges(base, undefined)).toBe(base);
  });
});

describe("formatNavBadge", () => {
  it("caps at 99+", () => {
    expect(formatNavBadge(7)).toBe("7");
    expect(formatNavBadge(99)).toBe("99");
    expect(formatNavBadge(100)).toBe("99+");
  });
});
