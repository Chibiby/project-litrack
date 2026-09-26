import "server-only";
import { prisma } from "@/lib/prisma";
import {
  AUDIT_LOG_AUTH_NOISE_RETENTION,
  AUDIT_LOG_RETENTION,
  deleteInBatches,
  NOTIFICATION_READ_RETENTION,
  NOTIFICATION_RETENTION,
  retentionCutoff,
  retentionDays,
  type BatchedDeleteResult,
  type RetentionSetting,
} from "@/lib/retention/policy";

/**
 * The daily purges for `Notification` and `AuditLog`, run by the backup cron
 * beside `purgeExpiredErrorEvents`.
 *
 * Each batch is one statement: `DELETE … WHERE id IN (SELECT id … LIMIT n)`.
 * Raw SQL because Prisma's `deleteMany` has no `take`, and the alternative
 * (select ids, then delete by id list) is two round trips and ships 5,000 ids
 * each way per batch. The table and column names are literals and the values
 * are bound parameters.
 *
 * Nothing about the rows is returned or logged — only counts.
 */

export type RulePurge =
  | ({ status: "ran"; days: number } & BatchedDeleteResult)
  | { status: "disabled" }
  | { status: "failed" };

export type RetentionReport = {
  notificationsRead: RulePurge;
  notifications: RulePurge;
  auditLogs: RulePurge;
  auditLogsAuthNoise: RulePurge;
};

/**
 * The two audit actions `purgeExpiredAuthNoiseAuditLogs` purges early. Login
 * success/logout are the highest-volume, lowest-forensic-value audit rows;
 * `LOGIN_DENIED` and every other action are deliberately excluded and stay on
 * `AUDIT_LOG_RETENTION`'s longer horizon — see the policy comment.
 *
 * Kept in sync with the literal `IN (...)` list in
 * `purgeExpiredAuthNoiseAuditLogs` by hand: the values are Postgres string
 * literals inside a raw `DELETE`, not bound parameters, so this constant
 * cannot be spliced into that template without building the SQL fragment
 * itself (`Prisma.join`) — deliberately avoided here, because it would make
 * the query built from two different sql-tag compositions and complicate the
 * unit test's `$executeRaw` mock for no behavioural gain over two hard-coded
 * literals.
 */
export const AUTH_NOISE_AUDIT_ACTIONS = ["LOGIN_SUCCESS", "LOGOUT"] as const;

async function runRule(
  name: string,
  setting: RetentionSetting,
  now: Date,
  deleteBatch: (cutoff: Date, limit: number) => Promise<number>
): Promise<RulePurge> {
  const days = retentionDays(setting, process.env[setting.env]);
  if (days === null) return { status: "disabled" };
  const cutoff = retentionCutoff(now, days);
  try {
    const result = await deleteInBatches((limit) => deleteBatch(cutoff, limit));
    return { status: "ran", days, ...result };
  } catch (err) {
    // One rule failing must not stop the others or the backup. The message is
    // the database's, about a DELETE on a fixed table — no row content.
    console.error(`[retention] ${name} purge failed:`, err instanceof Error ? err.message : err);
    return { status: "failed" };
  }
}

/** Read notifications past `NOTIFICATION_READ_RETENTION_DAYS` (by creation date). */
export function purgeReadNotifications(now: Date = new Date()): Promise<RulePurge> {
  return runRule("Notification (read)", NOTIFICATION_READ_RETENTION, now, (cutoff, limit) =>
    prisma.$executeRaw`
      DELETE FROM "Notification"
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "readAt" IS NOT NULL AND "createdAt" < ${cutoff}
        LIMIT ${limit}
      )`
  );
}

/** Every notification past `NOTIFICATION_RETENTION_DAYS`, read or not. */
export function purgeExpiredNotifications(now: Date = new Date()): Promise<RulePurge> {
  return runRule("Notification", NOTIFICATION_RETENTION, now, (cutoff, limit) =>
    prisma.$executeRaw`
      DELETE FROM "Notification"
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "createdAt" < ${cutoff}
        LIMIT ${limit}
      )`
  );
}

/** Audit rows past `AUDIT_LOG_RETENTION_DAYS`. Served by `AuditLog`'s `timestamp` index. */
export function purgeExpiredAuditLogs(now: Date = new Date()): Promise<RulePurge> {
  return runRule("AuditLog", AUDIT_LOG_RETENTION, now, (cutoff, limit) =>
    prisma.$executeRaw`
      DELETE FROM "AuditLog"
      WHERE "id" IN (
        SELECT "id" FROM "AuditLog"
        WHERE "timestamp" < ${cutoff}
        LIMIT ${limit}
      )`
  );
}

/**
 * `LOGIN_SUCCESS`/`LOGOUT` rows past `AUDIT_LOG_AUTH_NOISE_RETENTION_DAYS` —
 * shorter than the general `AUDIT_LOG_RETENTION_DAYS` horizon. Runs BEFORE
 * `purgeExpiredAuditLogs` for the same reason the read-notification rule runs
 * before the general notification one: the broader rule would eventually
 * catch these rows anyway, but purging the narrow set first keeps its own
 * count meaningful in the log. `action IN (...)` is not covered by an index
 * today; acceptable because each batch is LIMITed and this runs once a day,
 * same tradeoff already accepted for the unindexed `readAt` filter on
 * `Notification` above.
 */
export function purgeExpiredAuthNoiseAuditLogs(now: Date = new Date()): Promise<RulePurge> {
  return runRule("AuditLog (auth noise)", AUDIT_LOG_AUTH_NOISE_RETENTION, now, (cutoff, limit) =>
    prisma.$executeRaw`
      DELETE FROM "AuditLog"
      WHERE "id" IN (
        SELECT "id" FROM "AuditLog"
        WHERE "action" IN ('LOGIN_SUCCESS', 'LOGOUT') AND "timestamp" < ${cutoff}
        LIMIT ${limit}
      )`
  );
}

/**
 * All four, one after another. Never throws: each rule reports `failed`
 * instead, because retention is housekeeping and must not fail the backup it
 * runs beside.
 */
export async function runDailyRetention(now: Date = new Date()): Promise<RetentionReport> {
  // Read notifications first: the broader rule would delete them anyway, but
  // doing the narrow one first keeps its count meaningful in the log. Same
  // reasoning for auth-noise audit rows before the general AuditLog rule.
  const notificationsRead = await purgeReadNotifications(now);
  const notifications = await purgeExpiredNotifications(now);
  const auditLogsAuthNoise = await purgeExpiredAuthNoiseAuditLogs(now);
  const auditLogs = await purgeExpiredAuditLogs(now);
  return { notificationsRead, notifications, auditLogs, auditLogsAuthNoise };
}
