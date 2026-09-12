import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockTargetSchool, ActiveTeacherUnlock, ActiveSchoolUnlock } from "@/lib/unlock/admin-queries";

/**
 * The Super Admin unlock console: proves the client-side contract the server
 * actions rely on — `issueUnlock`/`revokeUnlock` reject a payload that carries
 * both `userId` and `schoolId`, so the form must never send both; "Whole
 * school" must hide the teacher picker rather than merely ignore its value;
 * the scope choice must drive which kind of period key gets posted; the days
 * input must refuse anything outside 1..90; and a revoke must name the exact
 * grant and table (`kind`) it acts on. A failed action must never fail
 * silently — `res.error` (and `res.ref`, when present) has to reach the page.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const issueUnlock = vi.fn(async (_input?: unknown) => ({
  ok: true,
  data: { id: "grant-new", expiresAt: new Date("2026-09-19T00:00:00"), recipients: 1 },
}));
const revokeUnlock = vi.fn(async (_input?: unknown) => ({ ok: true }));
vi.mock("@/lib/actions/unlock-admin", () => ({
  issueUnlock: (...args: unknown[]) => issueUnlock(...(args as [])),
  revokeUnlock: (...args: unknown[]) => revokeUnlock(...(args as [])),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const { UnlockConsole } = await import("@/components/admin/unlock-console");

const SCHOOLS: UnlockTargetSchool[] = [
  {
    id: "school-1",
    name: "Sampaguita ES",
    teachers: [{ id: "teacher-1", name: "Ana Cruz" }],
  },
];

const EMPTY_ACTIVE = { teacher: [] as ActiveTeacherUnlock[], school: [] as ActiveSchoolUnlock[] };

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  // Radix Select's popper positioning reaches for ResizeObserver, which jsdom
  // does not implement.
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  issueUnlock.mockResolvedValue({
    ok: true,
    data: { id: "grant-new", expiresAt: new Date("2026-09-19T00:00:00"), recipients: 1 },
  });
  revokeUnlock.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

/** Opens a shadcn Select by its accessible (label-associated) name and picks an option by its visible text. */
async function pickSelect(name: string, optionText: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByText(optionText));
}

async function confirmIssue() {
  fireEvent.click(screen.getByRole("button", { name: "Reopen access" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm reopen" }));
}

describe("UnlockConsole — mode switch", () => {
  it("hides the teacher picker in whole-school mode and posts schoolId with no userId", async () => {
    render(<UnlockConsole schools={SCHOOLS} active={EMPTY_ACTIVE} />);

    expect(screen.getByRole("combobox", { name: "Teacher" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Whole school" }));

    expect(screen.queryByRole("combobox", { name: "Teacher" })).toBeNull();

    await confirmIssue();

    await waitFor(() => expect(issueUnlock).toHaveBeenCalledTimes(1));
    const payload = issueUnlock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.mode).toBe("school");
    expect(payload.schoolId).toBe("school-1");
    expect("userId" in payload).toBe(false);
  });
});

describe("UnlockConsole — scope-driven target picker", () => {
  it("swaps the period picker to months and posts a YYYY-MM-01 key", async () => {
    render(<UnlockConsole schools={SCHOOLS} active={EMPTY_ACTIVE} />);

    await pickSelect("What to reopen", "Monthly reading level");

    await confirmIssue();

    await waitFor(() => expect(issueUnlock).toHaveBeenCalledTimes(1));
    const payload = issueUnlock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.scope).toBe("MONTHLY_READING_LEVEL");
    expect(payload.targetKey).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe("UnlockConsole — days validation", () => {
  it("refuses 0 and 91 days, and accepts 7", () => {
    render(<UnlockConsole schools={SCHOOLS} active={EMPTY_ACTIVE} />);
    const days = screen.getByLabelText("Days");
    const trigger = screen.getByRole("button", { name: "Reopen access" });

    // This repo has no @testing-library/jest-dom — use native DOM assertions only.
    fireEvent.change(days, { target: { value: "0" } });
    expect(trigger.hasAttribute("disabled")).toBe(true);

    fireEvent.change(days, { target: { value: "91" } });
    expect(trigger.hasAttribute("disabled")).toBe(true);

    fireEvent.change(days, { target: { value: "7" } });
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });
});

describe("UnlockConsole — revoke", () => {
  it("posts the grant's id and kind", async () => {
    const active = {
      teacher: [
        {
          id: "grant-t1",
          scope: "ARAL_WEEKLY_ATTENDANCE" as const,
          targetKey: "2026-09-07",
          expiresAt: new Date("2026-09-20T00:00:00"),
          createdAt: new Date("2026-09-12T00:00:00"),
          teacherId: "teacher-1",
          teacherName: "Ana Cruz",
          schoolId: "school-1",
          schoolName: "Sampaguita ES",
          grantedByName: "Admin One",
        },
      ],
      school: [] as ActiveSchoolUnlock[],
    };
    render(<UnlockConsole schools={SCHOOLS} active={active} />);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(revokeUnlock).toHaveBeenCalledTimes(1));
    expect(revokeUnlock).toHaveBeenCalledWith({ kind: "teacher", grantId: "grant-t1" });
  });
});

describe("UnlockConsole — expiry dates follow the school's calendar", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("renders an expiry instant as its Manila day even on a UTC server", () => {
    // 2026-09-07T20:00Z is 04:00 on September 8 in Manila. A UTC process that
    // formatted the instant's own calendar fields would print September 7 —
    // and disagree with the browser at hydration. The table must say 8.
    process.env.TZ = "UTC";
    const active = {
      teacher: [
        {
          id: "grant-tz",
          scope: "ARAL_WEEKLY_ATTENDANCE" as const,
          targetKey: "2026-08-31",
          expiresAt: new Date("2026-09-07T20:00:00Z"),
          createdAt: new Date("2026-09-01T00:00:00Z"),
          teacherId: "teacher-1",
          teacherName: "Ana Cruz",
          schoolId: "school-1",
          schoolName: "Sampaguita ES",
          grantedByName: "Admin One",
        },
      ],
      school: [] as ActiveSchoolUnlock[],
    };
    render(<UnlockConsole schools={SCHOOLS} active={active} />);

    expect(screen.getByText("September 8, 2026")).not.toBeNull();
    expect(screen.queryByText("September 7, 2026")).toBeNull();
  });
});

describe("UnlockConsole — action failure", () => {
  it("renders res.error rather than failing silently", async () => {
    issueUnlock.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Choose a school before reopening access.",
    } as never);

    render(<UnlockConsole schools={SCHOOLS} active={EMPTY_ACTIVE} />);

    await confirmIssue();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Choose a school before reopening access."
      )
    );
    expect(toastFn.success).not.toHaveBeenCalled();
  });

  it("toasts when issueUnlock rejects outright (dropped connection) and keeps the dialog open", async () => {
    issueUnlock.mockRejectedValueOnce(new Error("network down"));

    render(<UnlockConsole schools={SCHOOLS} active={EMPTY_ACTIVE} />);

    await confirmIssue();

    await waitFor(() => expect(toastFn.error).toHaveBeenCalledTimes(1));
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("toasts when revokeUnlock rejects outright (dropped connection) and keeps the dialog open", async () => {
    revokeUnlock.mockRejectedValueOnce(new Error("network down"));
    const active = {
      teacher: [
        {
          id: "grant-t1",
          scope: "ARAL_WEEKLY_ATTENDANCE" as const,
          targetKey: "2026-09-07",
          expiresAt: new Date("2026-09-20T00:00:00"),
          createdAt: new Date("2026-09-12T00:00:00"),
          teacherId: "teacher-1",
          teacherName: "Ana Cruz",
          schoolId: "school-1",
          schoolName: "Sampaguita ES",
          grantedByName: "Admin One",
        },
      ],
      school: [] as ActiveSchoolUnlock[],
    };
    render(<UnlockConsole schools={SCHOOLS} active={active} />);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalledTimes(1));
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});
