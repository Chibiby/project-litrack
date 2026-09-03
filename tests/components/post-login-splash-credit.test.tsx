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
  it("names Apache Spark, with the mark, on the splash it opens with", () => {
    render(<PostLoginSplash />);

    const overlay = document.querySelector("[data-post-login-splash]");
    expect(overlay).not.toBeNull();

    expect(screen.getByText("Developed by Apache Spark")).toBeTruthy();
    // The mark is the only inline SVG in the overlay.
    expect(overlay?.querySelector("svg")).not.toBeNull();
  });
});
