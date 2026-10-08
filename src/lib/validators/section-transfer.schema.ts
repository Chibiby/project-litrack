import { z } from "zod";
import { nonEmpty } from "./common";

/** Matches `MAX_TRANSFER_BATCH` (the largest Learners page). */
const MAX_IDS = 100;
const MAX_NOTE = 300;

const ids = (label: string) =>
  z.array(nonEmpty(`Choose at least one ${label}`)).min(1, `Choose at least one ${label}`).max(MAX_IDS, `Choose at most ${MAX_IDS} at a time`);

const note = (label: string) =>
  z
    .string()
    .trim()
    .max(MAX_NOTE, `${label} must be ${MAX_NOTE} characters or fewer`)
    .optional();

export const transferLearnersSchema = z.object({
  learnerIds: ids("learner"),
  toSectionId: nonEmpty("Choose a section"),
});

export const requestSectionTransfersSchema = transferLearnersSchema.extend({
  reason: note("The note"),
});

export const decideTransferRequestsSchema = z.object({
  requestIds: ids("request"),
});

export const declineTransferRequestsSchema = decideTransferRequestsSchema.extend({
  note: note("The note"),
});

export const cancelTransferRequestSchema = z.object({
  requestId: nonEmpty("Choose a request"),
});

export type TransferLearnersInput = z.infer<typeof transferLearnersSchema>;
export type RequestSectionTransfersInput = z.infer<typeof requestSectionTransfersSchema>;
export type DecideTransferRequestsInput = z.infer<typeof decideTransferRequestsSchema>;
export type DeclineTransferRequestsInput = z.infer<typeof declineTransferRequestsSchema>;
export type CancelTransferRequestInput = z.infer<typeof cancelTransferRequestSchema>;
