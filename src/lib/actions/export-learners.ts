"use server";

import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  GRADE_LEVEL_LABELS,
  GENDER_LABELS,
  PARENT_EDUCATION_LABELS,
  GOV_BENEFIT_LABELS,
  labelReadingProfile,
  formatEthnicity,
} from "@/lib/constants/enum-labels";

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ExportLearnersFilter = {
  gradeLevelId?: string;
  /** Filter to one section; `"none"` = learners with no section. */
  sectionId?: string;
  aralOnly?: boolean;
};

/** Fields rendered by PrintableLearnersReport (+ relations). */
const learnerReportSelect = {
  id: true,
  fullName: true,
  age: true,
  gender: true,
  englishReadingProfile: true,
  filipinoReadingProfile: true,
  isAralLearner: true,
  gradeLevel: { select: { type: true } },
  section: { select: { name: true } },
} as const;

/** Fields used by Excel export sheets (Learners + ARAL summary). */
const learnerExportSelect = {
  fullName: true,
  firstName: true,
  middleName: true,
  lastName: true,
  age: true,
  gender: true,
  englishReadingProfile: true,
  filipinoReadingProfile: true,
  governmentBenefits: true,
  parentEducation: true,
  ethnicity: true,
  ethnicityOther: true,
  isAralLearner: true,
  modeOfTransportation: true,
  distanceHomeToSchool: true,
  previousTransfers: true,
  gradeLevel: { select: { type: true } },
  section: { select: { name: true } },
  aralProfile: {
    select: {
      absenteeismFrequency: true,
    },
  },
} as const;

function sectionFilterClause(sectionId?: string) {
  if (!sectionId) return {};
  if (sectionId === "none") return { sectionId: null };
  return { sectionId };
}

/**
 * `teacherId` scopes the export to the learners in that teacher's care —
 * their advisory roster plus any learner whose ARAL teacher they are.
 */
function learnerWhere(opts: {
  schoolId: string;
  teacherId?: string;
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
}) {
  return {
    schoolId: opts.schoolId,
    deletedAt: null,
    archivedAt: null,
    ...(opts.teacherId ? teacherLearnerScope(opts.teacherId) : {}),
    ...(opts.gradeLevelId ? { gradeLevelId: opts.gradeLevelId } : {}),
    ...sectionFilterClause(opts.sectionId),
    ...(opts.aralOnly ? { isAralLearner: true } : {}),
  };
}

async function fetchLearnersForExport(opts: {
  schoolId: string;
  teacherId?: string;
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
}) {
  return prisma.learner.findMany({
    where: learnerWhere(opts),
    select: learnerExportSelect,
    orderBy: [{ gradeLevelId: "asc" }, { fullName: "asc" }],
  });
}

async function fetchLearnersForReport(opts: {
  schoolId: string;
  teacherId?: string;
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
}) {
  return prisma.learner.findMany({
    where: learnerWhere(opts),
    select: learnerReportSelect,
    orderBy: [{ gradeLevelId: "asc" }, { fullName: "asc" }],
  });
}

async function buildLearnersWorkbook(
  learners: Awaited<ReturnType<typeof fetchLearnersForExport>>,
  schoolName: string
): Promise<Buffer> {
  // Dynamic import keeps exceljs off the reports (`loadLearnersForReport`) cold path.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Learners");
  sheet.columns = [
    { header: "Full name", key: "fullName", width: 28 },
    { header: "First name", key: "firstName", width: 14 },
    { header: "Middle name", key: "middleName", width: 14 },
    { header: "Last name", key: "lastName", width: 14 },
    { header: "Age", key: "age", width: 8 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Ethnicity", key: "ethnicity", width: 16 },
    { header: "Grade", key: "grade", width: 12 },
    { header: "Section", key: "section", width: 12 },
    { header: "English profile", key: "english", width: 28 },
    { header: "Filipino profile", key: "filipino", width: 28 },
    { header: "Gov benefits", key: "benefits", width: 14 },
    { header: "Parent education", key: "parentEd", width: 22 },
    { header: "ARAL", key: "aral", width: 8 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const l of learners) {
    sheet.addRow({
      fullName: l.fullName,
      firstName: l.firstName,
      middleName: l.middleName ?? "",
      lastName: l.lastName,
      age: l.age,
      gender: GENDER_LABELS[l.gender as keyof typeof GENDER_LABELS] ?? l.gender,
      ethnicity: formatEthnicity(l.ethnicity, l.ethnicityOther, ""),
      grade: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      section: l.section?.name ?? "",
      english: labelReadingProfile(
        l.englishReadingProfile,
        l.gradeLevel.type
      ),
      filipino: labelReadingProfile(
        l.filipinoReadingProfile,
        l.gradeLevel.type
      ),
      benefits: l.governmentBenefits
        .map((b) => GOV_BENEFIT_LABELS[b as keyof typeof GOV_BENEFIT_LABELS] ?? b)
        .join("; "),
      parentEd:
        PARENT_EDUCATION_LABELS[l.parentEducation as keyof typeof PARENT_EDUCATION_LABELS] ??
        l.parentEducation,
      aral: l.isAralLearner ? "Yes" : "No",
    });
  }

  const aralSheet = wb.addWorksheet("ARAL summary");
  aralSheet.columns = [
    { header: "Full name", key: "fullName", width: 28 },
    { header: "Grade", key: "grade", width: 12 },
    { header: "Section", key: "section", width: 12 },
    { header: "Transportation", key: "transport", width: 18 },
    { header: "Distance", key: "distance", width: 16 },
    { header: "Transfers", key: "transfers", width: 16 },
    { header: "Absenteeism", key: "absenteeism", width: 22 },
    { header: "Has ARAL profile", key: "hasProfile", width: 14 },
  ];
  aralSheet.getRow(1).font = { bold: true };

  for (const l of learners.filter((x) => x.isAralLearner)) {
    aralSheet.addRow({
      fullName: l.fullName,
      grade: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      section: l.section?.name ?? "",
      transport: l.modeOfTransportation ?? "",
      distance: l.distanceHomeToSchool ?? "",
      transfers: l.previousTransfers ?? "",
      absenteeism: l.aralProfile?.absenteeismFrequency ?? "",
      hasProfile: l.aralProfile ? "Yes" : "No",
    });
  }

  const meta = wb.addWorksheet("Export info");
  meta.addRow(["School", schoolName]);
  meta.addRow(["Exported at", new Date().toISOString()]);
  meta.addRow(["Learner count", learners.length]);
  meta.addRow(["ARAL count", learners.filter((l) => l.isAralLearner).length]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Teacher Excel export — assigned grades only (or one grade if filtered).
 */
export async function exportTeacherLearnersExcel(
  filter: ExportLearnersFilter = {}
): Promise<ActionResult<{ base64: string; filename: string }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  if (filter.gradeLevelId) {
    // Read-only export: an ARAL-only teacher reaches the grade through the
    // learners designated to them. `learnerWhere` still narrows the rows to
    // the learners in their care.
    const grade = await prisma.gradeLevel.findFirst({
      where: {
        id: filter.gradeLevelId,
        schoolId: user.schoolId,
        deletedAt: null,
        ...teacherGradeScope(user.id),
      },
    });
    if (!grade) return { ok: false, error: "You are not assigned to this grade level" };
  }

  if (filter.sectionId && filter.sectionId !== "none") {
    const section = await prisma.section.findFirst({
      where: {
        id: filter.sectionId,
        schoolId: user.schoolId,
        deletedAt: null,
        ...(filter.gradeLevelId ? { gradeLevelId: filter.gradeLevelId } : {}),
      },
    });
    if (!section) return { ok: false, error: "Section not found" };
  }

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { name: true },
  });

  const learners = await fetchLearnersForExport({
    schoolId: user.schoolId,
    teacherId: user.id,
    gradeLevelId: filter.gradeLevelId,
    sectionId: filter.sectionId,
    aralOnly: filter.aralOnly,
  });

  const buffer = await buildLearnersWorkbook(learners, school?.name ?? "School");
  const filename = `litrack-learners-${new Date().toISOString().slice(0, 10)}.xlsx`;

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.EXPORT_LEARNERS_EXCEL,
    resource: "Learner",
    metadata: {
      count: learners.length,
      gradeLevelId: filter.gradeLevelId ?? null,
      sectionId: filter.sectionId ?? null,
      aralOnly: Boolean(filter.aralOnly),
      role: "TEACHER",
    },
  });

  return {
    ok: true,
    data: { base64: buffer.toString("base64"), filename },
  };
}

/**
 * School Head Excel export — entire school (tenant-scoped).
 * `schoolId` optional override for Super Admin context views only.
 */
export async function exportSchoolHeadLearnersExcel(
  filter: ExportLearnersFilter & { schoolId?: string } = {}
): Promise<ActionResult<{ base64: string; filename: string }>> {
  const user = await requireUser("SCHOOL_HEAD");

  let schoolId = user.schoolId;
  if (user.role === "SUPER_ADMIN") {
    if (!filter.schoolId) return { ok: false, error: "schoolId required" };
    schoolId = filter.schoolId;
  }
  if (!schoolId) return { ok: false, error: "Not found" };

  if (filter.gradeLevelId) {
    const grade = await prisma.gradeLevel.findFirst({
      where: {
        id: filter.gradeLevelId,
        schoolId,
        deletedAt: null,
      },
    });
    if (!grade) return { ok: false, error: "Grade level not found" };
  }

  if (filter.sectionId && filter.sectionId !== "none") {
    const section = await prisma.section.findFirst({
      where: {
        id: filter.sectionId,
        schoolId,
        deletedAt: null,
        ...(filter.gradeLevelId ? { gradeLevelId: filter.gradeLevelId } : {}),
      },
    });
    if (!section) return { ok: false, error: "Section not found" };
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  const learners = await fetchLearnersForExport({
    schoolId,
    gradeLevelId: filter.gradeLevelId,
    sectionId: filter.sectionId,
    aralOnly: filter.aralOnly,
  });

  const buffer = await buildLearnersWorkbook(learners, school?.name ?? "School");
  const filename = `litrack-school-learners-${new Date().toISOString().slice(0, 10)}.xlsx`;

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.EXPORT_LEARNERS_EXCEL,
    resource: "Learner",
    metadata: {
      count: learners.length,
      gradeLevelId: filter.gradeLevelId ?? null,
      sectionId: filter.sectionId ?? null,
      aralOnly: Boolean(filter.aralOnly),
      role: user.role,
    },
  });

  return {
    ok: true,
    data: { base64: buffer.toString("base64"), filename },
  };
}

/** Record printable/PDF report view (browser print). */
export async function auditPrintableReport(input: {
  scope: "TEACHER" | "SCHOOL_HEAD";
  schoolId: string;
}): Promise<void> {
  const user =
    input.scope === "TEACHER"
      ? await requireSchoolUser("TEACHER")
      : await requireUser("SCHOOL_HEAD");

  const schoolId =
    user.role === "SUPER_ADMIN" ? input.schoolId : user.schoolId ?? input.schoolId;
  if (!schoolId || (user.role !== "SUPER_ADMIN" && schoolId !== user.schoolId)) {
    return;
  }

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.EXPORT_PRINTABLE_REPORT,
    resource: "Report",
    metadata: { scope: input.scope },
  });
}

export type PrintableReportLearner = {
  id: string;
  fullName: string;
  age: number;
  gender: string;
  englishReadingProfile: string;
  filipinoReadingProfile: string;
  isAralLearner: boolean;
  gradeLevel: { type: string };
  section: { name: string } | null;
};

export type PrintableReportSectionRow = {
  section: string;
  count: number;
  aral: number;
};

/** Serializable printable report payload (safe across the server-action boundary). */
export type PrintableReportData = {
  schoolName: string;
  schoolIdCode: string;
  learners: PrintableReportLearner[];
  byGrade: { type: string; learners: PrintableReportLearner[] }[];
  byGradeSection: { type: string; rows: PrintableReportSectionRow[] }[];
  aralCount: number;
  generatedAt: string;
};

function buildPrintableReportData(
  school: { name: string; schoolIdCode: string } | null,
  learners: Awaited<ReturnType<typeof fetchLearnersForReport>>
): PrintableReportData {
  const byGradeMap = new Map<string, typeof learners>();
  for (const l of learners) {
    const key = l.gradeLevel.type;
    const list = byGradeMap.get(key) ?? [];
    list.push(l);
    byGradeMap.set(key, list);
  }

  const byGrade = [...byGradeMap.entries()].map(([type, list]) => ({
    type,
    learners: list,
  }));

  const byGradeSection: PrintableReportData["byGradeSection"] = [];
  for (const [gradeType, list] of byGradeMap) {
    const hasAnySection = list.some((l) => l.section);
    if (!hasAnySection) continue;
    const buckets = new Map<string, { count: number; aral: number }>();
    for (const l of list) {
      const name = l.section?.name ?? "No section";
      const cur = buckets.get(name) ?? { count: 0, aral: 0 };
      cur.count += 1;
      if (l.isAralLearner) cur.aral += 1;
      buckets.set(name, cur);
    }
    byGradeSection.push({
      type: gradeType,
      rows: [...buckets.entries()]
        .map(([section, v]) => ({ section, count: v.count, aral: v.aral }))
        .sort((a, b) => a.section.localeCompare(b.section)),
    });
  }

  return {
    schoolName: school?.name ?? "School",
    schoolIdCode: school?.schoolIdCode ?? "",
    learners,
    byGrade,
    byGradeSection,
    aralCount: learners.filter((l) => l.isAralLearner).length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * On-demand printable report loader (auth + tenant checks).
 * Prefer this from the reports UI so page visits do not dump full rosters.
 */
export async function fetchPrintableReport(input: {
  scope: "TEACHER" | "SCHOOL_HEAD";
  schoolId?: string;
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
}): Promise<ActionResult<PrintableReportData>> {
  const user =
    input.scope === "TEACHER"
      ? await requireSchoolUser("TEACHER")
      : await requireUser("SCHOOL_HEAD");

  const schoolId =
    user.role === "SUPER_ADMIN"
      ? input.schoolId
      : user.schoolId ?? undefined;
  if (!schoolId) return { ok: false, error: "School not found" };
  if (user.role !== "SUPER_ADMIN" && schoolId !== user.schoolId) {
    return { ok: false, error: "Not found" };
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, schoolIdCode: true },
  });

  const learners = await fetchLearnersForReport({
    schoolId,
    teacherId: user.role === "TEACHER" ? user.id : undefined,
    gradeLevelId: input.gradeLevelId,
    sectionId: input.sectionId,
    aralOnly: input.aralOnly,
  });

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.EXPORT_PRINTABLE_REPORT,
    resource: "Report",
    metadata: {
      scope: input.scope,
      gradeLevelId: input.gradeLevelId ?? null,
      sectionId: input.sectionId ?? null,
      aralOnly: Boolean(input.aralOnly),
    },
  });

  return { ok: true, data: buildPrintableReportData(school, learners) };
}

/**
 * @deprecated Prefer `fetchPrintableReport` (on-demand + auth). Kept for
 * any server composers that already resolved schoolId.
 */
export async function loadLearnersForReport(opts: {
  schoolId: string;
  teacherId?: string;
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
}) {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true, schoolIdCode: true },
  });

  const learners = await fetchLearnersForReport(opts);
  const data = buildPrintableReportData(school, learners);

  return {
    ...data,
    generatedAt: new Date(data.generatedAt),
    byGrade: new Map(data.byGrade.map((g) => [g.type, g.learners])),
    byGradeSection: new Map(data.byGradeSection.map((g) => [g.type, g.rows])),
  };
}
