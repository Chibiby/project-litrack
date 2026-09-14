import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenNavGroups, getNavGroups } from "@/lib/nav/nav-config";
import { aralProfileSchema } from "@/lib/validators/aral.schema";
import { WRITE_ORDER } from "@/lib/db/schema-order";

/**
 * The ARAL Profile (Sections C–D–E) is DORMANT, not deleted.
 *
 * Two opposite mistakes are guarded here, and either one loses real work:
 *
 * - **Reviving it by accident.** A nav row, a "Complete Profiling" button or a
 *   pending-count card is all it takes to put teachers back to work on a survey
 *   nobody is asking them to fill in. The call to action IS the workflow.
 * - **Deleting it.** The schema, the validator, the action and the route stay,
 *   because schools that already filled these in keep their data and the feature
 *   is meant to come back as a config change rather than a migration.
 *
 * The third claim, and the one that matters day to day: the live ARAL workflows
 * must not depend on a profile row existing. See `docs/aral-profile.md`.
 */

const REPO_ROOT = join(__dirname, "..", "..");

const read = (relative: string) =>
  readFileSync(join(REPO_ROOT, relative), "utf8");

describe("ARAL Profile — preserved, not deleted", () => {
  it("keeps the validator and its conditional rules working", () => {
    // Parked, not broken: the schema still parses, so reviving the form needs no
    // archaeology.
    const parsed = aralProfileSchema.safeParse({
      learnerId: "learner-1",
      absenteeismFrequency: "ONE_TO_THREE_PER_MONTH",
      // The conditional rule is part of what "still works" means: the frequency
      // demands its own specify field, so a payload without it would pass for
      // the wrong reason.
      absenteeismOtherReason: "Illness",
      absenteeismReasons: ["BAD_WEATHER"],
      letterRecognition: "ALL_EASY",
      letterSoundCorrespondence: "ACCURATE",
      wordRecognition: "READS_HF_FLUENT",
      homeLiteracyEnvironment: "HAS_ACCESS",
      parentalSupport: "REGULAR",
      classroomEnvironment: "SMALL_CLASS",
      languageConsiderations: ["MATCHES_LOI"],
      suggestedInterventions: ["PHONEMIC_AWARENESS"],
      furtherAssessment: ["MFAT"],
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the create/update route on disk", () => {
    expect(
      existsSync(
        join(REPO_ROOT, "src/app/teacher/(app)/aral/[gradeId]/learners/[id]/update/page.tsx")
      )
    ).toBe(true);
    expect(existsSync(join(REPO_ROOT, "src/components/forms/aral-update-form.tsx"))).toBe(
      true
    );
  });

  it("keeps the model, so no rows are orphaned or dropped", () => {
    expect(read("prisma/schema.prisma")).toContain("model AralProfile");
    // Still in the write order, so a restore rebuilds it in the right place.
    expect(WRITE_ORDER.map((m) => m.model)).toContain("AralProfile");
  });

  it("keeps saveAralProfile with its guards intact", () => {
    const source = read("src/lib/actions/aral.ts");
    expect(source).toContain("export async function saveAralProfile");
    expect(source).toContain("aralProfileSchema");
    // Dormant must not mean unguarded: a typed URL still hits the real action.
    expect(source).toContain("writeAudit");
  });
});

describe("ARAL Profile — nothing asks anyone to complete one", () => {
  it("has no Learner Profiling row in the teacher menu", () => {
    for (const grades of [[], [{ id: "g1", label: "Grade 3", hasAral: true }], undefined]) {
      const items = flattenNavGroups(getNavGroups("TEACHER", grades));
      expect(items.some((i) => i.id === "teacher-learner-profiling")).toBe(false);
      expect(items.map((i) => i.label)).not.toContain("Learner Profiling");
    }
  });

  it("has no Complete/Update Profiling call to action on the ARAL roster", () => {
    const source = read("src/app/teacher/(app)/aral/page.tsx");
    expect(source).not.toMatch(/Complete Profiling/);
    expect(source).not.toMatch(/Update Profiling/);
    expect(source).not.toMatch(/learners\/\$\{[^}]+\}\/update/);
    // And no completion status column standing in for the button.
    expect(source).not.toMatch(/Profile complete\?/);
    expect(source).not.toContain("aralProfile");
  });

  it("has no ARAL Profile status column on the advisory roster", () => {
    const list = read("src/components/learners/learner-list-client.tsx");
    expect(list).not.toContain("hasAralProfile");
    expect(list).not.toMatch(/<TableHead[^>]*>ARAL Profile<\/TableHead>/);
    expect(read("src/app/teacher/(app)/learners/page.tsx")).not.toContain("aralProfile");
  });

  it("has no Pending Profiles card on either dashboard", () => {
    expect(read("src/components/dashboard/teacher/dashboard-body.tsx")).not.toMatch(
      /Pending Profiles/
    );
    expect(read("src/lib/dashboard/teacher-overview.ts")).not.toContain(
      "pendingAralProfiles"
    );
    const schoolHead = read("src/components/dashboard/school-head-dashboard-sections.tsx");
    expect(schoolHead).not.toContain("pendingAralProfiles");
    expect(schoolHead).not.toMatch(/still need Sections/);
  });

  it("does not prompt for a missing profile on the learner surfaces", () => {
    // Absent is an ordinary state now, so the empty card that used to say
    // "Sections C–E appear here after Update Data is saved" has to be gone —
    // that sentence is an instruction, not a status.
    for (const file of [
      "src/app/teacher/(app)/grade/[id]/learners/[learnerId]/page.tsx",
      "src/components/learners/learner-profile-modal/aral-panel.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/ARAL profile not completed/);
      expect(read(file), file).not.toMatch(/after Update Data is saved/);
    }
  });

  it("does not hand the AI assistant a list of missing profiles", () => {
    expect(read("src/lib/assistant/scope.ts")).not.toContain("aralProfile");
    expect(read("src/lib/assistant/prompt.ts")).not.toContain("pendingProfiles");
  });
});

describe("ARAL Profile — the live workflows do not depend on one", () => {
  /**
   * The load-bearing claim. Each of these pages and actions is read as source
   * and asserted not to consult `aralProfile` at all — a gate is easy to add by
   * reflex ("they should profile the learner first"), and a teacher blocked out
   * of attendance by a dormant survey has no way to unblock themselves.
   */
  const liveWorkflows = [
    "src/app/teacher/(app)/aral/[gradeId]/attendance/page.tsx",
    "src/app/teacher/(app)/aral/[gradeId]/reading-level/page.tsx",
    "src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx",
    "src/app/teacher/(app)/terms-reports/page.tsx",
    "src/lib/actions/aral-grid.ts",
    "src/lib/actions/term-grades.ts",
  ];

  for (const file of liveWorkflows) {
    it(`does not read or require an ARAL profile in ${file}`, () => {
      expect(existsSync(join(REPO_ROOT, file)), `${file} missing`).toBe(true);
      expect(read(file), file).not.toMatch(/aralProfile/i);
    });
  }

  it("enrolling a learner into ARAL does not create or demand a profile", () => {
    // `enrollLearnersToAral` lives in the learner action module; it flips
    // `isAralLearner` and designates a tutor, and must not reach for a survey.
    const source = read("src/lib/actions/learner.ts");
    const enroll = source.slice(source.indexOf("enrollLearnersToAral"));
    expect(enroll).not.toMatch(/aralProfile/i);
  });
});
