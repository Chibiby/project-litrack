import { prisma } from "@/lib/prisma";
import { countLetterSections } from "@/lib/section-letters";
import { PROFILING_GRADE_LEVEL_TYPES } from "@/lib/validators/grade-level.schema";

const PROFILING_GRADE_SET = new Set<string>(PROFILING_GRADE_LEVEL_TYPES);

export type SchoolStructureDefaults = {
  gradeTypes: string[];
  sectionsPerGrade: number;
  existingGradeStats: {
    type: string;
    activeSections: number;
    letterSections: number;
  }[];
};

/** Active grades + section stats for School Head profiling / profile edit prefills. */
export async function getSchoolStructureDefaults(
  schoolId: string
): Promise<SchoolStructureDefaults> {
  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, deletedAt: null },
    select: {
      type: true,
      sections: {
        where: { deletedAt: null },
        select: { name: true },
      },
    },
    orderBy: { type: "asc" },
  });

  const existingGradeStats = grades.map((g) => {
    const names = g.sections.map((s) => s.name);
    return {
      type: g.type,
      activeSections: names.length,
      letterSections: countLetterSections(names),
    };
  });

  // Profiling School Structure only offers G1–G12; keep KINDER/FLOATING in DB.
  const gradeTypes = existingGradeStats
    .map((g) => g.type)
    .filter((type) => PROFILING_GRADE_SET.has(type));
  const maxSections = existingGradeStats.reduce(
    (max, g) => Math.max(max, g.activeSections),
    0
  );

  return {
    gradeTypes,
    sectionsPerGrade: maxSections > 0 ? maxSections : 1,
    existingGradeStats,
  };
}
