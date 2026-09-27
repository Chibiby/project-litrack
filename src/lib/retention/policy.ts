/**
 * Retention rules for the tables that grow with activity rather than with the
 * school roll: how long rows live, read from env, and how a purge is chopped
 * into bounded statements.
 *
 * Pure — no Prisma, no env reads at module scope — so every rule is unit-tested
 * and the purge module (`./purge.ts`) is only I/O.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows per DELETE. Bounded so no single statement is unbounded. */
export const RETENTION_BATCH_SIZE = 5_000;

/**
 * Most batches one rule may run per cron invocation, i.e. at most 100k rows per
 * rule per day. A backlog larger than that (the first run after enabling a
 * rule, say) drains over the following days instead of holding the Worker and
 * a pooler connection for as long as it takes; the report says `capped` so the
 * log shows it is still catching up.
 */
export const RETENTION_MAX_BATCHES = 20;

export type RetentionSetting = {
  env: string;
  defaultDays: number;
  /**
   * Values below this are raised to it. Only set where a typo would destroy
   * something no backup can bring back.
   */
  minDays?: number;
};

export const NOTIFICATION_READ_RETENTION: RetentionSetting = {
  env: "NOTIFICATION_READ_RETENTION_DAYS",
  defaultDays: 90,
};

export const NOTIFICATION_RETENTION: RetentionSetting = {
  env: "NOTIFICATION_RETENTION_DAYS",
  defaultDays: 180,
};

/**
 * `AuditLog` is excluded from snapshots (schema-order.ts, `inSnapshot: false`),
 * so a purged audit row is gone for good — only Supabase PITR predates it.
 * `AUDIT_LOG_RETENTION_DAYS=7` typed for `=730` would erase two years of trail
 * on the next midnight, hence the floor.
 */
export const AUDIT_LOG_RETENTION: RetentionSetting = {
  env: "AUDIT_LOG_RETENTION_DAYS",
  defaultDays: 730,
  minDays: 90,
};

/**
 * Days to keep, or null when the rule is switched off.
 *
 *  - unset or blank → the default
 *  - `0`, negative, or not a number → disabled. An operator who writes
 *    something unparseable gets no deletion rather than a guessed one; a purge
 *    that did not run can run tomorrow, a purge that ran cannot be undone.
 *  - a fraction is floored; below `minDays` it is raised to `minDays`.
 */
export function retentionDays(setting: RetentionSetting, raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return setting.defaultDays;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days < 1) return null;
  return setting.minDays !== undefined ? Math.max(days, setting.minDays) : days;
}

/** Rows created strictly before this instant are expired. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export type BatchedDeleteResult = {
  deleted: number;
  batches: number;
  /** True when the batch cap stopped the loop with rows possibly left. */
  capped: boolean;
};

/**
 * Run `deleteBatch(limit)` until it deletes fewer than `limit` rows or the
 * batch cap is reached. `deleteBatch` must delete at most `limit` rows and
 * return how many it deleted.
 */
export async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
  options: { batchSize?: number; maxBatches?: number } = {}
): Promise<BatchedDeleteResult> {
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? RETENTION_MAX_BATCHES;
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const n = await deleteBatch(batchSize);
    batches++;
    deleted += n;
    if (n < batchSize) return { deleted, batches, capped: false };
  }
  return { deleted, batches, capped: true };
}
