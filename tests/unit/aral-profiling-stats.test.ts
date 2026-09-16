import { describe, expect, it } from "vitest";
import {
  PROFILING_STATUSES,
  PROFILING_STATUS_LABELS,
  parseProfilingStatus,
  computeProfilingStats,
} from "@/lib/aral/profiling-stats";

describe("computeProfilingStats", () => {
  it("completed is total minus pending", () => {
    const stats = computeProfilingStats({ total: 10, pending: 4, lastUpdatedAt: null });
    expect(stats.completed).toBe(6);
  });

  it("floors completed at zero when pending exceeds total", () => {
    const stats = computeProfilingStats({ total: 3, pending: 5, lastUpdatedAt: null });
    expect(stats.completed).toBe(0);
    expect(stats.completed).toBeGreaterThanOrEqual(0);
  });

  it("completionPct is 0 when total is 0", () => {
    const stats = computeProfilingStats({ total: 0, pending: 0, lastUpdatedAt: null });
    expect(stats.completionPct).toBe(0);
    expect(Number.isNaN(stats.completionPct)).toBe(false);
  });

  it("rounds completionPct to the nearest whole percent", () => {
    // 1 of 3 completed -> 33.33... -> 33.
    const stats = computeProfilingStats({ total: 3, pending: 2, lastUpdatedAt: null });
    expect(stats.completed).toBe(1);
    expect(stats.completionPct).toBe(33);
  });

  it("is 100% when nothing is pending", () => {
    const stats = computeProfilingStats({ total: 5, pending: 0, lastUpdatedAt: null });
    expect(stats.completionPct).toBe(100);
    expect(stats.completed).toBe(5);
  });

  it("shows an em dash and 'No profiles completed yet' when lastUpdatedAt is null", () => {
    const stats = computeProfilingStats({ total: 5, pending: 5, lastUpdatedAt: null });
    expect(stats.lastUpdatedDisplay).toBe("—");
    expect(stats.hint).toBe("No profiles completed yet");
  });

  it("formats a real Date as a short Asia/Manila date, even when UTC lands on a different day", () => {
    // 2026-01-14T17:30:00Z is 2026-01-15 01:30 in Asia/Manila (UTC+8).
    // toISOString() on this instant would print "2026-01-14" — a regression
    // to that would fail this assertion.
    const lastUpdatedAt = new Date("2026-01-14T17:30:00.000Z");
    const stats = computeProfilingStats({ total: 5, pending: 1, lastUpdatedAt });
    expect(stats.lastUpdatedDisplay).toBe("Jan 15, 2026");
    expect(stats.hint).toBe("Most recent profile saved");
  });
});

describe("parseProfilingStatus", () => {
  it("accepts 'pending'", () => {
    expect(parseProfilingStatus("pending")).toBe("pending");
  });

  it("accepts 'completed'", () => {
    expect(parseProfilingStatus("completed")).toBe("completed");
  });

  it("accepts 'all'", () => {
    expect(parseProfilingStatus("all")).toBe("all");
  });

  it("falls back to 'all' for undefined", () => {
    expect(parseProfilingStatus(undefined)).toBe("all");
  });

  it("falls back to 'all' for an empty string", () => {
    expect(parseProfilingStatus("")).toBe("all");
  });

  it("falls back to 'all' for junk", () => {
    expect(parseProfilingStatus("bogus-status")).toBe("all");
  });
});

describe("PROFILING_STATUSES / PROFILING_STATUS_LABELS", () => {
  it("has a label for every status", () => {
    for (const status of PROFILING_STATUSES) {
      expect(typeof PROFILING_STATUS_LABELS[status]).toBe("string");
      expect(PROFILING_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});
