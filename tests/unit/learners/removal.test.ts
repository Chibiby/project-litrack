import { describe, expect, it } from "vitest";
import {
  REMOVAL_CLOCK_START,
  REMOVAL_WINDOW_DAYS,
  isRemovalExpired,
  removalExpiresAt,
  removalExpiryCutoff,
  removedListArchivedAtFilter,
} from "@/lib/learners/removal";

const DAY = 24 * 60 * 60 * 1000;
const FIRST_CUTOFF = new Date(REMOVAL_CLOCK_START.getTime() + 30 * DAY);

describe("removalExpiresAt", () => {
  it("counts from the clock start for removals recorded before it", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    expect(removalExpiresAt(old).getTime()).toBe(REMOVAL_CLOCK_START.getTime() + 30 * DAY);
  });

  it("counts from the removal itself after the clock start", () => {
    const at = new Date("2026-10-20T03:00:00Z");
    expect(removalExpiresAt(at).getTime()).toBe(at.getTime() + 30 * DAY);
  });

  it("treats the clock start itself as a normal removal", () => {
    expect(removalExpiresAt(REMOVAL_CLOCK_START).getTime()).toBe(REMOVAL_CLOCK_START.getTime() + 30 * DAY);
  });

  it("uses a 30 day window", () => {
    expect(REMOVAL_WINDOW_DAYS).toBe(30);
  });
});

describe("removalExpiryCutoff", () => {
  it("is null before the clock start plus 30 days", () => {
    expect(removalExpiryCutoff(new Date("2026-10-01T00:00:00Z"))).toBeNull();
    expect(removalExpiryCutoff(new Date(FIRST_CUTOFF.getTime() - 1))).toBeNull();
  });

  it("is null exactly when the cutoff equals the clock start", () => {
    expect(removalExpiryCutoff(FIRST_CUTOFF)).toBeNull();
  });

  it("is now minus 30 days afterwards", () => {
    const now = new Date(FIRST_CUTOFF.getTime() + 1);
    expect(removalExpiryCutoff(now)?.getTime()).toBe(now.getTime() - 30 * DAY);
  });
});

describe("removedListArchivedAtFilter", () => {
  it("is just { not: null } before a cutoff exists", () => {
    expect(removedListArchivedAtFilter(new Date("2026-10-01T00:00:00Z"))).toEqual({ not: null });
  });

  it("adds gte: cutoff once the cutoff has passed the clock start", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    expect(removedListArchivedAtFilter(now)).toEqual({
      not: null,
      gte: new Date(now.getTime() - 30 * DAY),
    });
  });
});

describe("isRemovalExpired", () => {
  it("never expires before the first cutoff, however old the removal", () => {
    expect(isRemovalExpired(new Date("2025-01-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"))).toBe(false);
  });

  it("expires pre-release removals once the full window from the clock start has passed", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    expect(isRemovalExpired(old, FIRST_CUTOFF)).toBe(false);
    expect(isRemovalExpired(old, new Date(FIRST_CUTOFF.getTime() + 1))).toBe(true);
  });

  it("is not expired exactly at the boundary, expired one ms later", () => {
    const at = new Date("2026-10-20T03:00:00Z");
    const boundary = new Date(at.getTime() + 30 * DAY);
    expect(isRemovalExpired(at, boundary)).toBe(false);
    expect(isRemovalExpired(at, new Date(boundary.getTime() + 1))).toBe(true);
  });
});
