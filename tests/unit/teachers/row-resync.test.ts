import { describe, expect, it } from "vitest";
import {
  resyncOverrides,
  signaturesFor,
  teacherRowSignature,
  visibleRows,
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

describe("visibleRows", () => {
  it("filters out an id present in the hidden map", () => {
    const rows = [row(ROW_A, []), row(ROW_B, [])];
    const result = visibleRows(rows, { [ROW_A]: true });
    expect(result.map((r) => r.id)).toEqual([ROW_B]);
  });

  it("returns every row when nothing is hidden", () => {
    const rows = [row(ROW_A, []), row(ROW_B, [])];
    expect(visibleRows(rows, {})).toEqual(rows);
  });
});

describe("hidden-row resync (deactivate/remove regression)", () => {
  // Reproduces the production bug: clicking Deactivate hid a teacher's row
  // immediately, but the row reappeared as soon as the click's own network
  // round trip settled — before the slower `router.refresh()` had delivered
  // a `rows` prop that no longer contains that teacher — because the hidden
  // flag lived in `useOptimistic`, which reverts to the stale `rows` prop the
  // moment its owning transition settles, not when fresh data arrives.
  //
  // Tracking "hidden" ids in plain state and pruning them only via
  // `resyncOverrides` (the same signature-comparison rule already proven for
  // advisory chips) fixes it: the flag survives any *unrelated* re-render and
  // is dropped only once that row's own signature has actually moved — here,
  // moved all the way to "gone from the list".
  it("keeps a deactivated row hidden through an unrelated refresh, then prunes once the row is confirmed gone", () => {
    const rowA = row(ROW_A, []);
    const rowB = row(ROW_B, []);

    // Click: hide A immediately, before any network round trip.
    let hidden: Record<string, true> = { [ROW_A]: true };
    let signatures = signaturesFor([rowA, rowB]);

    // An unrelated refresh lands first (e.g. row B's own advisory edit, or a
    // search) — A is still present server-side because the deactivate call
    // hasn't committed yet from this refresh's point of view.
    const rowBEdited = row(ROW_B, ["s9"]);
    const midSignatures = signaturesFor([rowA, rowBEdited]);
    hidden = resyncOverrides(hidden, signatures, midSignatures);
    signatures = midSignatures;

    expect(visibleRows([rowA, rowBEdited], hidden).map((r) => r.id)).toEqual([
      ROW_B,
    ]);

    // The deactivate's own refresh finally lands: the active-teachers query
    // no longer returns A at all.
    const finalSignatures = signaturesFor([rowBEdited]);
    hidden = resyncOverrides(hidden, signatures, finalSignatures);

    expect(hidden).toEqual({});
  });

  it("rolls back instantly on a failed action, without waiting for any refresh", () => {
    const hidden: Record<string, true> = { [ROW_A]: true };
    // Roll back: the server action failed, so the click's optimistic hide is
    // undone directly — never gated on `resyncOverrides`/`rows` at all.
    delete hidden[ROW_A];

    expect(visibleRows([row(ROW_A, [])], hidden)).toEqual([row(ROW_A, [])]);
  });
});
