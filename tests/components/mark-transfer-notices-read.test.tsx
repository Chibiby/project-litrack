import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const mark = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("@/lib/actions/school-transfer", () => ({ markMyTransferNoticesRead: mark }));

import { MarkTransferNoticesRead } from "@/components/transfers/mark-transfer-notices-read";

/**
 * The Transfer page clears the bell only once it is really open in the
 * browser. Marking during the server render cleared it on a hover prefetch of
 * the sidebar link, so the School Head never saw the notice.
 */
describe("MarkTransferNoticesRead", () => {
  it("marks the notices read once, after it mounts", async () => {
    const { rerender } = render(<MarkTransferNoticesRead />);
    rerender(<MarkTransferNoticesRead />);
    await vi.waitFor(() => expect(mark).toHaveBeenCalledTimes(1));
  });

  it("renders nothing", () => {
    const { container } = render(<MarkTransferNoticesRead />);
    expect(container.innerHTML).toBe("");
  });
});
