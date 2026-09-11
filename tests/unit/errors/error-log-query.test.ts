import { describe, expect, it } from "vitest";
import { buildErrorLogQuery, parseErrorLogParams } from "@/lib/admin/error-log";

const NOW = new Date("2026-09-11T12:00:00Z");

describe("parseErrorLogParams", () => {
  it("defaults to the last 24 hours and no filters", () => {
    expect(parseErrorLogParams({})).toEqual({
      ref: null,
      code: null,
      severity: null,
      schoolId: null,
      window: "24h",
    });
  });

  it("accepts only known windows and severities", () => {
    expect(parseErrorLogParams({ window: "7d" }).window).toBe("7d");
    expect(parseErrorLogParams({ window: "all-time" }).window).toBe("24h");
    expect(parseErrorLogParams({ severity: "system" }).severity).toBe("system");
    // "user" severity is never recorded, so it is not a filter either.
    expect(parseErrorLogParams({ severity: "user" }).severity).toBeNull();
  });

  it("keeps a reference exactly as typed, trimmed", () => {
    expect(parseErrorLogParams({ ref: "  E-7K2P9QXM " }).ref).toBe("E-7K2P9QXM");
  });
});

describe("buildErrorLogQuery", () => {
  it("looks up a reference on its own, ignoring the time window", () => {
    const where = buildErrorLogQuery(
      { ref: "E-7K2P9QXM", code: null, severity: null, schoolId: null, window: "24h" },
      NOW
    );
    // Someone read this off a screen; when it happened is what they don't know.
    expect(where).toEqual({ ref: "E-7K2P9QXM" });
  });

  it("filters by window, code, severity and school together", () => {
    const where = buildErrorLogQuery(
      {
        ref: null,
        code: "DB_UNAVAILABLE",
        severity: "system",
        schoolId: "school-1",
        window: "7d",
      },
      NOW
    );
    expect(where).toEqual({
      createdAt: { gte: new Date("2026-09-04T12:00:00Z") },
      code: "DB_UNAVAILABLE",
      severity: "system",
      schoolId: "school-1",
    });
  });
});
