import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  }),
}));

const { AralWeeklyAttendanceGridForm } = await import(
  "@/components/forms/aral-weekly-attendance-grid-form"
);

afterEach(cleanup);

describe("weekly attendance grid cell accessible name", () => {
  it("announces name, day, status and reason", () => {
    render(
      <AralWeeklyAttendanceGridForm
        gradeId="grade-1"
        weekStartKey="2026-09-07"
        learners={[
          {
            id: "l1",
            fullName: "Ana Santos",
            listingName: "Santos, Ana",
            sectionName: null,
          },
        ]}
        existing={[
          {
            learnerId: "l1",
            dateKey: "2026-09-07",
            status: "ABSENT",
            notes: "Sick",
          },
        ]}
        holidayKeys={[]}
        showSection={false}
      />
    );

    const absent = screen.getByRole("button", {
      name: "Ana Santos attendance for Monday, Sep 7: Absent, reason Sick",
    });
    expect(absent.getAttribute("aria-haspopup")).toBe("dialog");
    expect(
      screen.getByRole("button", {
        name: "Ana Santos attendance for Tuesday, Sep 8: No Class",
      })
    ).toBeTruthy();
  });
});
