import { describe, expect, it } from "vitest";
import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveHref,
  resolvePageTitle,
} from "@/lib/nav/nav-config";

const oneAral = [{ id: "g1", label: "Grade 3", hasAral: true }];
const twoAral = [
  { id: "g1", label: "Grade 3", hasAral: true },
  { id: "g2", label: "Grade 4", hasAral: true },
];

describe("getNavGroups — teacher", () => {
  it("splits nav into MENU, ARAL PROGRAM and a trailing ungrouped item", () => {
    const groups = getNavGroups("TEACHER", oneAral);
    expect(groups.map((g) => g.label)).toEqual(["Menu", "ARAL Program", undefined]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard", "Learners"]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "Weekly Attendance",
      "Monthly Reading Level",
      "End of Terms Reports",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("deep-links ARAL items to the single ARAL grade", () => {
    const [, aral] = getNavGroups("TEACHER", oneAral);
    expect(aral.items[0].href).toBe("/teacher/aral/g1/attendance");
    expect(aral.items[1].href).toBe("/teacher/aral/g1/reading-level");
  });

  it("falls back to the grade picker when there is not exactly one ARAL grade", () => {
    for (const grades of [twoAral, [], undefined]) {
      const [, aral] = getNavGroups("TEACHER", grades);
      expect(aral.items[0].href).toBe("/teacher/aral");
      expect(aral.items[1].href).toBe("/teacher/aral");
    }
  });
});

describe("getNavGroups — other roles", () => {
  it("gives admin and school head a single unlabeled group", () => {
    for (const role of ["SUPER_ADMIN", "SCHOOL_HEAD"] as const) {
      const groups = getNavGroups(role);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBeUndefined();
      expect(groups[0].items[0].href).toBe(
        role === "SUPER_ADMIN" ? "/admin" : "/school-head"
      );
    }
  });
});

describe("resolveActiveHref", () => {
  const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));

  it("prefers the longest matching prefix over the role home", () => {
    expect(resolveActiveHref("/teacher/learners/abc", items)).toBe("/teacher/learners");
  });

  it("matches the role home only exactly", () => {
    expect(resolveActiveHref("/teacher", items)).toBe("/teacher");
  });

  it("returns undefined for an unmatched path", () => {
    expect(resolveActiveHref("/account/set-password", items)).toBeUndefined();
  });
});

describe("resolvePageTitle", () => {
  const groups = getNavGroups("TEACHER", oneAral);

  it("uses the active nav item label", () => {
    expect(resolvePageTitle("/teacher", groups)).toBe("Dashboard");
    expect(resolvePageTitle("/teacher/learners/abc", groups)).toBe("Learners");
  });

  it("falls back to a humanised last segment when nothing matches", () => {
    expect(resolvePageTitle("/teacher/settings/change-password", groups)).toBe(
      "Change password"
    );
  });

  it("falls back to LITRACK at the root", () => {
    expect(resolvePageTitle("/", groups)).toBe("LITRACK");
  });
});
