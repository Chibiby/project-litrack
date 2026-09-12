import { describe, expect, it } from "vitest";
import {
  generateActivationCredential,
  hashToken,
  isStrongPasswordShape,
} from "@/lib/auth/credentials";
import {
  schoolHeadSyntheticEmail,
  teacherUsername,
  teacherSyntheticEmail,
  usernameFromTeacherEmail,
  isSyntheticEmail,
  TEACHER_EMAIL_DOMAIN,
} from "@/lib/auth/synthetic-email";
import {
  parseAppMetadataRole,
  roleHomePath,
  enforceRolePrefix,
  authedLoginRedirect,
} from "@/lib/auth/roles";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictCode,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

describe("generateActivationCredential", () => {
  it("returns ~14 char base64url without padding", () => {
    const cred = generateActivationCredential();
    expect(cred.length).toBeGreaterThanOrEqual(13);
    expect(cred.length).toBeLessThanOrEqual(16);
    expect(cred).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cred.includes("=")).toBe(false);
  });

  it("produces unique values", () => {
    const a = generateActivationCredential();
    const b = generateActivationCredential();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("returns stable sha256 hex", () => {
    const a = hashToken("secret");
    const b = hashToken("secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("other")).not.toBe(a);
  });
});

describe("synthetic emails", () => {
  it("builds school head and teacher emails", () => {
    expect(schoolHeadSyntheticEmail("ABC_12")).toMatch(/^sh@abc-12\./);
    expect(teacherUsername("O'Brien", "a1b2")).toBe("teacher.obrien.a1b2");
    expect(teacherSyntheticEmail("teacher.smith.a1b2")).toBe(
      `teacher.smith.a1b2@${TEACHER_EMAIL_DOMAIN}`
    );
    expect(usernameFromTeacherEmail(`teacher.smith.a1b2@${TEACHER_EMAIL_DOMAIN}`)).toBe(
      "teacher.smith.a1b2"
    );
  });

  it("detects synthetic emails", () => {
    expect(isSyntheticEmail(`teacher.x.abcd@${TEACHER_EMAIL_DOMAIN}`)).toBe(true);
    expect(isSyntheticEmail("person@gmail.com")).toBe(false);
  });
});

describe("password shape helper", () => {
  it("mirrors strong password rules", () => {
    expect(isStrongPasswordShape("password1")).toBe(true);
    expect(isStrongPasswordShape("password")).toBe(false);
  });
});

describe("roles + middleware gate", () => {
  it("maps roles to homes", () => {
    expect(roleHomePath("SUPER_ADMIN")).toBe("/admin");
    expect(roleHomePath("SCHOOL_HEAD")).toBe("/school-head");
    expect(roleHomePath("TEACHER")).toBe("/teacher");
  });

  it("parses app metadata roles", () => {
    expect(parseAppMetadataRole("TEACHER")).toBe("TEACHER");
    expect(parseAppMetadataRole("nope")).toBeNull();
  });

  it("enforces path prefixes; legacy null role passes", () => {
    expect(enforceRolePrefix("/admin/schools", null).ok).toBe(true);
    expect(enforceRolePrefix("/admin/schools", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/school-head", "SCHOOL_HEAD").ok).toBe(true);
    expect(enforceRolePrefix("/school-head", "TEACHER").ok).toBe(false);
    expect(enforceRolePrefix("/teacher", "SUPER_ADMIN").ok).toBe(true);
    expect(enforceRolePrefix("/account/password", "TEACHER").ok).toBe(true);
    // Pending teacher self-register success page must not be role-blocked.
    expect(enforceRolePrefix("/account/created", "TEACHER").ok).toBe(true);
    expect(enforceRolePrefix("/account/created", null).ok).toBe(true);
  });

  it("bounces a signed-in visitor who loads a login page to their home", () => {
    expect(authedLoginRedirect("GET", "/login", "SCHOOL_HEAD")).toBe("/school-head");
    expect(authedLoginRedirect("HEAD", "/login", "TEACHER")).toBe("/teacher");
    expect(authedLoginRedirect("GET", "/admin/login", "SUPER_ADMIN")).toBe("/admin");
  });

  it("never redirects a POST to a login page — that is a Server Action mid-sign-in", () => {
    // The browser has just stored the session; finishSchoolHeadLogin /
    // finishTeacherLogin then POST to /login. Redirecting that request sends
    // the action to /school-head, where Next cannot find it, and the sign-in
    // Supabase already accepted is thrown away.
    expect(authedLoginRedirect("POST", "/login", "SCHOOL_HEAD")).toBeNull();
    expect(authedLoginRedirect("POST", "/login", "TEACHER")).toBeNull();
    expect(authedLoginRedirect("POST", "/admin/login", "SUPER_ADMIN")).toBeNull();
  });

  it("leaves legacy role-less sessions and other paths alone", () => {
    expect(authedLoginRedirect("GET", "/login", null)).toBeNull();
    expect(authedLoginRedirect("GET", "/school-head", "SCHOOL_HEAD")).toBeNull();
    expect(authedLoginRedirect("GET", "/forgot-password", "TEACHER")).toBeNull();
  });
});

describe("teacher registration helpers", () => {
  const base = {
    role: "TEACHER" as const,
    schoolId: "school-1",
    approvalStatus: "PENDING" as const,
    deletedAt: null,
    isActive: false,
  };

  it("detects PENDING teacher at school for idempotent success", () => {
    const pending = {
      role: base.role,
      schoolId: base.schoolId,
      approvalStatus: base.approvalStatus,
      deletedAt: base.deletedAt,
    };
    expect(isPendingTeacherAtSchool(pending, "school-1")).toBe(true);
    expect(isPendingTeacherAtSchool(pending, "school-2")).toBe(false);
    expect(
      isPendingTeacherAtSchool({ ...pending, approvalStatus: "APPROVED" }, "school-1")
    ).toBe(false);
    expect(
      isPendingTeacherAtSchool({ ...pending, deletedAt: new Date() }, "school-1")
    ).toBe(false);
  });

  it("maps register conflicts to codes, and keeps the wording", () => {
    expect(registerConflictCode(base, "school-1")).toBe("AUTH_TEACHER_PENDING");
    expect(registerConflictCode({ ...base, approvalStatus: "REJECTED" }, "school-1")).toBe(
      "AUTH_REGISTRATION_DECLINED"
    );
    expect(
      registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: false }, "school-1")
    ).toBe("AUTH_ACCOUNT_DEACTIVATED");
    expect(
      registerConflictCode({ ...base, approvalStatus: "APPROVED", isActive: true }, "school-1")
    ).toBe("AUTH_ACCOUNT_EXISTS_SIGN_IN");
    // An account at ANOTHER school must never be described as one at this
    // school — that would tell a stranger where a colleague works.
    expect(registerConflictCode(base, "other-school")).toBe("AUTH_EMAIL_IN_USE");

    expect(registerConflictError(base, "school-1")).toBe(
      "Your request is pending School Head approval."
    );
    expect(registerConflictError({ ...base, approvalStatus: "REJECTED" }, "school-1")).toBe(
      DECLINED_REGISTRATION_MESSAGE
    );
    expect(registerConflictError(base, "other-school")).toBe(
      "That email is already used by another LITRACK account."
    );
  });

  it("detects deactivated approved teachers", () => {
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: false,
        deletedAt: null,
      })
    ).toBe(true);
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: true,
        deletedAt: null,
      })
    ).toBe(false);
    expect(
      isDeactivatedTeacher({
        role: "TEACHER",
        approvalStatus: "PENDING",
        isActive: false,
        deletedAt: null,
      })
    ).toBe(false);
  });
});
