import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { HeaderSearch } from "@/components/shell/header-search";

beforeEach(() => push.mockClear());
afterEach(cleanup);

/** Types into a controlled input and submits the enclosing form. */
function search(value: string) {
  const input = screen.getByRole("searchbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  return input;
}

describe("HeaderSearch", () => {
  it("navigates to the search href with an encoded query", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    search("juan dela cruz");
    expect(push).toHaveBeenCalledWith("/teacher/learners?q=juan%20dela%20cruz");
  });

  it("ignores a whitespace-only submit", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    search("   ");
    expect(push).not.toHaveBeenCalled();
  });

  it("labels the input from the placeholder", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    expect(
      screen.getByRole("searchbox").getAttribute("aria-label")
    ).toBe("Search learners...");
  });

  it("focuses the input on Cmd/Ctrl+K and blurs on Escape", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
  });
});
