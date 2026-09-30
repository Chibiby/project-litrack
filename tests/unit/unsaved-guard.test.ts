import { afterEach, describe, expect, it, vi } from "vitest";
import {
  internalNavigationHref,
  registerUnsavedGuard,
  runGuarded,
} from "@/lib/ui/unsaved-guard";

const LOCATION = { origin: "https://litrack.test", pathname: "/teacher/aral/g1/attendance", search: "?week=2026-09-07" };
const PLAIN_CLICK = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

function anchor(href: string, extra: { target?: string; download?: boolean } = {}) {
  return {
    href,
    target: extra.target ?? "",
    hasAttribute: (name: string) => name === "download" && Boolean(extra.download),
  };
}

describe("runGuarded", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("runs immediately when no guard is registered", () => {
    const proceed = vi.fn();
    runGuarded(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("runs immediately when nothing is unsaved", () => {
    const request = vi.fn();
    unregister = registerUnsavedGuard({ isDirty: () => false, request });
    const proceed = vi.fn();
    runGuarded(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("hands the move to the guard, without running it, when input is unsaved", () => {
    const request = vi.fn();
    unregister = registerUnsavedGuard({ isDirty: () => true, request });
    const proceed = vi.fn();
    runGuarded(proceed);
    expect(proceed).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(proceed);
  });

  it("stops guarding once the guard unregisters", () => {
    const request = vi.fn();
    registerUnsavedGuard({ isDirty: () => true, request })();
    const proceed = vi.fn();
    runGuarded(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});

describe("internalNavigationHref", () => {
  it("returns the in-app path for a plain click on a same-origin link", () => {
    expect(
      internalNavigationHref(anchor("https://litrack.test/teacher/dashboard?x=1#top"), PLAIN_CLICK, LOCATION)
    ).toBe("/teacher/dashboard?x=1#top");
  });

  it("leaves modified clicks, other targets and downloads to the browser", () => {
    const href = "https://litrack.test/teacher/dashboard";
    expect(internalNavigationHref(anchor(href), { ...PLAIN_CLICK, ctrlKey: true }, LOCATION)).toBeNull();
    expect(internalNavigationHref(anchor(href), { ...PLAIN_CLICK, metaKey: true }, LOCATION)).toBeNull();
    expect(internalNavigationHref(anchor(href), { ...PLAIN_CLICK, button: 1 }, LOCATION)).toBeNull();
    expect(internalNavigationHref(anchor(href, { target: "_blank" }), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(anchor(href, { download: true }), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(anchor(href), { ...PLAIN_CLICK, defaultPrevented: true }, LOCATION)).toBeNull();
  });

  it("leaves route handlers, framework assets and file links to the browser", () => {
    const at = (path: string) => anchor(`https://litrack.test${path}`);
    expect(internalNavigationHref(at("/api/export/learners?x=1"), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(at("/api"), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(at("/_next/static/a.js"), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(at("/files/report.pdf"), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(internalNavigationHref(at("/teacher/apiary"), PLAIN_CLICK, LOCATION)).toBe("/teacher/apiary");
  });

  it("ignores other origins and the page that is already open", () => {
    expect(internalNavigationHref(anchor("https://example.com/x"), PLAIN_CLICK, LOCATION)).toBeNull();
    expect(
      internalNavigationHref(
        anchor("https://litrack.test/teacher/aral/g1/attendance?week=2026-09-07#grid"),
        PLAIN_CLICK,
        LOCATION
      )
    ).toBeNull();
  });
});
