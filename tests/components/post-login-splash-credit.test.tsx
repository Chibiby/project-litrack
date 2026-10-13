/**
 * The splash carries its developer attribution.
 *
 * The credit is a deliberate, requested part of the ARAL opener rather than
 * decoration, and it is the kind of line that quietly disappears in a refactor
 * of the overlay's markup — it belongs to no beat of the animation and no
 * test would otherwise notice its absence. This asserts only that it is
 * rendered, with the mark beside it: the placement is CSS-module work that
 * jsdom cannot judge.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {} }),
}));

// jsdom stand-in for next/image: keep src/alt, drop the loader-only props that
// React would otherwise warn about writing to the DOM.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { PostLoginSplash } from "@/components/post-login-splash";

afterEach(cleanup);

describe("PostLoginSplash — developer credit", () => {
  it("names Apspark, with the mark, on the splash it opens with", () => {
    render(<PostLoginSplash />);

    const overlay = document.querySelector("[data-post-login-splash]");
    expect(overlay).not.toBeNull();

    const credit = screen.getByText("Developed by Apspark").closest("a");
    // The credit opens Apspark's page in a new tab, leaving the app as it was.
    expect(credit?.getAttribute("href")).toBe(
      "https://www.facebook.com/profile.php?id=61594549658337"
    );
    expect(credit?.getAttribute("target")).toBe("_blank");
    expect(credit?.getAttribute("rel")).toContain("noopener");
    // The mark is the only inline SVG in the overlay, and it sits in the link.
    expect(credit?.querySelector("svg")).not.toBeNull();
  });
});
