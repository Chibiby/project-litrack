import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed week fetch must leave the picker, the URL and the grid on the same
 * week (the one whose records are still shown), and choosing the failed week
 * again must retry the fetch.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const fetchAralAttendanceForWeek = vi.fn();
vi.mock("@/lib/actions/aral-grid", () => ({
  fetchAralAttendanceForWeek: (...args: unknown[]) => fetchAralAttendanceForWeek(...args),
}));

vi.mock("@/lib/ui/call-action", () => ({
  callAction: async (fn: () => Promise<unknown>) => fn(),
}));

const toastFailure = vi.fn();
vi.mock("@/lib/ui/toast-failure", () => ({
  toastFailure: (...args: unknown[]) => toastFailure(...args),
}));

vi.mock("@/lib/ui/unsaved-guard", () => ({
  runGuarded: (fn: () => void) => fn(),
}));

vi.mock("@/components/aral/unsaved-grid-guard", () => ({
  UnsavedGridGuard: () => null,
  UnsavedChangesBadge: () => null,
}));
vi.mock("@/components/aral/attendance-week-stats", () => ({
  AttendanceWeekStats: () => null,
}));
vi.mock("@/components/aral/aral-scope-select", () => ({
  AralGradeSelect: () => null,
  AralSectionSelect: () => null,
}));
vi.mock("@/components/aral/date-nav", () => ({
  AralDateNav: ({
    value,
    onNavigate,
  }: {
    value: string;
    onNavigate: (v: string) => void;
  }) => (
    <div>
      <span data-testid="picker">{value}</span>
      <button type="button" onClick={() => onNavigate("2026-08-10")}>
        go-next
      </button>
    </div>
  ),
}));
vi.mock("@/components/forms/aral-weekly-attendance-grid-form", () => ({
  AralWeeklyAttendanceGridForm: ({ weekStartKey }: { weekStartKey: string }) => (
    <div data-testid="grid">{weekStartKey}</div>
  ),
  BulkAttendanceActions: () => null,
}));

const { AralWeeklyAttendancePanel } = await import(
  "@/components/aral/aral-weekly-attendance-panel"
);

function renderPanel() {
  return render(
    <AralWeeklyAttendancePanel
      gradeId="g1"
      grades={[]}
      basePath="/teacher/aral/g1/attendance"
      initialWeekKey="2026-08-03"
      section="all"
      sections={[]}
      showSection={false}
      learners={[]}
      initialExisting={[]}
      initialHolidayKeys={[]}
      readOnly
    />
  );
}

describe("AralWeeklyAttendancePanel week fetch failure", () => {
  beforeEach(() => {
    replace.mockClear();
    toastFailure.mockClear();
    fetchAralAttendanceForWeek.mockReset();
  });
  afterEach(cleanup);

  it("rolls the picker and URL back to the loaded week, then retries", async () => {
    fetchAralAttendanceForWeek.mockResolvedValueOnce({
      ok: false,
      error: "You appear to be offline.",
      code: "NETWORK_OFFLINE",
    });
    renderPanel();

    fireEvent.click(screen.getByText("go-next"));
    expect(screen.getByTestId("picker").textContent).toBe("2026-08-10");

    await waitFor(() => expect(toastFailure).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("picker").textContent).toBe("2026-08-03")
    );
    expect(screen.getByTestId("grid").textContent).toBe("2026-08-03");
    expect(replace).toHaveBeenLastCalledWith(
      "/teacher/aral/g1/attendance?week=2026-08-03",
      { scroll: false }
    );

    fetchAralAttendanceForWeek.mockResolvedValueOnce({
      ok: true,
      data: { records: [], holidayKeys: [] },
    });
    fireEvent.click(screen.getByText("go-next"));
    expect(fetchAralAttendanceForWeek).toHaveBeenCalledTimes(2);

    await waitFor(() =>
      expect(screen.getByTestId("grid").textContent).toBe("2026-08-10")
    );
    expect(screen.getByTestId("picker").textContent).toBe("2026-08-10");
  });
});
