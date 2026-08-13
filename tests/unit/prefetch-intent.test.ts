import { describe, it, expect } from "vitest";
import {
  createIntentTracker,
  isSaveDataConnection,
  MAX_INTENT_PREFETCHES,
  INTENT_DELAY_MS,
} from "@/lib/nav/prefetch-intent";

describe("createIntentTracker", () => {
  it("allows a first-seen href", () => {
    const t = createIntentTracker();
    expect(t.shouldPrefetch("/teacher")).toBe(true);
  });

  it("refuses an href already prefetched this session", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    expect(t.shouldPrefetch("/teacher")).toBe(false);
  });

  it("treats different hrefs independently", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    expect(t.shouldPrefetch("/teacher/reports")).toBe(true);
  });

  it("refuses empty and non-navigational hrefs", () => {
    const t = createIntentTracker();
    expect(t.shouldPrefetch("")).toBe(false);
    expect(t.shouldPrefetch("#section")).toBe(false);
    expect(t.shouldPrefetch("https://deped.gov.ph")).toBe(false);
    expect(t.shouldPrefetch("mailto:a@b.c")).toBe(false);
  });

  it("stops once the per-page budget is spent", () => {
    const t = createIntentTracker();
    for (let i = 0; i < MAX_INTENT_PREFETCHES; i++) {
      expect(t.shouldPrefetch(`/teacher/${i}`)).toBe(true);
      t.markPrefetched(`/teacher/${i}`);
    }
    expect(t.size()).toBe(MAX_INTENT_PREFETCHES);
    expect(t.shouldPrefetch("/teacher/overflow")).toBe(false);
  });

  it("reset clears the budget", () => {
    const t = createIntentTracker();
    t.markPrefetched("/teacher");
    t.reset();
    expect(t.size()).toBe(0);
    expect(t.shouldPrefetch("/teacher")).toBe(true);
  });
});

describe("isSaveDataConnection", () => {
  it("is false when the API is unavailable", () => {
    expect(isSaveDataConnection(undefined)).toBe(false);
  });

  it("is true when the user asked to save data", () => {
    expect(isSaveDataConnection({ saveData: true })).toBe(true);
  });

  it("is true on 2g-class connections", () => {
    expect(isSaveDataConnection({ effectiveType: "2g" })).toBe(true);
    expect(isSaveDataConnection({ effectiveType: "slow-2g" })).toBe(true);
  });

  it("is false on fast connections", () => {
    expect(isSaveDataConnection({ effectiveType: "4g" })).toBe(false);
    expect(isSaveDataConnection({ saveData: false, effectiveType: "3g" })).toBe(false);
  });
});

describe("constants", () => {
  it("delays long enough to filter pass-over hovers", () => {
    expect(INTENT_DELAY_MS).toBeGreaterThanOrEqual(50);
    expect(INTENT_DELAY_MS).toBeLessThanOrEqual(150);
  });
});
