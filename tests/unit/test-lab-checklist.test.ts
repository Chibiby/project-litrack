import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ALIASES, buildTestLabChecklist, type TestLabChecklistFixtures } from "@/lib/test-lab/checklist";

/**
 * Coverage test for the Page Test Lab checklist (docs/test-lab-spec.md, T3).
 *
 * Walks every `page.tsx` under `src/app/school-head` and `src/app/teacher` and
 * requires each one to be reachable from `buildTestLabChecklist` or listed in
 * `ALIASES` — the two places Test Lab claims to cover a page. `[...missing]`
 * is the catch-all 404 and is excluded on purpose: there is nothing to open.
 */

const APP_DIR = path.resolve(__dirname, "../../src/app");

function findPageFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry === "page.tsx") {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/** `.../src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx` -> `/teacher/aral/[gradeId]/attendance` */
function routeOf(pageFile: string): string {
  const rel = path
    .relative(APP_DIR, pageFile)
    .replace(/\\/g, "/")
    .replace(/\/page\.tsx$/, "");
  const segments = rel.split("/").filter((seg) => !/^\(.*\)$/.test(seg));
  return "/" + segments.join("/");
}

/** `/teacher/aral/[gradeId]/attendance` -> `^/teacher/aral/[^/]+/attendance$` */
function routeRegex(route: string): RegExp {
  const pattern = route
    .split("/")
    .map((seg) => (/^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function isCatchAllMissing(route: string): boolean {
  return route.includes("[...missing]");
}

const SAMPLE_FIXTURES: TestLabChecklistFixtures = {
  gradeId: "11111111-1111-4111-8111-111111111111",
  secondGradeId: "22222222-2222-4222-8222-222222222222",
  learnerId: "33333333-3333-4333-8333-333333333333",
  aralLearnerId: "44444444-4444-4444-8444-444444444444",
};

const checklist = buildTestLabChecklist(SAMPLE_FIXTURES);
const checklistHrefs = checklist.map((item) => item.href);

describe("buildTestLabChecklist coverage", () => {
  it.each(["school-head", "teacher"] as const)("covers every page.tsx under src/app/%s", (root) => {
    const pageFiles = findPageFiles(path.join(APP_DIR, root));
    expect(pageFiles.length).toBeGreaterThan(0);

    const uncovered: string[] = [];
    for (const file of pageFiles) {
      const route = routeOf(file);
      if (isCatchAllMissing(route)) continue;

      const matchesChecklist = checklistHrefs.some((href) => routeRegex(route).test(href));
      const matchesAlias = ALIASES.some((alias) => routeRegex(route).test(alias));
      if (!matchesChecklist && !matchesAlias) {
        uncovered.push(route);
      }
    }

    expect(uncovered, `pages missing from the checklist and ALIASES: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("gives every checklist item a role matching its own path", () => {
    for (const item of checklist) {
      expect(item.href.startsWith(item.role === "SCHOOL_HEAD" ? "/school-head" : "/teacher")).toBe(true);
    }
  });

  it("builds only well-formed, single-role app paths from fixture ids", () => {
    const wellFormed = /^\/(school-head|teacher)(\/[A-Za-z0-9._-]+)*$/;
    for (const item of checklist) {
      expect(item.href, item.href).toMatch(wellFormed);
      expect(item.href).not.toContain("//");
      expect(item.href).not.toContain("..");
    }
  });

  it("every fixture id actually reaches the href it was given for", () => {
    const { gradeId, secondGradeId, learnerId, aralLearnerId } = SAMPLE_FIXTURES;
    const gradeItem = checklist.find((i) => i.id === "t-grade");
    const secondGradeItem = checklist.find((i) => i.id === "t-grade-second");
    const learnerItem = checklist.find((i) => i.id === "t-learner");
    const aralLearnerItem = checklist.find((i) => i.id === "t-aral-learner-attendance");

    expect(gradeItem?.href).toBe(`/teacher/grade/${gradeId}`);
    expect(secondGradeItem?.href).toBe(`/teacher/grade/${secondGradeId}`);
    expect(learnerItem?.href).toBe(`/teacher/grade/${gradeId}/learners/${learnerId}`);
    expect(aralLearnerItem?.href).toBe(`/teacher/aral/${gradeId}/learners/${aralLearnerId}/attendance`);
  });

  it("ALIASES itself contains no dynamic segments and no duplicates", () => {
    for (const alias of ALIASES) {
      expect(alias).not.toMatch(/\[.+\]/);
    }
    expect(new Set(ALIASES).size).toBe(ALIASES.length);
  });

  it("the checklist carries no duplicate ids", () => {
    const ids = checklist.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
