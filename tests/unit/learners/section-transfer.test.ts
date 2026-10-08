import { describe, expect, it } from "vitest";
import {
  evaluateSectionTransfer,
  MAX_TRANSFER_BATCH,
  TRANSFER_BLOCK_REASON_LABELS,
  type TransferBlockReason,
  type TransferDestinationFacts,
  type TransferLearnerFacts,
} from "@/lib/learners/section-transfer";
import { LEARNER_PAGE_SIZE_OPTIONS } from "@/lib/learners/pagination";
import { SECTION_TRANSFER_REQUEST_STATUS_LABELS } from "@/lib/constants/enum-labels";

const learner = (over: Partial<TransferLearnerFacts> = {}): TransferLearnerFacts => ({
  id: "l1",
  schoolId: "s1",
  gradeLevelId: "g3",
  gradeType: "G3",
  sectionId: "secA",
  deletedAt: null,
  archivedAt: null,
  ...over,
});

const destination = (over: Partial<NonNullable<TransferDestinationFacts>> = {}): TransferDestinationFacts => ({
  id: "secB",
  schoolId: "s1",
  gradeLevelId: "g3",
  deletedAt: null,
  gradeDeletedAt: null,
  adviser: { id: "t1", deletedAt: null, isActive: true, role: "TEACHER" },
  ...over,
});

const base = {
  actorSchoolId: "s1",
  learner: learner(),
  destination: destination(),
  hasPendingRequest: false,
};

describe("evaluateSectionTransfer", () => {
  it("moves a learner and names the destination adviser", () => {
    expect(evaluateSectionTransfer(base)).toEqual({ ok: true, kind: "move", teacherId: "t1" });
  });

  it("moves a learner who has no section yet", () => {
    expect(evaluateSectionTransfer({ ...base, learner: learner({ sectionId: null }) })).toEqual({
      ok: true,
      kind: "move",
      teacherId: "t1",
    });
  });

  it("reports unchanged when the learner is already there", () => {
    expect(evaluateSectionTransfer({ ...base, learner: learner({ sectionId: "secB" }) })).toEqual({
      ok: true,
      kind: "unchanged",
    });
  });

  it.each<[string, Parameters<typeof evaluateSectionTransfer>[0], TransferBlockReason]>([
    ["learner missing", { ...base, learner: null }, "learner-unavailable"],
    ["learner deleted", { ...base, learner: learner({ deletedAt: new Date() }) }, "learner-unavailable"],
    ["learner archived", { ...base, learner: learner({ archivedAt: new Date() }) }, "learner-unavailable"],
    ["learner in another school", { ...base, learner: learner({ schoolId: "s2" }) }, "learner-unavailable"],
    ["floating grade", { ...base, learner: learner({ gradeType: "FLOATING" }) }, "floating"],
    ["destination missing", { ...base, destination: null }, "section-unavailable"],
    ["destination archived", { ...base, destination: destination({ deletedAt: new Date() }) }, "section-unavailable"],
    ["destination other school", { ...base, destination: destination({ schoolId: "s2" }) }, "section-unavailable"],
    ["destination grade archived", { ...base, destination: destination({ gradeDeletedAt: new Date() }) }, "section-unavailable"],
    ["different grade", { ...base, destination: destination({ gradeLevelId: "g4" }) }, "different-grade"],
    ["no adviser", { ...base, destination: destination({ adviser: null }) }, "no-adviser"],
    [
      "adviser deleted",
      { ...base, destination: destination({ adviser: { id: "t1", deletedAt: new Date(), isActive: true, role: "TEACHER" } }) },
      "no-adviser",
    ],
    [
      "adviser inactive",
      { ...base, destination: destination({ adviser: { id: "t1", deletedAt: null, isActive: false, role: "TEACHER" } }) },
      "no-adviser",
    ],
    [
      "adviser not a teacher",
      { ...base, destination: destination({ adviser: { id: "t1", deletedAt: null, isActive: true, role: "SCHOOL_HEAD" } }) },
      "no-adviser",
    ],
    ["moved since request", { ...base, expectedFromSectionId: "secZ" }, "moved-since-request"],
    ["not in advisory", { ...base, advisedSectionIds: ["secX"] }, "not-in-advisory"],
    ["not in advisory when no section", { ...base, learner: learner({ sectionId: null }), advisedSectionIds: ["secX"] }, "not-in-advisory"],
    ["pending request", { ...base, hasPendingRequest: true }, "pending-request"],
  ])("blocks: %s", (_name, input, reason) => {
    expect(evaluateSectionTransfer(input)).toEqual({ ok: false, reason });
  });

  it("accepts expectedFromSectionId null for a sectionless learner", () => {
    expect(
      evaluateSectionTransfer({ ...base, learner: learner({ sectionId: null }), expectedFromSectionId: null })
    ).toMatchObject({ ok: true, kind: "move" });
  });

  it("passes when the learner is in an advised section", () => {
    expect(evaluateSectionTransfer({ ...base, advisedSectionIds: ["secA"] })).toMatchObject({ ok: true });
  });

  describe("check order", () => {
    it("archived learner beats floating", () => {
      expect(
        evaluateSectionTransfer({ ...base, learner: learner({ archivedAt: new Date(), gradeType: "FLOATING" }) })
      ).toEqual({ ok: false, reason: "learner-unavailable" });
    });
    it("floating beats destination unavailable", () => {
      expect(
        evaluateSectionTransfer({ ...base, learner: learner({ gradeType: "FLOATING" }), destination: null })
      ).toEqual({ ok: false, reason: "floating" });
    });
    it("destination unavailable beats different grade", () => {
      expect(
        evaluateSectionTransfer({ ...base, destination: destination({ deletedAt: new Date(), gradeLevelId: "g4" }) })
      ).toEqual({ ok: false, reason: "section-unavailable" });
    });
    it("different grade beats no adviser", () => {
      expect(
        evaluateSectionTransfer({ ...base, destination: destination({ gradeLevelId: "g4", adviser: null }) })
      ).toEqual({ ok: false, reason: "different-grade" });
    });
    it("no adviser beats moved since request", () => {
      expect(
        evaluateSectionTransfer({ ...base, destination: destination({ adviser: null }), expectedFromSectionId: "secZ" })
      ).toEqual({ ok: false, reason: "no-adviser" });
    });
    it("moved since request beats not in advisory", () => {
      expect(
        evaluateSectionTransfer({ ...base, expectedFromSectionId: "secZ", advisedSectionIds: ["secX"] })
      ).toEqual({ ok: false, reason: "moved-since-request" });
    });
    it("not in advisory beats pending request", () => {
      expect(
        evaluateSectionTransfer({ ...base, advisedSectionIds: ["secX"], hasPendingRequest: true })
      ).toEqual({ ok: false, reason: "not-in-advisory" });
    });
    it("pending request beats unchanged", () => {
      expect(
        evaluateSectionTransfer({ ...base, learner: learner({ sectionId: "secB" }), hasPendingRequest: true })
      ).toEqual({ ok: false, reason: "pending-request" });
    });
    it("a missing adviser still blocks a learner already in the destination", () => {
      expect(
        evaluateSectionTransfer({
          ...base,
          learner: learner({ sectionId: "secB" }),
          destination: destination({ adviser: null }),
        })
      ).toEqual({ ok: false, reason: "no-adviser" });
    });
  });
});

describe("constants", () => {
  it("labels every block reason with one sentence", () => {
    const reasons: TransferBlockReason[] = [
      "learner-unavailable",
      "floating",
      "different-grade",
      "section-unavailable",
      "no-adviser",
      "moved-since-request",
      "not-in-advisory",
      "pending-request",
    ];
    expect(Object.keys(TRANSFER_BLOCK_REASON_LABELS).sort()).toEqual([...reasons].sort());
    for (const r of reasons) expect(TRANSFER_BLOCK_REASON_LABELS[r].length).toBeGreaterThan(10);
  });

  it("caps a batch at the largest page size", () => {
    expect(MAX_TRANSFER_BATCH).toBe(100);
    expect(MAX_TRANSFER_BATCH).toBe(Math.max(...LEARNER_PAGE_SIZE_OPTIONS));
  });

  it("labels every request status", () => {
    expect(SECTION_TRANSFER_REQUEST_STATUS_LABELS).toEqual({
      PENDING: "Waiting",
      APPROVED: "Approved",
      REJECTED: "Declined",
      CANCELLED: "Withdrawn",
    });
  });
});
