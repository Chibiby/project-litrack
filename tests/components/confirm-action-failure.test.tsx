import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ConfirmAction } from "@/components/confirm-action";
import { ToastedError } from "@/lib/ui/toast-failure";

function renderDialog(onConfirm: () => Promise<void>) {
  render(
    <ConfirmAction
      title="Remove it?"
      description="This removes it."
      confirmLabel="Remove"
      trigger={<button type="button">Open</button>}
      onConfirm={onConfirm}
    />
  );
  fireEvent.click(screen.getByText("Open"));
}

describe("ConfirmAction failure handling", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    toast.error.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it("toasts a network rejection, keeps the dialog open and clears the spinner", async () => {
    renderDialog(async () => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.getByText("Remove it?")).toBeTruthy();
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("does not toast a second time for a ToastedError", async () => {
    renderDialog(async () => {
      throw new ToastedError("Already shown");
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("Working…")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Remove it?")).toBeTruthy();
  });

  it("toasts a plain Error once with a generic message and keeps the dialog open", async () => {
    renderDialog(async () => {
      throw new Error("x");
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Working…")).toBeNull());
    expect(String(toast.error.mock.calls[0][0])).not.toBe("x");
    expect(screen.getByText("Remove it?")).toBeTruthy();
  });

  it("does not toast an already-toasted error while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    renderDialog(async () => {
      throw new ToastedError("Already shown");
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("Working…")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Remove it?")).toBeTruthy();
  });

  it("toasts a resolved ActionFailure and keeps the dialog open", async () => {
    render(
      <ConfirmAction
        title="Remove it?"
        description="This removes it."
        confirmLabel="Remove"
        trigger={<button type="button">Open</button>}
        onConfirm={async () => ({
          ok: false as const,
          code: "INTERNAL_ERROR" as const,
          error: "Could not remove.",
        })}
      />
    );
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Remove it?")).toBeTruthy();
  });
});

