import "server-only";
import type { GradeLevelType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertTestableSchool } from "@/lib/auth/test-lab";
import { findDemoSchools } from "@/lib/demo/provision";
import { testLabPersonaEmail } from "@/lib/test-lab/personas";
import { setTeacherAdvisory } from "@/lib/teachers/section-assignment";
import { generateActivationCredential } from "@/lib/auth/credentials";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * Page Test Lab fixtures (docs/test-lab-spec.md, T2).
 *
 * Every write here is keyed on a school found via `findDemoSchools()` and
 * re-checked by `assertTestableSchool` immediately before the first write, so
 * nothing lands anywhere but the one live demo school. Idempotent throughout:
 * each step looks for what it needs before creating it, so a second call
 * creates nothing new.
 */

const SECTION_NAME = "A";
const TEST_LAB_YEAR_LABEL = "Test Lab";

export type TestLabFixtures = {
  prepared: boolean;
  schoolId: string | null;
  schoolYearId: string | null;
  kinderGradeId: string | null;
  g1GradeId: string | null;
  kinderSectionId: string | null;
  g1SectionId: string | null;
  teacherId: string | null;
  pendingTeacherId: string | null;
  /** Every learner rostered under the demo teacher, across both sections. */
  learnerIds: string[];
  /** Subset of `learnerIds` enrolled in ARAL, `aralTeacherId` = the demo teacher. */
  aralLearnerIds: string[];
};

const EMPTY_FIXTURES: TestLabFixtures = {
  prepared: false,
  schoolId: null,
  schoolYearId: null,
  kinderGradeId: null,
  g1GradeId: null,
  kinderSectionId: null,
  g1SectionId: null,
  teacherId: null,
  pendingTeacherId: null,
  learnerIds: [],
  aralLearnerIds: [],
};

/**
 * Read whatever Test Lab fixtures currently exist, or the "not prepared"
 * shape. Never throws — the demo school and its rows can be removed by
 * `resetDemoTenant` at any time, and this is read from admin UI, not from a
 * guard, so a missing row is just "not prepared yet".
 */
export async function findTestLabFixtures(): Promise<TestLabFixtures> {
  const schools = await findDemoSchools();
  const schoolId = schools[0]?.id;
  if (!schoolId) return EMPTY_FIXTURES;

  const schoolYear = await prisma.schoolYear.findFirst({
    where: { schoolId, isActive: true },
    select: { id: true },
  });

  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, type: { in: ["KINDER", "G1"] }, deletedAt: null },
    select: { id: true, type: true },
  });
  const kinderGradeId = grades.find((g) => g.type === "KINDER")?.id ?? null;
  const g1GradeId = grades.find((g) => g.type === "G1")?.id ?? null;

  const gradeIds = [kinderGradeId, g1GradeId].filter((id): id is string => id !== null);
  const sections =
    gradeIds.length > 0
      ? await prisma.section.findMany({
          where: { schoolId, gradeLevelId: { in: gradeIds }, name: SECTION_NAME, deletedAt: null },
          select: { id: true, gradeLevelId: true },
        })
      : [];
  const kinderSectionId = sections.find((s) => s.gradeLevelId === kinderGradeId)?.id ?? null;
  const g1SectionId = sections.find((s) => s.gradeLevelId === g1GradeId)?.id ?? null;

  const teacher = await prisma.user.findFirst({
    where: { email: testLabPersonaEmail("teacher"), role: "TEACHER", schoolId, deletedAt: null },
    select: { id: true },
  });
  const pendingTeacher = await prisma.user.findFirst({
    where: { email: testLabPersonaEmail("pending-teacher"), role: "TEACHER", schoolId, deletedAt: null },
    select: { id: true },
  });

  const learners = teacher
    ? await prisma.learner.findMany({
        where: { schoolId, teacherId: teacher.id, deletedAt: null },
        select: { id: true, isAralLearner: true },
      })
    : [];

  const prepared = Boolean(
    schoolYear &&
      kinderGradeId &&
      g1GradeId &&
      kinderSectionId &&
      g1SectionId &&
      teacher &&
      pendingTeacher &&
      learners.length > 0
  );

  return {
    prepared,
    schoolId,
    schoolYearId: schoolYear?.id ?? null,
    kinderGradeId,
    g1GradeId,
    kinderSectionId,
    g1SectionId,
    teacherId: teacher?.id ?? null,
    pendingTeacherId: pendingTeacher?.id ?? null,
    learnerIds: learners.map((l) => l.id),
    aralLearnerIds: learners.filter((l) => l.isAralLearner).map((l) => l.id),
  };
}

async function ensureActiveSchoolYear(schoolId: string): Promise<string> {
  const active = await prisma.schoolYear.findFirst({ where: { schoolId, isActive: true } });
  if (active) return active.id;

  const existingByLabel = await prisma.schoolYear.findFirst({
    where: { schoolId, label: TEST_LAB_YEAR_LABEL },
  });
  if (existingByLabel) {
    const updated = await prisma.schoolYear.update({
      where: { id: existingByLabel.id },
      data: { isActive: true },
    });
    return updated.id;
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), 5, 1); // June 1
  const endDate = new Date(now.getFullYear() + 1, 2, 31); // March 31 next year
  const created = await prisma.schoolYear.create({
    data: { schoolId, label: TEST_LAB_YEAR_LABEL, startDate, endDate, isActive: true },
  });
  return created.id;
}

async function ensureGrade(schoolId: string, type: GradeLevelType): Promise<string> {
  const existing = await prisma.gradeLevel.findFirst({ where: { schoolId, type } });
  if (!existing) {
    const created = await prisma.gradeLevel.create({ data: { schoolId, type } });
    return created.id;
  }
  if (existing.deletedAt) {
    await prisma.gradeLevel.update({ where: { id: existing.id }, data: { deletedAt: null } });
  }
  return existing.id;
}

async function ensureSection(schoolId: string, gradeLevelId: string): Promise<string> {
  const existing = await prisma.section.findFirst({
    where: { schoolId, gradeLevelId, name: SECTION_NAME },
  });
  if (!existing) {
    const created = await prisma.section.create({
      data: { schoolId, gradeLevelId, name: SECTION_NAME },
    });
    return created.id;
  }
  if (existing.deletedAt) {
    await prisma.section.update({ where: { id: existing.id }, data: { deletedAt: null } });
  }
  return existing.id;
}

async function ensureDemoSchoolHead(schoolId: string): Promise<void> {
  const head = await prisma.user.findFirst({
    where: { email: testLabPersonaEmail("head"), role: "SCHOOL_HEAD", schoolId, deletedAt: null },
    select: { id: true, profileCompleted: true, mustChangePassword: true },
  });
  if (!head) return; // Provisioned by `provisionDemoTenant`, not created here.
  if (head.profileCompleted && !head.mustChangePassword) return;
  await prisma.user.update({
    where: { id: head.id },
    data: { profileCompleted: true, mustChangePassword: false },
  });
}

/** Create the Supabase auth user + `User` row for a fresh demo teacher persona. */
async function createTeacherAuthUser(params: {
  email: string;
  schoolId: string;
  firstName: string;
  lastName: string;
}): Promise<{ id: string; authId: string }> {
  const admin = createSupabaseAdminClient();
  // Generated once, never returned or logged: nobody signs in as this account
  // with a password — Test Lab reaches it only through the signed
  // impersonation ticket.
  const password = generateActivationCredential();
  const { data, error } = await admin.auth.admin.createUser({
    email: params.email,
    password,
    email_confirm: true,
    app_metadata: { role: "TEACHER", schoolId: params.schoolId },
    user_metadata: { role: "TEACHER" },
  });
  if (error || !data.user) {
    throw error ?? new Error("prepareTestLabFixtures: teacher auth bootstrap failed");
  }
  const fullName = `${params.firstName} ${params.lastName}`;
  const user = await prisma.user.create({
    data: {
      authId: data.user.id,
      email: params.email,
      role: "TEACHER",
      schoolId: params.schoolId,
      firstName: params.firstName,
      lastName: params.lastName,
      fullName,
      isActive: true,
      mustChangePassword: false,
    },
  });
  return { id: user.id, authId: data.user.id };
}

/**
 * The demo teacher: APPROVED, active, profiled, advising Kinder-A and Grade
 * 1-A through the real `setTeacherAdvisory`, so the legacy `TeacherSection`
 * and `taughtGrades` mirrors are genuinely exercised.
 */
async function ensureDemoTeacher(params: {
  schoolId: string;
  createdById: string;
  kinderSectionId: string;
  g1SectionId: string;
}): Promise<string> {
  const email = testLabPersonaEmail("teacher");
  let teacher = await prisma.user.findFirst({
    where: { email, role: "TEACHER", schoolId: params.schoolId, deletedAt: null },
    select: { id: true },
  });

  if (!teacher) {
    const created = await createTeacherAuthUser({
      email,
      schoolId: params.schoolId,
      firstName: "Test Lab",
      lastName: "Teacher",
    });
    await prisma.user.update({
      where: { id: created.id },
      data: {
        isActive: true,
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.createdById,
        profileCompleted: true,
      },
    });
    await prisma.teacherProfile.create({
      data: {
        userId: created.id,
        educationalAttainment: "BACHELORS",
        fieldOfSpecialization: "GENERAL_EDUCATION",
        hasReadingTraining: false,
        hasEnglishTraining: false,
        highestTrainingLevel: "NA",
        advisoryMode: "MULTI_GRADE",
      },
    });
    teacher = { id: created.id };
    const adminClient = createSupabaseAdminClient();
    await adminClient.auth.admin.updateUserById(created.authId, {
      app_metadata: { role: "TEACHER", schoolId: params.schoolId },
    });
  }

  const advisory = await prisma.section.findMany({
    where: { adviserId: teacher.id, schoolId: params.schoolId, deletedAt: null },
    select: { id: true },
  });
  const held = new Set(advisory.map((s) => s.id));
  for (const sectionId of [params.kinderSectionId, params.g1SectionId]) {
    if (held.has(sectionId)) continue;
    await prisma.$transaction((tx) =>
      setTeacherAdvisory(tx, {
        teacherId: teacher!.id,
        schoolId: params.schoolId,
        change: { op: "add", sectionId },
      })
    );
  }

  return teacher.id;
}

async function ensurePendingTeacher(schoolId: string): Promise<string> {
  const email = testLabPersonaEmail("pending-teacher");
  const existing = await prisma.user.findFirst({
    where: { email, role: "TEACHER", schoolId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await createTeacherAuthUser({
    email,
    schoolId,
    firstName: "Test Lab",
    lastName: "Pending Teacher",
  });
  await prisma.user.update({
    where: { id: created.id },
    data: { isActive: false, approvalStatus: "PENDING" },
  });
  return created.id;
}

/** ~3 learners in one section, 2 of them ARAL. No-op once any exist there. */
async function ensureSectionLearners(params: {
  schoolId: string;
  gradeLevelId: string;
  sectionId: string;
  teacherId: string;
  schoolYearId: string;
  namePrefix: string;
}): Promise<{ learnerIds: string[]; aralLearnerIds: string[] }> {
  const existing = await prisma.learner.findMany({
    where: {
      schoolId: params.schoolId,
      sectionId: params.sectionId,
      teacherId: params.teacherId,
      deletedAt: null,
    },
    select: { id: true, isAralLearner: true },
  });
  if (existing.length > 0) {
    return {
      learnerIds: existing.map((l) => l.id),
      aralLearnerIds: existing.filter((l) => l.isAralLearner).map((l) => l.id),
    };
  }

  const learnerIds: string[] = [];
  const aralLearnerIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const isAral = i < 2;
    const learner = await prisma.$transaction(async (tx) => {
      const row = await tx.learner.create({
        data: {
          schoolId: params.schoolId,
          gradeLevelId: params.gradeLevelId,
          sectionId: params.sectionId,
          teacherId: params.teacherId,
          firstName: params.namePrefix,
          lastName: `Learner ${i + 1}`,
          fullName: `${params.namePrefix} Learner ${i + 1}`,
          age: 6,
          gender: i % 2 === 0 ? "MALE" : "FEMALE",
          filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
          parentEducation: "COLLEGE_GRADUATE",
          isAralLearner: isAral,
          aralEnrolledAt: isAral ? new Date() : null,
          aralTeacherId: isAral ? params.teacherId : null,
        },
      });
      await tx.enrollment.create({
        data: {
          learnerId: row.id,
          schoolId: params.schoolId,
          schoolYearId: params.schoolYearId,
          gradeLevelId: params.gradeLevelId,
          sectionId: params.sectionId,
          teacherId: params.teacherId,
          status: "ACTIVE",
        },
      });
      return row;
    });
    learnerIds.push(learner.id);
    if (learner.isAralLearner) aralLearnerIds.push(learner.id);
  }
  return { learnerIds, aralLearnerIds };
}

/**
 * Build (or complete) every Test Lab fixture inside the one live demo school.
 *
 * Refuses via `assertTestableSchool` before any write — a school missing or
 * not `isDemo` never receives a row. Every sub-step is idempotent, so calling
 * this twice creates nothing new.
 */
export async function prepareTestLabFixtures(createdById: string): Promise<TestLabFixtures> {
  const schools = await findDemoSchools();
  const schoolId = schools[0]?.id;
  await assertTestableSchool(schoolId);
  const school = schoolId as string;

  const schoolYearId = await ensureActiveSchoolYear(school);

  const kinderGradeId = await ensureGrade(school, "KINDER");
  const g1GradeId = await ensureGrade(school, "G1");
  const kinderSectionId = await ensureSection(school, kinderGradeId);
  const g1SectionId = await ensureSection(school, g1GradeId);

  await ensureDemoSchoolHead(school);

  const teacherId = await ensureDemoTeacher({
    schoolId: school,
    createdById,
    kinderSectionId,
    g1SectionId,
  });
  const pendingTeacherId = await ensurePendingTeacher(school);

  const kinder = await ensureSectionLearners({
    schoolId: school,
    gradeLevelId: kinderGradeId,
    sectionId: kinderSectionId,
    teacherId,
    schoolYearId,
    namePrefix: "Kinder",
  });
  const g1 = await ensureSectionLearners({
    schoolId: school,
    gradeLevelId: g1GradeId,
    sectionId: g1SectionId,
    teacherId,
    schoolYearId,
    namePrefix: "Grade 1",
  });

  const learnerIds = [...kinder.learnerIds, ...g1.learnerIds];
  const aralLearnerIds = [...kinder.aralLearnerIds, ...g1.aralLearnerIds];

  await writeAudit({
    userId: createdById,
    schoolId: school,
    action: AUDIT_ACTIONS.TEST_LAB_PREPARE,
    resource: "School",
    resourceId: school,
    metadata: {
      schoolYearId,
      kinderGradeId,
      g1GradeId,
      kinderSectionId,
      g1SectionId,
      teacherId,
      pendingTeacherId,
      learnerCount: learnerIds.length,
      aralLearnerCount: aralLearnerIds.length,
    },
  });

  return {
    prepared: true,
    schoolId: school,
    schoolYearId,
    kinderGradeId,
    g1GradeId,
    kinderSectionId,
    g1SectionId,
    teacherId,
    pendingTeacherId,
    learnerIds,
    aralLearnerIds,
  };
}
