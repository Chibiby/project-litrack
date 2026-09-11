import { describe, it, expect } from "vitest";
import { UnlockScope } from "@prisma/client";
import { UNLOCK_SCOPE_LABELS } from "@/lib/constants/enum-labels";

/**
 * `UNLOCK_SCOPE_LABELS` backs the support inbox's unlock-request chip
 * (`support-inbox.tsx`). A scope with no label there renders the raw enum
 * constant to a school user. This pins the current scope, and fails on its
 * own the next time `UnlockScope` grows a value nobody added a label for.
 */
describe("UNLOCK_SCOPE_LABELS", () => {
  it("has a label for MONTHLY_READING_LEVEL", () => {
    expect(UNLOCK_SCOPE_LABELS.MONTHLY_READING_LEVEL).toBe(
      "Monthly reading level"
    );
  });

  it("covers every UnlockScope value", () => {
    const missing = Object.values(UnlockScope).filter(
      (scope) => !(scope in UNLOCK_SCOPE_LABELS)
    );
    expect(missing).toEqual([]);
  });
});
