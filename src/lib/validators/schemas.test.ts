import { describe, expect, it } from "vitest";
import { adminLoginSchema, teacherSetupSchema, schoolLoginSchema } from "./auth.schema";
import { createSchoolSchema } from "./school.schema";
import { attendanceMarkSchema } from "./attendance.schema";
import { createGradeLevelSchema, teacherInviteSchema } from "./teacher-invite.schema";
import { learnerCreateSchema } from "./learner.schema";

describe("adminLoginSchema", () => {
  it("accepts valid email/password", () => {
    const r = adminLoginSchema.safeParse({ email: "a@b.co", password: "secret" });
    expect(r.success).toBe(true);
  });

  it("rejects bad email", () => {
    expect(adminLoginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("teacherSetupSchema", () => {
  it("requires matching passwords and valid username", () => {
    const ok = teacherSetupSchema.safeParse({
      token: "tok",
      username: "teacher.cruz.1",
      password: "password1",
      confirmPassword: "password1",
    });
    expect(ok.success).toBe(true);

    const mismatch = teacherSetupSchema.safeParse({
      token: "tok",
      username: "teacher.cruz.1",
      password: "password1",
      confirmPassword: "other",
    });
    expect(mismatch.success).toBe(false);
  });

  it("rejects username charset outside letters/digits/dot/underscore/dash", () => {
    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        username: "teacher cruz",
        password: "password1",
        confirmPassword: "password1",
      }).success
    ).toBe(false);
    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        username: "teacher@cruz",
        password: "password1",
        confirmPassword: "password1",
      }).success
    ).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        username: "teacher.cruz.1",
        password: "short",
        confirmPassword: "short",
      }).success
    ).toBe(false);
  });
});

describe("schoolLoginSchema", () => {
  it("requires schoolId and password", () => {
    expect(
      schoolLoginSchema.safeParse({
        schoolId: "s1",
        role: "SCHOOL_HEAD",
        password: "code",
      }).success
    ).toBe(true);
  });

  it("rejects missing or empty password", () => {
    expect(
      schoolLoginSchema.safeParse({
        schoolId: "s1",
        role: "SCHOOL_HEAD",
      }).success
    ).toBe(false);
    expect(
      schoolLoginSchema.safeParse({
        schoolId: "s1",
        role: "SCHOOL_HEAD",
        password: "",
      }).success
    ).toBe(false);
    expect(
      schoolLoginSchema.safeParse({
        schoolId: "s1",
        role: "SCHOOL_HEAD",
        password: "   ",
      }).success
    ).toBe(false);
  });
});

describe("createSchoolSchema", () => {
  it("validates schoolIdCode charset", () => {
    expect(
      createSchoolSchema.safeParse({ name: "Demo", schoolIdCode: "demo123" }).success
    ).toBe(true);
    expect(
      createSchoolSchema.safeParse({ name: "Demo", schoolIdCode: "bad code" }).success
    ).toBe(false);
  });
});

describe("attendanceMarkSchema", () => {
  it("requires YYYY-MM-DD date string", () => {
    expect(
      attendanceMarkSchema.safeParse({
        learnerId: "l1",
        date: "2024-06-01",
        status: "PRESENT",
      }).success
    ).toBe(true);
    expect(
      attendanceMarkSchema.safeParse({
        learnerId: "l1",
        date: "06/01/2024",
        status: "PRESENT",
      }).success
    ).toBe(false);
  });
});

describe("createGradeLevelSchema / teacherInviteSchema", () => {
  it("accepts known grade types and invite fields", () => {
    expect(createGradeLevelSchema.safeParse({ type: "G1" }).success).toBe(true);
    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        email: "t@example.com",
        firstName: "Ann",
        lastName: "Bee",
      }).success
    ).toBe(true);
  });

  it("rejects invalid grade type and incomplete invites", () => {
    expect(createGradeLevelSchema.safeParse({ type: "GRADE_99" }).success).toBe(false);
    expect(createGradeLevelSchema.safeParse({}).success).toBe(false);
    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        email: "not-an-email",
        firstName: "Ann",
        lastName: "Bee",
      }).success
    ).toBe(false);
    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "",
        email: "t@example.com",
        firstName: "Ann",
        lastName: "Bee",
      }).success
    ).toBe(false);
    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        email: "t@example.com",
        firstName: "",
        lastName: "Bee",
      }).success
    ).toBe(false);
  });
});

describe("learnerCreateSchema", () => {
  it("coerces age and requires profiles", () => {
    const r = learnerCreateSchema.safeParse({
      gradeLevelId: "g1",
      firstName: "A",
      lastName: "B",
      age: "8",
      gender: "MALE",
      englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      parentEducation: "SECONDARY_GRADUATE",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.age).toBe(8);
  });
});
