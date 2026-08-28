import { describe, expect, it } from "vitest";

import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveItemId,
  resolvePageTitle,
} from "@/lib/nav/nav-config";
import {
  pendingNavHref,
  resolveNavPath,
  retirePendingNav,
  type PendingNav,
} from "@/lib/nav/pending-nav";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

describe("pendingNavHref", () => {
  it("is null with no pending click", () => {
    expect(pendingNavHref("/teacher", null)).toBeNull();
  });

  it("keeps the href while the pathname has not moved", () => {
    expect(
      pendingNavHref("/teacher", { href: "/teacher/learners", from: "/teacher" })
    ).toBe("/teacher/learners");
  });

  it("is null once the pathname has changed", () => {
    expect(
      pendingNavHref("/teacher/learners", {
        href: "/teacher/learners",
        from: "/teacher",
      })
    ).toBeNull();
  });
});

describe("resolveNavPath", () => {
  it("uses the real pathname when nothing is pending", () => {
    expect(resolveNavPath("/school-head/teachers", null)).toBe("/school-head/teachers");
  });

  it("uses the clicked href in the frame after the click", () => {
    // The router is still fetching, usePathname() still says /admin, and the rail
    // must already show Schools.
    expect(resolveNavPath("/admin", { href: "/admin/schools", from: "/admin" })).toBe(
      "/admin/schools"
    );
  });

  it("hands back to the real pathname once the URL has arrived", () => {
    expect(
      resolveNavPath("/admin/schools", { href: "/admin/schools", from: "/admin" })
    ).toBe("/admin/schools");
  });

  it("hands back when the URL moved somewhere else entirely", () => {
    // Back button pressed mid-navigation, or a page that redirected off the nav.
    // Holding the pending href here would leave Schools lit on a page that is not
    // Schools, permanently.
    expect(
      resolveNavPath("/admin/audit", { href: "/admin/schools", from: "/admin" })
    ).toBe("/admin/audit");
  });

  it("prefers the real pathname for a destination deeper than the clicked row", () => {
    // /teacher/grade/g1 is not a nav href; the row that owns it wins on arrival by
    // longest prefix, and the stale record must not interfere.
    expect(
      resolveNavPath("/teacher/grade/g1", { href: "/teacher/learners", from: "/teacher" })
    ).toBe("/teacher/grade/g1");
  });
});

describe("retirePendingNav", () => {
  it("returns the identical record while it is still live", () => {
    // Identity, not equality: the provider feeds this straight into a state setter,
    // and React only bails out of the re-render when the value is the same object.
    const pending: PendingNav = { href: "/teacher/reports", from: "/teacher" };
    expect(retirePendingNav("/teacher", pending)).toBe(pending);
  });

  it("drops the record once the pathname has moved", () => {
    expect(
      retirePendingNav("/teacher/reports", {
        href: "/teacher/reports",
        from: "/teacher",
      })
    ).toBeNull();
  });

  it("drops a record the pathname has moved past, so it cannot come back to life", () => {
    // The case that makes retiring different from ignoring: left in place, this
    // record would light Learners again the moment the teacher returned to
    // /teacher — on the dashboard, with nothing pending.
    expect(
      retirePendingNav("/teacher/reports", {
        href: "/teacher/learners",
        from: "/teacher",
      })
    ).toBeNull();
  });

  it("drops nothing when there is nothing pending", () => {
    expect(retirePendingNav("/teacher", null)).toBeNull();
  });
});

describe("optimistic highlight — teacher rail", () => {
  const items = flattenNavGroups(
    getNavGroups("TEACHER", [{ id: "g1", label: "Grade 3", hasAral: true }], {
      advisoryGradeLevelId: "g1",
    })
  );

  function activeDuringClick(from: string, href: string) {
    return resolveActiveItemId(resolveNavPath(from, { href, from }), items);
  }

  it("lights the clicked row in the same frame as the click", () => {
    expect(activeDuringClick("/teacher", "/teacher/learners")).toBe("teacher-learners");
  });

  it("lights exactly one row, and it is the clicked one", () => {
    // The property the sidebar actually depends on: it renders `item.id ===
    // activeItemId`, so a pending click must resolve to a single id — and the
    // dashboard, whose href is a prefix of every other row's, must not also win.
    const path = resolveNavPath("/teacher", {
      href: "/teacher/reports",
      from: "/teacher",
    });
    const active = resolveActiveItemId(path, items);
    expect(items.filter((item) => item.id === active).map((item) => item.id)).toEqual([
      "teacher-reports",
    ]);
  });

  it("lights the deep terms-reports row rather than the ARAL picker", () => {
    // The row's href is grade-scoped, and /teacher/aral is a prefix of it — so this
    // pins that longest-prefix matching still awards the click to the sheet.
    expect(activeDuringClick("/teacher", "/teacher/aral/g1/terms-reports")).toBe(
      "teacher-terms-reports"
    );
  });

  it("moves the header title with the highlight", () => {
    const groups = getNavGroups(
      "TEACHER",
      [{ id: "g1", label: "Grade 3", hasAral: true }],
      { advisoryGradeLevelId: "g1" }
    );
    const path = resolveNavPath("/teacher", {
      href: "/teacher/learners",
      from: "/teacher",
    });
    // The rail and the bar must never disagree about which page is arriving.
    expect(resolvePageTitle(path, groups)).toBe("Learners");
  });
});

describe("optimistic highlight — rows that share an href", () => {
  // With zero or 2+ ARAL grades both ARAL rows collapse onto /teacher/aral, and
  // `resolveActiveItemId` awards the first in list order. The point of this case is
  // that the optimistic answer equals the committed one: clicking Monthly Reading
  // Level lights Weekly Attendance either way, so the highlight lands earlier
  // rather than somewhere else and then jumping.
  const grades = [
    { id: "g1", label: "Grade 3", hasAral: true },
    { id: "g2", label: "Grade 4", hasAral: true },
  ];
  const items = flattenNavGroups(getNavGroups("TEACHER", grades));

  it("agrees with the committed highlight", () => {
    const optimistic = resolveActiveItemId(
      resolveNavPath("/teacher", { href: "/teacher/aral", from: "/teacher" }),
      items
    );
    const committed = resolveActiveItemId("/teacher/aral", items);
    expect(optimistic).toBe(committed);
  });
});

describe("optimistic highlight — admin and school head rails", () => {
  const adminItems = flattenNavGroups(getNavGroups("SUPER_ADMIN"));
  const headItems = flattenNavGroups(getNavGroups("SCHOOL_HEAD"));

  it("lights the clicked admin row before the router commits", () => {
    const path = resolveNavPath("/admin", { href: "/admin/transfers", from: "/admin" });
    expect(resolveActiveItemId(path, adminItems)).toBe("admin-transfers");
  });

  it("does not keep the admin dashboard lit while a child route is arriving", () => {
    // The failure this whole module exists to remove: before the optimistic path,
    // the dashboard stayed lit for the entire force-dynamic render of the child.
    const path = resolveNavPath("/admin", {
      href: "/admin/school-years",
      from: "/admin",
    });
    expect(resolveActiveItemId(path, adminItems)).not.toBe("admin-dashboard");
  });

  it("lights the clicked school-head row before the router commits", () => {
    const path = resolveNavPath(SCHOOL_HEAD_ROUTES.dashboard, {
      href: SCHOOL_HEAD_ROUTES.teachers,
      from: SCHOOL_HEAD_ROUTES.dashboard,
    });
    expect(resolveActiveItemId(path, headItems)).toBe("school-head-teachers");
  });
});
