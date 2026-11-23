import { describe, expect, it } from "vitest";
import {
  canTransferBetween,
  effectiveStatus,
  expiresAtFor,
  transferKindForTeacher,
  TRANSFER_EXPIRY_DAYS,
} from "@/lib/transfers/school-transfer-rules";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

const now = new Date("2026-11-23T08:00:00Z");

describe("effectiveStatus", () => {
  it("reads a pending row past its expiry as EXPIRED", () => {
    const row = { status: "PENDING" as const, expiresAt: new Date(now.getTime() - 1) };
    expect(effectiveStatus(row, now)).toBe("EXPIRED");
  });

  it("keeps a pending row before its expiry PENDING", () => {
    const row = { status: "PENDING" as const, expiresAt: new Date(now.getTime() + 1) };
    expect(effectiveStatus(row, now)).toBe("PENDING");
  });

  it("never rewrites a decided row", () => {
    const row = { status: "DECLINED" as const, expiresAt: new Date(now.getTime() - 1) };
    expect(effectiveStatus(row, now)).toBe("DECLINED");
  });
});

describe("expiresAtFor", () => {
  it("is 30 days after sending", () => {
    expect(TRANSFER_EXPIRY_DAYS).toBe(30);
    expect(expiresAtFor(new Date("2026-11-23T00:00:00Z")).toISOString()).toBe(
      "2026-12-23T00:00:00.000Z"
    );
  });
});

describe("canTransferBetween", () => {
  const a = { id: "a", division: "Division of X", isActive: true };
  const b = { id: "b", division: " division of x ", isActive: true };

  it("allows active schools in the same division, ignoring case and spaces", () => {
    expect(canTransferBetween(a, b)).toBe(true);
  });

  it("refuses when either division is missing", () => {
    expect(canTransferBetween({ ...a, division: null }, b)).toBe(false);
    expect(canTransferBetween(a, { ...b, division: "  " })).toBe(false);
  });

  it("refuses an inactive target", () => {
    expect(canTransferBetween(a, { ...b, isActive: false })).toBe(false);
  });

  it("refuses the same school", () => {
    expect(canTransferBetween(a, { ...a })).toBe(false);
  });

  it("refuses another division", () => {
    expect(canTransferBetween(a, { ...b, division: "Division of Y" })).toBe(false);
  });
});

describe("transferKindForTeacher", () => {
  it("splits volunteers from teachers by designation", () => {
    expect(transferKindForTeacher(ARAL_VOLUNTEER_DESIGNATION)).toBe("ARAL_VOLUNTEER");
    expect(transferKindForTeacher("TEACHER_I")).toBe("TEACHER");
    expect(transferKindForTeacher(null)).toBe("TEACHER");
  });
});
