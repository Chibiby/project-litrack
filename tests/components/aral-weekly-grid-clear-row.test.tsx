import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The weekly attendance grid's per-row Clear button, and the "nothing changed"
 * message it exposes on Save. Both guards it relies on — the server's
 * `cells.length > 0` refine and the grid's own empty-diff check — are unchanged
 * here; only the row-level clear action and the copy of the guard's toast are
 * under test.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

type WeeklySavePayload = {
  gradeId: string;
  weekStart: string;
  cells: { learnerId: string; date: string; status: string | null; notes: string | null }[];
};

const saveAralWeeklyAttendance = vi.fn(async (_input: WeeklySavePayload) => ({
  ok: true as const,
}));
vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: (...args: unknown[]) =>
    saveAralWeeklyAttendance(...(args as [WeeklySavePayload])),
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
const { toast } = await import("sonner");

import type {
  AralWeeklyAttendanceGridFormHandle,
  WeeklyAttendanceGridExisting,
  WeeklyAttendanceGridLearner,
} from "@/components/forms/aral-weekly-attendance-grid-form";

// Monday of the week under test; Wed 2026-09-09 is flagged as a holiday below,
// making it a locked column between two ordinary school days.
const WEEK_START = "2026-09-07";
const MON = "2026-09-07";
const TUE = "2026-09-08";
const WED_HOLIDAY = "2026-09-09";

const LEARNERS: WeeklyAttendanceGridLearner[] = [
  { id: "learner-1", fullName: "Ana Santos", sectionName: null },
  { id: "learner-2", fullName: "Ben Cruz", sectionName: null },
];

const EXISTING: WeeklyAttendanceGridExisting[] = [
  { learnerId: "learner-1", dateKey: MON, status: "PRESENT", notes: null },
  { learnerId: "learner-1", dateKey: TUE, status: "ABSENT", notes: "Family emergency" },
  { learnerId: "learner-1", dateKey: WED_HOLIDAY, status: "ABSENT", notes: "Family emergency" },
];

function Harness({ readOnly }: { readOnly?: boolean }) {
  const formRef = useRef<AralWeeklyAttendanceGridFormHandle>(null);
  return (
    <>
      <button type="button" onClick={() => formRef.current?.save()}>
        Save
      </button>
      <AralWeeklyAttendanceGridForm
        ref={formRef}
        gradeId="grade-1"
        weekStartKey={WEEK_START}
        learners={LEARNERS}
        existing={EXISTING}
        holidayKeys={[WED_HOLIDAY]}
        showSection={false}
        readOnly={readOnly}
      />
    </>
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`No row for ${name}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("weekly attendance grid — row Clear", () => {
  it("clears a row's two marks and saves them as status: null, skipping the locked holiday", async () => {
    render(<Harness />);

    fireEvent.click(
      within(rowFor("Ana Santos")).getByRole("button", {
        name: "Clear Ana Santos's week",
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Row cleared. Save to keep the change."
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAralWeeklyAttendance).toHaveBeenCalledTimes(1)
    );
    const payload = saveAralWeeklyAttendance.mock.calls[0][0];

    expect(payload.cells).toHaveLength(2);
    expect(payload.cells).toEqual(
      expect.arrayContaining([
        { learnerId: "learner-1", date: MON, status: null, notes: null },
        { learnerId: "learner-1", date: TUE, status: null, notes: null },
      ])
    );
    expect(payload.cells.some((c) => c.date === WED_HOLIDAY)).toBe(false);
  });

  it("clearing an already-empty row and saving calls the action zero times and shows the informational toast", () => {
    render(<Harness />);

    fireEvent.click(
      within(rowFor("Ben Cruz")).getByRole("button", {
        name: "Clear Ben Cruz's week",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveAralWeeklyAttendance).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Everything here is already saved.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("disables the Clear button when the grid is read-only", () => {
    // Asserted as "rendered and disabled" rather than "rendered or absent":
    // a branch that accepts either outcome passes even with the button deleted,
    // which is exactly the regression this case exists to catch.
    render(<Harness readOnly />);

    const button = within(rowFor("Ana Santos")).getByRole("button", {
      name: "Clear Ana Santos's week",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves the Clear button enabled when the grid is editable", () => {
    render(<Harness />);

    const button = within(rowFor("Ana Santos")).getByRole("button", {
      name: "Clear Ana Santos's week",
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
