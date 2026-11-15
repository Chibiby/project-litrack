import { afterEach } from "vitest";

/**
 * Grids keep unsaved edits on the device (`src/lib/ui/use-grid-draft.ts`), so a
 * test that leaves a grid dirty would otherwise hand its draft to the next test
 * that opens the same grid. A real browser tab starts from its own storage; so
 * does each test.
 */
afterEach(() => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // storage unavailable in this environment
  }
});
