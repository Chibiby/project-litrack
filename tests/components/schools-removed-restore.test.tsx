import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/management/schools",
  useSearchParams: () => new URLSearchParams(""),
  unstable_isUnrecognizedActionError: () => false,
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const restoreSchool = vi.fn();
vi.mock("@/lib/actions/school", () => ({
  deleteSchool: vi.fn(),
  regenerateSchoolHeadCredential: vi.fn(),
  restoreSchool: (...args: unknown[]) => restoreSchool(...args),
}));

vi.mock("@/lib/actions/school-management", () => ({
  setSchoolActive: vi.fn(),
}));

const { RemovedSchoolsTable, SchoolsViewTabs } = await import("@/components/removed-schools");
const { SchoolsTable } = await import("@/components/schools-table");

const ROW = {
  id: "school-9",
  name: "Old Town ES",
  schoolIdCode: "100200",
  isDemo: false,
  removedAt: "2026-09-01T02:00:00.000Z",
  users: 4,
  learners: 88,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("SchoolsViewTabs", () => {
  it("links Active to the list and Removed to ?view=removed, marking the current one", () => {
    render(<SchoolsViewTabs view="removed" />);
    const removed = screen.getByRole("link", { name: "Removed" });
    const active = screen.getByRole("link", { name: "Active" });
    expect(removed.getAttribute("href")).toBe("/admin/management/schools?view=removed");
    expect(active.getAttribute("href")).toBe("/admin/management/schools");
    expect(removed.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("aria-current")).toBeNull();
  });
});

describe("RemovedSchoolsTable", () => {
  it("shows an empty state", () => {
    render(<RemovedSchoolsTable schools={[]} />);
    expect(screen.getByText(/No removed schools/)).toBeTruthy();
  });

  it("lists name, School ID, removed date, users and learners", () => {
    render(<RemovedSchoolsTable schools={[ROW]} />);
    expect(screen.getByText("Old Town ES")).toBeTruthy();
    expect(screen.getByText("100200")).toBeTruthy();
    expect(screen.getByText(/Sep 1, 2026/)).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("88")).toBeTruthy();
  });

  it("confirms with the turned-off warning, then restores", async () => {
    restoreSchool.mockResolvedValueOnce(undefined);
    render(<RemovedSchoolsTable schools={[ROW]} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore Old Town ES" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Restore Old Town ES?")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "It comes back turned off, so no one can sign in until you turn it on."
    );
    expect(restoreSchool).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreSchool).toHaveBeenCalledTimes(1));
    const fd = restoreSchool.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("school-9");
    await waitFor(() => expect(toastFn.success).toHaveBeenCalled());
  });

  it("keeps the dialog open and announces no success when restore fails", async () => {
    restoreSchool.mockResolvedValueOnce({
      ok: false,
      code: "DB_UNAVAILABLE",
      error: "Couldn't restore the school.",
    });
    render(<RemovedSchoolsTable schools={[ROW]} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore Old Town ES" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Couldn't restore the school.", {
        id: "DB_UNAVAILABLE",
      })
    );
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("SchoolsTable remove dialog", () => {
  it("points to the Removed tab instead of support", async () => {
    render(
      <SchoolsTable
        schools={[
          {
            id: "s1",
            name: "Live ES",
            schoolIdCode: "1",
            region: null,
            division: null,
            isActive: true,
            users: 1,
            learners: 1,
            isDemo: false,
          },
        ]}
        list={{ page: 1, totalPages: 1, totalCount: 1, pageSize: 10, q: "", region: "", status: "" }}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Remove Live ES" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("You can restore it from the Removed tab.");
    expect(dialog.textContent).not.toContain("support");
  });
});
