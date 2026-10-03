import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

const overview = vi.fn();
const mix = vi.fn();

vi.mock("@/lib/dashboard/school-head-overview", () => ({
  getSchoolHeadOverview: (...a: unknown[]) => overview(...a),
  buildSchoolHeadAttention: () => [],
}));
vi.mock("@/lib/dashboard/aggregates", () => ({
  getSchoolHeadAttendanceMix: (...a: unknown[]) => mix(...a),
}));
vi.mock("@/components/dashboard/school-head-dashboard-sections", () => ({
  SchoolHeadChartsSection: () => null,
  SchoolHeadIpSection: () => null,
  SchoolHeadRecentActivitySection: () => null,
}));

import { loadSchoolHeadDashboard } from "@/components/dashboard/school-head/dashboard-body";
import type { SchoolHeadView } from "@/components/school-head/school-head-page";

const view = { schoolId: "s1", isSuperAdminView: false } as unknown as SchoolHeadView;

const data = {
  todayKey: "2026-10-03",
  activeYear: null,
  gradeCount: 0,
  sectionCount: 0,
  adviserlessSections: [],
};

describe("loadSchoolHeadDashboard bannerSrc", () => {
  it("starts its own queries before a pending banner promise resolves, then uses the resolved value", async () => {
    overview.mockResolvedValue(data);
    mix.mockResolvedValue({});
    let resolveBanner!: (v: string) => void;
    const banner = new Promise<string>((r) => {
      resolveBanner = r;
    });

    const pending = loadSchoolHeadDashboard({ view, displayName: "Ana", bannerSrc: banner });
    await Promise.resolve();
    expect(overview).toHaveBeenCalledWith("s1");
    expect(mix).toHaveBeenCalledWith("s1");

    resolveBanner("/brand/banner-x.webp");
    const { hero } = await pending;
    expect((hero as ReactElement<{ bannerSrc: string }>).props.bannerSrc).toBe(
      "/brand/banner-x.webp"
    );
  });

  it("still accepts a plain string", async () => {
    overview.mockResolvedValue(data);
    mix.mockResolvedValue({});
    const { hero } = await loadSchoolHeadDashboard({
      view,
      displayName: "Ana",
      bannerSrc: "/brand/plain.webp",
    });
    expect((hero as ReactElement<{ bannerSrc: string }>).props.bannerSrc).toBe(
      "/brand/plain.webp"
    );
  });

  it("page passes the banner promise without awaiting it", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../../../src/app/school-head/(app)/page.tsx"),
      "utf8"
    );
    expect(page).toContain("const bannerSrc: Promise<string> =");
    expect(page).toContain("bannerSrc,");
    expect(page).not.toMatch(/const gender = [\s\S]*?await prisma/);
  });
});
