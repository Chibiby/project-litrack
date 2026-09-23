"use server";

import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  GRADE_LEVEL_LABELS,
  GENDER_LABELS,
  NUTRITIONAL_STATUS_LABELS,
  ABSENTEEISM_REASON_LABELS,
  PARENT_EDUCATION_LABELS,
  GOV_BENEFIT_LABELS,
  labelReadingProfile,
  ETHNICITY_LABELS,
} from "@/lib/constants/enum-labels";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { formatListingNameFromRecord } from "@/lib/names";
import {
  loadReportFrame,
  writeTemplateSheet,
  type GradeSectionLine,
  type ReportFooter,
  type ReportFrame,
  type ReportHeaderField,
  type ReportPurpose,
} from "@/lib/reports/sheet-header";
import { formatGradeSectionLine, frameFooter, frameHeaderFields } from "@/lib/reports/report-frame";
import { reportPurposeSchema } from "@/lib/validators/report.schema";

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * The enum's own label and nothing else — "Others" stays "Others", because the
 * free text lives in its own column. `formatEthnicity` deliberately substitutes
 * the free text for display; a spreadsheet column is not display.
 */
function labelEthnicityOnly(ethnicity: string | null | undefined): string {
  if (!ethnicity) return "";
  return (
    ETHNICITY_LABELS[ethnicity as keyof typeof ETHNICITY_LABELS] ?? ethnicity
  );
}

export type ExportLearnersFilter = {
  gradeLevelId?: string;
  /** Filter to one section; `"none"` = learners with no section. */
  sectionId?: string;
  aralOnly?: boolean;
  /** PRINT (default: the DepEd print template) or RECORDS (a plain sortable sheet). */
  purpose?: ReportPurpose;
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
  nutritionalStatus: true,
  ethnicity: true,
  ethnicityOther: true,
  secondaryEthnicity: true,
  secondaryEthnicityOther: true,
  isAralLearner: true,
  modeOfTransportation: true,
  distanceHomeToSchool: true,
  previousTransfers: true,
  gradeLevel: { select: { type: true } },
  section: { select: { name: true } },
  aralProfile: {
    select: {
      absenteeismFrequency: true,
      absenteeismReasons: true,
    },
  },
} as const;

/**
 * The template's grade/section line — same rule `gradeSectionLabelFromLearners`
 * (`src/lib/reports/queries.ts`) follows for the Reports Hub, applied to this
 * export's own already-filtered roster rather than importing across module
 * boundaries for one label.
 */
function gradeSectionFor(
  learners: { gradeLevel: { type: string }; section: { name: string } | null }[],
  filter: { gradeLevelId?: string; sectionId?: string }
): GradeSectionLine {
  const first = learners[0];
  const grade = first ? (GRADE_LEVEL_LABELS[first.gradeLevel.type] ?? first.gradeLevel.type) : null;
  if (filter.sectionId && first) {
    return { gradeLevel: grade, section: first.section?.name ?? "—" };
  }
  if (filter.gradeLevelId && first) return { gradeLevel: grade, section: null };
  return { label: "All" };
}

/**
 * `purpose` arrives on a plain object, not FormData, so it is parsed here at
 * the boundary. Missing means PRINT.
 */
function parsePurpose(
  value: unknown
): { ok: true; purpose: ReportPurpose } | { ok: false; error: string } {
  const parsed = reportPurposeSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  return { ok: true, purpose: parsed.data };
}

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
    relationLoadStrategy: "join",
    where: learnerWhere(opts),
    select: learnerExportSelect,
    orderBy: [
      { gradeLevelId: "asc" },
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ],
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
    relationLoadStrategy: "join",
    where: learnerWhere(opts),
    select: learnerReportSelect,
    orderBy: [
      { gradeLevelId: "asc" },
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ],
  });
}

async function buildLearnersWorkbook(
  learners: Awaited<ReturnType<typeof fetchLearnersForExport>>,
  frame: ReportFrame,
  gradeSection: GradeSectionLine,
  purpose: ReportPurpose
): Promise<Buffer> {
  // Dynamic import keeps exceljs off the reports (`loadLearnersForReport`) cold path.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  // Local day, never `toISOString()`: the school runs at UTC+8.
  const ctx = { frame, generatedOn: schoolToday() };
  const aralLearners = learners.filter((l) => l.isAralLearner);

  const sheet = wb.addWorksheet("Learners");
  writeTemplateSheet(
    wb,
    sheet,
    ctx,
    {
      reportTitle: "Learner List",
      gradeSection,
      columns: [
        { header: "Name", width: 28 },
        { header: "First name", width: 14 },
        { header: "Middle name", width: 14 },
        { header: "Last name", width: 14 },
        { header: "Age", width: 8 },
        { header: "Gender", width: 10 },
        { header: "Nutritional status", width: 18 },
        // Four columns, not two. The label column names the enum answer and
        // the "specify" column beside it carries the free text. Folding the
        // free text into the label — which this sheet used to do — erased the
        // answer itself: an Others/"Manobo" learner exported as `Manobo`,
        // which is not one of the thirteen and so resolves to nothing on the
        // way back in.
        { header: "Ethnicity", width: 16 },
        { header: "Ethnicity (specify)", width: 18 },
        // Its own column rather than one cell holding both, so the sheet
        // stays sortable and filterable on each answer.
        { header: "Second ethnicity", width: 16 },
        { header: "Second ethnicity (specify)", width: 18 },
        { header: "Grade", width: 12 },
        { header: "Section", width: 12 },
        { header: "English profile", width: 28 },
        { header: "Filipino profile", width: 28 },
        { header: "Gov benefits", width: 14 },
        { header: "Parent education", width: 22 },
        { header: "ARAL", width: 8 },
      ],
      rows: learners.map((l) => [
        formatListingNameFromRecord(l),
        l.firstName,
        l.middleName ?? "",
        l.lastName,
        l.age,
        GENDER_LABELS[l.gender as keyof typeof GENDER_LABELS] ?? l.gender,
        l.nutritionalStatus ? NUTRITIONAL_STATUS_LABELS[l.nutritionalStatus] : "",
        labelEthnicityOnly(l.ethnicity),
        l.ethnicityOther ?? "",
        labelEthnicityOnly(l.secondaryEthnicity),
        l.secondaryEthnicityOther ?? "",
        GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
        l.section?.name ?? "",
        l.englishReadingProfile
          ? labelReadingProfile(l.englishReadingProfile, l.gradeLevel.type)
          : "",
        labelReadingProfile(l.filipinoReadingProfile, l.gradeLevel.type),
        l.governmentBenefits
          .map((b) => GOV_BENEFIT_LABELS[b as keyof typeof GOV_BENEFIT_LABELS] ?? b)
          .join("; "),
        PARENT_EDUCATION_LABELS[l.parentEducation as keyof typeof PARENT_EDUCATION_LABELS] ??
          l.parentEducation,
        l.isAralLearner ? "Yes" : "No",
      ]),
      summary: [`${learners.length} learner(s), ${aralLearners.length} in ARAL`],
    },
    purpose
  );

  const aralSheet = wb.addWorksheet("ARAL summary");
  writeTemplateSheet(
    wb,
    aralSheet,
    ctx,
    {
      reportTitle: "ARAL Learner Summary",
      gradeSection,
      columns: [
        { header: "Name", width: 28 },
        { header: "Grade", width: 12 },
        { header: "Section", width: 12 },
        { header: "Transportation", width: 18 },
        { header: "Distance", width: 16 },
        { header: "Transfers", width: 16 },
        { header: "Absenteeism", width: 22 },
        { header: "Reasons", width: 40 },
        { header: "Has ARAL profile", width: 14 },
      ],
      rows: aralLearners.map((l) => [
        formatListingNameFromRecord(l),
        GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
        l.section?.name ?? "",
        l.modeOfTransportation ?? "",
        l.distanceHomeToSchool ?? "",
        l.previousTransfers ?? "",
        l.aralProfile?.absenteeismFrequency ?? "",
        (l.aralProfile?.absenteeismReasons ?? [])
          .map((r) => ABSENTEEISM_REASON_LABELS[r])
          .join("; "),
        l.aralProfile ? "Yes" : "No",
      ]),
      summary: [`${aralLearners.length} ARAL learner(s)`],
    },
    purpose
  );

  const meta = wb.addWorksheet("Export info");
  meta.addRow(["School", frame.schoolName || "School"]);
  // Local date key, never `toISOString()`: the school runs at UTC+8, so a UTC
  // instant names the wrong civil day for anyone reading this sheet in Manila
  // between 00:00 and 08:00 — the same rule every filename in this file follows.
  meta.addRow(["Exported at", formatLocalDateKey(ctx.generatedOn)]);
  meta.addRow(["Learner count", learners.length]);
  meta.addRow(["ARAL count", aralLearners.length]);

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

  const purposeResult = parsePurpose(filter.purpose);
  if (!purposeResult.ok) return purposeResult;
  const { purpose } = purposeResult;

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

  const learners = await fetchLearnersForExport({
    schoolId: user.schoolId,
    teacherId: user.id,
    gradeLevelId: filter.gradeLevelId,
    sectionId: filter.sectionId,
    aralOnly: filter.aralOnly,
  });

  const frame = await loadReportFrame({ schoolId: user.schoolId, preparedBy: user.fullName });
  const buffer = await buildLearnersWorkbook(
    learners,
    frame,
    gradeSectionFor(learners, filter),
    purpose
  );
  // Local date key, never `toISOString()`: the school runs at UTC+8, so between
  // 00:00 and 08:00 Manila the UTC slice names the export for yesterday.
  const filename = `litrack-learners-${formatLocalDateKey(schoolToday())}.xlsx`;

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
      purpose,
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

  const purposeResult = parsePurpose(filter.purpose);
  if (!purposeResult.ok) return purposeResult;
  const { purpose } = purposeResult;

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

  const learners = await fetchLearnersForExport({
    schoolId,
    gradeLevelId: filter.gradeLevelId,
    sectionId: filter.sectionId,
    aralOnly: filter.aralOnly,
  });

  const frame = await loadReportFrame({ schoolId, preparedBy: user.fullName });
  const buffer = await buildLearnersWorkbook(
    learners,
    frame,
    gradeSectionFor(learners, filter),
    purpose
  );
  // Local date key, never `toISOString()`: the school runs at UTC+8, so between
  // 00:00 and 08:00 Manila the UTC slice names the export for yesterday.
  const filename = `litrack-school-learners-${formatLocalDateKey(schoolToday())}.xlsx`;

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
      purpose,
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
  englishReadingProfile: string | null;
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
  /**
   * The shared DepEd-style header block, for the UI to render once the
   * printable report gains it. Optional: `loadLearnersForReport`'s deprecated
   * callers have no signed-in actor to put in "Prepared by", so they get no
   * header rather than one naming nobody.
   */
  header?: ReportHeaderField[];
  /**
   * The shared DepEd-style footer (Prepared by / Noted by / system-generated
   * note), for the UI to render alongside `header`. Same optionality reason:
   * `loadLearnersForReport`'s deprecated callers have no signed-in actor.
   */
  footer?: ReportFooter;
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

  // The printable (HTML) report keeps its "Label: Value" header and
  // "Prepared by / Noted by" footer; both come off the same frame the
  // spreadsheets use, so the two never disagree about the school.
  const frame = await loadReportFrame({ schoolId, preparedBy: user.fullName });
  const gradeSection = gradeSectionFor(learners, input);
  const header = frameHeaderFields(
    frame,
    gradeSection.gradeLevel
      ? [gradeSection.gradeLevel, gradeSection.section].filter(Boolean).join(" - ")
      : formatGradeSectionLine(gradeSection)
  );
  const footer = frameFooter(frame);

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

  return {
    ok: true,
    data: { ...buildPrintableReportData(school, learners), header, footer },
  };
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
