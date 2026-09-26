import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_LOG_RETENTION,
  deleteInBatches,
  NOTIFICATION_READ_RETENTION,
  NOTIFICATION_RETENTION,
  retentionCutoff,
  retentionDays,
} from "@/lib/retention/policy";

/**
 * Retention for Notification and AuditLog. The rules that matter: unset means
 * the default, anything unparseable or zero means OFF (never a guessed
 * deletion), the AuditLog floor catches a typo that would erase history no
 * backup carries, and a purge is a sequence of bounded statements with a cap.
 */

describe("retention days from env", () => {
  it("uses the defaults when unset or blank", () => {
    expect(retentionDays(NOTIFICATION_READ_RETENTION, undefined)).toBe(90);
    expect(retentionDays(NOTIFICATION_RETENTION, "")).toBe(180);
    expect(retentionDays(AUDIT_LOG_RETENTION, "  ")).toBe(730);
  });

  it("honours a sane override, flooring fractions", () => {
    expect(retentionDays(NOTIFICATION_RETENTION, "30")).toBe(30);
    expect(retentionDays(NOTIFICATION_RETENTION, " 45.9 ")).toBe(45);
  });

  it("disables the rule for 0, negatives and anything unparseable", () => {
    for (const raw of ["0", "-5", "0.5", "abc", "30d", "Infinity", "NaN"]) {
      expect(retentionDays(NOTIFICATION_RETENTION, raw), raw).toBeNull();
    }
  });

  it("raises an AuditLog value below the floor rather than purging recent history", () => {
    expect(retentionDays(AUDIT_LOG_RETENTION, "7")).toBe(90);
    expect(retentionDays(AUDIT_LOG_RETENTION, "365")).toBe(365);
    // Off still means off: the floor applies to a value, not to a disable.
    expect(retentionDays(AUDIT_LOG_RETENTION, "0")).toBeNull();
  });

  it("reads the documented variable names", () => {
    expect(NOTIFICATION_READ_RETENTION.env).toBe("NOTIFICATION_READ_RETENTION_DAYS");
    expect(NOTIFICATION_RETENTION.env).toBe("NOTIFICATION_RETENTION_DAYS");
    expect(AUDIT_LOG_RETENTION.env).toBe("AUDIT_LOG_RETENTION_DAYS");
  });
});

describe("retention cutoff", () => {
  it("is exactly N days before now", () => {
    expect(retentionCutoff(new Date("2026-09-30T00:00:00Z"), 90)).toEqual(new Date("2026-07-02T00:00:00Z"));
  });
});

describe("batched delete", () => {
  it("stops on the first short batch", async () => {
    const batch = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    await expect(deleteInBatches(batch, { batchSize: 5, maxBatches: 10 })).resolves.toEqual({
      deleted: 12,
      batches: 3,
      capped: false,
    });
    expect(batch).toHaveBeenCalledWith(5);
  });

  it("runs one statement and stops when nothing has expired", async () => {
    const batch = vi.fn().mockResolvedValue(0);
    await expect(deleteInBatches(batch, { batchSize: 5 })).resolves.toEqual({
      deleted: 0,
      batches: 1,
      capped: false,
    });
  });

  it("stops at the cap and says so, leaving the backlog for the next run", async () => {
    const batch = vi.fn().mockResolvedValue(5);
    await expect(deleteInBatches(batch, { batchSize: 5, maxBatches: 3 })).resolves.toEqual({
      deleted: 15,
      batches: 3,
      capped: true,
    });
    expect(batch).toHaveBeenCalledTimes(3);
  });

  it("defaults to 5,000-row statements", async () => {
    const batch = vi.fn().mockResolvedValue(0);
    await deleteInBatches(batch);
    expect(batch).toHaveBeenCalledWith(5_000);
  });
});
