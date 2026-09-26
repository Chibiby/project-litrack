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
import { action } from "@/lib/errors/action";
import { resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";

/** Authorization: `requireSchoolUser("SCHOOL_HEAD")`. Tenancy: every write is scoped by `schoolId: user.schoolId`. */
export const createAnnouncement = action(
  "createAnnouncement",
  async (formData: FormData): Promise<{ ok: true }> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");

    const parsed = parseInput(createAnnouncementSchema, {
      title: formData.get("title"),
      body: formData.get("body"),
    });

    const announcement = await prisma.announcement.create({
      data: {
        schoolId: user.schoolId,
        authorId: user.id,
        title: parsed.title,
        body: parsed.body,
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
  },
  { verb: "publish the announcement" }
);

/**
 * Authorization: `requireSchoolUser("SCHOOL_HEAD")`. Tenancy: the lookup is
 * scoped by `schoolId: user.schoolId`. `broadcastId != null` means this copy
 * came from a district/division broadcast (docs/specs/district-admin.md I13);
 * leaving it out of the `where` makes a broadcast row invisible to a School
 * Head's edit — indistinguishable from one that does not exist, the same
 * NOT_FOUND every other tenant boundary in this app gives.
 */
export const updateAnnouncement = action(
  "updateAnnouncement",
  async (formData: FormData): Promise<{ ok: true }> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");

    const parsed = parseInput(updateAnnouncementSchema, {
      announcementId: formData.get("announcementId"),
      title: formData.get("title"),
      body: formData.get("body"),
    });

    const existing = await prisma.announcement.findFirst({
      where: {
        id: parsed.announcementId,
        schoolId: user.schoolId,
        deletedAt: null,
        broadcastId: null,
      },
    });
    if (!existing) throw resourceNotFound("Announcement");

    await prisma.announcement.update({
      where: { id: existing.id },
      data: { title: parsed.title, body: parsed.body },
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE,
      resource: "Announcement",
      resourceId: existing.id,
      metadata: { schoolId: user.schoolId, title: parsed.title },
    });

    revalidatePath(SCHOOL_HEAD_ROUTES.announcements);
    revalidateSchoolDashboard(user.schoolId);
    return { ok: true };
  },
  { verb: "update the announcement" }
);

/**
 * Authorization: `requireSchoolUser("SCHOOL_HEAD")`. Tenancy: same refusal as
 * `updateAnnouncement` above, and the same reason — a broadcast is read-only
 * to the School Head it was sent to.
 */
export const deleteAnnouncement = action(
  "deleteAnnouncement",
  async (formData: FormData): Promise<{ ok: true }> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");

    const parsed = parseInput(announcementIdSchema, {
      announcementId: formData.get("announcementId"),
    });

    const existing = await prisma.announcement.findFirst({
      where: {
        id: parsed.announcementId,
        schoolId: user.schoolId,
        deletedAt: null,
        broadcastId: null,
      },
    });
    if (!existing) throw resourceNotFound("Announcement");

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
  },
  { verb: "delete the announcement" }
);
