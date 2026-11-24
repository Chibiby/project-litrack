import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The counts behind the sidebar badges. Each role reads only its own scope,
 * and each count matches what the page it points to lists.
 */

vi.mock("server-only", () => ({}));
const queryRaw = vi.fn();
const ticketCount = vi.fn();
const learnerCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    supportTicket: { count: (...a: unknown[]) => ticketCount(...a) },
    learner: { count: (...a: unknown[]) => learnerCount(...a) },
  },
}));
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: (fn: () => unknown) => fn() }));
const countIncomingByKind = vi.fn();
vi.mock("@/lib/transfers/queries", () => ({ countIncomingByKind: (...a: unknown[]) => countIncomingByKind(...a) }));
const getMonitoringCounts = vi.fn();
vi.mock("@/lib/monitoring/load", () => ({ getMonitoringCounts: (...a: unknown[]) => getMonitoringCounts(...a) }));
const getOpenTicketCountInScope = vi.fn();
vi.mock("@/lib/district/notifications", () => ({
  getOpenTicketCountInScope: (...a: unknown[]) => getOpenTicketCountInScope(...a),
}));

const badges = await import("@/lib/nav/badges");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAdminNavBadges", () => {
  it("adds conversations waiting on the team to open tickets", async () => {
    queryRaw.mockResolvedValue([{ n: 3 }]);
    ticketCount.mockResolvedValue(2);
    expect(await badges.getAdminNavBadges()).toEqual({ "admin-support": 5 });
    expect(ticketCount).toHaveBeenCalledWith({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, school: { deletedAt: null } },
    });
  });

  it("asks only about Ask-admin threads and any Super Admin's read", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    ticketCount.mockResolvedValue(0);
    await badges.getAdminNavBadges();
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain(`'ADMIN_DIRECT'`);
    expect(sql).toContain(`'SUPER_ADMIN'`);
    expect(sql).toContain(`"lastReadAt" >= c."lastMessageAt"`);
  });
});

describe("getDistrictNavBadges", () => {
  it("counts open tickets in the admin's districts", async () => {
    getOpenTicketCountInScope.mockResolvedValue(4);
    const scope = { kind: "districts", districts: ["North"] } as const;
    expect(await badges.getDistrictNavBadges({ id: "d1" }, scope as never)).toEqual({ "district-support": 4 });
    expect(getOpenTicketCountInScope).toHaveBeenCalledWith({ id: "d1" }, scope);
  });
});

describe("getSchoolHeadNavBadges", () => {
  it("counts incoming transfers, section-move requests and monitoring rows for that school", async () => {
    countIncomingByKind.mockResolvedValue({ LEARNER: 2, TEACHER: 1, ARAL_VOLUNTEER: 0 });
    getMonitoringCounts.mockResolvedValue({
      teachers: 10,
      teachersWithPending: 4,
      aralTeachers: 3,
      aralTeachersWithPending: 1,
      pendingByKind: {},
      discrepancyTotal: 6,
      discrepancyByKind: {},
    });
    const result = await badges.getSchoolHeadNavBadges("school-1", { pendingTransferRequestCount: 2 }, "2026-11-24");
    expect(countIncomingByKind).toHaveBeenCalledWith("school-1");
    expect(getMonitoringCounts).toHaveBeenCalledWith("school-1", "2026-11-24");
    expect(result).toEqual({
      "school-head-transfer": 3,
      "school-head-learners": 2,
      "school-head-monitoring-non-compliance": 4,
      "school-head-monitoring-aral": 1,
      "school-head-monitoring-discrepancies": 6,
    });
  });

  it("still returns the counts that loaded when one source fails", async () => {
    countIncomingByKind.mockRejectedValue(new Error("pool"));
    getMonitoringCounts.mockRejectedValue(new Error("pool"));
    const result = await badges.getSchoolHeadNavBadges("school-1", { pendingTransferRequestCount: 1 }, "2026-11-24");
    expect(result).toEqual({ "school-head-learners": 1 });
  });
});

describe("getTeacherNavBadges", () => {
  it("counts the tutor's ARAL learners with no profile, in their school only", async () => {
    learnerCount.mockResolvedValue(7);
    expect(await badges.getTeacherNavBadges("t1", "school-1")).toEqual({ "teacher-aral-profiling": 7 });
    const where = learnerCount.mock.calls[0][0].where;
    expect(where).toMatchObject({
      schoolId: "school-1",
      deletedAt: null,
      archivedAt: null,
      isAralLearner: true,
      aralProfile: null,
    });
  });
});
