import "server-only";

export type SchoolTransferEvent =
  | { type: "REQUESTED"; batchId: string; actorId: string }
  | { type: "DECIDED"; ids: string[]; actorId: string };

/** Bell notifications for transfers. Filled in by Task 6; never throws. */
export async function notifySchoolTransfer(_event: SchoolTransferEvent): Promise<void> {}
