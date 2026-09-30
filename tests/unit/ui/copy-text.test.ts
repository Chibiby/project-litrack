import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { COPY_FAILED_MESSAGE, copyText } from "@/lib/ui/copy-text";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  toast.error.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
});

describe("copyText", () => {
  it("returns true and stays quiet when the clipboard accepts the text", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);

    await expect(copyText("secret")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("secret");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts how to copy by hand when the clipboard rejects", async () => {
    stubClipboard(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });

    await expect(copyText("secret")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith(COPY_FAILED_MESSAGE);
    expect(COPY_FAILED_MESSAGE).toBe("Couldn't copy. Select the text and copy it instead.");
  });

  it("toasts when the clipboard API is missing", async () => {
    await expect(copyText("secret")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
