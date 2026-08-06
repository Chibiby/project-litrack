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

  revalidatePath("/school-head/announcements");
  revalidatePath("/school-head");
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

  const existing = await prisma.announcement.findFirst({
    where: {
      id: parsed.data.announcementId,
      schoolId: user.schoolId,
      deletedAt: null,
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

  revalidatePath("/school-head/announcements");
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

  const existing = await prisma.announcement.findFirst({
    where: {
      id: parsed.data.announcementId,
      schoolId: user.schoolId,
      deletedAt: null,
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

  revalidatePath("/school-head/announcements");
  return { ok: true };
}
