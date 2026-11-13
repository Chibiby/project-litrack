import "server-only";
import type { AdvisoryMode, Gender, GradeLevelType, ReadingProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createIdentity } from "@/lib/auth/identity";
import { hashPassword } from "@/lib/auth/password-hash";
import { assertTestableSchool } from "@/lib/auth/test-lab";
import { findDemoSchools } from "@/lib/demo/provision";
import { DEMO_DISTRICT_NAME } from "@/lib/demo/constants";
import { testLabPersonaEmail, type TestLabPersona } from "@/lib/test-lab/personas";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { buildFullName } from "@/lib/names";
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

/**
 * The demo people. Invented, common Filipino names rather than "Learner 1":
 * the demo school is what orientation screenshots and recordings show, and a
 * roster of placeholders reads as a broken system. None of these is a real
 * person; the school, district and division keep their bracketed demo names so
 * nobody mistakes the tenant for a real one.
 */
type TeacherKey = "multi" | "single" | "floating" | "volunteer";

type DemoTeacherSpec = {
  persona: TestLabPersona;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: Gender;
  advisoryMode: AdvisoryMode;
  volunteer: boolean;
};

/**
 * One demo teacher per kind of teacher the system knows:
 *  - multi: advises Kinder-A and Grade 1-A (multi-advisory, stored MULTI_GRADE)
 *  - single: advises Grade 2-A only
 *  - floating: DepEd teacher with no advisory section, ARAL tutor only
 *  - volunteer: Non-DepEd ARAL Volunteer, ARAL tutor only
 */
const DEMO_TEACHERS: Record<TeacherKey, DemoTeacherSpec> = {
  multi: {
    persona: "teacher",
    firstName: "Anna",
    middleName: "Lopez",
    lastName: "Meyer",
    gender: "FEMALE",
    advisoryMode: "MULTI_GRADE",
    volunteer: false,
  },
  single: {
    persona: "teacher-single",
    firstName: "Maria Teresa",
    middleName: "Cruz",
    lastName: "Santos",
    gender: "FEMALE",
    advisoryMode: "DEFAULT",
    volunteer: false,
  },
  floating: {
    persona: "teacher-floating",
    firstName: "Jose",
    middleName: "Pineda",
    lastName: "Reyes",
    gender: "MALE",
    advisoryMode: "FLOATING",
    volunteer: false,
  },
  volunteer: {
    persona: "teacher-volunteer",
    firstName: "Liza",
    middleName: "Marquez",
    lastName: "Garcia",
    gender: "FEMALE",
    advisoryMode: "DEFAULT",
    volunteer: true,
  },
};

const PENDING_TEACHER_NAME = { firstName: "Ramon", middleName: "Diaz", lastName: "Bautista" };
const DEMO_HEAD_NAME = { firstName: "Rosario", middleName: "Castro", lastName: "Villanueva" };
const DEMO_DISTRICT_ADMIN_NAME = { firstName: "Carmela", middleName: "Ramos", lastName: "Aquino" };

type DemoLearnerSpec = {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: Gender;
  reading: ReadingProfile;
  /** Who tutors this learner in ARAL; null = not an ARAL learner. */
  aral: TeacherKey | null;
};

const L = (
  firstName: string,
  middleName: string,
  lastName: string,
  gender: Gender,
  reading: ReadingProfile,
  aral: TeacherKey | null = null
): DemoLearnerSpec => ({ firstName, middleName, lastName, gender, reading, aral });

/**
 * Rosters, in order. The first two of Kinder and Grade 1 are ARAL learners on
 * purpose: a tenant prepared by an earlier release holds three placeholder
 * learners per section with the first two in ARAL, and those rows are renamed
 * in place to the first three names here.
 */
const KINDER_ROSTER: readonly DemoLearnerSpec[] = [
  L("Juan", "Santos", "Dela Cruz", "MALE", "CANNOT_NAME_SOUND_LETTERS", "multi"),
  L("Maria Angelica", "Rivera", "Santos", "FEMALE", "LETTER_LEVEL", "multi"),
  L("Miguel", "Andres", "Reyes", "MALE", "CV_BLENDING"),
  L("Sofia", "Bernardo", "Garcia", "FEMALE", "CVC_BLENDING"),
  L("Gabriel", "Tolentino", "Mendoza", "MALE", "CV_BLENDING"),
];
const G1_ROSTER: readonly DemoLearnerSpec[] = [
  L("Althea Mae", "Domingo", "Ramos", "FEMALE", "LETTER_LEVEL", "multi"),
  L("Joshua", "Perez", "Bautista", "MALE", "CANNOT_NAME_SOUND_LETTERS", "multi"),
  L("Princess Joy", "Lim", "Flores", "FEMALE", "CVC_BLENDING"),
  L("John Paul", "Corpuz", "Villanueva", "MALE", "CV_BLENDING"),
  L("Angel Grace", "Morales", "Aquino", "FEMALE", "CVC_BLENDING"),
];
const G2_ROSTER: readonly DemoLearnerSpec[] = [
  L("Mark Anthony", "Valdez", "Castillo", "MALE", "LETTER_LEVEL", "single"),
  L("Jasmine", "Espiritu", "Navarro", "FEMALE", "CV_BLENDING", "single"),
  L("Daniel", "Ocampo", "Fernandez", "MALE", "CANNOT_NAME_SOUND_LETTERS", "floating"),
  L("Kimberly Anne", "Salazar", "Torres", "FEMALE", "LETTER_LEVEL", "floating"),
  L("Christian Jay", "Nepomuceno", "Pascual", "MALE", "LETTER_LEVEL", "volunteer"),
  L("Samantha Nicole", "Gonzales", "Domingo", "FEMALE", "CV_BLENDING", "volunteer"),
  L("Rafael", "Ignacio", "Soriano", "MALE", "CVC_BLENDING"),
  L("Bea Katrina", "Manalo", "De Guzman", "FEMALE", "CVC_BLENDING"),
];

/** A learner or teacher row written by an earlier release, before real names. */
const PLACEHOLDER_LEARNER = /^Learner \d+$/;
const PLACEHOLDER_TEACHER_FIRST_NAME = "Test Lab";

export type TestLabFixtures = {
  prepared: boolean;
  schoolId: string | null;
  schoolYearId: string | null;
  kinderGradeId: string | null;
  g1GradeId: string | null;
  kinderSectionId: string | null;
  g1SectionId: string | null;
  /** The multi-advisory demo teacher (Kinder-A and Grade 1-A). */
  teacherId: string | null;
  /** Grade 2-A, advised by the single-advisory demo teacher. */
  g2GradeId: string | null;
  g2SectionId: string | null;
  singleTeacherId: string | null;
  floatingTeacherId: string | null;
  volunteerTeacherId: string | null;
  pendingTeacherId: string | null;
  /** The demo district admin, assigned to `DEMO_DISTRICT_NAME` only. */
  districtAdminId: string | null;
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
  g2GradeId: null,
  g2SectionId: null,
  singleTeacherId: null,
  floatingTeacherId: null,
  volunteerTeacherId: null,
  pendingTeacherId: null,
  districtAdminId: null,
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
    where: { schoolId, type: { in: ["KINDER", "G1", "G2"] }, deletedAt: null },
    select: { id: true, type: true },
  });
  const kinderGradeId = grades.find((g) => g.type === "KINDER")?.id ?? null;
  const g1GradeId = grades.find((g) => g.type === "G1")?.id ?? null;
  const g2GradeId = grades.find((g) => g.type === "G2")?.id ?? null;

  const gradeIds = [kinderGradeId, g1GradeId, g2GradeId].filter((id): id is string => id !== null);
  const sections =
    gradeIds.length > 0
      ? await prisma.section.findMany({
          where: { schoolId, gradeLevelId: { in: gradeIds }, name: SECTION_NAME, deletedAt: null },
          select: { id: true, gradeLevelId: true },
        })
      : [];
  const kinderSectionId = sections.find((s) => s.gradeLevelId === kinderGradeId)?.id ?? null;
  const g1SectionId = sections.find((s) => s.gradeLevelId === g1GradeId)?.id ?? null;
  const g2SectionId = sections.find((s) => s.gradeLevelId === g2GradeId)?.id ?? null;

  const findTeacher = (persona: TestLabPersona) =>
    prisma.user.findFirst({
      where: { email: testLabPersonaEmail(persona), role: "TEACHER", schoolId, deletedAt: null },
      select: { id: true },
    });
  const teacher = await findTeacher("teacher");
  const singleTeacher = await findTeacher("teacher-single");
  const floatingTeacher = await findTeacher("teacher-floating");
  const volunteerTeacher = await findTeacher("teacher-volunteer");
  const pendingTeacher = await findTeacher("pending-teacher");
  const districtAdmin = await findDemoDistrictAdmin();

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
      g2GradeId &&
      g2SectionId &&
      teacher &&
      singleTeacher &&
      floatingTeacher &&
      volunteerTeacher &&
      pendingTeacher &&
      districtAdmin &&
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
    g2GradeId,
    g2SectionId,
    singleTeacherId: singleTeacher?.id ?? null,
    floatingTeacherId: floatingTeacher?.id ?? null,
    volunteerTeacherId: volunteerTeacher?.id ?? null,
    pendingTeacherId: pendingTeacher?.id ?? null,
    districtAdminId: districtAdmin?.id ?? null,
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

  // UTC midnight, matching `createSchoolYear` — which stores the value of an
  // `<input type="date">` via `new Date("YYYY-MM-DD")`, and ECMA-262 parses a
  // date-only ISO string as UTC midnight. Building these from LOCAL fields
  // instead would store a different instant on any machine that is not at
  // UTC, and `getTermWindows` reads the anchor month with UTC getters, so the
  // demo tenant's term windows would drift against every real school's.
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), 5, 1)); // June 1
  const endDate = new Date(Date.UTC(now.getUTCFullYear() + 1, 2, 31)); // March 31 next year
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
    select: { id: true, profileCompleted: true, mustChangePassword: true, firstName: true },
  });
  if (!head) return; // Provisioned by `provisionDemoTenant`, not created here.
  // Provisioning leaves the head nameless (its full name is the school's). Give
  // the account a person's name once; a name somebody typed since is kept.
  const unnamed = head.firstName === "";
  if (head.profileCompleted && !head.mustChangePassword && !unnamed) return;
  await prisma.user.update({
    where: { id: head.id },
    data: {
      profileCompleted: true,
      mustChangePassword: false,
      ...(unnamed
        ? {
            firstName: DEMO_HEAD_NAME.firstName,
            middleName: DEMO_HEAD_NAME.middleName,
            lastName: DEMO_HEAD_NAME.lastName,
            fullName: buildFullName(
              DEMO_HEAD_NAME.firstName,
              DEMO_HEAD_NAME.middleName,
              DEMO_HEAD_NAME.lastName
            ),
          }
        : {}),
    },
  });
}

/** Create the identity + `User` row for a fresh demo teacher persona. */
async function createTeacherAuthUser(params: {
  email: string;
  schoolId: string;
  firstName: string;
  middleName: string;
  lastName: string;
}): Promise<{ id: string; authId: string }> {
  // Generated once, never returned or logged: nobody signs in as this account
  // with a password — Test Lab reaches it only through the signed
  // impersonation ticket. Hashed before the transaction so bcrypt does not
  // run while it is open.
  const hash = await hashPassword(generateActivationCredential());
  const fullName = buildFullName(params.firstName, params.middleName, params.lastName);
  // One transaction: the persona's email is fixed, so an identity left behind
  // by a failed `User.create` would make every later Prepare fail.
  return prisma.$transaction(async (tx) => {
    const { authId } = await createIdentity(
      { email: params.email, password: { hash }, role: "TEACHER", emailVerified: true },
      tx
    );
    const user = await tx.user.create({
      data: {
        authId,
        email: params.email,
        role: "TEACHER",
        schoolId: params.schoolId,
        firstName: params.firstName,
        middleName: params.middleName,
        lastName: params.lastName,
        fullName,
        isActive: true,
        mustChangePassword: false,
      },
    });
    return { id: user.id, authId };
  });
}

/**
 * Give an account written by an earlier release ("Test Lab Teacher") its real
 * demo name. Only the placeholder is replaced; a name typed since is kept.
 */
async function renamePlaceholderTeacher(
  teacher: { id: string; firstName: string },
  name: { firstName: string; middleName: string; lastName: string }
): Promise<void> {
  if (teacher.firstName !== PLACEHOLDER_TEACHER_FIRST_NAME) return;
  await prisma.user.update({
    where: { id: teacher.id },
    data: {
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      fullName: buildFullName(name.firstName, name.middleName, name.lastName),
    },
  });
}

/**
 * One demo teacher: APPROVED, active, profiled, and advising `sectionIds`
 * through the real `setTeacherAdvisory`, so the legacy `TeacherSection` and
 * `taughtGrades` mirrors are genuinely exercised. A floating teacher and a
 * Non-DepEd ARAL Volunteer pass no sections: they reach learners only as the
 * designated ARAL tutor.
 */
async function ensureDemoTeacher(params: {
  spec: DemoTeacherSpec;
  schoolId: string;
  createdById: string;
  sectionIds: string[];
}): Promise<string> {
  const { spec } = params;
  const email = testLabPersonaEmail(spec.persona);
  const existing = await prisma.user.findFirst({
    where: { email, role: "TEACHER", schoolId: params.schoolId, deletedAt: null },
    select: { id: true, firstName: true },
  });

  let teacherId: string;
  if (existing) {
    teacherId = existing.id;
    await renamePlaceholderTeacher(existing, spec);
  } else {
    const created = await createTeacherAuthUser({
      email,
      schoolId: params.schoolId,
      firstName: spec.firstName,
      middleName: spec.middleName,
      lastName: spec.lastName,
    });
    await prisma.user.update({
      where: { id: created.id },
      data: {
        isActive: true,
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.createdById,
        profileCompleted: true,
        registeredAsAralVolunteer: spec.volunteer,
      },
    });
    await prisma.teacherProfile.create({
      data: {
        userId: created.id,
        designation: spec.volunteer ? ARAL_VOLUNTEER_DESIGNATION : "Teacher",
        employmentType: spec.volunteer ? "NON_DEPED" : "DEPED_PLANTILLA",
        gender: spec.gender,
        educationalAttainment: "BACHELORS",
        fieldOfSpecialization: "GENERAL_EDUCATION",
        hasReadingTraining: false,
        hasEnglishTraining: false,
        highestTrainingLevel: "NA",
        advisoryMode: spec.advisoryMode,
      },
    });
    teacherId = created.id;
  }

  if (params.sectionIds.length === 0) return teacherId;

  const advisory = await prisma.section.findMany({
    where: { adviserId: teacherId, schoolId: params.schoolId, deletedAt: null },
    select: { id: true },
  });
  const held = new Set(advisory.map((s) => s.id));
  for (const sectionId of params.sectionIds) {
    if (held.has(sectionId)) continue;
    await prisma.$transaction((tx) =>
      setTeacherAdvisory(tx, {
        teacherId,
        schoolId: params.schoolId,
        change: { op: "add", sectionId },
      })
    );
  }

  return teacherId;
}

async function ensurePendingTeacher(schoolId: string): Promise<string> {
  const email = testLabPersonaEmail("pending-teacher");
  const existing = await prisma.user.findFirst({
    where: { email, role: "TEACHER", schoolId, deletedAt: null },
    select: { id: true, firstName: true },
  });
  if (existing) {
    await renamePlaceholderTeacher(existing, PENDING_TEACHER_NAME);
    return existing.id;
  }

  const created = await createTeacherAuthUser({ email, schoolId, ...PENDING_TEACHER_NAME });
  await prisma.user.update({
    where: { id: created.id },
    data: { isActive: false, approvalStatus: "PENDING" },
  });
  return created.id;
}

/** The demo district admin, only while it is assigned to the demo district alone. */
function findDemoDistrictAdmin() {
  return prisma.user.findFirst({
    where: {
      email: testLabPersonaEmail("district"),
      role: "DISTRICT_ADMIN",
      schoolId: null,
      deletedAt: null,
      districtAssignments: {
        some: { district: DEMO_DISTRICT_NAME },
        every: { district: DEMO_DISTRICT_NAME },
      },
    },
    select: { id: true },
  });
}

/**
 * The demo district admin: a DISTRICT_ADMIN with no school, assigned to
 * `DEMO_DISTRICT_NAME` and nothing else, so its scope is the demo schools and
 * never a real one (`schoolWhereForScope`). Any other assignment this one
 * test account somehow holds is removed. The account is not tied to a school,
 * so "Reset test data" keeps it; it simply sees the rebuilt demo school.
 */
async function ensureDemoDistrictAdmin(createdById: string): Promise<string> {
  const email = testLabPersonaEmail("district");
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, role: true, schoolId: true },
  });
  if (existing && (existing.role !== "DISTRICT_ADMIN" || existing.schoolId !== null)) {
    throw new Error("The demo district admin's address belongs to another kind of account.");
  }

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    // Same as a demo teacher: nobody signs in with this password; Test Lab
    // reaches the account only through the impersonation swap.
    const hash = await hashPassword(generateActivationCredential());
    const name = DEMO_DISTRICT_ADMIN_NAME;
    userId = await prisma.$transaction(async (tx) => {
      const { authId } = await createIdentity(
        { email, password: { hash }, role: "DISTRICT_ADMIN", emailVerified: true },
        tx
      );
      const user = await tx.user.create({
        data: {
          authId,
          email,
          role: "DISTRICT_ADMIN",
          schoolId: null,
          firstName: name.firstName,
          middleName: name.middleName,
          lastName: name.lastName,
          fullName: buildFullName(name.firstName, name.middleName, name.lastName),
          isActive: true,
          mustChangePassword: false,
          profileCompleted: true,
        },
      });
      return user.id;
    });
  }

  await prisma.districtAdminAssignment.deleteMany({
    where: { userId, district: { not: DEMO_DISTRICT_NAME } },
  });
  await prisma.districtAdminAssignment.upsert({
    where: { userId_district: { userId, district: DEMO_DISTRICT_NAME } },
    create: { userId, district: DEMO_DISTRICT_NAME, createdById },
    update: {},
  });
  return userId;
}

/**
 * The named roster of one section. Idempotent by full name: a learner already
 * there is left alone, a placeholder from an earlier release ("Learner 1") is
 * renamed in place to the next unused name, and only the names still missing
 * are created.
 */
async function ensureSectionLearners(params: {
  schoolId: string;
  gradeLevelId: string;
  sectionId: string;
  /** The section's adviser, who rosters every learner in it. */
  teacherId: string;
  schoolYearId: string;
  age: number;
  roster: readonly DemoLearnerSpec[];
  teacherIds: Record<TeacherKey, string>;
}): Promise<{ learnerIds: string[]; aralLearnerIds: string[] }> {
  const existing = await prisma.learner.findMany({
    where: { schoolId: params.schoolId, sectionId: params.sectionId, deletedAt: null },
    select: { id: true, lastName: true, fullName: true, isAralLearner: true },
  });

  const nameOf = (spec: DemoLearnerSpec) =>
    buildFullName(spec.firstName, spec.middleName, spec.lastName);
  const taken = new Set(existing.map((l) => l.fullName));
  const unused = params.roster.filter((spec) => !taken.has(nameOf(spec)));

  // Placeholders take the first unused names, in "Learner 1, 2, 3" order, and
  // keep everything else about the row: its ARAL state, enrollment and marks.
  const placeholders = existing
    .filter((l) => PLACEHOLDER_LEARNER.test(l.lastName))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, undefined, { numeric: true }));
  for (const row of placeholders) {
    const spec = unused.shift();
    if (!spec) break;
    await prisma.learner.update({
      where: { id: row.id },
      data: {
        firstName: spec.firstName,
        middleName: spec.middleName,
        lastName: spec.lastName,
        fullName: nameOf(spec),
        gender: spec.gender,
      },
    });
  }

  const learnerIds = existing.map((l) => l.id);
  const aralLearnerIds = existing.filter((l) => l.isAralLearner).map((l) => l.id);
  for (const spec of unused) {
    const aralTeacherId = spec.aral ? params.teacherIds[spec.aral] : null;
    const learner = await prisma.$transaction(async (tx) => {
      const row = await tx.learner.create({
        data: {
          schoolId: params.schoolId,
          gradeLevelId: params.gradeLevelId,
          sectionId: params.sectionId,
          teacherId: params.teacherId,
          firstName: spec.firstName,
          middleName: spec.middleName,
          lastName: spec.lastName,
          fullName: nameOf(spec),
          age: params.age,
          gender: spec.gender,
          filipinoReadingProfile: spec.reading,
          parentEducation: "COLLEGE_GRADUATE",
          isAralLearner: aralTeacherId !== null,
          aralEnrolledAt: aralTeacherId ? new Date() : null,
          aralTeacherId,
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
  const g2GradeId = await ensureGrade(school, "G2");
  const g2SectionId = await ensureSection(school, g2GradeId);

  await ensureDemoSchoolHead(school);

  const teacherOf = (key: TeacherKey, sectionIds: string[]) =>
    ensureDemoTeacher({ spec: DEMO_TEACHERS[key], schoolId: school, createdById, sectionIds });
  const teacherId = await teacherOf("multi", [kinderSectionId, g1SectionId]);
  const singleTeacherId = await teacherOf("single", [g2SectionId]);
  const floatingTeacherId = await teacherOf("floating", []);
  const volunteerTeacherId = await teacherOf("volunteer", []);
  const pendingTeacherId = await ensurePendingTeacher(school);
  const districtAdminId = await ensureDemoDistrictAdmin(createdById);

  const teacherIds: Record<TeacherKey, string> = {
    multi: teacherId,
    single: singleTeacherId,
    floating: floatingTeacherId,
    volunteer: volunteerTeacherId,
  };
  const kinder = await ensureSectionLearners({
    schoolId: school,
    gradeLevelId: kinderGradeId,
    sectionId: kinderSectionId,
    teacherId,
    schoolYearId,
    age: 5,
    roster: KINDER_ROSTER,
    teacherIds,
  });
  const g1 = await ensureSectionLearners({
    schoolId: school,
    gradeLevelId: g1GradeId,
    sectionId: g1SectionId,
    teacherId,
    schoolYearId,
    age: 6,
    roster: G1_ROSTER,
    teacherIds,
  });
  // Grade 2-A belongs to the single-advisory teacher. Its ids stay out of
  // `learnerIds`, which is the multi-advisory teacher's roster by contract.
  const g2 = await ensureSectionLearners({
    schoolId: school,
    gradeLevelId: g2GradeId,
    sectionId: g2SectionId,
    teacherId: singleTeacherId,
    schoolYearId,
    age: 7,
    roster: G2_ROSTER,
    teacherIds,
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
      singleTeacherId,
      floatingTeacherId,
      volunteerTeacherId,
      pendingTeacherId,
      districtAdminId,
      learnerCount: learnerIds.length + g2.learnerIds.length,
      aralLearnerCount: aralLearnerIds.length + g2.aralLearnerIds.length,
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
    g2GradeId,
    g2SectionId,
    singleTeacherId,
    floatingTeacherId,
    volunteerTeacherId,
    pendingTeacherId,
    districtAdminId,
    learnerIds,
    aralLearnerIds,
  };
}
