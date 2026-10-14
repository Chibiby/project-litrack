import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The purge wiring: every DELETE is LIMITed, a disabled rule touches nothing,
 * and a failing rule reports `failed` without stopping the others.
 */

const executeRaw = vi.fn();
const learnerUpdateMany = vi.fn();
const revalidateAll = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => executeRaw(strings.join("?"), values),
    learner: { updateMany: (...args: unknown[]) => learnerUpdateMany(...args) },
  },
}));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateAllCachedData: () => revalidateAll(),
}));

const { runDailyRetention, expireRemovedLearners } = await import("@/lib/retention/purge");

const NOW = new Date("2026-09-30T00:00:00Z");
const ENV = ["NOTIFICATION_READ_RETENTION_DAYS", "NOTIFICATION_RETENTION_DAYS", "AUDIT_LOG_RETENTION_DAYS"];

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV) delete process.env[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe("daily retention", () => {
  it("runs each rule as bounded statements with the right cutoff", async () => {
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(NOW);

    expect(report).toEqual({
      notificationsRead: { status: "ran", days: 90, deleted: 0, batches: 1, capped: false },
      notifications: { status: "ran", days: 180, deleted: 0, batches: 1, capped: false },
      auditLogs: { status: "ran", days: 730, deleted: 0, batches: 1, capped: false },
      removedLearners: { status: "idle" },
    });
    for (const [sql, values] of executeRaw.mock.calls) {
      expect(sql).toMatch(/LIMIT \?/);
      expect(values.at(-1)).toBe(5_000);
    }
    const [readSql, readValues] = executeRaw.mock.calls[0];
    expect(readSql).toMatch(/"Notification"[\s\S]*"readAt" IS NOT NULL/);
    expect(readValues[0]).toEqual(new Date("2026-07-02T00:00:00Z"));
    const [auditSql, auditValues] = executeRaw.mock.calls[2];
    expect(auditSql).toMatch(/"AuditLog"[\s\S]*"timestamp" </);
    expect(auditValues[0]).toEqual(new Date("2024-09-30T00:00:00Z"));
  });

  it("skips a disabled rule entirely", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "0";
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(NOW);
    expect(report.auditLogs).toEqual({ status: "disabled" });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("reports a failed rule and still runs the rest", async () => {
    executeRaw.mockRejectedValueOnce(new Error("statement timeout")).mockResolvedValue(3);
    const report = await runDailyRetention(NOW);
    expect(report.notificationsRead).toEqual({ status: "failed" });
    expect(report.notifications).toMatchObject({ status: "ran", deleted: 3 });
    expect(report.auditLogs).toMatchObject({ status: "ran", deleted: 3 });
  });
});

describe("expireRemovedLearners", () => {
  const LATER = new Date("2026-12-01T00:00:00Z");

  it("is a no-op while no removal window can have lapsed", async () => {
    const res = await expireRemovedLearners(NOW);
    expect(res).toEqual({ status: "idle" });
    expect(learnerUpdateMany).not.toHaveBeenCalled();
    expect(revalidateAll).not.toHaveBeenCalled();
  });

  it("soft-deletes only removed, not-yet-deleted learners past the cutoff", async () => {
    learnerUpdateMany.mockResolvedValue({ count: 4 });
    const res = await expireRemovedLearners(LATER);
    expect(res).toEqual({ status: "ran", expired: 4 });
    expect(learnerUpdateMany).toHaveBeenCalledTimes(1);
    expect(learnerUpdateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, archivedAt: { not: null, lt: new Date("2026-11-01T00:00:00Z") } },
      data: { deletedAt: LATER },
    });
    expect(revalidateAll).toHaveBeenCalledTimes(1);
  });

  it("skips revalidation when nothing expired", async () => {
    learnerUpdateMany.mockResolvedValue({ count: 0 });
    expect(await expireRemovedLearners(LATER)).toEqual({ status: "ran", expired: 0 });
    expect(revalidateAll).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing, and runDailyRetention flags it", async () => {
    learnerUpdateMany.mockRejectedValue(new Error("boom"));
    executeRaw.mockResolvedValue(0);
    expect(await expireRemovedLearners(LATER)).toEqual({ status: "failed" });
    const report = await runDailyRetention(LATER);
    expect(report.removedLearners).toEqual({ status: "failed" });
    expect(report.retentionFailed).toBe(true);
  });

  it("does not fail the rule when cache revalidation throws", async () => {
    learnerUpdateMany.mockResolvedValue({ count: 1 });
    revalidateAll.mockImplementationOnce(() => {
      throw new Error("no static generation store");
    });
    expect(await expireRemovedLearners(LATER)).toEqual({ status: "ran", expired: 1 });
  });
});
