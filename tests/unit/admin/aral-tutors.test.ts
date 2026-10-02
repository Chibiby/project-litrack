/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

let demoVisible = false;
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => demoVisible }));
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => unknown) => fn(),
}));

const p = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  learnerGroupBy: vi.fn(),
  learnerCount: vi.fn(),
  learnerFindMany: vi.fn(),
  gradeFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: p.userFindMany, count: p.userCount },
    learner: {
      groupBy: p.learnerGroupBy,
      count: p.learnerCount,
      findMany: p.learnerFindMany,
    },
    gradeLevel: { findMany: p.gradeFindMany },
  },
}));

import {
  aralTutorsWhere,
  getAralTutorsPage,
  getAralTutorsSummary,
  parseAralTutorsParams,
} from "@/lib/admin/aral-tutors";
import {
  getSchoolLearnersPage,
  getSchoolLearnersSummary,
  parseSchoolLearnersParams,
} from "@/lib/admin/management";

const json = (v: unknown) => JSON.stringify(v);

function teacher(id: string, last: string, extra: Record<string, any> = {}) {
  return {
    id,
    firstName: "Ana",
    middleName: null,
    lastName: last,
    school: { id: "s1", name: "Alamada ES" },
    teacherProfile: { employmentType: "DEPED_PLANTILLA", designation: "Teacher I" },
    advisorySections: [],
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  demoVisible = false;
  p.userFindMany.mockResolvedValue([]);
  p.userCount.mockResolvedValue(0);
  p.learnerGroupBy.mockResolvedValue([]);
  p.learnerCount.mockResolvedValue(0);
  p.learnerFindMany.mockResolvedValue([]);
  p.gradeFindMany.mockResolvedValue([]);
});

describe("school-scope learners directory", () => {
  it("forces the session school even when params carry another schoolId/district", async () => {
    const params = {
      ...parseSchoolLearnersParams({}, "mine"),
      schoolId: "other-school",
      district: "Banga",
    };
    await getSchoolLearnersPage("mine", params);
    const where = p.learnerFindMany.mock.calls[0]![0].where;
    const s = json(where);
    expect(s).toContain('"schoolId":"mine"');
    expect(s).not.toContain("other-school");
    expect(s).not.toContain("Banga");
    expect(p.learnerCount.mock.calls[0]![0].where).toEqual(where);
  });

  it("ignores ?schoolId=/?district= from the URL when parsing", () => {
    const parsed = parseSchoolLearnersParams(
      { page: "2", section: "sec1", ...({ schoolId: "x", district: "y" } as any) },
      "mine"
    );
    expect(parsed.schoolId).toBe("mine");
    expect(parsed.district).toBeUndefined();
    expect(parsed.section).toBe("sec1");
  });

  it("does not hide the demo school from its own head", async () => {
    await getSchoolLearnersPage("demo-school", parseSchoolLearnersParams({}, "demo-school"));
    expect(json(p.learnerFindMany.mock.calls[0]![0].where)).not.toContain('"isDemo":false');
  });

  it("refuses an empty schoolId rather than widening to the division", () => {
    expect(() => getSchoolLearnersPage("", parseSchoolLearnersParams({}, ""))).toThrow();
    expect(() => getSchoolLearnersSummary("")).toThrow();
  });
});

describe("aralTutorsWhere", () => {
  it("school scope pins schoolId on teacher and learner, live ARAL learners only", () => {
    const s = json(aralTutorsWhere({ kind: "school", schoolId: "s1" }, "", false));
    expect(s).toContain('"schoolId":"s1"');
    expect(s).toContain('"role":"TEACHER"');
    expect(s).toContain('"approvalStatus":"APPROVED"');
    expect(s).toContain('"isActive":true');
    expect(s).toContain('"deletedAt":null');
    expect(s).toContain('"archivedAt":null');
    expect(s).toContain('"isAralLearner":true');
    expect(s).toContain('"aralLearners":{"some"');
  });

  it("grade filter adds a live-ARAL-learner grade clause, still pinned to the school", () => {
    const w = aralTutorsWhere({ kind: "school", schoolId: "s1" }, "", false, "G3");
    const clauses = (w.AND as any[]).filter((c) => json(c).includes('"gradeLevel":{"type":"G3"}'));
    expect(clauses).toHaveLength(1);
    const s = json(clauses[0]);
    expect(s).toContain('"schoolId":"s1"');
    expect(s).toContain('"isAralLearner":true');
    expect(s).toContain('"archivedAt":null');
    expect(json(aralTutorsWhere({ kind: "school", schoolId: "s1" }, "", false))).not.toContain(
      "gradeLevel"
    );
  });

  it("parses grade and sort, dropping unknown values", () => {
    expect(parseAralTutorsParams({ grade: "G3", sort: "learners" })).toMatchObject({
      grade: "G3",
      sort: "learners",
    });
    expect(parseAralTutorsParams({ grade: "nope", sort: "evil" })).toMatchObject({
      grade: undefined,
      sort: "name",
    });
  });

  it("admin scope applies district / school filters and hides the demo school", () => {
    const s = json(
      aralTutorsWhere({ kind: "admin", district: "Banga", schoolId: "s9" }, "", false)
    );
    expect(s).toContain('"district":"Banga"');
    expect(s).toContain('"schoolId":"s9"');
    expect(s).toContain('"isDemo":false');
  });

  it("admin scope includes the demo school when a demo session is visible", () => {
    const s = json(aralTutorsWhere({ kind: "admin" }, "", true));
    // `schoolWhereForScope` for the division does not set isDemo.
    expect(s).not.toContain('"isDemo":false');
  });

  it("a district admin scope confines to its districts and always drops demo", () => {
    const s = json(
      aralTutorsWhere(
        { kind: "admin", scope: { kind: "districts", districts: ["Banga"] } },
        "",
        true
      )
    );
    expect(s).toContain('"in":["Banga"]');
    expect(s).toContain('"isDemo":false');
  });
});

describe("getAralTutorsPage", () => {
  it("school scope: school-pinned queries, counts, untutored, grade order", async () => {
    p.userFindMany.mockResolvedValue([teacher("t1", "Cruz")]);
    p.userCount.mockResolvedValue(1);
    p.learnerCount.mockResolvedValue(7);
    p.learnerGroupBy.mockResolvedValue([
      { aralTeacherId: "t1", gradeLevelId: "g4", _count: { _all: 2 } },
      { aralTeacherId: "t1", gradeLevelId: "gk", _count: { _all: 3 } },
      { aralTeacherId: "t1", gradeLevelId: "g1", _count: { _all: 1 } },
    ]);
    p.gradeFindMany.mockResolvedValue([
      { id: "g4", type: "G4" },
      { id: "gk", type: "KINDER" },
      { id: "g1", type: "G1" },
    ]);

    const res = await getAralTutorsPage(
      { kind: "school", schoolId: "s1" },
      parseAralTutorsParams({ schoolId: "evil", district: "evil" })
    );

    // Single grouped query, pinned to the school and live ARAL learners.
    expect(p.learnerGroupBy).toHaveBeenCalledTimes(1);
    const gb = p.learnerGroupBy.mock.calls[0]![0].where;
    expect(gb).toMatchObject({
      schoolId: "s1",
      deletedAt: null,
      archivedAt: null,
      isAralLearner: true,
    });
    expect(json(p.userFindMany.mock.calls[0]![0].where)).not.toContain("evil");

    const row = res.rows[0]!;
    expect(row.aralLearnerCount).toBe(6);
    expect(row.grades.map((g) => g.grade)).toEqual(["KINDER", "G1", "G4"]);
    expect(row.employment).toBe("DEPED");
    expect(row.employmentLabel).toBe("DepEd");
    expect(row.listingName).toBe("Cruz, Ana");
  });

  it("reads a volunteer designation as Non-DepEd", async () => {
    const { ARAL_VOLUNTEER_DESIGNATION } = await import("@/lib/validators/profile.schema");
    p.userFindMany.mockResolvedValue([
      teacher("t2", "Reyes", {
        teacherProfile: { employmentType: null, designation: ARAL_VOLUNTEER_DESIGNATION },
      }),
    ]);
    p.userCount.mockResolvedValue(1);
    const res = await getAralTutorsPage({ kind: "school", schoolId: "s1" }, parseAralTutorsParams({}));
    expect(res.rows[0]!.employmentLabel).toBe("Non-DepEd");
  });

  it("excludes tutors with no live ARAL learners via the where (some), and skips group queries on an empty page", async () => {
    const res = await getAralTutorsPage({ kind: "school", schoolId: "s1" }, parseAralTutorsParams({}));
    expect(res.rows).toEqual([]);
    expect(p.learnerGroupBy).not.toHaveBeenCalled();
    expect(p.gradeFindMany).not.toHaveBeenCalled();
    expect(json(p.userFindMany.mock.calls[0]![0].where)).toContain('"aralLearners":{"some"');
  });

  it("orders by surname, first name, id and pages with skip/take", async () => {
    await getAralTutorsPage(
      { kind: "school", schoolId: "s1" },
      parseAralTutorsParams({ page: "3" }, 10)
    );
    const args = p.userFindMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }]);
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it("passes the grade filter into both the page and count queries", async () => {
    await getAralTutorsPage(
      { kind: "school", schoolId: "s1" },
      parseAralTutorsParams({ grade: "G3" })
    );
    for (const call of [p.userFindMany.mock.calls[0]![0], p.userCount.mock.calls[0]![0]]) {
      const s = json(call.where);
      expect(s).toContain('"gradeLevel":{"type":"G3"}');
      expect(s).toContain('"schoolId":"s1"');
    }
  });

  it("'Most ARAL learners' ranks by live learner count within the same where, then pages the ranking", async () => {
    p.userFindMany
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }, { id: "c" }])
      .mockResolvedValueOnce([teacher("b", "Bravo"), teacher("c", "Cruz")]);
    p.learnerGroupBy
      .mockResolvedValueOnce([
        { aralTeacherId: "a", _count: { _all: 1 } },
        { aralTeacherId: "b", _count: { _all: 9 } },
        { aralTeacherId: "c", _count: { _all: 4 } },
      ])
      .mockResolvedValue([]);
    p.userCount.mockResolvedValue(3);
    const res = await getAralTutorsPage(
      { kind: "school", schoolId: "s1" },
      { ...parseAralTutorsParams({ sort: "learners" }), skip: 0, take: 2 }
    );
    expect(res.rows.map((r) => r.id)).toEqual(["b", "c"]);
    const rank = p.learnerGroupBy.mock.calls[0]![0].where;
    expect(rank).toMatchObject({ schoolId: "s1", archivedAt: null, isAralLearner: true });
    expect(json(p.userFindMany.mock.calls[0]![0].where)).toContain('"schoolId":"s1"');
    const pageWhere = json(p.userFindMany.mock.calls[1]![0].where);
    expect(pageWhere).toContain('"schoolId":"s1"');
    expect(pageWhere).toContain('"id":{"in":["b","c"]}');
  });

  it("admin scope: no learner schoolId pin on the grouped counts, reads the demo session", async () => {
    p.userFindMany.mockResolvedValue([teacher("t1", "Cruz")]);
    p.learnerGroupBy.mockResolvedValue([]);
    const res = await getAralTutorsPage(
      { kind: "admin", district: "Banga" },
      parseAralTutorsParams({})
    );
    expect(p.learnerCount).not.toHaveBeenCalled();
    expect(res.rows[0]!.school.name).toBe("Alamada ES");
    expect(json(p.userFindMany.mock.calls[0]![0].where)).toContain('"isDemo":false');
  });

  it("refuses an empty school scope id", async () => {
    await expect(
      getAralTutorsPage({ kind: "school", schoolId: "" }, parseAralTutorsParams({}))
    ).rejects.toThrow();
    await expect(getAralTutorsSummary({ kind: "school", schoolId: "" })).rejects.toThrow();
  });
});

describe("getAralTutorsSummary", () => {
  it("school scope: three counts, all pinned to the school", async () => {
    p.userCount.mockResolvedValue(4);
    p.learnerCount.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
    const res = await getAralTutorsSummary({ kind: "school", schoolId: "s1" });
    expect(res).toEqual({ tutors: 4, learnersWithTutor: 7, learnersWithoutTutor: 3 });
    expect(json(p.userCount.mock.calls[0]![0].where)).toContain('"schoolId":"s1"');
    expect(p.learnerCount.mock.calls[0]![0].where).toEqual({
      schoolId: "s1",
      deletedAt: null,
      archivedAt: null,
      isAralLearner: true,
    });
    expect(p.learnerCount.mock.calls[1]![0].where).toMatchObject({
      schoolId: "s1",
      aralTeacherId: null,
    });
  });

  it("admin scope: honours district / school filters and the demo rule like the list", async () => {
    await getAralTutorsSummary({ kind: "admin", district: "Banga", schoolId: "s9" });
    const s = json(p.learnerCount.mock.calls[0]![0].where);
    expect(s).toContain('"district":"Banga"');
    expect(s).toContain('"schoolId":"s9"');
    expect(s).toContain('"isDemo":false');
    expect(json(p.userCount.mock.calls[0]![0].where)).toContain('"isDemo":false');
  });
});
