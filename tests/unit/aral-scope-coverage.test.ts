import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/**
 * Every ARAL surface, by file. Listed rather than globbed for the two write
 * paths, because `attendance.ts` and `reading-level.ts` are ARAL-only files that
 * do not sit under an `aral/` directory, and a glob would quietly miss them —
 * which is how §11's bug survived as long as it did.
 */
const ARAL_FILES = [
  "app/teacher/(app)/aral",
  "lib/actions/aral.ts",
  "lib/actions/aral-grid.ts",
  "lib/actions/attendance.ts",
  "lib/actions/reading-level.ts",
];

/** The wide predicates. Correct almost everywhere; wrong on an ARAL page. */
const WIDE = ["teacherLearnerScope", "teacherCanAccessLearner"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function aralSources(): string[] {
  const files: string[] = [];
  for (const rel of ARAL_FILES) {
    const full = path.join(SRC, rel);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");

/**
 * §11 of the ten concerns, pinned at the call sites rather than only in the
 * predicate.
 *
 * `teacherLearnerScope` asks "may this teacher act on the learner" — adviser OR
 * designated ARAL tutor. Every ARAL page and write path used it, so an adviser
 * saw and could encode the ARAL records of learners in their own class that
 * somebody else is the designated tutor for. `tests/unit/teachers-scope.test.ts`
 * guards the two predicates; this file guards which one each surface reaches for,
 * because the predicates were never wrong — the wiring was.
 *
 * A new ARAL page that reaches for the wide predicate fails here. If a genuinely
 * advisory-shaped feature is ever added under `aral/`, this list is the place to
 * say so, in the open, with a reason.
 */
describe("ARAL surfaces use the narrow learner scope", () => {
  it("finds the ARAL sources it claims to cover", () => {
    const files = aralSources().map(rel);
    // A guard against the guard: a renamed directory would otherwise make this
    // suite pass by covering nothing.
    expect(files.length).toBeGreaterThan(6);
    expect(files).toContain("lib/actions/aral-grid.ts");
    expect(files).toContain("lib/actions/attendance.ts");
    expect(files).toContain("lib/actions/reading-level.ts");
  });

  it("never reaches for the advisory-or-ARAL predicates", () => {
    const offenders: string[] = [];
    for (const file of aralSources()) {
      const text = readFileSync(file, "utf8");
      for (const wide of WIDE) {
        if (new RegExp(`\\b${wide}\\b`).test(text)) {
          offenders.push(`${rel(file)} → ${wide}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually narrows: every ARAL learner query names the ARAL predicate", () => {
    // The complement of the test above. Removing the wide predicate and putting
    // nothing in its place would widen the page to the whole grade, which is
    // worse than the bug being fixed.
    const scoped: string[] = [];
    for (const file of aralSources()) {
      const text = readFileSync(file, "utf8");
      if (/aralLearnerScope|teacherIsAralTutorFor/.test(text)) {
        scoped.push(rel(file));
      }
    }
    expect(scoped).toEqual(
      expect.arrayContaining([
        "app/teacher/(app)/aral/page.tsx",
        "app/teacher/(app)/aral/[gradeId]/attendance/page.tsx",
        "app/teacher/(app)/aral/[gradeId]/reading-level/page.tsx",
        "app/teacher/(app)/aral/[gradeId]/learners/[id]/attendance/page.tsx",
        "app/teacher/(app)/aral/[gradeId]/learners/[id]/reading-level/page.tsx",
        "app/teacher/(app)/aral/[gradeId]/learners/[id]/update/page.tsx",
        "lib/actions/aral.ts",
        "lib/actions/aral-grid.ts",
        "lib/actions/attendance.ts",
        "lib/actions/reading-level.ts",
      ])
    );
  });

  it("leaves the advisory surfaces on the wide predicate", () => {
    // The other half of the rule, and the reason `teacherLearnerScope` was not
    // simply narrowed: these are the pages an adviser is entitled to, and every
    // one of them would go blank for an adviser under the ARAL predicate.
    const advisory = [
      "app/teacher/(app)/learners/page.tsx",
      "app/teacher/(app)/grade/[id]/learners/[learnerId]/page.tsx",
      "components/learners/learner-stat-cards.tsx",
      "lib/actions/global-search.ts",
      "lib/actions/learner-profile.ts",
      "lib/dashboard/aggregates.ts",
      "lib/reports/queries.ts",
    ];
    for (const file of advisory) {
      const text = readFileSync(path.join(SRC, file), "utf8");
      expect(text, `${file} lost the advisory scope`).toMatch(
        /teacherLearnerScope/
      );
    }
  });
});
