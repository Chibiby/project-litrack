import { beforeEach, describe, expect, it, vi } from "vitest";
import { READING_PROFILE_LABELS } from "@/lib/constants/enum-labels";

/**
 * School Head reading-profile charts. A Grade 1-3 learner still holding the old
 * combined INSTRUCTIONAL_DEVELOPING ("Developing or Transitioning") is counted
 * as DEVELOPING; Grade 4+ keep INSTRUCTIONAL_DEVELOPING. The grade type comes
 * from a `gradeLevel` lookup that must be scoped to the caller's school.
 */

const SCHOOL_ID = "school-a";

type ProfileRow = {
  gradeLevelId: string;
  englishReadingProfile: string | null;
  filipinoReadingProfile: string;
  _count: { _all: number };
};

let profileRows: ProfileRow[] = [];
const gradeFindMany = vi.fn(async (args: { where: { id: { in: string[] }; schoolId: string } }) => {
  const types: Record<string, string> = { g2: "G2", g3: "G3", g4: "G4" };
  return args.where.id.in.map((id) => ({ id, type: types[id] }));
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { groupBy: async () => [] },
    learner: { groupBy: async () => profileRows },
    readingLevelRecord: { groupBy: async () => [] },
    gradeLevel: { findMany: (...a: unknown[]) => gradeFindMany(...(a as [never])) },
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

const { getSchoolHeadCharts } = await import("@/lib/dashboard/aggregates");

const L = READING_PROFILE_LABELS;
const valueOf = (dist: { name: string; value: number }[], key: keyof typeof READING_PROFILE_LABELS) =>
  dist.find((d) => d.name === L[key])?.value;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSchoolHeadCharts — legacy INSTRUCTIONAL_DEVELOPING folding", () => {
  it("counts a Grade 2/3 legacy row as DEVELOPING and a Grade 4 row as INSTRUCTIONAL_DEVELOPING", async () => {
    profileRows = [
      { gradeLevelId: "g2", englishReadingProfile: null, filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING", _count: { _all: 3 } },
      { gradeLevelId: "g3", englishReadingProfile: "INSTRUCTIONAL_DEVELOPING", filipinoReadingProfile: "DEVELOPING", _count: { _all: 2 } },
      { gradeLevelId: "g4", englishReadingProfile: "INSTRUCTIONAL_DEVELOPING", filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING", _count: { _all: 5 } },
    ];

    const charts = await getSchoolHeadCharts(SCHOOL_ID);

    // Filipino: G2 legacy 3 + G3 DEVELOPING 2 = 5 Developing; only G4's 5 stay Instructional.
    expect(valueOf(charts.filipinoDistribution, "DEVELOPING")).toBe(5);
    expect(valueOf(charts.filipinoDistribution, "INSTRUCTIONAL_DEVELOPING")).toBe(5);
    // English: G3 legacy 2 -> Developing; G4 5 stay Instructional; G2 null is skipped.
    expect(valueOf(charts.englishDistribution, "DEVELOPING")).toBe(2);
    expect(valueOf(charts.englishDistribution, "INSTRUCTIONAL_DEVELOPING")).toBe(5);
  });

  it("scopes the grade-type lookup by schoolId (tenancy)", async () => {
    profileRows = [
      { gradeLevelId: "g2", englishReadingProfile: null, filipinoReadingProfile: "DEVELOPING", _count: { _all: 1 } },
      { gradeLevelId: "g4", englishReadingProfile: null, filipinoReadingProfile: "DEVELOPING", _count: { _all: 1 } },
    ];

    await getSchoolHeadCharts(SCHOOL_ID);

    expect(gradeFindMany).toHaveBeenCalledTimes(1);
    const where = gradeFindMany.mock.calls[0][0].where;
    expect(where.schoolId).toBe(SCHOOL_ID);
    expect([...where.id.in].sort()).toEqual(["g2", "g4"]);
  });
});
