import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ClientErrorListener } from "@/components/errors/client-error-listener";

// jsdom has no PromiseRejectionEvent; the listener only reads `reason`.
function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

describe("ClientErrorListener", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    toast.error.mockClear();
  });
  afterEach(cleanup);

  it("toasts an unhandled network failure", () => {
    render(<ClientErrorListener />);
    reject(new TypeError("Failed to fetch"));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("ignores a redirect", () => {
    render(<ClientErrorListener />);
    reject(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/x;307;" }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores an arbitrary client bug", () => {
    render(<ClientErrorListener />);
    reject(new Error("x is not a function"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<ClientErrorListener />);
    unmount();
    reject(new TypeError("Failed to fetch"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
