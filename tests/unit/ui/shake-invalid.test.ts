// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHAKE_KEYFRAMES, shakeInvalidFields } from "@/lib/ui/shake-invalid";

function setMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("shakeInvalidFields", () => {
  let root: HTMLDivElement;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = `
      <div data-shake id="wrap"><input id="a" aria-invalid="true" /></div>
      <input id="b" aria-invalid="true" />
      <input id="c" />
      <input id="d" aria-invalid="false" />`;
    document.body.appendChild(root);
    animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    setMotion(false);
  });

  afterEach(() => {
    root.remove();
  });

  it("shakes only invalid fields, moving the data-shake wrapper when there is one", () => {
    expect(shakeInvalidFields(root)).toBe(2);
    const shaken = (animate.mock.contexts as HTMLElement[]).map((el) => el.id).sort();
    expect(shaken).toEqual(["b", "wrap"]);
    expect(animate).toHaveBeenCalledWith(SHAKE_KEYFRAMES, expect.objectContaining({ duration: 380 }));
  });

  it("shakes again on every call", () => {
    shakeInvalidFields(root);
    shakeInvalidFields(root);
    expect(animate).toHaveBeenCalledTimes(4);
  });

  it("does nothing under reduced motion or without a root", () => {
    setMotion(true);
    expect(shakeInvalidFields(root)).toBe(0);
    expect(shakeInvalidFields(null)).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("ends where it started", () => {
    expect(SHAKE_KEYFRAMES[0]).toEqual({ transform: "translateX(0)" });
    expect(SHAKE_KEYFRAMES.at(-1)).toEqual({ transform: "translateX(0)" });
  });
});
