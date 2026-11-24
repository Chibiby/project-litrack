import { describe, expect, it } from "vitest";
import {
  COUNT_UP_MS,
  countUpFrame,
  createCountUpGate,
  createStagger,
  easeOutCubic,
  formatStatValue,
  parseCountable,
} from "@/lib/ui/count-up";

describe("parseCountable", () => {
  it("counts whole numbers and digit strings, always with thousands commas", () => {
    expect(parseCountable(5695)?.format(5695)).toBe("5,695");
    expect(parseCountable("5695")?.format(5695)).toBe("5,695");
    expect(parseCountable(999)?.format(999)).toBe("999");
    const commas = parseCountable("103,110");
    expect(commas?.target).toBe(103110);
    expect(commas?.format(1234)).toBe("1,234");
    const pct = parseCountable("55%");
    expect(pct?.target).toBe(55);
    expect(pct?.format(12)).toBe("12%");
  });

  it("leaves words, fractions, decimals and negatives alone", () => {
    for (const v of ["Not chosen", "3/4", "2.5", "-4", "", "1,23"]) {
      expect(parseCountable(v)).toBeNull();
    }
    expect(parseCountable(2.5)).toBeNull();
    expect(parseCountable(-3)).toBeNull();
    expect(parseCountable(Number.NaN)).toBeNull();
  });
});

describe("countUpFrame", () => {
  it("starts at 0, climbs steadily, and lands exactly on the target", () => {
    expect(countUpFrame(1000, 0, 1000)).toBe(0);
    // ease-out, but not a jump: about half the value at a quarter of the time
    expect(countUpFrame(1000, 250, 1000)).toBeGreaterThan(500);
    expect(countUpFrame(1000, 250, 1000)).toBeLessThan(650);
    expect(countUpFrame(1000, 1000, 1000)).toBe(1000);
    expect(countUpFrame(1000, 5000, 1000)).toBe(1000);
  });

  it("never goes backwards", () => {
    let last = -1;
    for (let t = 0; t <= 1100; t += 16) {
      const n = countUpFrame(103110, t, 1100);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect(easeOutCubic(1)).toBe(1);
  });

  it("runs 1.2 seconds", () => {
    expect(COUNT_UP_MS).toBe(1200);
  });
});

describe("createCountUpGate", () => {
  it("counts a page once per page load, for every card on it", () => {
    let clock = 0;
    const gate = createCountUpGate(() => clock);

    // Four cards on the dashboard mount in the same moment: all count.
    expect([1, 2, 3, 4].map(() => gate.shouldCount("/admin"))).toEqual([true, true, true, true]);
    // Coming back later without a refresh: no count.
    clock = 10_000;
    expect(gate.shouldCount("/admin")).toBe(false);
    // Another page still counts its first time.
    expect(gate.shouldCount("/admin/management/learners")).toBe(true);
  });

  it("counts again after a refresh (a new gate) or a sign-in reset", () => {
    let clock = 0;
    const gate = createCountUpGate(() => clock);
    expect(gate.shouldCount("/teacher")).toBe(true);
    clock = 10_000;
    expect(gate.shouldCount("/teacher")).toBe(false);
    gate.reset();
    expect(gate.shouldCount("/teacher")).toBe(true);
    // A refresh loads the module again, which makes a fresh gate.
    expect(createCountUpGate(() => clock).shouldCount("/teacher")).toBe(true);
  });
});

describe("formatStatValue", () => {
  it("adds thousands commas to counts and leaves other values alone", () => {
    expect(formatStatValue(103110)).toBe("103,110");
    expect(formatStatValue("12000%")).toBe("12,000%");
    expect(formatStatValue("2026-2027")).toBe("2026-2027");
    expect(formatStatValue("Not chosen")).toBe("Not chosen");
  });
});

describe("createStagger", () => {
  it("starts cards that are ready together 100 ms apart, in order", () => {
    const delayFor = createStagger(100);
    expect([0, 0, 0, 0].map((t) => delayFor(t))).toEqual([0, 100, 200, 300]);
  });

  it("starts a card at once when the queue has drained", () => {
    const delayFor = createStagger(100);
    delayFor(0);
    expect(delayFor(5000)).toBe(0);
  });
});
