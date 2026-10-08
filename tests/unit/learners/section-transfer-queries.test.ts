import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { sectionTransferRequest: { findMany, count } },
}));

import {
  countPendingTransferRequests,
  pendingTransfersByLearner,
} from "@/lib/learners/section-transfer-queries";

const SCHOOL = "school-1";

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
});

describe("pendingTransfersByLearner", () => {
  it("skips the query when there are no learners", async () => {
    const map = await pendingTransfersByLearner(SCHOOL, []);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes to the school and reports who filed each request", async () => {
    findMany.mockResolvedValue([
      { id: "req-1", learnerId: "l-1", requestedById: "teacher-a", toSection: { name: "Rizal" } },
      { id: "req-2", learnerId: "l-2", requestedById: null, toSection: { name: "Mabini" } },
    ]);

    const map = await pendingTransfersByLearner(SCHOOL, ["l-1", "l-2"]);

    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      schoolId: SCHOOL,
      learnerId: { in: ["l-1", "l-2"] },
      status: "PENDING",
    });
    expect(args.select.requestedById).toBe(true);
    expect(map.get("l-1")).toEqual({
      requestId: "req-1",
      toSectionName: "Rizal",
      requestedById: "teacher-a",
    });
    expect(map.get("l-2")).toEqual({
      requestId: "req-2",
      toSectionName: "Mabini",
      requestedById: null,
    });
  });
});

describe("countPendingTransferRequests", () => {
  it("counts every pending request in the school, uncapped", async () => {
    count.mockResolvedValue(137);
    await expect(countPendingTransferRequests(SCHOOL)).resolves.toBe(137);
    expect(count).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, status: "PENDING" } });
  });
});
