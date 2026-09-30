import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two regressions on the single-learner attendance form:
 * - its default date came from `toISOString()`, which is yesterday between
 *   00:00 and 08:00 in UTC+8;
 * - it submitted through a form `action`, so React 19 reset every field when a
 *   failed save returned and the teacher's typing vanished.
 */

const markAttendance = vi.fn();
vi.mock("@/lib/actions/attendance", () => ({
  markAttendance: (...args: unknown[]) => markAttendance(...args),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), loading: vi.fn() },
}));

const toastFailure = vi.fn();
vi.mock("@/lib/ui/toast-failure", () => ({
  toastFailure: (...a: unknown[]) => toastFailure(...a),
}));

const { AttendanceMarkForm } = await import("@/components/forms/attendance-mark-form");

const originalTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("AttendanceMarkForm", () => {
  it("defaults the date to today's local date at 07:30 in UTC+8", () => {
    process.env.TZ = "Asia/Manila";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T23:30:00Z"));

    render(<AttendanceMarkForm learnerId="learner-1" />);

    expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe("2026-09-30");
  });

  it("keeps what was typed when the save fails", async () => {
    markAttendance.mockResolvedValue({
      ok: false,
      code: "INTERNAL",
      error: "Something went wrong",
    });

    render(<AttendanceMarkForm learnerId="learner-1" />);

    const notes = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Came in late, bus broke down" } });
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(toastFailure).toHaveBeenCalledTimes(1));
    expect(markAttendance).toHaveBeenCalledTimes(1);
    const sent = markAttendance.mock.calls[0][0] as FormData;
    expect(sent.get("learnerId")).toBe("learner-1");
    expect(sent.get("notes")).toBe("Came in late, bus broke down");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
      "Came in late, bus broke down"
    );
    expect((screen.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
  });

  it("clears the form after a successful save", async () => {
    markAttendance.mockResolvedValue({ ok: true });

    render(<AttendanceMarkForm learnerId="learner-1" />);

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Present" } });
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Attendance saved"));
    await waitFor(() =>
      expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("")
    );
  });
});
