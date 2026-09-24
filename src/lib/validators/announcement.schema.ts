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

/**
 * A division/district broadcast (`docs/specs/district-admin.md` 3.5): one
 * announcement fanned out to many schools at once, by a district admin (their
 * own districts) or the division office (any school). `target` names WHICH
 * schools without trusting any of them yet — `src/lib/actions/district-announcements.ts`
 * resolves each kind through the caller's own `AdminScope`, and an id outside
 * it fails the whole call rather than silently dropping that one school.
 */
export const broadcastTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("district"), district: nonEmpty("Choose a district") }),
  z.object({
    kind: z.literal("schools"),
    schoolIds: z
      .array(nonEmpty("Choose a school").uuid("Choose a school"))
      .min(1, "Choose at least one school"),
  }),
]);

export const broadcastAnnouncementSchema = z.object({
  title: nonEmpty("Title required").max(200),
  body: nonEmpty("Body required").max(5000),
  target: broadcastTargetSchema,
});

export const retractBroadcastSchema = z.object({
  broadcastId: nonEmpty("Broadcast required").uuid("Broadcast required"),
});

export type BroadcastTarget = z.infer<typeof broadcastTargetSchema>;
export type BroadcastAnnouncementInput = z.infer<typeof broadcastAnnouncementSchema>;
export type RetractBroadcastInput = z.infer<typeof retractBroadcastSchema>;
