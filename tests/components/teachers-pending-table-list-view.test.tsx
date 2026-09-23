import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The below-`lg` stacked `<ul aria-label="Pending requests">` in
 * `TeachersPendingTable` duplicates the desktop table's rows. These tests
 * fail if that list block is removed.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const okResult = { ok: true as const };
const approveTeacher = vi.fn(async (_fd: FormData) => okResult);
vi.mock("@/lib/actions/school-head", () => ({
  approveTeacher: (fd: FormData) => approveTeacher(fd),
  rejectTeacher: vi.fn(async () => okResult),
}));

const { TeachersPendingTable } = await import("@/components/teachers-pending-table");
type PendingTeacherRowType = Parameters<typeof TeachersPendingTable>[0]["rows"][number];

const ROWS: PendingTeacherRowType[] = [
  { id: "teacher-1", fullName: "Ana Dela Cruz", email: "ana@example.test", requestedAt: "2026-06-01T00:00:00.000Z" },
  { id: "teacher-2", fullName: "Ben Torres", email: "ben@example.test", requestedAt: "2026-06-02T00:00:00.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeachersPendingTable — mobile list view", () => {
  it("renders the same row data as the desktop table", () => {
    render(<TeachersPendingTable rows={ROWS} />);

    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "Pending requests" });

    for (const row of ROWS) {
      expect(within(table).getByText(row.fullName)).not.toBeNull();
      expect(within(list).getByText(row.fullName)).not.toBeNull();
      expect(within(table).getByText(row.email)).not.toBeNull();
      expect(within(list).getByText(row.email)).not.toBeNull();
    }

    expect(within(table).getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(list.querySelectorAll("li")).toHaveLength(ROWS.length);
  });

  it("wires the list's Approve button to the same approveTeacher action the table uses", async () => {
    render(<TeachersPendingTable rows={ROWS} />);

    const list = screen.getByRole("list", { name: "Pending requests" });
    const listItem = within(list).getByText("Ana Dela Cruz").closest("li");
    expect(listItem).not.toBeNull();

    fireEvent.click(
      within(listItem as HTMLElement).getByRole("button", { name: "Approve" })
    );

    await vi.waitFor(() => {
      expect(approveTeacher).toHaveBeenCalledTimes(1);
    });
    const fd = approveTeacher.mock.calls[0][0] as FormData;
    expect(fd.get("userId")).toBe("teacher-1");
  });
});
