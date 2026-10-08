import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared section-transfer dialog (School Head: move now; teacher: send a
 * request). The server action decides everything that matters, so these cases
 * pin what the dialog itself owns: no pre-selection, what blocks Submit, what
 * is listed as left out, and that it only reports success after the action
 * resolved ok.
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

const invalidateNavWarm = vi.fn();
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: () => invalidateNavWarm(),
}));

const transferLearnersToSection = vi.fn();
const requestSectionTransfers = vi.fn();
vi.mock("@/lib/actions/section-transfer", () => ({
  transferLearnersToSection: (input: unknown) => transferLearnersToSection(input),
  requestSectionTransfers: (input: unknown) => requestSectionTransfers(input),
}));

import { TransferLearnersDialog } from "@/components/learners/transfer-learners-dialog";
import type {
  TransferCandidate,
  TransferDestination,
} from "@/components/learners/transfer-eligibility";

function candidate(over: Partial<TransferCandidate> = {}): TransferCandidate {
  return {
    id: "l1",
    name: "Ana Santos",
    gradeLevelId: "g3",
    gradeLabel: "Grade 3",
    gradeType: "G3",
    sectionId: "s-sampaguita",
    archived: false,
    pendingRequest: false,
    ...over,
  };
}

const DESTINATIONS: TransferDestination[] = [
  { id: "s-sampaguita", name: "Sampaguita", gradeLevelId: "g3", adviser: { id: "t1", fullName: "Ana Cruz" } },
  { id: "s-rosal", name: "Rosal", gradeLevelId: "g3", adviser: { id: "t2", fullName: "Ben Reyes" } },
  { id: "s-ilang", name: "Ilang-Ilang", gradeLevelId: "g3", adviser: null },
  { id: "s-g4", name: "Mabini", gradeLevelId: "g4", adviser: { id: "t3", fullName: "Cora Diaz" } },
];

function renderDialog(
  props: Partial<React.ComponentProps<typeof TransferLearnersDialog>> = {}
) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <TransferLearnersDialog
      mode="transfer"
      candidates={[candidate()]}
      destinations={DESTINATIONS}
      open
      onClose={onClose}
      onDone={onDone}
      {...props}
    />
  );
  return { ...view, onClose, onDone };
}

const submitButton = (name: RegExp | string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("TransferLearnersDialog — choosing a section", () => {
  it("preselects nothing and keeps Submit disabled until a section is chosen", () => {
    renderDialog({ candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Ben Lim" })] });

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) expect(r.getAttribute("aria-checked")).toBe("false");
    expect(submitButton("Transfer 2 learners").disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(submitButton("Transfer 2 learners").disabled).toBe(false);
  });

  it("offers only sections of the learners' grade and disables the current and adviserless ones", () => {
    renderDialog();

    expect(screen.queryByRole("radio", { name: /Mabini/ })).toBeNull();
    const current = screen.getByRole("radio", { name: /Sampaguita/ }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(screen.getByText("Current section")).toBeTruthy();
    const noAdviser = screen.getByRole("radio", { name: /Ilang-Ilang/ }) as HTMLButtonElement;
    expect(noAdviser.disabled).toBe(true);
    expect(screen.getByText(/No adviser yet — assign one in School Setup/)).toBeTruthy();
    expect(screen.getByText("Adviser: Ben Reyes")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Rosal/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("previews the move and names the new adviser", () => {
    renderDialog({ candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Ben Lim" })] });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(screen.getByText(/Moves 2 learners to Rosal\. Their adviser becomes Ben Reyes\./)).toBeTruthy();
  });

  it("starts empty again each time it opens", () => {
    const { rerender, onClose, onDone } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(submitButton("Transfer learner").disabled).toBe(false);

    const props = { mode: "transfer" as const, candidates: [candidate()], destinations: DESTINATIONS, onClose, onDone };
    rerender(<TransferLearnersDialog {...props} open={false} />);
    rerender(<TransferLearnersDialog {...props} open />);

    for (const r of screen.getAllByRole("radio")) expect(r.getAttribute("aria-checked")).toBe("false");
    expect(submitButton("Transfer learner").disabled).toBe(true);
  });
});

describe("TransferLearnersDialog — selections that cannot go ahead", () => {
  it("blocks a mixed-grade selection and offers only Close", () => {
    renderDialog({
      candidates: [
        candidate({ id: "l1" }),
        candidate({ id: "l2", name: "Dan Go", gradeLevelId: "g4", gradeLabel: "Grade 4", gradeType: "G4", sectionId: "s-g4" }),
      ],
    });

    expect(screen.getByText(/These learners are in Grade 3 and Grade 4\. A transfer stays inside one grade/)).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Transfer \d* ?learner/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Request transfer/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("lists left-out rows with a reason and lets the rest go ahead", () => {
    renderDialog({
      candidates: [
        candidate({ id: "l1" }),
        candidate({ id: "l2", name: "Archie Old", archived: true }),
        candidate({ id: "l3", name: "Penny Wait", pendingRequest: true }),
        candidate({ id: "l4", name: "Flo Ating", gradeType: "FLOATING", sectionId: null }),
      ],
    });

    const leftOut = screen.getByRole("region", { name: "Left out" });
    expect(within(leftOut).getByText("Left out (3)")).toBeTruthy();
    expect(within(leftOut).getByText("Archie Old")).toBeTruthy();
    expect(within(leftOut).getByText("Archived")).toBeTruthy();
    expect(within(leftOut).getByText("Penny Wait")).toBeTruthy();
    expect(within(leftOut).getByText("A transfer request is already waiting")).toBeTruthy();
    expect(within(leftOut).getByText("Flo Ating")).toBeTruthy();
    expect(within(leftOut).getByText(/Floating/)).toBeTruthy();
    expect(within(leftOut).getByText("These stay where they are. The rest go ahead.")).toBeTruthy();

    // Only the one eligible learner is counted and sent.
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(submitButton("Transfer learner").disabled).toBe(false);
  });

  it("sends only the eligible learner ids", async () => {
    transferLearnersToSection.mockResolvedValue({ ok: true, data: { moved: 1, unchanged: 0, sectionName: "Rosal" } });
    renderDialog({
      candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Archie Old", archived: true })],
    });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Transfer learner"));
    await waitFor(() => expect(transferLearnersToSection).toHaveBeenCalledTimes(1));
    expect(transferLearnersToSection).toHaveBeenCalledWith({ learnerIds: ["l1"], toSectionId: "s-rosal" });
  });

  it("with nothing eligible, says so and offers only Close", () => {
    renderDialog({ candidates: [candidate({ archived: true })] });
    expect(screen.getByText("None of these learners can move")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Transfer learner/ })).toBeNull();
  });

  it("in request mode, lists a learner outside the teacher's advisory", () => {
    renderDialog({
      mode: "request",
      advisedSectionIds: ["s-sampaguita"],
      candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Zed Away", sectionId: "s-rosal" })],
    });
    const leftOut = screen.getByRole("region", { name: "Left out" });
    expect(within(leftOut).getByText("Zed Away")).toBeTruthy();
    expect(within(leftOut).getByText("Not in your advisory section")).toBeTruthy();
  });
});

describe("TransferLearnersDialog — request mode", () => {
  it("labels the request, shows the note counter and hides School Head wording", () => {
    renderDialog({
      mode: "request",
      advisedSectionIds: ["s-sampaguita"],
      candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Ben Lim" })],
    });

    expect(screen.getByText("Request a section transfer")).toBeTruthy();
    expect(screen.getByText(/No adviser yet$/)).toBeTruthy();
    expect(screen.queryByText(/School Setup/)).toBeNull();
    expect(screen.getByLabelText("Note for your School Head (optional)")).toBeTruthy();
    expect(screen.getByText("0 / 300")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Note for your School Head (optional)"), {
      target: { value: "Moved house" },
    });
    expect(screen.getByText("11 / 300")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(submitButton("Request transfer for 2 learners").disabled).toBe(false);
    expect(
      screen.getByText(/Sends 2 requests to your School Head\. The learners stay in your section until it is approved\./)
    ).toBeTruthy();
  });

  it("caps the note at 300 characters", () => {
    renderDialog({ mode: "request", advisedSectionIds: ["s-sampaguita"] });
    const note = screen.getByLabelText("Note for your School Head (optional)") as HTMLTextAreaElement;
    expect(note.maxLength).toBe(300);
  });

  it("does not show a note field when transferring directly", () => {
    renderDialog();
    expect(screen.queryByLabelText(/Note for your School Head/)).toBeNull();
  });

  it("sends the trimmed note with the request", async () => {
    requestSectionTransfers.mockResolvedValue({ ok: true, data: { requested: 1, unchanged: 0 } });
    renderDialog({ mode: "request", advisedSectionIds: ["s-sampaguita"] });
    fireEvent.change(screen.getByLabelText("Note for your School Head (optional)"), {
      target: { value: "  needs a calmer class  " },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Request transfer"));

    await waitFor(() => expect(requestSectionTransfers).toHaveBeenCalledTimes(1));
    expect(requestSectionTransfers).toHaveBeenCalledWith({
      learnerIds: ["l1"],
      toSectionId: "s-rosal",
      reason: "needs a calmer class",
    });
  });
});

describe("TransferLearnersDialog — outcomes", () => {
  it("reports success, closes and refreshes only after the action resolves ok", async () => {
    let settle: (v: unknown) => void = () => {};
    transferLearnersToSection.mockReturnValue(new Promise((r) => (settle = r)));
    const { onClose, onDone } = renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Transfer learner"));
    await waitFor(() => expect(transferLearnersToSection).toHaveBeenCalledTimes(1));

    // Still in flight: nothing has been announced, closed or cleared.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Transferring…")).toBeTruthy();

    settle({ ok: true, data: { moved: 1, unchanged: 0, sectionName: "Rosal" } });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1 learner moved to Rosal"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invalidateNavWarm).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("does not submit twice while the first call is pending", async () => {
    let settle: (v: unknown) => void = () => {};
    transferLearnersToSection.mockReturnValue(new Promise((r) => (settle = r)));
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    const button = submitButton("Transfer learner");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(transferLearnersToSection).toHaveBeenCalled());
    expect(transferLearnersToSection).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Transferring…")).toBeTruthy();
    // Settle so React's shared async-transition queue is not left blocked for
    // the next test.
    settle({ ok: true, data: { moved: 1, unchanged: 0, sectionName: "Rosal" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("keeps the dialog open with the input and shows the field error on a failed result", async () => {
    transferLearnersToSection.mockResolvedValue({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Check the highlighted fields.",
      fieldErrors: { toSectionId: "That section is not available." },
    });
    const { onClose, onDone } = renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Transfer learner"));

    expect(await screen.findByText("That section is not available.")).toBeTruthy();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // The choice survives and the person can try again.
    await waitFor(() => expect(submitButton("Transfer learner").disabled).toBe(false));
    expect(screen.getByRole("radio", { name: /Rosal/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the typed note on a failed request", async () => {
    requestSectionTransfers.mockResolvedValue({
      ok: false,
      code: "DB_UNAVAILABLE",
      error: "Try again in a moment.",
    });
    const { onClose } = renderDialog({ mode: "request", advisedSectionIds: ["s-sampaguita"] });

    fireEvent.change(screen.getByLabelText("Note for your School Head (optional)"), {
      target: { value: "please" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Request transfer"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Note for your School Head (optional)") as HTMLTextAreaElement).value).toBe("please");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("shows a refresh callout for a TRANSFER_* failure", async () => {
    transferLearnersToSection.mockResolvedValue({
      ok: false,
      code: "TRANSFER_BLOCKED",
      error: "Ana Santos can't move to Rosal: the section has no adviser.",
    });
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Transfer learner"));

    expect(await screen.findByText("The list has changed")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The list has changed")).toBeNull();
  });

  it("treats a rejected call (dropped connection) as a failure, not a success", async () => {
    transferLearnersToSection.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onClose, onDone } = renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Transfer learner"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says nothing changed when the action moved nobody", async () => {
    transferLearnersToSection.mockResolvedValue({ ok: true, data: { moved: 0, unchanged: 2, sectionName: "Rosal" } });
    const { onDone } = renderDialog({
      candidates: [candidate({ id: "l1", sectionId: "s-sampaguita" }), candidate({ id: "l2", name: "Ben Lim", sectionId: "s-rosal" })],
    });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    expect(screen.getByText(/1 already in Rosal stay where they are\./)).toBeTruthy();
    fireEvent.click(submitButton("Transfer learner"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Already in Rosal — nothing changed"));
    expect(onDone).toHaveBeenCalled();
  });

  it("announces a request with the waiting wording", async () => {
    requestSectionTransfers.mockResolvedValue({ ok: true, data: { requested: 2, unchanged: 0 } });
    renderDialog({
      mode: "request",
      advisedSectionIds: ["s-sampaguita"],
      candidates: [candidate({ id: "l1" }), candidate({ id: "l2", name: "Ben Lim" })],
    });
    fireEvent.click(screen.getByRole("radio", { name: /Rosal/ }));
    fireEvent.click(submitButton("Request transfer for 2 learners"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Transfer requested for 2 learners. Waiting for your School Head.")
    );
  });
});
