import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

const overview = vi.fn();

vi.mock("@/lib/dashboard/teacher-overview", () => ({
  getTeacherOverview: (...a: unknown[]) => overview(...a),
  buildDashboardTasks: () => [],
}));
vi.mock("@/components/dashboard/lazy-charts", () => ({
  GradeLevelBarChart: () => null,
}));

import { TeacherDashboardBody } from "@/components/dashboard/teacher/dashboard-body";

// A floating teacher (no grades) takes the short branch: the greeting hero and
// one card, which is all this test needs to read the banner back.
const floatingData = {
  todayKey: "2026-11-10",
  gradeCount: 0,
  gradeDistribution: [],
  primaryAralGradeId: null,
};

const props = {
  schoolId: "s1",
  teacherId: "t1",
  isSuperAdmin: false,
  firstName: "Ana",
};

function heroBanner(tree: ReactElement): string {
  const children = (tree.props as { children: ReactElement[] }).children;
  return (children[0] as ReactElement<{ bannerSrc: string }>).props.bannerSrc;
}

describe("TeacherDashboardBody bannerSrc", () => {
  it("starts the overview before a pending banner promise resolves, then uses the resolved value", async () => {
    overview.mockReset();
    overview.mockResolvedValue(floatingData);
    let resolveBanner!: (v: string) => void;
    const banner = new Promise<string>((r) => {
      resolveBanner = r;
    });

    const pending = TeacherDashboardBody({ ...props, bannerSrc: banner });
    await Promise.resolve();
    expect(overview).toHaveBeenCalledWith({
      schoolId: "s1",
      teacherId: "t1",
      isSuperAdmin: false,
    });

    resolveBanner("/brand/banner-x.webp");
    expect(heroBanner(await pending)).toBe("/brand/banner-x.webp");
  });

  it("still accepts a plain string", async () => {
    overview.mockReset();
    overview.mockResolvedValue(floatingData);
    const tree = await TeacherDashboardBody({ ...props, bannerSrc: "/brand/plain.webp" });
    expect(heroBanner(tree)).toBe("/brand/plain.webp");
  });

  it("page passes the banner promise without awaiting the gender read", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../../../src/app/teacher/(app)/(dashboard)/page.tsx"),
      "utf8"
    );
    expect(page).toContain("const bannerSrc: Promise<string> =");
    expect(page).toContain("bannerSrc={bannerSrc}");
    expect(page).not.toContain("BannerDashboardBody");
  });
});
