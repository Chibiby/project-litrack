import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenNavGroups, getNavGroups } from "@/lib/nav/nav-config";
import { aralProfileSchema } from "@/lib/validators/aral.schema";
import { WRITE_ORDER } from "@/lib/db/schema-order";
import { buildMosyBlocks, type MosyInput } from "@/lib/reports/mosy";

/**
 * The ARAL Profile (Sections C–D–E) was dormant and is back, with one entry
 * point: the ARAL Profiling page under ARAL Program (restored 1.19.0 by
 * project-owner request). Guarded here:
 *
 * - **One place asks for it.** The ARAL Profiling page and the dashboard's
 *   Pending Profiles card link to the form; the roster, the learner list and
 *   the School Head dashboard still do not.
 * - **No absenteeism questions.** Weekly Attendance already records absences.
 * - **Nothing depends on it.** The live ARAL workflows must not require a
 *   profile row. See `docs/aral-profile.md`.
 */

const REPO_ROOT = join(__dirname, "..", "..");

const read = (relative: string) =>
  readFileSync(join(REPO_ROOT, relative), "utf8");

describe("ARAL Profile — preserved, not deleted", () => {
  it("keeps the validator and its conditional rules working", () => {
    const parsed = aralProfileSchema.safeParse({
      learnerId: "learner-1",
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
    expect(source).toMatch(/export (async function|const) saveAralProfile\b/);
    expect(source).toContain("aralProfileSchema");
    // Dormant must not mean unguarded: a typed URL still hits the real action.
    expect(source).toContain("writeAudit");
  });
});

describe("ARAL Profile — asked for in one place only", () => {
  it("reaches the form only through the ARAL Profiling page, not the old Learner Profiling row", () => {
    for (const grades of [[], [{ id: "g1", label: "Grade 3", hasAral: true }], undefined]) {
      const items = flattenNavGroups(getNavGroups("TEACHER", grades));
      expect(items.some((i) => i.id === "teacher-learner-profiling")).toBe(false);
      expect(items.find((i) => i.id === "teacher-aral-profiling")?.href).toBe(
        "/teacher/aral/profiling"
      );
    }
    const page = read("src/app/teacher/(app)/aral/profiling/page.tsx");
    expect(page).toContain("learners/${l.id}/update");
    // Same tutor scope as saveAralProfile, so no button can only fail.
    expect(page).toContain("aralLearnerScope");
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

  it("links the teacher dashboard Pending Profiles card to the Pending tab of ARAL Profiling", () => {
    const teacherDashboard = read("src/components/dashboard/teacher/dashboard-body.tsx");
    const cardStart = teacherDashboard.indexOf('title="Pending Profiles"');
    const cardEnd = teacherDashboard.indexOf("/>", cardStart);
    expect(teacherDashboard.slice(cardStart, cardEnd)).toContain("aralProfilingHref()");
    expect(read("src/components/dashboard/teacher/hrefs.ts")).toContain(
      "/teacher/aral/profiling?status=pending"
    );
    // The count uses the same tutor scope as the page it links to.
    expect(read("src/lib/dashboard/teacher-overview.ts")).toContain("aralLearnerScope(teacherId)");

    // The School Head dashboard nudge stays removed.
    const schoolHead = read("src/components/dashboard/school-head-dashboard-sections.tsx");
    expect(schoolHead).not.toContain("pendingAralProfiles");
    expect(schoolHead).not.toMatch(/Pending Profiles/);
  });

  it("does not ask about absenteeism — Weekly Attendance already records it", () => {
    expect(read("src/components/forms/aral-update-form.tsx")).not.toContain("name=\"absenteeism");
    expect(read("src/lib/validators/aral.schema.ts")).not.toMatch(/absenteeism\w*:/);
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

  it("the MOSY report still yields four non-empty blocks when every learner's profile is null", () => {
    const input: MosyInput = {
      window: {
        startKey: "2026-11-01",
        endKey: "2027-01-31",
        label: "November - January",
        source: "term",
      },
      grades: [{ id: "grade-3", type: "G3", label: "Grade 3" }],
      learners: [
        {
          id: "l1",
          gradeLevelId: "grade-3",
          gradeType: "G3",
          gradeLabel: "Grade 3",
          sectionName: "Sampaguita",
          firstName: "Juan",
          middleName: null,
          lastName: "Cruz",
          isAralLearner: true,
          aralTutorName: "T. Santos",
          record: null,
          profile: null,
          sex: "MALE",
        },
        {
          id: "l2",
          gradeLevelId: "grade-3",
          gradeType: "G3",
          gradeLabel: "Grade 3",
          sectionName: "Sampaguita",
          firstName: "Ana",
          middleName: null,
          lastName: "Reyes",
          isAralLearner: true,
          aralTutorName: "T. Santos",
          record: null,
          profile: null,
          sex: "FEMALE",
        },
      ],
    };

    const blocks = buildMosyBlocks(input);
    // Six blocks now — the two DepEd (CRLA / Phil-IRI) summaries lead the
    // original four; the dormant-safety rule this test guards ("no throw,
    // no vanishing block when every profile is null") still holds for all six.
    expect(blocks).toHaveLength(6);
    // Every block with a G3 row is non-empty; the Phil-IRI summary's bucket
    // is Grades 4+ and G3 is the only grade in this fixture, so that block is
    // legitimately empty rather than a bug.
    for (const block of blocks) {
      if (block.heading === "Summary by Grade and Sex — Phil-IRI (Grades 4+)") continue;
      expect(block.rows.length).toBeGreaterThan(0);
    }
  });
});
