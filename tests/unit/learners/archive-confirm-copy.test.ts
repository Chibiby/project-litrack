import { describe, expect, it } from "vitest";
import {
  REMOVE_CANCEL_LABEL,
  archiveConfirmDescription,
  archiveConfirmLabel,
  archiveConfirmTitle,
  removalDeletionLabel,
} from "@/components/learners/archive-confirm-copy";
import { REMOVAL_CLOCK_START, removalExpiresAt } from "@/lib/learners/removal";
import { formatSchoolDate } from "@/lib/format-datetime";

const one = { ids: ["a"], name: "Ana Santos", aralCount: 0 };
const many = { ids: ["a", "b"], name: null, aralCount: 1 };

describe("remove confirm copy", () => {
  it("titles name the learner or the count", () => {
    expect(archiveConfirmTitle(one)).toBe("Remove Ana Santos?");
    expect(archiveConfirmTitle(many)).toBe("Remove 2 learners?");
  });

  it("answers read Yes, remove / No", () => {
    expect(archiveConfirmLabel(one)).toBe("Yes, remove");
    expect(archiveConfirmLabel(many)).toBe("Yes, remove");
    expect(REMOVE_CANCEL_LABEL).toBe("No");
  });

  it("states the 30-day restore window and who can restore afterwards", () => {
    const text = archiveConfirmDescription(one);
    expect(text).toContain("Ana Santos will move to Removed.");
    expect(text).toContain("restore them from Removed for 30 days");
    expect(text).toContain("only your division or district office can restore them");
    expect(text).not.toContain("ARAL");
  });

  it("adds the ARAL consequence only when someone is in ARAL", () => {
    expect(archiveConfirmDescription(many)).toContain(
      "1 of them is in ARAL and leave the ARAL weekly grids while removed"
    );
    expect(
      archiveConfirmDescription({ ids: ["a"], name: "Ana", aralCount: 1 })
    ).toContain("leaves the ARAL weekly grids while removed");
  });

  it("never says archive", () => {
    for (const t of [one, many, { ids: ["a"], name: "Ana", aralCount: 1 }]) {
      const all = [
        archiveConfirmTitle(t),
        archiveConfirmLabel(t),
        archiveConfirmDescription(t),
      ].join(" ");
      expect(all).not.toMatch(/archiv/i);
    }
  });
});

describe("removalDeletionLabel", () => {
  it("shows the date the removal window closes", () => {
    const removedAt = new Date(REMOVAL_CLOCK_START.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(removalDeletionLabel(removedAt.toISOString())).toBe(
      `Deletes ${formatSchoolDate(removalExpiresAt(removedAt))}`
    );
    expect(removalDeletionLabel(removedAt.toISOString())).toBe("Deletes Nov 18, 2026");
  });

  it("counts older removals from the clock start", () => {
    expect(removalDeletionLabel("2026-01-01T00:00:00.000Z")).toBe("Deletes Nov 13, 2026");
  });
});
