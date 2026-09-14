import { describe, expect, it } from "vitest";
import {
  resyncOverrides,
  signaturesFor,
  teacherRowSignature,
  type SignatureRow,
} from "@/lib/teachers/row-resync";

/**
 * Pure-logic coverage for the fix to the production bug where a School
 * Head's advisory-chip edit visibly "snapped back" to the old value: the
 * table used to clear *every* row's local override whenever the `rows` prop
 * changed at all, rather than only the row whose server data actually moved.
 *
 * These assert against `resyncOverrides` directly, no React involved — the
 * bug is reproducible at this level: simulate the sequence of signatures the
 * table would compute across renders and check what survives.
 */

const ROW_A = "teacher-a";
const ROW_B = "teacher-b";

function row(id: string, sectionIds: string[]): SignatureRow {
  return { id, designation: "Teacher", advisoryMode: "MULTI_GRADE", assignments: sectionIds.map((sectionId) => ({ sectionId })) };
}

describe("teacherRowSignature", () => {
  it("is independent of the order sections were added in", () => {
    const a = teacherRowSignature(row(ROW_A, ["s1", "s2"]));
    const b = teacherRowSignature(row(ROW_A, ["s2", "s1"]));
    expect(a).toBe(b);
  });

  it("changes when the held sections change", () => {
    const before = teacherRowSignature(row(ROW_A, ["s1"]));
    const after = teacherRowSignature(row(ROW_A, ["s1", "s2"]));
    expect(before).not.toBe(after);
  });
});

describe("resyncOverrides", () => {
  it("keeps a row's override across a refresh that only reflects a DIFFERENT row's change", () => {
    // Row A has an in-flight edit (its override optimistically shows ["s1"]).
    // Row B just finished saving elsewhere and triggered a refresh — Row A's
    // own mutation has not committed yet, so its server signature is
    // unchanged between the two snapshots.
    const previous = signaturesFor([row(ROW_A, []), row(ROW_B, [])]);
    const next = signaturesFor([row(ROW_A, []), row(ROW_B, ["s9"])]);
    const overrides = { [ROW_A]: ["s1"] };

    const result = resyncOverrides(overrides, previous, next);

    // This is the bug: the old blanket `useEffect(() => setAdvisoryOverrides({}), [rows])`
    // would drop Row A's override here too, snapping its chip back to "no
    // section" while its own save was still in flight.
    expect(result).toEqual({ [ROW_A]: ["s1"] });
  });

  it("drops a row's override once that row's own server signature changes", () => {
    // Row A's save has now landed: the refreshed row carries the section the
    // override already showed. The override is redundant and should clear so
    // the row reads straight from server data again.
    const previous = signaturesFor([row(ROW_A, [])]);
    const next = signaturesFor([row(ROW_A, ["s1"])]);
    const overrides = { [ROW_A]: ["s1"] };

    const result = resyncOverrides(overrides, previous, next);

    expect(result).toEqual({});
  });

  it("drops an override for a row that disappeared from the next snapshot", () => {
    const previous = signaturesFor([row(ROW_A, ["s1"])]);
    const next = signaturesFor([]); // deactivated, removed, or paged away
    const overrides = { [ROW_A]: ["s1"] };

    const result = resyncOverrides(overrides, previous, next);

    expect(result).toEqual({});
  });

  it("returns the same reference when nothing changes, so callers can skip a re-render", () => {
    const previous = signaturesFor([row(ROW_A, ["s1"])]);
    const next = signaturesFor([row(ROW_A, ["s1"]), row(ROW_B, [])]);
    const overrides = { [ROW_A]: ["s1"] };

    const result = resyncOverrides(overrides, previous, next);

    expect(result).toBe(overrides);
  });

  it("leaves rows with no override alone either way", () => {
    const previous = signaturesFor([row(ROW_A, [])]);
    const next = signaturesFor([row(ROW_A, ["s1"])]);

    const result = resyncOverrides({}, previous, next);

    expect(result).toEqual({});
  });
});
