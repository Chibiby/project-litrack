import { describe, expect, it, vi } from "vitest";

/**
 * The weekly grid locks a day that has not come yet, the same way it locks a
 * holiday, so a teacher cannot mark a class Present ahead of time. The server
 * refuses such a mark too; this is the half the teacher sees.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/attendance", () => ({ saveAralWeeklyAttendance: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const { buildDays } = await import("@/components/forms/aral-weekly-attendance-grid-form");

describe("buildDays - future days", () => {
  it("locks every day after today as Not yet and leaves today open", () => {
    // Week of Monday 2026-11-16, seen on Wednesday 2026-11-18.
    const days = buildDays("2026-11-16", [], "2026-11-18");

    expect(days.map((d) => [d.key, d.locked, d.lockReason])).toEqual([
      ["2026-11-16", false, ""],
      ["2026-11-17", false, ""],
      ["2026-11-18", false, ""],
      ["2026-11-19", true, "Not yet"],
      ["2026-11-20", true, "Not yet"],
    ]);
  });

  it("keeps Holiday as the reason when a future day is also a holiday", () => {
    const days = buildDays("2026-11-16", ["2026-11-20"], "2026-11-16");

    expect(days[4]).toMatchObject({ locked: true, lockReason: "Holiday" });
  });

  it("locks the whole week when it starts after today", () => {
    const days = buildDays("2026-11-23", [], "2026-11-13");

    expect(days.every((d) => d.locked && d.lockReason === "Not yet")).toBe(true);
  });
});
