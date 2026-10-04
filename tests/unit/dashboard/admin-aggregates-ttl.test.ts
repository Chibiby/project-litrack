/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDashboard } from "@/lib/cache/tags";

/**
 * The heavy Super Admin dashboard aggregates sit on a 300 s TTL and stay busted
 * by the `adminDashboard` tag (what `revalidateAdminDashboard` and friends emit).
 */

vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => false }));

const calls: { keyParts: string[]; tags: string[]; profile?: string; revalidate?: number }[] = [];
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => unknown, options: any) => {
    calls.push(options);
    return fn();
  },
}));

vi.mock("@/lib/prisma", () => {
  const count = async () => 0;
  const many = async () => [];
  return {
    prisma: {
      school: { count, findMany: many },
      user: { count, groupBy: many },
      learner: { count, groupBy: many },
      attendance: { groupBy: many },
    },
  };
});

const { getAdminMetricCounts, getAdminActivitySeries, getAdminIpAndAdvisoryMetrics, ADMIN_DASHBOARD_TTL } =
  await import("@/lib/dashboard/aggregates");

beforeEach(() => {
  calls.length = 0;
});

describe("admin dashboard aggregate TTL", () => {
  it("is 300 seconds", () => {
    expect(ADMIN_DASHBOARD_TTL).toBe(300);
  });

  it.each([
    ["getAdminMetricCounts", getAdminMetricCounts],
    ["getAdminActivitySeries", getAdminActivitySeries],
    ["getAdminIpAndAdvisoryMetrics", getAdminIpAndAdvisoryMetrics],
  ])("%s caches for 300 s under the adminDashboard tag", async (_name, load) => {
    await (load as () => Promise<unknown>)();
    expect(calls).toHaveLength(1);
    expect(calls[0].revalidate).toBe(300);
    expect(calls[0].tags).toContain(adminDashboard);
  });
});
