import { describe, expect, it } from "vitest";
import {
  cancelTransferRequestSchema,
  declineTransferRequestsSchema,
  decideTransferRequestsSchema,
  requestSectionTransfersSchema,
  transferLearnersSchema,
} from "@/lib/validators/section-transfer.schema";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

describe("transferLearnersSchema", () => {
  it("accepts 1 to 100 learners", () => {
    expect(transferLearnersSchema.safeParse({ learnerIds: ["a"], toSectionId: "s" }).success).toBe(true);
    expect(transferLearnersSchema.safeParse({ learnerIds: ids(100), toSectionId: "s" }).success).toBe(true);
  });
  it("rejects none and over 100", () => {
    expect(transferLearnersSchema.safeParse({ learnerIds: [], toSectionId: "s" }).success).toBe(false);
    expect(transferLearnersSchema.safeParse({ learnerIds: ids(101), toSectionId: "s" }).success).toBe(false);
  });
  it("does not require unique ids", () => {
    expect(transferLearnersSchema.safeParse({ learnerIds: ["a", "a"], toSectionId: "s" }).success).toBe(true);
  });
  it("asks for a section", () => {
    const r = transferLearnersSchema.safeParse({ learnerIds: ["a"], toSectionId: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Choose a section");
  });
  it("rejects blank ids", () => {
    expect(transferLearnersSchema.safeParse({ learnerIds: [" "], toSectionId: "s" }).success).toBe(false);
  });
});

describe("requestSectionTransfersSchema", () => {
  const ok = { learnerIds: ["a"], toSectionId: "s" };
  it("reason is optional and trimmed", () => {
    expect(requestSectionTransfersSchema.safeParse(ok).success).toBe(true);
    const r = requestSectionTransfersSchema.safeParse({ ...ok, reason: "  needs a closer seat  " });
    expect(r.success && r.data.reason).toBe("needs a closer seat");
  });
  it("caps the note at 300 characters", () => {
    expect(requestSectionTransfersSchema.safeParse({ ...ok, reason: "x".repeat(300) }).success).toBe(true);
    expect(requestSectionTransfersSchema.safeParse({ ...ok, reason: "x".repeat(301) }).success).toBe(false);
  });
  it("caps learners at 100", () => {
    expect(requestSectionTransfersSchema.safeParse({ ...ok, learnerIds: ids(101) }).success).toBe(false);
  });
});

describe("decide / decline / cancel", () => {
  it("decide takes 1 to 100 request ids", () => {
    expect(decideTransferRequestsSchema.safeParse({ requestIds: ids(100) }).success).toBe(true);
    expect(decideTransferRequestsSchema.safeParse({ requestIds: [] }).success).toBe(false);
    expect(decideTransferRequestsSchema.safeParse({ requestIds: ids(101) }).success).toBe(false);
  });
  it("decline note is optional and capped at 300", () => {
    expect(declineTransferRequestsSchema.safeParse({ requestIds: ["a"] }).success).toBe(true);
    expect(declineTransferRequestsSchema.safeParse({ requestIds: ["a"], note: "x".repeat(300) }).success).toBe(true);
    expect(declineTransferRequestsSchema.safeParse({ requestIds: ["a"], note: "x".repeat(301) }).success).toBe(false);
    expect(declineTransferRequestsSchema.safeParse({ requestIds: ids(101) }).success).toBe(false);
  });
  it("cancel needs a request id", () => {
    expect(cancelTransferRequestSchema.safeParse({ requestId: "a" }).success).toBe(true);
    expect(cancelTransferRequestSchema.safeParse({ requestId: "" }).success).toBe(false);
  });
});
