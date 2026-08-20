import { describe, expect, it } from "vitest";
import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveHref,
  resolveActiveItemId,
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
    // Term reports is a per-term GRADES report, so it belongs beside the roster
    // it reports on, not under the ARAL programme.
    expect(groups[0].items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Learners",
      "End of Terms Reports",
    ]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "Weekly Attendance",
      "Monthly Reading Level",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("marks only the unbuilt term report as soon", () => {
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));
    expect(items.filter((i) => i.soon).map((i) => i.id)).toEqual([
      "teacher-terms-reports",
    ]);
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

describe("getNavGroups — admin", () => {
  it("keeps admin on a single unlabeled group", () => {
    // The redesign regrouped the School Head sidebar only; admin was left
    // alone on purpose, so its flat shape is part of the contract now rather
    // than an accident of the two roles once sharing a branch.
    const groups = getNavGroups("SUPER_ADMIN");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeUndefined();
    expect(groups[0].items[0].href).toBe("/admin");
  });
});

describe("getNavGroups — school head", () => {
  it("splits nav into a lone Dashboard, Manage and Records", () => {
    const groups = getNavGroups("SCHOOL_HEAD");
    expect(groups.map((g) => g.label)).toEqual([undefined, "Manage", "Records"]);
    // Dashboard sits above the labelled groups on its own so it reads as the
    // landing page, not as the first of the things you manage.
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard"]);
    expect(groups[0].items[0].href).toBe("/school-head");
    // Manage is what a School Head changes, Records what they publish or read
    // back. "School" is one entry because school years, grade levels and school
    // info are tabs of one workspace now, not three separate destinations.
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "School",
      "Teachers",
      "ARAL Program",
      "Transfer",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual([
      "Announcements",
      "Reports",
      "Audit",
    ]);
  });

  it("points Teachers at the workspace root so every tab keeps it highlighted", () => {
    const items = flattenNavGroups(getNavGroups("SCHOOL_HEAD"));
    expect(items.find((i) => i.id === "school-head-teachers")?.href).toBe(
      "/school-head/teachers"
    );
    // Longest-prefix matching is what lets one sidebar entry serve all four tab
    // routes. A tab-specific href here would leave three of the four tabs
    // highlighting nothing but Dashboard.
    for (const tab of ["pending", "inactive", "declined"]) {
      expect(resolveActiveHref(`/school-head/teachers/${tab}`, items)).toBe(
        "/school-head/teachers"
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

  it("restores plain longest-prefix matching for role roots (SUPER_ADMIN/SCHOOL_HEAD parity)", () => {
    const adminItems = flattenNavGroups(getNavGroups("SUPER_ADMIN"));
    expect(resolveActiveHref("/admin/settings", adminItems)).toBe("/admin");
  });

  it("still prefix-matches the teacher role root for non-nav nested routes", () => {
    expect(resolveActiveHref("/teacher/settings/change-password", items)).toBe("/teacher");
  });
});

describe("resolveActiveItemId", () => {
  it("skips a soon item parked on a live item's href", () => {
    // "End of Terms Reports" holds /teacher/reports until it is built, and it
    // comes FIRST in the flattened list — so without the soon filter it would
    // take the highlight from the Reports page a teacher is actually looking at.
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));
    expect(resolveActiveItemId("/teacher/reports", items)).toBe("teacher-reports");
  });

  it("resolves the first of two colliding live hrefs deterministically", () => {
    const icon = () => null;
    const items = [
      { id: "first", label: "First", href: "/x", icon },
      { id: "second", label: "Second", href: "/x", icon },
    ];
    expect(resolveActiveItemId("/x", items)).toBe("first");
  });

  it("produces unique ids within each role's flattened nav list", () => {
    for (const [role, grades] of [
      ["TEACHER", oneAral],
      ["SUPER_ADMIN", undefined],
      ["SCHOOL_HEAD", undefined],
    ] as const) {
      const items = flattenNavGroups(getNavGroups(role, grades));
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("resolvePageTitle", () => {
  const groups = getNavGroups("TEACHER", oneAral);

  it("uses the active nav item label", () => {
    expect(resolvePageTitle("/teacher", groups)).toBe("Dashboard");
    expect(resolvePageTitle("/teacher/learners/abc", groups)).toBe("Learners");
  });

  it("titles a route after the item that serves it, not the soon placeholder", () => {
    expect(resolvePageTitle("/teacher/reports", groups)).toBe("Reports");
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
