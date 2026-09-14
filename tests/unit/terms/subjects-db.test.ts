import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TERM_SUBJECTS } from "@/lib/terms/subjects";

/**
 * Server-half coverage for `src/lib/terms/subjects-db.ts` — specifically the
 * lazy seed in `getAllTermSubjects`, which every reader (`getSheetSubjects`,
 * `getManagedTermSubjects`, and the actions that read through them) funnels
 * through.
 *
 * The trigger is "zero rows for this grade", not "zero ACTIVE rows" — a School
 * Head who archived every subject on a grade must never be handed the 8
 * defaults back. That distinction is the one thing this file exists to pin.
 */

type Row = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  name: string;
  position: number;
  legacyArea: string | null;
  deletedAt: Date | null;
};

const SCHOOL_ID = "school-malandag";
const GRADE_ID = "grade-g7";

let rows: Row[];

const findMany = vi.fn(async (args: { where: { schoolId: string; gradeLevelId: string } }) =>
  rows
    .filter(
      (r) => r.schoolId === args.where.schoolId && r.gradeLevelId === args.where.gradeLevelId
    )
    .map((r) => ({ id: r.id, name: r.name, position: r.position, deletedAt: r.deletedAt }))
);

const createMany = vi.fn(
  async (args: {
    data: { schoolId: string; gradeLevelId: string; name: string; position: number; legacyArea: string }[];
    skipDuplicates?: boolean;
  }) => {
    let count = 0;
    for (const d of args.data) {
      // Mirrors @@unique([gradeLevelId, legacyArea]) with skipDuplicates: true.
      const clash = rows.some(
        (r) =>
          r.gradeLevelId === d.gradeLevelId &&
          r.legacyArea === d.legacyArea &&
          args.skipDuplicates
      );
      if (clash) continue;
      rows.push({
        id: `seeded-${d.legacyArea}`,
        schoolId: d.schoolId,
        gradeLevelId: d.gradeLevelId,
        name: d.name,
        position: d.position,
        legacyArea: d.legacyArea,
        deletedAt: null,
      });
      count += 1;
    }
    return { count };
  }
);

const client = {
  termSubject: {
    findMany: (...args: unknown[]) => findMany(...(args as [never])),
    createMany: (...args: unknown[]) => createMany(...(args as [never])),
  },
} as unknown as import("@prisma/client").PrismaClient;

const { getAllTermSubjects, getSheetSubjects, getManagedTermSubjects, healLegacyTermGrades } =
  await import("@/lib/terms/subjects-db");

describe("healLegacyTermGrades — pre-M2 adoption of NULL-termSubjectId rows", () => {
  const executeRaw = vi.fn(
    async (_sql: { sql: string; values: unknown[] }) => 3
  );
  const rawClient = {
    $executeRaw: (...args: unknown[]) => executeRaw(...(args as [never])),
  } as unknown as import("@prisma/client").PrismaClient;

  async function heal(schoolYearId?: string) {
    executeRaw.mockClear();
    const n = await healLegacyTermGrades(rawClient, {
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      schoolYearId,
    });
    const stmt = executeRaw.mock.calls[0][0];
    return { n, sql: stmt.sql.replace(/\s+/g, " "), values: stmt.values };
  }

  it("only touches NULL rows, guarded by NOT EXISTS on the target unique tuple", async () => {
    const { n, sql } = await heal();
    expect(n).toBe(3);
    expect(sql).toContain('tg."termSubjectId" IS NULL');
    expect(sql).toContain('ts."legacyArea" = tg."subject"');
    expect(sql).toMatch(
      /NOT EXISTS \( SELECT 1 FROM "TermGrade" o WHERE o\."learnerId" = tg\."learnerId" AND o\."schoolYearId" = tg\."schoolYearId" AND o\."term" = tg\."term" AND o\."termSubjectId" = ts\."id" \)/
    );
  });

  it("scopes both the learner and the TermSubject to the school AND grade, bound not interpolated", async () => {
    const { sql, values } = await heal();
    expect(sql).toMatch(/l\."schoolId" = (\?|\$\d+)/);
    expect(sql).toMatch(/l\."gradeLevelId" = (\?|\$\d+)/);
    expect(sql).toMatch(/ts\."schoolId" = (\?|\$\d+)/);
    expect(sql).toMatch(/ts\."gradeLevelId" = (\?|\$\d+)/);
    expect(values.filter((v) => v === SCHOOL_ID)).toHaveLength(2);
    expect(values.filter((v) => v === GRADE_ID)).toHaveLength(2);
  });

  it("narrows to the school year only when one is given", async () => {
    expect((await heal()).sql).not.toContain('tg."schoolYearId" =');
    const withYear = await heal("sy-1");
    expect(withYear.sql).toMatch(/tg\."schoolYearId" = (\?|\$\d+)/);
    expect(withYear.values).toContain("sy-1");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
});

describe("getAllTermSubjects — the lazy seed", () => {
  it("seeds the 8 defaults when a grade has zero rows at all", async () => {
    const result = await getAllTermSubjects(client, { schoolId: SCHOOL_ID, gradeLevelId: GRADE_ID });

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(8);
    expect(result.map((r) => r.name).sort()).toEqual(
      [...DEFAULT_TERM_SUBJECTS].map((d) => d.name).sort()
    );
  });

  it("does NOT re-seed when every existing row is archived", async () => {
    // A head who archived all 8 (or all of a custom set) must not get the
    // defaults handed back — "zero rows", not "zero active rows", is the
    // trigger.
    rows = [
      {
        id: "existing-1",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "English",
        position: 0,
        legacyArea: "ENGLISH",
        deletedAt: new Date(2026, 8, 1),
      },
    ];

    const result = await getAllTermSubjects(client, { schoolId: SCHOOL_ID, gradeLevelId: GRADE_ID });

    expect(createMany).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("existing-1");
  });

  it("does not seed when the grade already has active custom rows", async () => {
    rows = [
      {
        id: "custom-1",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "Reading Enrichment",
        position: 0,
        legacyArea: null,
        deletedAt: null,
      },
    ];

    const result = await getAllTermSubjects(client, { schoolId: SCHOOL_ID, gradeLevelId: GRADE_ID });

    expect(createMany).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("scopes the read to schoolId AND gradeLevelId — another school's or grade's rows never leak in", async () => {
    rows = [
      {
        id: "other-school",
        schoolId: "school-kiblawan",
        gradeLevelId: GRADE_ID,
        name: "English",
        position: 0,
        legacyArea: "ENGLISH",
        deletedAt: null,
      },
      {
        id: "other-grade",
        schoolId: SCHOOL_ID,
        gradeLevelId: "grade-g8",
        name: "English",
        position: 0,
        legacyArea: "ENGLISH",
        deletedAt: null,
      },
    ];

    // Zero rows for THIS grade+school pair, so the seed still fires — and it
    // must not be short-circuited by the foreign rows existing elsewhere.
    const result = await getAllTermSubjects(client, { schoolId: SCHOOL_ID, gradeLevelId: GRADE_ID });

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(result.every((r) => r.id !== "other-school" && r.id !== "other-grade")).toBe(true);
  });
});

describe("getSheetSubjects", () => {
  it("returns only active rows, in display order", async () => {
    rows = [
      {
        id: "b",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "Filipino",
        position: 1,
        legacyArea: null,
        deletedAt: null,
      },
      {
        id: "a",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "English",
        position: 0,
        legacyArea: null,
        deletedAt: null,
      },
      {
        id: "c",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "Archived One",
        position: 2,
        legacyArea: null,
        deletedAt: new Date(2026, 8, 1),
      },
    ];

    const result = await getSheetSubjects(client, { schoolId: SCHOOL_ID, gradeLevelId: GRADE_ID });
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("getManagedTermSubjects", () => {
  it("splits active (display order) from archived (most recently archived first)", async () => {
    rows = [
      {
        id: "active-b",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "Filipino",
        position: 1,
        legacyArea: null,
        deletedAt: null,
      },
      {
        id: "active-a",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "English",
        position: 0,
        legacyArea: null,
        deletedAt: null,
      },
      {
        id: "archived-old",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "Old One",
        position: 2,
        legacyArea: null,
        deletedAt: new Date(2026, 7, 1),
      },
      {
        id: "archived-new",
        schoolId: SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        name: "New One",
        position: 3,
        legacyArea: null,
        deletedAt: new Date(2026, 8, 1),
      },
    ];

    const { active, archived } = await getManagedTermSubjects(client, {
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
    });

    expect(active.map((r) => r.id)).toEqual(["active-a", "active-b"]);
    expect(archived.map((r) => r.id)).toEqual(["archived-new", "archived-old"]);
  });
});
