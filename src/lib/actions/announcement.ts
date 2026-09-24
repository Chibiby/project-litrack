"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  announcementIdSchema,
} from "@/lib/validators/announcement.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateSchoolDashboard } from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function createAnnouncement(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = createAnnouncementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const announcement = await prisma.announcement.create({
    data: {
      schoolId: user.schoolId,
      authorId: user.id,
      title: parsed.data.title,
      body: parsed.data.body,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATE,
    resource: "Announcement",
    resourceId: announcement.id,
    metadata: { schoolId: user.schoolId, title: announcement.title },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.announcements);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}

export async function updateAnnouncement(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = updateAnnouncementSchema.safeParse({
    announcementId: formData.get("announcementId"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // `broadcastId != null` means this copy came from a district/division
  // broadcast (docs/specs/district-admin.md I13). Leaving it out of the where
  // makes a broadcast row invisible to a School Head's edit — indistinguishable
  // from one that does not exist, the same NOT_FOUND every other tenant
  // boundary in this app gives.
  const existing = await prisma.announcement.findFirst({
    where: {
      id: parsed.data.announcementId,
      schoolId: user.schoolId,
      deletedAt: null,
      broadcastId: null,
    },
  });
  if (!existing) return { ok: false, error: "Announcement not found" };

  await prisma.announcement.update({
    where: { id: existing.id },
    data: { title: parsed.data.title, body: parsed.data.body },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE,
    resource: "Announcement",
    resourceId: existing.id,
    metadata: { schoolId: user.schoolId, title: parsed.data.title },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.announcements);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}

export async function deleteAnnouncement(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = announcementIdSchema.safeParse({
    announcementId: formData.get("announcementId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // Same refusal as `updateAnnouncement` above, and the same reason: a
  // broadcast is read-only to the School Head it was sent to.
  const existing = await prisma.announcement.findFirst({
    where: {
      id: parsed.data.announcementId,
      schoolId: user.schoolId,
      deletedAt: null,
      broadcastId: null,
    },
  });
  if (!existing) return { ok: false, error: "Announcement not found" };

  await prisma.announcement.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_DELETE,
    resource: "Announcement",
    resourceId: existing.id,
    metadata: { schoolId: user.schoolId, title: existing.title },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.announcements);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}
