import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Transfer page workspace: send people to another school in the division,
 * cancel what is waiting, accept or decline what was sent here.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/transfer",
  useSearchParams: () => new URLSearchParams(""),
  unstable_isUnrecognizedActionError: () => false,
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));

vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));

const acceptSchoolTransfers = vi.fn();
const requestSchoolTransfers = vi.fn();
vi.mock("@/lib/actions/school-transfer", () => ({
  requestSchoolTransfers: (input: unknown) => requestSchoolTransfers(input),
  cancelSchoolTransfers: vi.fn(),
  declineSchoolTransfers: vi.fn(),
  acceptSchoolTransfers: (input: unknown) => acceptSchoolTransfers(input),
}));

import { TransferWorkspace, type TransferWorkspaceProps } from "@/components/transfers/transfer-workspace";
import type { TransferRow } from "@/lib/transfers/queries";

const desktop = () => document.querySelector("table") as HTMLElement;

function incoming(id: string, name: string): TransferRow {
  return {
    id,
    batchId: "b1",
    personName: name,
    detail: "Grade 4 · Mabini",
    otherSchoolName: "Alpha ES",
    status: "PENDING",
    reason: null,
    decisionNote: null,
    createdAt: new Date("2026-11-20T02:00:00Z").toISOString(),
    expiresAt: new Date("2026-12-20T02:00:00Z").toISOString(),
    requestedByName: "Head A",
    direction: "incoming",
  };
}

function props(over: Partial<TransferWorkspaceProps> = {}): TransferWorkspaceProps {
  return {
    schoolId: "school-b",
    kind: "LEARNER",
    division: "Division of X",
    targets: [{ id: "school-c", name: "Charlie ES" }],
    candidates: [
      { id: "l1", name: "Cruz, Ana", detail: "Grade 4 · Mabini", pendingTo: null, group: "Grade 4" },
      { id: "l2", name: "Dela Cruz, Ben", detail: "Grade 4 · Mabini", pendingTo: null, group: "Grade 4" },
      { id: "l3", name: "Reyes, Carla", detail: "Grade 5 · Rizal", pendingTo: "Charlie ES", group: "Grade 5" },
    ],
    rows: { outgoing: [], incoming: [], history: [] },
    placement: {
      grades: [
        { id: "g4", label: "Grade 4", sections: [{ id: "s1", name: "Mabini", adviserName: null }] },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  refresh.mockReset();
  toastSuccess.mockReset();
  acceptSchoolTransfers.mockReset();
  requestSchoolTransfers.mockReset();
});
afterEach(cleanup);

describe("TransferWorkspace", () => {
  it("counts ticked people on the send button", () => {
    render(<TransferWorkspace {...props()} />);
    const table = desktop();
    const button = screen.getByRole("button", { name: "Transfer to another school (0)" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(table).getByRole("checkbox", { name: "Select Cruz, Ana" }));
    fireEvent.click(within(table).getByRole("checkbox", { name: "Select Dela Cruz, Ben" }));
    expect((screen.getByRole("button", { name: "Transfer to another school (2)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks a person whose transfer is already waiting", () => {
    render(<TransferWorkspace {...props()} />);
    const table = desktop();
    expect((within(table).getByRole("checkbox", { name: "Select Reyes, Carla" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(table).getByText(/Pending → Charlie ES/)).toBeTruthy();
  });

  it("select all leaves out the locked person", () => {
    render(<TransferWorkspace {...props()} />);
    fireEvent.click(within(desktop()).getByRole("checkbox", { name: "Select all learners" }));
    expect((screen.getByRole("button", { name: "Transfer to another school (2)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks for a section before a learner can be accepted", async () => {
    acceptSchoolTransfers.mockResolvedValue({ ok: true, data: { accepted: 1, skipped: [] } });
    render(<TransferWorkspace {...props({ rows: { outgoing: [], incoming: [incoming("t1", "Santos, Dan")], history: [] } })} />);

    // Incoming opens first when something is waiting.
    expect(screen.getByRole("tab", { name: /Incoming/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(desktop()).getByRole("checkbox", { name: "Select Santos, Dan" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept (1)" }));

    const dialog = await screen.findByRole("dialog");
    const accept = within(dialog).getByRole("button", { name: "Accept" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Grade"), { target: { value: "g4" } });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "s1" } });
    expect(within(dialog).getByText(/No adviser yet/)).toBeTruthy();
    expect((accept as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(accept);
    await waitFor(() =>
      expect(acceptSchoolTransfers).toHaveBeenCalledWith({
        schoolId: "school-b",
        ids: ["t1"],
        placement: { gradeLevelId: "g4", sectionId: "s1" },
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1 learner joined your school."));
    expect(refresh).toHaveBeenCalled();
  });

  it("names the skipped reasons after an accept", async () => {
    acceptSchoolTransfers.mockResolvedValue({
      ok: true,
      data: { accepted: 1, skipped: [{ id: "t2", reason: "EXPIRED" }] },
    });
    render(
      <TransferWorkspace
        {...props({
          kind: "TEACHER",
          rows: { outgoing: [], incoming: [incoming("t1", "Ramos, Eve"), incoming("t2", "Lim, Fe")], history: [] },
        })}
      />
    );
    fireEvent.click(within(desktop()).getByRole("checkbox", { name: "Select all incoming teacher transfers" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept (2)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "1 teacher joined your school. 1 skipped: Expired before it was answered."
      )
    );
    expect(acceptSchoolTransfers).toHaveBeenCalledWith({ schoolId: "school-b", ids: ["t1", "t2"], placement: undefined });
  });

  it("narrows a big school's list by name and grade, drawing at most 100 rows", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `m${i}`,
      name: `Learner ${String(i).padStart(3, "0")}`,
      detail: i < 120 ? "Grade 1 · A" : "Grade 2 · B",
      pendingTo: null,
      group: i < 120 ? "Grade 1" : "Grade 2",
    }));
    render(<TransferWorkspace {...props({ candidates: many })} />);
    expect(within(desktop()).getAllByRole("row")).toHaveLength(101);
    expect(screen.getByText("Showing 100 of 150. Search or pick a grade to narrow the list.")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Grade" }), { target: { value: "Grade 2" } });
    expect(within(desktop()).getAllByRole("row")).toHaveLength(31);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search learners" }), { target: { value: "learner 149" } });
    expect(within(desktop()).getAllByRole("row")).toHaveLength(2);
    // Select all takes only what is on screen.
    fireEvent.click(within(desktop()).getByRole("checkbox", { name: "Select all learners" }));
    expect(screen.getByRole("button", { name: "Transfer to another school (1)" })).toBeTruthy();
  });

  it("tells a school with no division to set one", () => {
    render(<TransferWorkspace {...props({ division: null, targets: [] })} />);
    expect(screen.getByText(/Set this school's division before transferring/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Transfer to another school/ })).toBeNull();
  });

  it("shows the empty incoming list", () => {
    render(<TransferWorkspace {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Incoming/ }));
    expect(screen.getByText("No incoming transfers.")).toBeTruthy();
  });

  it("sends the ticked people to the chosen school", async () => {
    requestSchoolTransfers.mockResolvedValue({ ok: true, data: { batchId: "b", count: 1 } });
    render(<TransferWorkspace {...props()} />);
    fireEvent.click(within(desktop()).getByRole("checkbox", { name: "Select Cruz, Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer to another school (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send transfer" }));
    expect(dialog.querySelector("#transfer-to-school-error")?.textContent).toBe("Choose a school");
    expect(requestSchoolTransfers).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search schools" }), { target: { value: "charlie" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Charlie ES" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send transfer" }));
    await waitFor(() =>
      expect(requestSchoolTransfers).toHaveBeenCalledWith({
        schoolId: "school-b",
        toSchoolId: "school-c",
        kind: "LEARNER",
        ids: ["l1"],
        reason: undefined,
      })
    );
  });
});
