import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  flattenNavGroups,
  getNavGroups,
  termsReportsHref,
} from "@/lib/nav/nav-config";
import { ADVISORY_MODE_LABELS } from "@/lib/constants/enum-labels";
import {
  advisoryCapFor,
  advisoryCapReason,
  MAX_ADVISORY_SECTIONS,
} from "@/lib/teachers/advisory-limits";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { termSheetHref } from "@/lib/terms/advisory-href";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Multi-advisory: one teacher, up to three sections, which need NOT share a
 * grade.
 *
 * Two separate claims are pinned here, and they fail for different reasons.
 *
 * 1. **The word.** `MULTI_GRADE` survives as the stored enum value for backward
 *    compatibility — renaming it would be a risky migration for no user-visible
 *    gain — but "multi-grade" must never reach a screen. The name is also simply
 *    wrong about the feature: the sections may all sit in one grade.
 *
 * 2. **The routing.** A teacher who advises in two grades must be able to reach
 *    EITHER sheet, and one who advises two sections in a single grade must be
 *    asked which. Every place that turns an advisory into a URL is the place
 *    that used to answer "the first one".
 */

const REPO_ROOT = join(__dirname, "..", "..");

const read = (relative: string) =>
  readFileSync(join(REPO_ROOT, relative), "utf8");

describe("multi-advisory — the word a person reads", () => {
  it("labels the advisory mode Multi-advisory, never Multi-grade", () => {
    expect(ADVISORY_MODE_LABELS.MULTI_GRADE).toBe("Multi-advisory");
    for (const label of Object.values(ADVISORY_MODE_LABELS)) {
      expect(label).not.toMatch(/multi.?grade/i);
    }
  });

  it("keeps MULTI_GRADE as the stored key, so no enum migration is needed", () => {
    // The compatibility half. Renaming the key would mean rewriting an enum in
    // Postgres and every stored row with it; the label above is the whole fix.
    expect(Object.keys(ADVISORY_MODE_LABELS).sort()).toEqual([
      "DEFAULT",
      "FLOATING",
      "MULTI_GRADE",
    ]);
  });

  it("says multi-advisory in the School Head's cap explanation", () => {
    const reason = advisoryCapReason("Teacher", "MULTI_GRADE");
    expect(reason).toMatch(/Multi-advisory/);
    expect(reason).not.toMatch(/multi.?grade/i);
    // And the nudge on the one-section default names the same setting, so a
    // School Head can act on it without translating.
    const nudge = advisoryCapReason("Teacher", "DEFAULT");
    expect(nudge).toMatch(/Multi-advisory/);
    expect(nudge).not.toMatch(/multi.?grade/i);
  });

  it("ships no user-facing multi-grade string anywhere in src/", () => {
    // A file-level sweep, because the failure mode is one forgotten label in a
    // component nobody thought to check. Only the enum token may survive.
    const files = [
      "src/lib/constants/enum-labels.ts",
      "src/lib/teachers/advisory-limits.ts",
      "src/lib/validators/profile.schema.ts",
      "src/components/forms/teacher-profile-form.tsx",
      "src/components/school-head/teacher-role-dialog.tsx",
      "src/components/teachers-active-table.tsx",
    ];
    for (const file of files) {
      const withoutEnumToken = read(file).replaceAll("MULTI_GRADE", "");
      expect(withoutEnumToken, file).not.toMatch(/multi.?grade/i);
    }
  });

  it("caps a multi-advisory teacher at three sections, in any grades", () => {
    expect(advisoryCapFor("Teacher", "MULTI_GRADE")).toBe(MAX_ADVISORY_SECTIONS);
    expect(advisoryCapFor("Teacher", "DEFAULT")).toBe(1);
    // The cap is about count, never about how many grades those sections span.
    expect(advisoryCapReason("Teacher", "MULTI_GRADE")).toMatch(/any grades/);
  });
});

describe("multi-advisory — the End of Terms Reports href", () => {
  const g4Sampaguita = { sectionId: "sec-sampaguita", gradeLevelId: "grade-g4" };
  const g5Rosal = { sectionId: "sec-rosal", gradeLevelId: "grade-g5" };
  const g4Ilang = { sectionId: "sec-ilang", gradeLevelId: "grade-g4" };

  it("deep-links a teacher with exactly one advisory", () => {
    expect(termsReportsHref([g4Sampaguita])).toBe(
      "/teacher/aral/grade-g4/terms-reports"
    );
  });

  it("sends a teacher with advisories in TWO grades to the chooser", () => {
    // THE regression. The row used to carry one `advisoryGradeLevelId` off the
    // shell, which was whichever section the query happened to return first, so
    // a Grade 4 / Grade 5 adviser had no sidebar route to their Grade 5 sheet at
    // all. A resolver that lists both is the honest destination.
    expect(termsReportsHref([g4Sampaguita, g5Rosal])).toBe("/teacher/terms-reports");
  });

  it("sends a teacher with two sections in ONE grade to the chooser too", () => {
    // Same grade, two sheets. A grade-scoped deep link cannot say which, so it
    // must not be built — the grade id is not enough information.
    expect(termsReportsHref([g4Sampaguita, g4Ilang])).toBe("/teacher/terms-reports");
  });

  it("falls back to the resolver for no advisory and for a failed read", () => {
    expect(termsReportsHref([])).toBe("/teacher/terms-reports");
    expect(termsReportsHref()).toBe("/teacher/terms-reports");
    // Spelled out because a stringified empty value still looks like a deep link.
    expect(termsReportsHref()).not.toContain("undefined");
    expect(termsReportsHref()).not.toContain("null");
  });

  it("names the section in every link built for a sheet", () => {
    // The grade rides in the path, the section in the query. Without the second
    // half, a bookmark stops meaning one roster the moment the teacher picks up
    // a second section in that grade.
    expect(termSheetHref(g4Sampaguita)).toBe(
      "/teacher/aral/grade-g4/terms-reports?section=sec-sampaguita"
    );
    expect(termSheetHref(g4Ilang)).toBe(
      "/teacher/aral/grade-g4/terms-reports?section=sec-ilang"
    );
    // Two sections in one grade produce two DIFFERENT links, which is the whole
    // point — by grade alone these two collapse into one.
    expect(termSheetHref(g4Sampaguita)).not.toBe(termSheetHref(g4Ilang));
  });

  it("carries an extra param without losing the section", () => {
    expect(termSheetHref(g5Rosal, { term: "SECOND" })).toContain("section=sec-rosal");
    expect(termSheetHref(g5Rosal, { term: "SECOND" })).toContain("term=SECOND");
    // An absent extra must not become the string "undefined" in the query.
    expect(termSheetHref(g5Rosal, { term: undefined })).toBe(
      "/teacher/aral/grade-g5/terms-reports?section=sec-rosal"
    );
  });

  it("keeps the deep href live and unhijacked for a single-advisory teacher", () => {
    const items = flattenNavGroups(
      getNavGroups("TEACHER", [{ id: "grade-g4", label: "Grade 4", hasAral: true }], {
        advisoryPlacements: [g4Sampaguita],
      })
    );
    const row = items.find((i) => i.id === "teacher-terms-reports");
    expect(row?.href).toBe("/teacher/aral/grade-g4/terms-reports");
    expect(row?.unavailable).toBeUndefined();
  });
});

describe("floating teachers — no advisory, ARAL still open", () => {
  const floatingNav = () =>
    getNavGroups("TEACHER", [{ id: "g1", label: "Grade 3", hasAral: true }], {
      isFloating: true,
    });

  it("closes the roster and the end-of-term sheet, and says why", () => {
    const items = flattenNavGroups(floatingNav());
    for (const id of ["teacher-learners", "teacher-terms-reports"]) {
      expect(items.find((i) => i.id === id)?.unavailable, id).toEqual({
        pill: "Floating teacher",
        reason: "for teachers who advise a section",
      });
    }
  });

  it("leaves both ARAL rows live, with their real grade-scoped hrefs", () => {
    // A floating teacher's ARAL tutoring is untouched: `aralLearnerScope` has
    // never required an advisory, so closing these rows would take away the only
    // work they have.
    const items = flattenNavGroups(floatingNav());
    for (const id of ["teacher-aral-attendance", "teacher-aral-reading-level"]) {
      const row = items.find((i) => i.id === id);
      expect(row?.unavailable, id).toBeUndefined();
      expect(row?.href, id).toMatch(/^\/teacher\/aral\/g1\//);
    }
    // And Reports, which reads ARAL records, stays open too.
    expect(items.find((i) => i.id === "teacher-reports")?.unavailable).toBeUndefined();
  });

  it("closes the same two pages behind those rows, not just the rows", () => {
    // A disabled row is not access control. The predicate the pages call must
    // agree with the nav, or the sidebar advertises a dead end or hides a live
    // page.
    expect(
      advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "FLOATING" })
    ).toBe("floating");
    // A multi-advisory teacher is never denied — they advise more, not less.
    expect(
      advisoryRosterDenial({
        isSuperAdmin: false,
        designation: "Teacher",
        advisoryMode: "MULTI_GRADE",
      })
    ).toBeNull();
    // The volunteer's reason wins over the mode, because it is a different fact.
    expect(
      advisoryRosterDenial({
        isSuperAdmin: false,
        designation: ARAL_VOLUNTEER_DESIGNATION,
        advisoryMode: "FLOATING",
      })
    ).toBe("volunteer");
  });

  it("gives a floating teacher an advisory cap of zero", () => {
    expect(advisoryCapFor("Teacher", "FLOATING")).toBe(0);
    expect(advisoryCapReason("Teacher", "FLOATING")).toMatch(/don't advise a section/);
  });
});
