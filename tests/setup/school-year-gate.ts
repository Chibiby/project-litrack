import { vi } from "vitest";

/**
 * Every school-record write calls `assertSchoolYearOpen` (src/lib/school-year/gate.ts),
 * which reads the Division Admin's active duration from the database. Action
 * tests mock Prisma per file, so by default the gate is open here: tests keep
 * asserting what they were written to assert. A test about the closed year
 * overrides it, e.g.
 *
 *   const { assertSchoolYearOpen } = await import("@/lib/school-year/gate");
 *   vi.mocked(assertSchoolYearOpen).mockRejectedValueOnce(new AppError("SCHOOL_YEAR_CLOSED"));
 *
 * A test of the gate itself calls `vi.unmock("@/lib/school-year/gate")`.
 */
const OPEN = {
  open: true,
  reason: null,
  isLastMonth: false,
  schoolYearId: "test-school-year",
  label: "2026-2027",
  activeStart: "2026-06-01",
  activeEnd: "2027-04-30",
};

vi.mock("@/lib/school-year/gate", () => ({
  assertSchoolYearOpen: vi.fn(async () => OPEN),
  getSchoolYearGate: vi.fn(async () => OPEN),
  getDivisionGate: vi.fn(async () => OPEN),
  getGateForUser: vi.fn(async () => OPEN),
}));
