import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The School Head's panel of teachers' waiting transfer requests. A request an
 * approval would refuse (stale) is flagged and left out of a bulk approve; it
 * can still be declined.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/learners",
  useSearchParams: () => new URLSearchParams(""),
  unstable_isUnrecognizedActionError: () => false,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));

vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));

const approveSectionTransferRequests = vi.fn();
const declineSectionTransferRequests = vi.fn();
vi.mock("@/lib/actions/section-transfer", () => ({
  approveSectionTransferRequests: (input: unknown) => approveSectionTransferRequests(input),
  declineSectionTransferRequests: (input: unknown) => declineSectionTransferRequests(input),
}));

import {
  READ_ONLY_CAPTION,
  TransferRequestsPanel,
} from "@/components/school-head/learners/transfer-requests-panel";
import type { PendingTransferRequestRow } from "@/lib/learners/section-transfer-queries";

function row(over: Partial<PendingTransferRequestRow> & { id: string; name: string }): PendingTransferRequestRow {
  const { id, name, ...rest } = over;
  return {
    id,
    learner: { id: `learner-${id}`, fullName: name, gradeLevelId: "g3", gradeType: "G3" },
    fromSection: { id: "s-from", name: "Sampaguita" },
    toSection: { id: "s-to", name: "Rosal", adviser: { id: "t2", fullName: "Ben Reyes" } },
    requestedBy: { id: "t1", fullName: "Ana Cruz" },
    reason: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    staleReason: null,
    ...rest,
  };
}

const OK_ROW = row({ id: "r1", name: "Ana Santos", reason: "Moved house" });
const OK_ROW_2 = row({ id: "r2", name: "Ben Lim" });
const STALE_ROW = row({ id: "r3", name: "Cara Dee", staleReason: "moved-since-request" });

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("TransferRequestsPanel — empty and read-only states", () => {
  it("shows a single line when no request is waiting", () => {
    render(<TransferRequestsPanel requests={[]} readOnly={false} />);
    expect(screen.getByText("No transfer requests waiting.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve selected/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the load-failed line instead of the empty line", () => {
    render(<TransferRequestsPanel requests={[]} readOnly={false} loadFailed />);
    expect(screen.getByText("Could not load transfer requests right now.")).toBeTruthy();
    expect(screen.queryByText("No transfer requests waiting.")).toBeNull();
  });

  it("is read-only for a Super Admin: caption, no checkboxes, no buttons", () => {
    render(<TransferRequestsPanel requests={[OK_ROW]} readOnly />);
    expect(screen.getByText(READ_ONLY_CAPTION)).toBeTruthy();
    expect(screen.getByText("Ana Santos")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TransferRequestsPanel — truncation", () => {
  it("says it shows only the oldest requests when the school has more waiting", () => {
    render(<TransferRequestsPanel requests={[OK_ROW, OK_ROW_2]} readOnly={false} totalCount={5} />);
    expect(
      screen.getByText("Showing the oldest 2 of 5 requests. Approve or decline these to see the rest.")
    ).toBeTruthy();
  });

  it("shows no truncation line when every waiting request is listed", () => {
    render(<TransferRequestsPanel requests={[OK_ROW, OK_ROW_2]} readOnly={false} totalCount={2} />);
    expect(screen.queryByText(/Showing the oldest/)).toBeNull();
  });

  it("shows no truncation line when no total is given", () => {
    render(<TransferRequestsPanel requests={[OK_ROW]} readOnly={false} />);
    expect(screen.queryByText(/Showing the oldest/)).toBeNull();
  });
});

describe("TransferRequestsPanel — rows", () => {
  it("shows learner, from and to sections, adviser, requester and note", () => {
    render(<TransferRequestsPanel requests={[OK_ROW]} readOnly={false} />);
    expect(screen.getByText("Ana Santos")).toBeTruthy();
    expect(screen.getByText(/Grade 3/)).toBeTruthy();
    // "Sampaguita [arrow] Rosal Adviser: Ben Reyes" share one paragraph.
    const route = screen.getByText(/Adviser: Ben Reyes/).closest("p");
    expect(route?.textContent).toMatch(/^Sampaguita\s*Rosal/);
    expect(screen.getByText(/Requested by Ana Cruz/)).toBeTruthy();
    expect(screen.getByText("Note: Moved house")).toBeTruthy();
  });

  it("flags a stale request with its reason and disables its Approve", () => {
    render(<TransferRequestsPanel requests={[STALE_ROW]} readOnly={false} />);
    expect(screen.getByText(/Can't approve:/)).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve the transfer of Cara Dee" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    // Declining is still possible.
    const decline = screen.getByRole("button", { name: "Decline the transfer of Cara Dee" }) as HTMLButtonElement;
    expect(decline.disabled).toBe(false);
  });
});

describe("TransferRequestsPanel — bulk approve", () => {
  it("leaves stale rows out of Approve selected and says so", async () => {
    approveSectionTransferRequests.mockResolvedValue({ ok: true, data: { approved: 2 } });
    render(<TransferRequestsPanel requests={[OK_ROW, OK_ROW_2, STALE_ROW]} readOnly={false} />);

    // Nothing picked yet.
    expect((screen.getByRole("button", { name: "Approve selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decline selected (0)" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all transfer requests" }));

    // Three picked, but only the two non-stale count toward Approve.
    const approveAll = screen.getByRole("button", { name: "Approve selected (2)" }) as HTMLButtonElement;
    expect(approveAll.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Decline selected (3)" })).toBeTruthy();
    expect(screen.getByText(/1 flagged request is left out of Approve selected\. Decline it instead\./)).toBeTruthy();

    fireEvent.click(approveAll);
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Approve 2 transfers?")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve and transfer" }));

    await waitFor(() => expect(approveSectionTransferRequests).toHaveBeenCalledTimes(1));
    expect(approveSectionTransferRequests).toHaveBeenCalledWith({ requestIds: ["r1", "r2"] });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("2 requests approved. The learners have moved."));
  });

  it("disables Approve selected when only stale rows are picked", () => {
    render(<TransferRequestsPanel requests={[OK_ROW, STALE_ROW]} readOnly={false} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select the request for Cara Dee" }));
    expect((screen.getByRole("button", { name: "Approve selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decline selected (1)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the confirm open and reports no success when the approval fails", async () => {
    approveSectionTransferRequests.mockResolvedValue({
      ok: false,
      code: "TRANSFER_REQUESTS_CHANGED",
      error: "Some of these were already changed or decided. Refresh to see the current list.",
    });
    render(<TransferRequestsPanel requests={[OK_ROW]} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve the transfer of Ana Santos" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Approve this transfer?")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve and transfer" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("TransferRequestsPanel — decline", () => {
  it("declines every picked row, stale ones included, with an optional note", async () => {
    declineSectionTransferRequests.mockResolvedValue({ ok: true, data: { declined: 2 } });
    render(<TransferRequestsPanel requests={[OK_ROW, STALE_ROW]} readOnly={false} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all transfer requests" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline selected (2)" }));

    fireEvent.click(await screen.findByRole("button", { name: "Decline requests" }));
    await waitFor(() => expect(declineSectionTransferRequests).toHaveBeenCalledTimes(1));
    expect(declineSectionTransferRequests).toHaveBeenCalledWith({ requestIds: ["r1", "r3"], note: undefined });
  });
});
