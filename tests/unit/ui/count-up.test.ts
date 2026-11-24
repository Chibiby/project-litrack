import { describe, expect, it } from "vitest";
import {
  COUNT_UP_STORAGE_KEY,
  countUpFrame,
  createCountUpGate,
  easeOutExpo,
  parseCountable,
  resetCountUp,
  type SeenStore,
} from "@/lib/ui/count-up";

function memoryStore(): SeenStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("parseCountable", () => {
  it("counts whole numbers and digit strings, keeping commas and a % suffix", () => {
    expect(parseCountable(5695)?.format(5695)).toBe("5695");
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
  it("starts at 0, rises fast, and lands exactly on the target", () => {
    expect(countUpFrame(1000, 0, 1000)).toBe(0);
    // ease-out: well past half the value at a quarter of the time
    expect(countUpFrame(1000, 250, 1000)).toBeGreaterThan(700);
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
    expect(easeOutExpo(1)).toBe(1);
  });
});

describe("createCountUpGate", () => {
  it("counts a page once per sign-in, for every card on it", () => {
    const store = memoryStore();
    let clock = 0;
    const gate = createCountUpGate(() => store, () => clock);

    // Four cards on the dashboard mount in the same moment: all count.
    expect([1, 2, 3, 4].map(() => gate("/admin"))).toEqual([true, true, true, true]);
    // Coming back later in the same sign-in: no count.
    clock = 10_000;
    expect(gate("/admin")).toBe(false);
    // Another page still counts its first time.
    expect(gate("/admin/management/learners")).toBe(true);
  });

  it("counts again after a sign-in resets it", () => {
    const store = memoryStore();
    let clock = 0;
    const gate = createCountUpGate(() => store, () => clock);
    expect(gate("/teacher")).toBe(true);
    clock = 10_000;
    expect(gate("/teacher")).toBe(false);
    resetCountUp(store);
    expect(store.data.has(COUNT_UP_STORAGE_KEY)).toBe(false);
    expect(gate("/teacher")).toBe(true);
  });

  it("just shows the numbers when storage is missing or throws", () => {
    expect(createCountUpGate(() => null, () => 0)("/x")).toBe(false);
    const broken: SeenStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(createCountUpGate(() => broken, () => 0)("/x")).toBe(false);
    expect(() => resetCountUp(broken)).not.toThrow();
  });
});
