import { describe, expect, it } from "vitest";
import { evaluateWindow } from "@/lib/school-year/window";

const w = {
  activeStart: new Date(Date.UTC(2026, 5, 1)),
  activeEnd: new Date(Date.UTC(2027, 3, 30)),
};

describe("evaluateWindow", () => {
  it("is closed with NO_WINDOW when the Division Admin set none", () => {
    expect(evaluateWindow(null, "2026-11-12")).toEqual({ open: false, reason: "NO_WINDOW", isLastMonth: false });
  });

  it("is open inside the duration, inclusive of both ends", () => {
    expect(evaluateWindow(w, "2026-06-01").open).toBe(true);
    expect(evaluateWindow(w, "2026-11-12").open).toBe(true);
    expect(evaluateWindow(w, "2027-04-30").open).toBe(true);
  });

  it("says why it is closed", () => {
    expect(evaluateWindow(w, "2026-05-31").reason).toBe("NOT_STARTED");
    expect(evaluateWindow(w, "2027-05-01").reason).toBe("ENDED");
  });

  it("flags only the end month as the last month", () => {
    expect(evaluateWindow(w, "2027-03-31").isLastMonth).toBe(false);
    expect(evaluateWindow(w, "2027-04-01").isLastMonth).toBe(true);
  });
});
