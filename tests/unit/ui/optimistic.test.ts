import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";
import { ToastedError } from "@/lib/ui/toast-failure";

const startTransition = ((cb: () => unknown) => {
  void cb();
}) as Parameters<typeof runOptimistic>[0];

describe("runOptimistic", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
    toast.error.mockClear();
    toast.success.mockClear();
  });

  it("toasts a network rejection once and rejects with ToastedError", async () => {
    await expect(
      runOptimistic(startTransition, async () => {
        throw new TypeError("Failed to fetch");
      })
    ).rejects.toBeInstanceOf(ToastedError);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("rethrows a redirect without toasting", async () => {
    const err = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    await expect(
      runOptimistic(startTransition, async () => {
        throw err;
      })
    ).rejects.toBe(err);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not toast again for an already-toasted error", async () => {
    const err = new ToastedError("Already shown");
    await expect(
      runOptimistic(startTransition, async () => {
        throw err;
      })
    ).rejects.toBe(err);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("settleActionResult", () => {
  beforeEach(() => {
    toast.error.mockClear();
    toast.success.mockClear();
  });

  it("toasts a failure once and throws ToastedError", async () => {
    await expect(
      settleActionResult({ ok: false, error: "Nope" }, "Saved")
    ).rejects.toBeInstanceOf(ToastedError);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]?.[0]).toBe("Nope");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts success", async () => {
    await settleActionResult({ ok: true }, "Saved");
    expect(toast.success).toHaveBeenCalledWith("Saved");
  });
});
