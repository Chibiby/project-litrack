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

const { runDailyRetention, AUTH_NOISE_AUDIT_ACTIONS } = await import("@/lib/retention/purge");

const NOW = new Date("2026-09-30T00:00:00Z");
const ENV = [
  "NOTIFICATION_READ_RETENTION_DAYS",
  "NOTIFICATION_RETENTION_DAYS",
  "AUDIT_LOG_RETENTION_DAYS",
  "AUDIT_LOG_AUTH_NOISE_RETENTION_DAYS",
];

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
      auditLogsAuthNoise: { status: "ran", days: 180, deleted: 0, batches: 1, capped: false },
      auditLogs: { status: "ran", days: 730, deleted: 0, batches: 1, capped: false },
    });
    for (const [sql, values] of executeRaw.mock.calls) {
      expect(sql).toMatch(/LIMIT \?/);
      expect(values.at(-1)).toBe(5_000);
    }
    const [readSql, readValues] = executeRaw.mock.calls[0];
    expect(readSql).toMatch(/"Notification"[\s\S]*"readAt" IS NOT NULL/);
    expect(readValues[0]).toEqual(new Date("2026-07-02T00:00:00Z"));
    const [authNoiseSql, authNoiseValues] = executeRaw.mock.calls[2];
    expect(authNoiseSql).toMatch(/"AuditLog"[\s\S]*"action" IN[\s\S]*"timestamp" </);
    // The raw SQL's `IN (...)` literal list must name exactly the actions this
    // rule documents itself as purging — no silent drift between the two.
    expect(AUTH_NOISE_AUDIT_ACTIONS).toEqual(["LOGIN_SUCCESS", "LOGOUT"]);
    for (const action of AUTH_NOISE_AUDIT_ACTIONS) {
      expect(authNoiseSql).toMatch(new RegExp(action));
    }
    expect(authNoiseValues[0]).toEqual(new Date("2026-04-03T00:00:00Z"));
    const [auditSql, auditValues] = executeRaw.mock.calls[3];
    expect(auditSql).toMatch(/"AuditLog"[\s\S]*"timestamp" </);
    expect(auditSql).not.toMatch(/"action" IN/);
    expect(auditValues[0]).toEqual(new Date("2024-09-30T00:00:00Z"));
  });

  it("skips a disabled rule entirely", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "0";
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(NOW);
    expect(report.auditLogs).toEqual({ status: "disabled" });
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it("disables the auth-noise rule independently of the general AuditLog rule", async () => {
    process.env.AUDIT_LOG_AUTH_NOISE_RETENTION_DAYS = "0";
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(NOW);
    expect(report.auditLogsAuthNoise).toEqual({ status: "disabled" });
    expect(report.auditLogs).toMatchObject({ status: "ran", days: 730 });
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it("purges auth-noise rows on a shorter horizon than the general AuditLog rule by default", async () => {
    executeRaw.mockResolvedValue(0);
    const report = await runDailyRetention(NOW);
    expect(report.auditLogsAuthNoise).toMatchObject({ status: "ran", days: 180 });
    expect(report.auditLogs).toMatchObject({ status: "ran", days: 730 });
  });

  it("never names LOGIN_DENIED in the auth-noise action list", () => {
    expect(AUTH_NOISE_AUDIT_ACTIONS).not.toContain("LOGIN_DENIED");
  });

  it("reports a failed rule and still runs the rest", async () => {
    executeRaw.mockRejectedValueOnce(new Error("statement timeout")).mockResolvedValue(3);
    const report = await runDailyRetention(NOW);
    expect(report.notificationsRead).toEqual({ status: "failed" });
    expect(report.notifications).toMatchObject({ status: "ran", deleted: 3 });
    expect(report.auditLogsAuthNoise).toMatchObject({ status: "ran", deleted: 3 });
    expect(report.auditLogs).toMatchObject({ status: "ran", deleted: 3 });
  });
});
