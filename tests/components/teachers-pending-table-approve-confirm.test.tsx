import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const approveTeacher = vi.fn();
vi.mock("@/lib/actions/school-head", () => ({
  approveTeacher: (fd: FormData) => approveTeacher(fd),
  rejectTeacher: vi.fn(async () => ({ ok: true })),
}));

const { TeachersPendingTable } = await import("@/components/teachers-pending-table");

const ROWS = [
  { id: "teacher-1", fullName: "Ana Dela Cruz", email: "ana@example.test", requestedAt: "2026-06-01T00:00:00.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function openConfirm() {
  render(<TeachersPendingTable rows={ROWS} />);
  const list = screen.getByRole("list", { name: "Pending requests" });
  fireEvent.click(within(list).getByRole("button", { name: "Approve" }));
}

describe("TeachersPendingTable approve confirm", () => {
  it("names the person and email and states the consequence before calling the server", async () => {
    openConfirm();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Ana Dela Cruz");
    expect(dialog.textContent).toContain("ana@example.test");
    expect(dialog.textContent).toContain("see this school's learners");
    expect(approveTeacher).not.toHaveBeenCalled();
  });

  it("keeps the row when the server fails", async () => {
    approveTeacher.mockResolvedValue({
      ok: false,
      code: "UNKNOWN",
      error: "Could not approve.",
    });
    openConfirm();
    fireEvent.click(await screen.findByRole("button", { name: "Approve teacher" }));
    await vi.waitFor(() => expect(approveTeacher).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve teacher" })).not.toBeNull()
    );
    expect(screen.getAllByText("Ana Dela Cruz").length).toBeGreaterThan(0);
  });

  it("removes the row only after the server approves", async () => {
    approveTeacher.mockResolvedValue({ ok: true });
    openConfirm();
    fireEvent.click(await screen.findByRole("button", { name: "Approve teacher" }));
    await vi.waitFor(() => expect(screen.queryAllByText("Ana Dela Cruz")).toHaveLength(0));
  });

  it("moves focus to the next row's Approve button and announces the result", async () => {
    approveTeacher.mockResolvedValue({ ok: true });
    const rows = [
      ...ROWS,
      { id: "teacher-2", fullName: "Ben Reyes", email: "ben@example.test", requestedAt: "2026-06-02T00:00:00.000Z" },
    ];
    render(<TeachersPendingTable rows={rows} />);
    const list = screen.getByRole("list", { name: "Pending requests" });
    fireEvent.click(within(list).getAllByRole("button", { name: "Approve" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve teacher" }));
    await vi.waitFor(() => expect(screen.queryAllByText("Ana Dela Cruz")).toHaveLength(0));
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("data-approve-for")).toBe("teacher-2")
    );
    expect(screen.getByRole("status").textContent).toBe("Ana Dela Cruz approved");
  });

  it("moves focus to the list heading when no rows remain", async () => {
    approveTeacher.mockResolvedValue({ ok: true });
    openConfirm();
    fireEvent.click(await screen.findByRole("button", { name: "Approve teacher" }));
    await vi.waitFor(() => expect(screen.queryAllByText("Ana Dela Cruz")).toHaveLength(0));
    const heading = screen.getByRole("heading", { name: /Pending requests/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });
});
