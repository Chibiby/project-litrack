import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for the per-day "Optional details" textarea in the weekly
 * attendance grid (`AttendanceCellPicker` in
 * `aral-weekly-attendance-grid-row.tsx`).
 *
 * The stored note is `composeNote`d — trimmed — before it ever reaches the
 * grid's state, so the textarea cannot use that trimmed string as its own
 * `value`: a trailing (or otherwise significant) space the teacher is mid
 * typing would vanish on every keystroke, because the parent hands back a
 * note with the space already stripped. The fix keeps the raw, untrimmed
 * text the teacher is typing in local state and only resyncs it from the
 * parsed note when the cell moves to a different status/reason — so the
 * textarea keeps the trailing space, while the value that actually gets
 * saved is still the trimmed, composed one.
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

import type {
  AralWeeklyAttendanceGridFormHandle,
  WeeklyAttendanceGridExisting,
  WeeklyAttendanceGridLearner,
} from "@/components/forms/aral-weekly-attendance-grid-form";

// Monday of the week under test.
const WEEK_START = "2026-09-07";
const MON = "2026-09-07";
const MON_ARIA = "Monday, Sep 7";

const LEARNERS: WeeklyAttendanceGridLearner[] = [
  {
    id: "learner-1",
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    sectionName: null,
  },
];

/** Already Absent, with no note yet, so the reason/details panel is up as
 * soon as the popover opens. */
const EXISTING: WeeklyAttendanceGridExisting[] = [
  { learnerId: "learner-1", dateKey: MON, status: "ABSENT", notes: null },
];

function Harness() {
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
        holidayKeys={[]}
        showSection={false}
      />
    </>
  );
}

beforeAll(() => {
  // Radix Popover / Select reach for pointer capture and scrollIntoView,
  // which jsdom lacks.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("weekly attendance grid — Optional details textarea", () => {
  it("keeps a typed trailing space on screen while saving the trimmed, composed note", async () => {
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Ana Santos attendance for ${MON_ARIA}`,
      })
    );

    // The reason panel is already up: the day is already Absent.
    const reasonSelect = await screen.findByRole("combobox");
    fireEvent.click(reasonSelect);
    fireEvent.click(await screen.findByText("Family emergency"));

    const textarea = await screen.findByLabelText("Optional details");

    // Typed with a trailing space mid-composition.
    fireEvent.change(textarea, { target: { value: "sick leave " } });

    // The space is still on screen — it must not be silently dropped on the
    // very keystroke that typed it.
    expect((textarea as HTMLTextAreaElement).value).toBe("sick leave ");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAralWeeklyAttendance).toHaveBeenCalledTimes(1)
    );
    const payload = saveAralWeeklyAttendance.mock.calls[0][0];
    const cell = payload.cells.find(
      (c) => c.learnerId === "learner-1" && c.date === MON
    );
    // The saved note is the trimmed, composed value — the space never
    // travels to the server.
    expect(cell?.notes).toBe("Family emergency — sick leave");
  });
});
