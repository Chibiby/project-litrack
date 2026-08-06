"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import {
  createGradeLevelSchema,
  teacherInviteSchema,
  inviteIdSchema,
} from "@/lib/validators/teacher-invite.schema";
import {
  generateInviteTokenForUser,
  hashToken,
  findTeacherForInvite,
  generateActivationCredential,
} from "@/lib/auth/invites";
import { teacherUsername, teacherSyntheticEmail } from "@/lib/auth/synthetic-email";
import { sendTeacherInviteEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  revalidateSchoolDashboard,
  revalidateTeacherDashboard,
} from "@/lib/cache/revalidate";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const INVITE_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (obj[key] as string[]) ?? [];
      arr.push(String(v));
      obj[key] = arr;
    } else if (obj[k] !== undefined) {
      obj[k] = Array.isArray(obj[k])
        ? [...(obj[k] as string[]), String(v)]
        : [obj[k] as string, String(v)];
    } else {
      obj[k] = v === "on" ? true : v === "off" ? false : v;
    }
  }
  return obj;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function saveSchoolHeadProfile(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("User has no school");

  const raw = formToObj(formData);
  raw.hasReadingTraining =
    raw.hasReadingTraining === true ||
    raw.hasReadingTraining === "true" ||
    raw.hasReadingTraining === "on";
  raw.hasEnglishTraining =
    raw.hasEnglishTraining === true ||
    raw.hasEnglishTraining === "true" ||
    raw.hasEnglishTraining === "on";

  const parsed = schoolHeadProfileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

  const firstName = String(formData.get("firstName") ?? user.firstName).trim();
  const middleName = String(formData.get("middleName") ?? "").trim() || null;
  const lastName = String(formData.get("lastName") ?? user.lastName).trim();
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { firstName, middleName, lastName, fullName, profileCompleted: true },
    }),
    prisma.schoolHeadProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...parsed.data },
      update: { ...parsed.data },
    }),
  ]);

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PROFILE_SAVE,
    resource: "SchoolHeadProfile",
    resourceId: user.id,
    metadata: { schoolId: user.schoolId, userId: user.id },
  });

  revalidatePath("/school-head");
  revalidateSchoolDashboard(user.schoolId);
}

export async function createGradeLevel(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    throw new Error("Complete your profile first");
  }
  const parsed = createGradeLevelSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) throw new Error("Invalid grade level");

  const grade = await prisma.gradeLevel.upsert({
    where: { schoolId_type: { schoolId: user.schoolId, type: parsed.data.type } },
    update: { deletedAt: null },
    create: { schoolId: user.schoolId, type: parsed.data.type },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.GRADE_LEVEL_CREATE,
    resource: "GradeLevel",
    resourceId: grade.id,
    metadata: { schoolId: user.schoolId, gradeLevelId: grade.id, type: grade.type },
  });

  revalidatePath("/school-head/grade-levels");
  revalidateSchoolDashboard(user.schoolId);
}

/**
 * Unified teacher onboarding (single flow).
 * Creates Supabase user + Prisma User + TeacherInvite immediately.
 * Returns username + temp password once. Optional email gets a setup link.
 */
export async function inviteTeacher(
  formData: FormData
): Promise<ActionResult<{ username: string; tempPassword: string; inviteId: string }>> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    return { ok: false, error: "Complete your profile first" };
  }

  const rate = checkRateLimit(`invite:create:${user.schoolId}`, INVITE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const parsed = teacherInviteSchema.safeParse({
    gradeLevelId: formData.get("gradeLevelId"),
    email: formData.get("email") || undefined,
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName") || undefined,
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: { id: parsed.data.gradeLevelId, schoolId: user.schoolId, deletedAt: null },
  });
  if (!grade) return { ok: false, error: "Invalid grade level" };

  if (parsed.data.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (emailTaken) return { ok: false, error: "Email is already in use" };
    const inviteEmailTaken = await prisma.teacherInvite.findFirst({
      where: {
        schoolId: user.schoolId,
        email: parsed.data.email,
        consumedAt: null,
        revokedAt: null,
      },
    });
    if (inviteEmailTaken) return { ok: false, error: "A pending invite already uses this email" };
  }

  const hex4 = randomBytes(2).toString("hex");
  const username = teacherUsername(parsed.data.lastName, hex4);
  const syntheticEmail = teacherSyntheticEmail(username);
  const tempPassword = generateActivationCredential();
  const credentialHash = hashToken(tempPassword);

  const adminClient = createSupabaseAdminClient();
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: syntheticEmail,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role: "TEACHER", schoolId: user.schoolId },
    user_metadata: { role: "TEACHER", schoolId: user.schoolId, username },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "Failed to create teacher account" };
  }

  const fullName = [parsed.data.firstName, parsed.data.middleName, parsed.data.lastName]
    .filter(Boolean)
    .join(" ");

  let inviteId = "";
  let inviteToken = "";
  let teacherUserId = "";

  try {
    await prisma.$transaction(async (tx) => {
      const teacher = await tx.user.create({
        data: {
          authId: created.user!.id,
          email: syntheticEmail,
          role: "TEACHER",
          schoolId: user.schoolId!,
          firstName: parsed.data.firstName,
          middleName: parsed.data.middleName ?? null,
          lastName: parsed.data.lastName,
          fullName,
          isActive: true,
          mustChangePassword: true,
          profileCompleted: false,
          taughtGrades: { connect: { id: parsed.data.gradeLevelId } },
        },
      });
      teacherUserId = teacher.id;

      const { token, tokenHash, expiresAt } = generateInviteTokenForUser(teacher.id);
      inviteToken = token;

      const invite = await tx.teacherInvite.create({
        data: {
          schoolId: user.schoolId!,
          email: parsed.data.email ?? null,
          firstName: parsed.data.firstName,
          middleName: parsed.data.middleName ?? null,
          lastName: parsed.data.lastName,
          userId: teacher.id,
          gradeLevelId: parsed.data.gradeLevelId,
          tokenHash,
          credentialHash,
          expiresAt,
          createdById: user.id,
          lastSentAt: parsed.data.email ? new Date() : null,
        },
      });
      inviteId = invite.id;
    });
  } catch (err) {
    // Roll back auth user if DB write failed
    try {
      await adminClient.auth.admin.deleteUser(created.user.id);
    } catch (cleanupErr) {
      console.error("[inviteTeacher] auth cleanup failed:", cleanupErr);
    }
    console.error("[inviteTeacher] transaction failed:", err);
    return { ok: false, error: "Failed to create teacher account" };
  }

  if (parsed.data.email && inviteToken) {
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    });
    try {
      await sendTeacherInviteEmail({
        to: parsed.data.email,
        teacherName: [parsed.data.firstName, parsed.data.lastName].join(" "),
        schoolName: school?.name ?? "your school",
        inviteUrl: `${appUrl()}/teacher-setup/${inviteToken}`,
        username,
      });
    } catch (e) {
      console.error("[invite email] failed:", e);
    }
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_INVITE,
    resource: "TeacherInvite",
    resourceId: inviteId,
    metadata: {
      schoolId: user.schoolId,
      inviteId,
      gradeLevelId: parsed.data.gradeLevelId,
      hasEmail: Boolean(parsed.data.email),
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  if (teacherUserId) revalidateTeacherDashboard(teacherUserId);
  return { ok: true, data: { username, tempPassword, inviteId } };
}

/**
 * Regenerate temp password + invite token. Returns new credential once.
 * Invite token expiry is refreshed; teacher mustChangePassword set true again.
 */
export async function resendTeacherInvite(
  formData: FormData
): Promise<ActionResult<{ username: string; tempPassword: string }>> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) return { ok: false, error: "No school" };

  const parsed = inviteIdSchema.safeParse({ inviteId: formData.get("inviteId") });
  if (!parsed.success) return { ok: false, error: "Invalid invite" };

  const rate = checkRateLimit(`invite:resend:${parsed.data.inviteId}`, INVITE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const invite = await prisma.teacherInvite.findUnique({ where: { id: parsed.data.inviteId } });
  if (!invite) return { ok: false, error: "Invite not found" };
  if (invite.schoolId !== user.schoolId) return { ok: false, error: "Invite not found" };

  if (invite.consumedAt) return { ok: false, error: "Invite already activated" };
  if (invite.revokedAt) return { ok: false, error: "Invite was revoked" };

  const teacher = await findTeacherForInvite(invite);
  if (!teacher) return { ok: false, error: "Teacher account not found" };

  const tempPassword = generateActivationCredential();
  const credentialHash = hashToken(tempPassword);
  const { token, tokenHash, expiresAt } = generateInviteTokenForUser(teacher.id);

  const adminClient = createSupabaseAdminClient();
  const { error } = await adminClient.auth.admin.updateUserById(teacher.authId, {
    password: tempPassword,
    app_metadata: { role: "TEACHER", schoolId: invite.schoolId },
  });
  if (error) return { ok: false, error: "Failed to regenerate credentials" };

  await prisma.$transaction([
    prisma.user.update({
      where: { id: teacher.id },
      data: { mustChangePassword: true, isActive: true },
    }),
    prisma.teacherInvite.update({
      where: { id: invite.id },
      data: {
        userId: teacher.id,
        tokenHash,
        credentialHash,
        expiresAt,
        lastSentAt: new Date(),
      },
    }),
  ]);

  const username =
    teacher.email.split("@")[0] ?? teacher.email;

  if (invite.email) {
    const school = await prisma.school.findUnique({
      where: { id: invite.schoolId },
      select: { name: true },
    });
    try {
      await sendTeacherInviteEmail({
        to: invite.email,
        teacherName: [invite.firstName, invite.lastName].join(" "),
        schoolName: school?.name ?? "your school",
        inviteUrl: `${appUrl()}/teacher-setup/${token}`,
        username,
      });
    } catch (e) {
      console.error("[invite resend email] failed:", e);
    }
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_INVITE_RESEND,
    resource: "TeacherInvite",
    resourceId: invite.id,
    metadata: { schoolId: user.schoolId, inviteId: invite.id, teacherId: teacher.id },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherDashboard(teacher.id);
  return { ok: true, data: { username, tempPassword } };
}

/**
 * Revoke invite. If the teacher has never activated (invite not consumed), deactivate the user.
 */
export async function revokeTeacherInvite(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) return { ok: false, error: "No school" };

  const parsed = inviteIdSchema.safeParse({ inviteId: formData.get("inviteId") });
  if (!parsed.success) return { ok: false, error: "Invalid invite" };

  const rate = checkRateLimit(`invite:revoke:${parsed.data.inviteId}`, INVITE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const invite = await prisma.teacherInvite.findUnique({ where: { id: parsed.data.inviteId } });
  if (!invite) return { ok: false, error: "Invite not found" };
  if (invite.schoolId !== user.schoolId) return { ok: false, error: "Invite not found" };

  if (invite.revokedAt) return { ok: false, error: "Already revoked" };
  if (invite.consumedAt) return { ok: false, error: "Invite already activated — deactivate the user separately" };

  const teacher = await findTeacherForInvite(invite);

  await prisma.$transaction(async (tx) => {
    await tx.teacherInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
    if (teacher && !invite.consumedAt) {
      await tx.user.update({
        where: { id: teacher.id },
        data: { isActive: false },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_INVITE_REVOKE,
    resource: "TeacherInvite",
    resourceId: invite.id,
    metadata: {
      schoolId: user.schoolId,
      inviteId: invite.id,
      teacherId: teacher?.id,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  if (teacher) revalidateTeacherDashboard(teacher.id);
  return { ok: true };
}

export async function assignTeacherToGrade(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("No school");

  const teacherId = String(formData.get("teacherId") ?? "");
  const gradeLevelId = String(formData.get("gradeLevelId") ?? "");
  if (!teacherId || !gradeLevelId) throw new Error("Missing fields");

  const [teacher, grade] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, schoolId: user.schoolId, role: "TEACHER" } }),
    prisma.gradeLevel.findFirst({ where: { id: gradeLevelId, schoolId: user.schoolId } }),
  ]);
  if (!teacher || !grade) throw new Error("Invalid teacher or grade");

  await prisma.user.update({
    where: { id: teacherId },
    data: { taughtGrades: { connect: { id: gradeLevelId } } },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ASSIGN_GRADE,
    resource: "User",
    resourceId: teacherId,
    metadata: { schoolId: user.schoolId, teacherId, gradeLevelId },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherDashboard(teacherId);
}
