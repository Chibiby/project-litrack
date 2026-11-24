import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUnreadTitle } from "@/components/chat/use-unread-title";

beforeEach(() => {
  document.title = "Support · LITRACK";
});
afterEach(cleanup);

describe("useUnreadTitle", () => {
  it("title shows (2) and restores", () => {
    const { rerender, unmount } = renderHook(({ n }) => useUnreadTitle(n), { initialProps: { n: 2 } });
    expect(document.title).toBe("(2) Support · LITRACK");
    rerender({ n: 3 });
    expect(document.title).toBe("(3) Support · LITRACK");
    rerender({ n: 0 });
    expect(document.title).toBe("Support · LITRACK");
    rerender({ n: 1 });
    unmount();
    expect(document.title).toBe("Support · LITRACK");
  });

  it("does not stack prefixes when the title already carries one", () => {
    const { rerender } = renderHook(({ n }) => useUnreadTitle(n), { initialProps: { n: 2 } });
    document.title = "(2) Support · LITRACK";
    rerender({ n: 4 });
    expect(document.title).toBe("(4) Support · LITRACK");
  });
});
