import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The purge wiring: every DELETE is LIMITed, a disabled rule touches nothing,
 * and a failing rule reports `failed` without stopping the others.
 */

const executeRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => executeRaw(strings.join("?"), values),
  },
}));

const { runDailyRetention } = await import("@/lib/retention/purge");

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
