import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The all-grades Weekly Attendance grid holds learners of several grades. The
 * save action is keyed to one grade, so each grade's changed cells must travel
 * in their own call, and a holiday one grade keeps must lock only that grade's
 * rows.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
const saveAralWeeklyAttendance = vi.fn();
vi.mock("@/lib/actions/attendance", () => ({
  saveAralWeeklyAttendance: (...args: unknown[]) => saveAralWeeklyAttendance(...args),
}));
vi.mock("@/lib/ui/call-action", () => ({
  callAction: async (fn: () => Promise<unknown>) => fn(),
}));
const toastFailure = vi.fn();
vi.mock("@/lib/ui/toast-failure", () => ({
  toastFailure: (...args: unknown[]) => toastFailure(...args),
}));
// Keep autosave and drafts out of the way: this test drives saves itself.
vi.mock("@/lib/ui/use-autosave", () => ({
  useAutosave: () => ({ status: "idle" }),
}));
vi.mock("@/lib/ui/use-grid-draft", () => ({
  draftStorageKey: () => "k",
  useGridDraft: () => undefined,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "t"),
  }),
}));

const { AralWeeklyAttendanceGridForm } = await import(
  "@/components/forms/aral-weekly-attendance-grid-form"
);
type Handle = import("@/components/forms/aral-weekly-attendance-grid-form").AralWeeklyAttendanceGridFormHandle;

// A past week, so no day is locked as "Not yet".
const WEEK = "2026-09-07";
const LEARNERS = [
  {
    id: "l1",
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    sectionName: "Grade 1 · A",
    gradeId: "g1",
  },
  {
    id: "l2",
    fullName: "Ben Cruz",
    listingName: "Cruz, Ben",
    sectionName: "Grade 2 · B",
    gradeId: "g2",
    // Grade 2 keeps Tuesday as a holiday; Grade 1 does not.
    holidayKeys: ["2026-09-08"],
  },
];

function renderGrid() {
  const ref = createRef<Handle>();
  render(
    <AralWeeklyAttendanceGridForm
      ref={ref}
      gradeId="all"
      weekStartKey={WEEK}
      learners={LEARNERS}
      existing={[]}
      holidayKeys={[]}
      showSection
    />
  );
  return ref;
}

beforeEach(() => {
  saveAralWeeklyAttendance.mockReset();
  toastFailure.mockReset();
});
afterEach(cleanup);

function selectAll() {
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all learners" }));
}

describe("all-grades weekly attendance grid", () => {
  it("locks a grade's holiday on that grade's rows only", () => {
    renderGrid();
    expect(
      screen.getByRole("button", {
        name: "Ana Santos attendance for Tuesday, Sep 8: No Class",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Ben Cruz attendance for Tuesday, Sep 8/ })
    ).toBeNull();
  });

  it("saves each grade's cells in its own call, skipping the other grade's holiday", async () => {
    saveAralWeeklyAttendance.mockResolvedValue({ ok: true, upserted: 1, cleared: 0 });
    const ref = renderGrid();
    selectAll();
    ref.current!.applyBulk({ kind: "status", status: "PRESENT" });
    await waitFor(() => expect(ref.current).toBeTruthy());
    await ref.current!.persist();

    expect(saveAralWeeklyAttendance).toHaveBeenCalledTimes(2);
    const calls = saveAralWeeklyAttendance.mock.calls.map(
      (c) => c[0] as { gradeId: string; cells: { learnerId: string; date: string }[] }
    );
    const g1 = calls.find((c) => c.gradeId === "g1")!;
    const g2 = calls.find((c) => c.gradeId === "g2")!;
    expect(g1.cells.every((c) => c.learnerId === "l1")).toBe(true);
    expect(g2.cells.every((c) => c.learnerId === "l2")).toBe(true);
    expect(g1.cells.map((c) => c.date)).toContain("2026-09-08");
    expect(g2.cells.map((c) => c.date)).not.toContain("2026-09-08");
  });

  it("keeps a grade that failed unsaved while the grade that saved stays saved", async () => {
    saveAralWeeklyAttendance.mockImplementation(async (input: { gradeId: string }) =>
      input.gradeId === "g1"
        ? { ok: true, upserted: 5, cleared: 0 }
        : { ok: false, code: "SYSTEM", error: "Could not save" }
    );
    const ref = renderGrid();
    selectAll();
    ref.current!.applyBulk({ kind: "status", status: "PRESENT" });
    await waitFor(() => expect(ref.current).toBeTruthy());
    expect(await ref.current!.persist()).toBe(false);
    expect(toastFailure).toHaveBeenCalledTimes(1);

    // The retry sends only the grade that failed.
    saveAralWeeklyAttendance.mockClear();
    saveAralWeeklyAttendance.mockResolvedValue({ ok: true, upserted: 4, cleared: 0 });
    await waitFor(async () => {
      expect(await ref.current!.persist()).toBe(true);
    });
    const grades = saveAralWeeklyAttendance.mock.calls.map(
      (c) => (c[0] as { gradeId: string }).gradeId
    );
    expect(grades).toEqual(["g2"]);
  });
});
