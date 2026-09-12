import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * ErrorEvent is the one table that grows with incidents rather than with the
 * school roll, so the purge is not optional housekeeping — it is what keeps a
 * burst of one repeated failure from accumulating indefinitely.
 */

const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function errorRetentionDays(): number {
  const raw = Number(process.env.ERROR_EVENT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_DAYS;
}

/** Bounded by date; run from the daily cron. Returns the number of rows removed. */
export async function purgeExpiredErrorEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - errorRetentionDays() * DAY_MS);
  const { count } = await prisma.errorEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
