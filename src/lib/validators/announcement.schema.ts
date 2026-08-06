import { z } from "zod";
import { nonEmpty } from "./common";

export const createAnnouncementSchema = z.object({
  title: nonEmpty("Title required").max(200),
  body: nonEmpty("Body required").max(5000),
});

export const updateAnnouncementSchema = z.object({
  announcementId: nonEmpty("Announcement required"),
  title: nonEmpty("Title required").max(200),
  body: nonEmpty("Body required").max(5000),
});

export const announcementIdSchema = z.object({
  announcementId: nonEmpty("Announcement required"),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
