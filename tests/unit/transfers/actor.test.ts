import { beforeEach, describe, expect, it, vi } from "vitest";
import { resourceNotFound } from "@/lib/errors/app-error";

const currentUser = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const inScope = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => currentUser.value),
}));
vi.mock("@/lib/auth/district-scope", () => ({
  loadAdminScopeForUser: vi.fn(async () => ({ kind: "districts", districts: ["D1"] })),
  loadSchoolInScope: vi.fn(async (_scope: unknown, id: string) => {
    if (!inScope.ids.has(id)) throw resourceNotFound("School", { crossTenant: true });
    return { id };
  }),
}));

import { resolveTransferActor } from "@/lib/transfers/actor";
import {
  declineSchoolTransfersSchema,
  requestSchoolTransfersSchema,
} from "@/lib/validators/school-transfer.schema";

beforeEach(() => {
  inScope.ids = new Set(["school-in"]);
});

describe("resolveTransferActor", () => {
  it("lets a School Head act for their own school", async () => {
    currentUser.value = { id: "sh", role: "SCHOOL_HEAD", schoolId: "school-a" };
    await expect(resolveTransferActor("school-a")).resolves.toMatchObject({ viaAdmin: false });
  });

  it("refuses a School Head acting for another school as NOT_FOUND", async () => {
    currentUser.value = { id: "sh", role: "SCHOOL_HEAD", schoolId: "school-a" };
    await expect(resolveTransferActor("school-b")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a District admin outside their districts as NOT_FOUND", async () => {
    currentUser.value = { id: "da", role: "DISTRICT_ADMIN", schoolId: null };
    await expect(resolveTransferActor("school-out")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a District admin act inside their districts", async () => {
    currentUser.value = { id: "da", role: "DISTRICT_ADMIN", schoolId: null };
    await expect(resolveTransferActor("school-in")).resolves.toMatchObject({ viaAdmin: true });
  });

  it("refuses a Teacher", async () => {
    currentUser.value = { id: "t", role: "TEACHER", schoolId: "school-a" };
    await expect(resolveTransferActor("school-a")).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});

describe("school transfer schemas", () => {
  const base = { schoolId: "a", toSchoolId: "b", kind: "LEARNER", ids: ["l1"] };

  it("refuses a reason over 300 characters", () => {
    expect(requestSchoolTransfersSchema.safeParse({ ...base, reason: "x".repeat(301) }).success).toBe(false);
  });

  it("refuses an empty selection", () => {
    expect(requestSchoolTransfersSchema.safeParse({ ...base, ids: [] }).success).toBe(false);
  });

  it("turns a blank note into undefined", () => {
    const parsed = declineSchoolTransfersSchema.parse({ schoolId: "a", ids: ["t1"], note: "   " });
    expect(parsed.note).toBeUndefined();
  });
});
