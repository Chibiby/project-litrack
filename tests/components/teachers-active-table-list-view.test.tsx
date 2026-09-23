import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The below-`lg` stacked `<ul>` in `TeachersManagedTable` (below the `lg`
 * table, `aria-label="Active teachers"`) duplicates the desktop table's rows.
 * These tests fail if that list block is removed: they assert the list
 * carries the same row data as the table, and that its Remove button is
 * wired to the very same `removeTeacher` action mock the desktop table uses.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/teachers",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const okResult = { ok: true as const };
const removeTeacher = vi.fn(async (_fd: FormData) => okResult);
vi.mock("@/lib/actions/school-head", () => ({
  clearRejectedTeacher: vi.fn(async () => okResult),
  removeTeacher: (fd: FormData) => removeTeacher(fd),
  setTeacherActive: vi.fn(async () => okResult),
}));
vi.mock("@/lib/actions/teacher", () => ({
  setTeacherAdvisorySection: vi.fn(async () => okResult),
  setTeacherAdvisorySetting: vi.fn(async () => okResult),
}));
vi.mock("@/lib/actions/avatar", () => ({
  removeUserAvatar: vi.fn(async () => ({ ok: true, dryRun: false })),
}));

const { TeachersActiveTable } = await import("@/components/teachers-active-table");
type ActiveTeacherRowType = Parameters<typeof TeachersActiveTable>[0]["rows"][number];

const ROWS: ActiveTeacherRowType[] = [
  {
    id: "teacher-1",
    fullName: "Marivic Santos Cruz",
    listingName: "Cruz, Marivic Santos",
    email: "marivic@example.test",
    avatarPath: null,
    profileCompleted: true,
    approvedAt: "2026-06-01T00:00:00.000Z",
    learnerCount: 20,
    aralLearnerCount: 2,
    designation: "Teacher",
    advisoryMode: "DEFAULT",
    assignments: [{ sectionId: "sec-1", gradeName: "Grade 4", sectionName: "Sampaguita" }],
  },
  {
    id: "teacher-2",
    fullName: "Jose Reyes",
    listingName: "Reyes, Jose",
    email: "jose@example.test",
    avatarPath: null,
    profileCompleted: false,
    approvedAt: null,
    learnerCount: 0,
    aralLearnerCount: 0,
    designation: null,
    advisoryMode: null,
    assignments: [],
  },
];

const ADVISORY_OPTIONS = [
  {
    gradeLabel: "Grade 4",
    sections: [
      { id: "sec-1", name: "Sampaguita", adviserId: "teacher-1", adviserName: "Cruz, Marivic Santos" },
      { id: "sec-2", name: "Rosal", adviserId: null, adviserName: null },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeachersActiveTable — mobile list view", () => {
  it("renders the same row data as the desktop table", () => {
    render(<TeachersActiveTable rows={ROWS} advisoryOptions={ADVISORY_OPTIONS} />);

    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "Active teachers" });

    for (const row of ROWS) {
      expect(within(table).getByText(row.listingName)).not.toBeNull();
      expect(within(list).getByText(row.listingName)).not.toBeNull();
      expect(within(table).getByText(row.email)).not.toBeNull();
      expect(within(list).getByText(row.email)).not.toBeNull();
    }

    // Same row count in both views.
    expect(within(table).getAllByRole("row")).toHaveLength(ROWS.length + 1); // + header row
    expect(list.querySelectorAll("li")).toHaveLength(ROWS.length);
  });

  it("wires the list's Remove button to the same removeTeacher action the table uses", async () => {
    render(<TeachersActiveTable rows={ROWS} advisoryOptions={ADVISORY_OPTIONS} />);

    // teacher-2 has no ARAL learners, so Remove is not blocked (teacher-1's
    // `aralLearnerCount: 2` disables the trigger and would never open the
    // dialog — see `blockedReason` in `TeacherManageButtons`).
    const list = screen.getByRole("list", { name: "Active teachers" });
    const listItem = within(list).getByText("Reyes, Jose").closest("li");
    expect(listItem).not.toBeNull();

    fireEvent.click(
      within(listItem as HTMLElement).getByRole("button", { name: "Remove" })
    );

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() => {
      expect(removeTeacher).toHaveBeenCalledTimes(1);
    });
    const fd = removeTeacher.mock.calls[0][0] as FormData;
    expect(fd.get("userId")).toBe("teacher-2");
  });

  it("gives the mobile advisory select a unique id, distinct from the desktop one", () => {
    render(<TeachersActiveTable rows={ROWS} advisoryOptions={ADVISORY_OPTIONS} />);

    const desktopSelect = document.querySelector("#advisory-add-teacher-1");
    const mobileSelect = document.querySelector("#advisory-add-m-teacher-1");

    expect(desktopSelect).not.toBeNull();
    expect(mobileSelect).not.toBeNull();
    expect(mobileSelect).not.toBe(desktopSelect);
    expect(mobileSelect?.id).not.toBe(desktopSelect?.id);
  });
});
