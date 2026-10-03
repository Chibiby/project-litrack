import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: vi.fn(async () => ({ ok: true as const })),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
toastFn.loading = vi.fn(() => "toast-1");
vi.mock("sonner", () => ({ toast: toastFn }));

const {
  AralWeeklyAttendanceGridForm,
} = await import("@/components/forms/aral-weekly-attendance-grid-form");

import type {
  WeeklyAttendanceGridExisting,
  WeeklyAttendanceGridLearner,
} from "@/components/forms/aral-weekly-attendance-grid-form";

const LEARNERS: WeeklyAttendanceGridLearner[] = [
  { id: "learner-1", fullName: "Ana Santos", listingName: "Santos, Ana", sectionName: null },
];
const EXISTING: WeeklyAttendanceGridExisting[] = [
  { learnerId: "learner-1", dateKey: "2026-09-07", status: "PRESENT", notes: null },
  { learnerId: "learner-1", dateKey: "2026-09-08", status: "ABSENT", notes: null },
];

function renderGrid() {
  return render(
    <AralWeeklyAttendanceGridForm
      gradeId="grade-1"
      weekStartKey="2026-09-07"
      learners={LEARNERS}
      existing={EXISTING}
      holidayKeys={[]}
      showSection={false}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("weekly attendance grid — totals live region", () => {
  it("announces from a real sr-only status box, not a display:contents wrapper", () => {
    const { container } = renderGrid();
    const status = screen.getByRole("status");
    expect(status.className).toContain("sr-only");
    expect(status.className).not.toContain("contents");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("stays silent on mount and announces a short summary ~1s after the last edit", () => {
    renderGrid();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    fireEvent.click(
      within(screen.getByText("Santos, Ana").closest("tr")!).getByRole("button", {
        name: "Clear Ana Santos's week",
      })
    );
    expect(status.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toContain("Present 0");
    expect(status.textContent).toContain("absent 0");
  });

  it("announces the reverted totals when an edit is undone back to the initial state", () => {
    renderGrid();
    const status = screen.getByRole("status");
    const monday = () =>
      screen.getByRole("button", {
        name: /^Ana Santos attendance for Monday, Sep 7:/,
      });

    fireEvent.click(monday());
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /No Class/ })
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toContain("Present 0");

    fireEvent.click(monday());
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Present/ })
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toContain("Present 1");
  });
});
