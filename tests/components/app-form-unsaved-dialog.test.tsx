import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppForm, AppForm } from "@/components/forms/app-form";
import { z } from "zod";

/**
 * The profile forms' unsaved-changes guard used to call `window.confirm` when an
 * in-app link was followed. It now asks with the app's own dialog; the browser
 * prompt stays only for closing the tab.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const schema = z.object({ name: z.string() });

function Harness() {
  const form = useAppForm<{ name: string }>({ schema, defaultValues: { name: "" } });
  return (
    <>
      {/* jsdom cannot navigate; the guard runs in the capture phase before this. */}
      <a href="/elsewhere" onClick={(e) => e.preventDefault()}>
        Leave
      </a>
      <AppForm
        form={form}
        onSubmit={() => {}}
        enableUnsavedGuard
        unsavedMessage="You have unsaved profiling changes."
      >
        <input aria-label="name" {...form.register("name")} />
      </AppForm>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = vi.fn(() => true);
});
afterEach(cleanup);

describe("AppForm unsaved guard", () => {
  it("lets a clean form navigate without a question", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Leave"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("asks with the app dialog, not the browser, and holds the navigation", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("name"), { target: { value: "Maria" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Leave"));
    });

    const alert = await screen.findByRole("alertdialog");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(within(alert).getByText("Discard changes?")).toBeTruthy();
    expect(alert.textContent).toContain("You have unsaved profiling changes.");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates once Discard changes is chosen", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("name"), { target: { value: "Maria" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Leave"));
    });
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Discard changes" }));

    expect(push).toHaveBeenCalledWith("/elsewhere");
  });
});
