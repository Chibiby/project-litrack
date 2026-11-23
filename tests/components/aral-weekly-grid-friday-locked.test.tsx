import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Friday is locked in Weekly Attendance (owner decision 2026-11-24): the
 * column stays, greyed and not editable, and a mark already saved on a Friday
 * stays visible, read-only. Rates and exports still count Monday to Friday.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/attendance", () => ({ saveAralWeeklyAttendance: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }) }));

const { buildDays, AralWeeklyAttendanceGridForm } = await import("@/components/forms/aral-weekly-attendance-grid-form");

afterEach(cleanup);

describe("buildDays - Friday", () => {
  it("locks Friday even in a past week, and leaves Monday to Thursday open", () => {
    const days = buildDays("2026-11-09", [], "2026-11-23");

    expect(days.map((d) => [d.weekday, d.locked, d.lockReason])).toEqual([
      ["MON", false, ""],
      ["TUE", false, ""],
      ["WED", false, ""],
      ["THU", false, ""],
      ["FRI", true, "Friday is locked"],
    ]);
  });

  it("keeps Holiday as the reason on a Friday holiday", () => {
    expect(buildDays("2026-11-09", ["2026-11-13"], "2026-11-23")[4]).toMatchObject({
      locked: true,
      lockReason: "Holiday",
    });
  });
});

describe("weekly grid - a stored Friday mark", () => {
  it("shows it read-only, with no picker on Friday", () => {
    render(
      <AralWeeklyAttendanceGridForm
        gradeId="grade-1"
        weekStartKey="2026-11-09"
        learners={[{ id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana", sectionName: null }]}
        existing={[
          { learnerId: "l1", dateKey: "2026-11-10", status: "PRESENT", notes: null },
          { learnerId: "l1", dateKey: "2026-11-13", status: "ABSENT", notes: null },
        ]}
        holidayKeys={[]}
        showSection={false}
      />
    );

    expect(screen.queryByLabelText(/Ana Santos attendance for Friday/)).toBeNull();
    expect(screen.getByLabelText(/Ana Santos attendance for Tuesday/)).toBeTruthy();
    const friday = screen.getByTitle("Friday is locked");
    expect(friday.textContent).toContain("Absent");
  });
});
