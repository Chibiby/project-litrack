import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The below-`lg` stacked `<ul>`s in `TeachersRemovedTable`
 * (`aria-label="Removed teachers"`) and `TeachersDeclinedTable`
 * (`aria-label="Declined"`) duplicate their desktop tables' rows. These
 * tests fail if either list block is removed.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const okResult = { ok: true as const };
const clearRejectedTeacher = vi.fn(async (_fd: FormData) => okResult);
vi.mock("@/lib/actions/school-head", () => ({
  clearRejectedTeacher: (fd: FormData) => clearRejectedTeacher(fd),
}));

const { TeachersRemovedTable, TeachersDeclinedTable } = await import(
  "@/components/teachers-active-table"
);
type RemovedTeacherRowType = Parameters<typeof TeachersRemovedTable>[0]["rows"][number];
type DeclinedTeacherRowType = Parameters<typeof TeachersDeclinedTable>[0]["rows"][number];

const REMOVED_ROWS: RemovedTeacherRowType[] = [
  { id: "teacher-1", fullName: "Carla Reyes", email: "carla@example.test", removedAt: "2026-06-01T00:00:00.000Z" },
  { id: "teacher-2", fullName: "Dado Lim", email: null, removedAt: "2026-06-02T00:00:00.000Z" },
];

const DECLINED_ROWS: DeclinedTeacherRowType[] = [
  { id: "teacher-3", fullName: "Elsa Ramos", email: "elsa@example.test", rejectedAt: "2026-06-03T00:00:00.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(cleanup);

describe("TeachersRemovedTable — mobile list view", () => {
  it("renders the same row data as the desktop table", () => {
    render(<TeachersRemovedTable rows={REMOVED_ROWS} />);

    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "Removed teachers" });

    expect(within(table).getByText("Carla Reyes")).not.toBeNull();
    expect(within(list).getByText("Carla Reyes")).not.toBeNull();
    expect(within(table).getByText("Dado Lim")).not.toBeNull();
    expect(within(list).getByText("Dado Lim")).not.toBeNull();

    expect(within(table).getAllByRole("row")).toHaveLength(REMOVED_ROWS.length + 1);
    expect(list.querySelectorAll("li")).toHaveLength(REMOVED_ROWS.length);
  });
});

describe("TeachersDeclinedTable — mobile list view", () => {
  it("renders the same row data as the desktop table", () => {
    render(<TeachersDeclinedTable rows={DECLINED_ROWS} />);

    const table = screen.getByRole("table");
    const list = screen.getByRole("list", { name: "Declined" });

    expect(within(table).getByText("Elsa Ramos")).not.toBeNull();
    expect(within(list).getByText("Elsa Ramos")).not.toBeNull();

    expect(within(table).getAllByRole("row")).toHaveLength(DECLINED_ROWS.length + 1);
    expect(list.querySelectorAll("li")).toHaveLength(DECLINED_ROWS.length);
  });

  it("wires the list's Allow re-register button to the same clearRejectedTeacher action the table uses", async () => {
    render(<TeachersDeclinedTable rows={DECLINED_ROWS} />);

    const list = screen.getByRole("list", { name: "Declined" });
    const listItem = within(list).getByText("Elsa Ramos").closest("li");
    expect(listItem).not.toBeNull();

    fireEvent.click(
      within(listItem as HTMLElement).getByRole("button", { name: "Allow re-register" })
    );

    await vi.waitFor(() => {
      expect(clearRejectedTeacher).toHaveBeenCalledTimes(1);
    });
    const fd = clearRejectedTeacher.mock.calls[0][0] as FormData;
    expect(fd.get("userId")).toBe("teacher-3");
  });
});
