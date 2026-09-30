import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { OfflineBanner } from "@/components/errors/offline-banner";

const TEXT = "You're offline. Changes won't save until your connection is back.";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    toast.success.mockClear();
  });
  afterEach(cleanup);

  it("shows while offline and hides on reconnect with one confirmation toast", () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(TEXT)).toBeNull();

    setOnline(false);
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();

    setOnline(true);
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("You're back online.");
  });

  it("stays quiet when it never showed", () => {
    render(<OfflineBanner />);
    setOnline(true);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
