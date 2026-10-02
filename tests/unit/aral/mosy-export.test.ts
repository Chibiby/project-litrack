import { describe, expect, it } from "vitest";
import {
  buildMosyExportBlocks,
  buildMosyExportTable,
  describeMosyFilters,
  MOSY_EXPORT_TITLE,
  type MosyExportInput,
} from "@/lib/aral/mosy-export";
import {
  MOSY_STATUS_LABELS,
  computeMosyStats,
  formatBosyLevel,
  mosyLevelLanguage,
  mosyReasonLabel,
  type MosyRowStatus,
} from "@/lib/aral/mosy";
import type { MosyExportRow } from "@/lib/aral/mosy-queries";
import { GRADE_LEVEL_LABELS, labelReadingProfile } from "@/lib/constants/enum-labels";
import { EMPTY_REPORT_FRAME } from "@/lib/reports/report-frame";

/**
 * Pure layout of the MOSY Report export. Fixtures are hand-built; labels come
 * from the real label helpers so the grade-specific wording is the app's own.
 */

const STATS = computeMosyStats({ total: 10, notUpdated: 4, forDecision: 3, movedOut: 2, stay: 1 });

function row(over: Partial<MosyExportRow> & { gradeType?: string } = {}): MosyExportRow {
  const gradeType = over.gradeType ?? "G4";
  return {
    id: "l-1",
    fullName: "Juan Dela Cruz",
    listingName: "Cruz, Juan Dela",
    gradeLevelId: "g-1",
    gradeType,
    gradeLabel: GRADE_LEVEL_LABELS[gradeType] ?? gradeType,
    sectionName: "Sampaguita",
    isAralLearner: true,
    status: "not_updated" as MosyRowStatus,
    levelOptionsByDecision: { STAY: [], MOVE_OUT: [], NONE: [], TRANSFERRED_OUT: [] },
    reasonChoices: [],
    mosyLevel: null,
    mosyLevelLabel: null,
    mosyLanguage: mosyLevelLanguage(gradeType),
    decision: null,
    reason: null,
    improvedToLevel: null,
    reasonLabel: null,
    remarks: null,
    bosyLevel: null,
    ...over,
  };
}

function input(over: Partial<MosyExportInput> = {}): MosyExportInput {
  return {
    frame: EMPTY_REPORT_FRAME,
    teacherName: "Marivic Santos",
    windowLabel: "November - January",
    asOf: new Date(2026, 11, 15, 12),
    filters: { q: "", status: "all", gradeLabel: null, sectionLabel: null },
    stats: STATS,
    rows: [row()],
    totalCount: 1,
    truncated: false,
    ...over,
  };
}

describe("buildMosyExportBlocks", () => {
  it("returns a Summary block then a Learners block", () => {
    const blocks = buildMosyExportBlocks(input());
    expect(blocks.map((b) => b.heading)).toEqual(["Summary", "Learners"]);
  });

  it("Summary carries the five stats with values from computeMosyStats", () => {
    const [summary] = buildMosyExportBlocks(input());
    expect(summary!.rows).toHaveLength(5);
    expect(summary!.rows).toEqual(STATS.cards.map((c) => [c.label, c.value]));
    const byLabel = Object.fromEntries(summary!.rows.map((r) => [r[0] as string, r[1]]));
    expect(byLabel["Total ARAL learners"]).toBe(10);
    expect(byLabel["Updated MOSY level"]).toBe(6); // total - notUpdated
    expect(byLabel["For MOSY decision"]).toBe(3);
    expect(Object.values(byLabel)).toEqual([10, 6, 3, 2, 1]);
  });

  it("For decision is a superset that includes not-updated learners: printed as given, not reduced", () => {
    // mosyStatusWhere("for_decision") also matches learners with no level saved,
    // so with 5 learners and none updated, For decision is 5 and Updated is 0.
    const stats = computeMosyStats({ total: 5, notUpdated: 5, forDecision: 5, movedOut: 0, stay: 0 });
    const [summary] = buildMosyExportBlocks(input({ stats }));
    const byLabel = Object.fromEntries(summary!.rows.map((r) => [r[0] as string, r[1]]));
    expect(byLabel["Updated MOSY level"]).toBe(0);
    expect(byLabel["For MOSY decision"]).toBe(5);
  });

  it("Learners table has the specified columns in order", () => {
    const [, learners] = buildMosyExportBlocks(input());
    expect(learners!.columns.map((c) => c.header)).toEqual([
      "#",
      "Learner name",
      "Grade & section",
      "BOSY reading level",
      "MOSY reading level",
      "ARAL status decision",
      "Reason",
      "Remarks",
    ]);
  });

  it("numbers rows from 1, prints surname-first name and 'Grade - Section'", () => {
    const rows = [row(), row({ id: "l-2", listingName: "Reyes, Ana", sectionName: null })];
    const [, learners] = buildMosyExportBlocks(input({ rows, totalCount: 2 }));
    expect(learners!.rows[0]![0]).toBe(1);
    expect(learners!.rows[1]![0]).toBe(2);
    expect(learners!.rows[0]![1]).toBe("Cruz, Juan Dela");
    expect(learners!.rows[0]![2]).toBe("Grade 4 - Sampaguita");
    // no section -> grade only, no dangling dash
    expect(learners!.rows[1]![2]).toBe("Grade 4");
  });

  it("null cells stay null (blank), never a placeholder", () => {
    const [, learners] = buildMosyExportBlocks(input());
    const cells = learners!.rows[0]!;
    expect(cells[3]).toBeNull(); // BOSY level
    expect(cells[4]).toBeNull(); // MOSY level
    expect(cells[6]).toBeNull(); // reason
    expect(cells[7]).toBeNull(); // remarks
    expect(cells[5]).toBe("Not updated");
  });

  it("uses each grade's own level wording", () => {
    const g1Label = labelReadingProfile("INSTRUCTIONAL_DEVELOPING", "G1");
    const g4Label = labelReadingProfile("INSTRUCTIONAL_DEVELOPING", "G4");
    expect(g1Label).not.toBe(g4Label); // the fixture only proves something if they differ
    const rows = [
      row({ gradeType: "G1", mosyLevel: "INSTRUCTIONAL_DEVELOPING", mosyLevelLabel: g1Label }),
      row({ gradeType: "G4", mosyLevel: "INSTRUCTIONAL_DEVELOPING", mosyLevelLabel: g4Label }),
    ];
    const [, learners] = buildMosyExportBlocks(input({ rows, totalCount: 2 }));
    expect(learners!.rows[0]![4]).toBe(`Fil: ${g1Label}`);
    expect(learners!.rows[1]![4]).toBe(`Eng: ${g4Label}`);
  });

  it("BOSY level shows Filipino and English with no month for G4, English omitted for G1/G2", () => {
    const profiles = {
      englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      filipinoReadingProfile: "FRUSTRATION_HIGH_EMERGENT",
    };
    const rows = [
      row({ gradeType: "G4", bosyLevel: formatBosyLevel(profiles, "G4") }),
      row({ gradeType: "G1", bosyLevel: formatBosyLevel(profiles, "G1") }),
      row({ gradeType: "G2", bosyLevel: formatBosyLevel(profiles, "G2") }),
    ];
    const [, learners] = buildMosyExportBlocks(input({ rows, totalCount: 3 }));
    const [c4, c1, c2] = learners!.rows.map((r) => r[3] as string);
    expect(c4).toBe(
      `Fil: ${labelReadingProfile("FRUSTRATION_HIGH_EMERGENT", "G4")} · Eng: ${labelReadingProfile("INSTRUCTIONAL_DEVELOPING", "G4")}`
    );
    expect(c1).toBe(`Fil: ${labelReadingProfile("FRUSTRATION_HIGH_EMERGENT", "G1")}`);
    expect(c2).not.toContain("Eng");
    expect(c4).not.toMatch(/\(|20\d\d/);
  });

  it("a Grade 1-3 legacy BOSY value prints 'needs update'", () => {
    const bosyLevel = formatBosyLevel(
      { englishReadingProfile: null, filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING" },
      "G2"
    );
    const [, learners] = buildMosyExportBlocks(input({ rows: [row({ gradeType: "G2", bosyLevel })] }));
    expect(learners!.rows[0]![3]).toBe("Fil: Developing or Transitioning — needs update");
  });

  it("BOSY level with neither language is blank", () => {
    const [, learners] = buildMosyExportBlocks(
      input({ rows: [row({ bosyLevel: { filipino: null, english: null } })] })
    );
    expect(learners!.rows[0]![3]).toBeNull();
  });

  it("prints the decision label, reason label and remarks when present", () => {
    const rows = [
      row({
        status: "moved_out",
        reasonLabel: "Diagnosed as Learner with Special Educational Needs (LSEN)",
        remarks: "Referred to SPED",
        mosyLevel: "INSTRUCTIONAL_DEVELOPING",
        mosyLevelLabel: "Developing",
      }),
    ];
    const [, learners] = buildMosyExportBlocks(input({ rows }));
    expect(learners!.rows[0]!.slice(4)).toEqual([
      "Eng: Developing",
      MOSY_STATUS_LABELS.moved_out,
      "Diagnosed as Learner with Special Educational Needs (LSEN)",
      "Referred to SPED",
    ]);
  });

  it("prints Transferred out as the reason", () => {
    const rows = [
      row({
        status: "moved_out",
        reason: "TRANSFERRED_OUT",
        reasonLabel: mosyReasonLabel("TRANSFERRED_OUT", null, "G4"),
      }),
    ];
    const [, learners] = buildMosyExportBlocks(input({ rows }));
    expect(learners!.rows[0]![6]).toBe("Transferred out");
  });
});

describe("describeMosyFilters", () => {
  const base = { q: "", status: "all" as const, gradeLabel: null, sectionLabel: null };

  it("names the defaults", () => {
    expect(describeMosyFilters(base)).toBe("Grade & section: All  |  ARAL status: All");
  });

  it("names grade, section, status and search", () => {
    expect(
      describeMosyFilters({ q: "cruz", status: "for_decision", gradeLabel: "Grade 3", sectionLabel: "A" })
    ).toBe('Grade & section: Grade 3 - A  |  ARAL status: For decision  |  Search: "cruz"');
  });

  it("grade only, and section without grade", () => {
    expect(describeMosyFilters({ ...base, gradeLabel: "Grade 3" })).toContain("Grade & section: Grade 3  |");
    expect(describeMosyFilters({ ...base, sectionLabel: "A" })).toContain("Grade & section: All grades - A");
  });
});

describe("buildMosyExportTable", () => {
  it("titles the report and mirrors the learners block as flat columns/rows", () => {
    const t = buildMosyExportTable(input());
    expect(t.title).toBe(MOSY_EXPORT_TITLE);
    expect(t.reportingPeriod).toBe("MOSY window: November - January");
    expect(t.blocks).toHaveLength(2);
    expect(t.columns).toBe(t.blocks![1]!.columns);
    expect(t.rows).toBe(t.blocks![1]!.rows);
  });

  it("summary lines include the tutor, filters and learner count, with no truncation note when complete", () => {
    const t = buildMosyExportTable(input());
    expect(t.summary).toContain("ARAL tutor: Marivic Santos");
    expect(t.summary!.some((s) => s.startsWith("Filters applied: Grade & section: All"))).toBe(true);
    expect(t.summary).toContain("1 learner(s) listed");
    expect(t.summary!.some((s) => s.includes("Only the first"))).toBe(false);
  });

  it("adds a truncation note when rows were capped", () => {
    const t = buildMosyExportTable(input({ truncated: true, totalCount: 7000 }));
    expect(t.summary).toContain(
      "Only the first 1 of 7000 matching learners are listed. Narrow the filters to export the rest."
    );
  });

  it("grade filter names grade and section; section-only and none use a label", () => {
    const withGrade = buildMosyExportTable(
      input({ filters: { q: "", status: "all", gradeLabel: "Grade 3", sectionLabel: "A" } })
    );
    expect(withGrade.gradeSection).toEqual({ gradeLevel: "Grade 3", section: "A" });
    const sectionOnly = buildMosyExportTable(
      input({ filters: { q: "", status: "all", gradeLabel: null, sectionLabel: "A" } })
    );
    expect(sectionOnly.gradeSection).toEqual({ label: "Section: A" });
    expect(buildMosyExportTable(input()).gradeSection).toEqual({ label: "All Classes" });
  });
});
