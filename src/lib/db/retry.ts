/**
 * Quiet, bounded retries for database calls that failed because a connection
 * could not be opened or went silent — so a single bad socket costs the user a
 * short pause instead of an error or a reload.
 *
 * Safety rules, in order of importance:
 *
 * 1. Never repeat something that may already have happened. A write is retried
 *    only when the failure happened while *opening* the connection, before any
 *    SQL was sent. A stalled or dropped connection mid-query is retried only for
 *    plain reads outside a transaction, because a write may have committed and
 *    a transaction's connection is gone with its work.
 * 2. Every call has a hard cap: at most `MAX_CONNECT_RETRIES` retries for a
 *    connect failure, `MAX_STALL_RETRIES` for a stalled read, and no retry may
 *    start after `RETRY_TIME_BUDGET_MS`. Nothing loops.
 * 3. A per-isolate circuit breaker stops all retrying once failures pile up.
 *    When the database is really down, or a burst of traffic (a script, an
 *    attack) is producing failures, retrying would only multiply the load, so
 *    calls fail fast until the breaker cools off.
 *
 * Retries are triggered only by the database's own connection failures, never
 * by anything in a request's input, so a client cannot provoke them directly.
 *
 * Module state is plain numbers — no sockets or promises — so it is safe to
 * keep across requests in a Workers isolate.
 */

export const MAX_CONNECT_RETRIES = 2;
export const MAX_STALL_RETRIES = 1;
export const RETRY_TIME_BUDGET_MS = 15_000;
const BACKOFF_BASE_MS = 200;
const BACKOFF_CAP_MS = 1_500;

/** Breaker: this many retryable failures within the window opens it. */
export const BREAKER_THRESHOLD = 8;
export const BREAKER_WINDOW_MS = 30_000;
export const BREAKER_COOLDOWN_MS = 15_000;

/** Operations that only read. `$queryRaw` is left out: raw SQL may write. */
const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** Failed before any SQL was sent: always safe to try again. */
const CONNECT_FAILURE = [
  /timeout exceeded when trying to connect/i, // pg-pool connectionTimeoutMillis
  /connection terminated due to connection timeout/i, // pg during connect
  /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/,
  /too many (?:clients|connections)|remaining connection slots/i, // 53300
  /the database system is (?:starting up|shutting down)/i, // 57P03
  /can't reach database server/i, // P1001
];

/** The connection went silent or dropped mid-query: the SQL may have run. */
const STALL_FAILURE = [
  /query read timeout/i, // pg query_timeout
  /connection terminated unexpectedly/i,
  /network connection lost/i, // Workers socket
  /server has closed the connection/i, // P1017
  /\b(?:ECONNRESET|EPIPE|ETIMEDOUT)\b/,
];

export type FailurePhase = "connect" | "stall" | null;

/** Every message and code on the error, its cause chain, and Prisma's adapter meta. */
function errorTexts(err: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 4 || typeof err !== "object" || err === null) {
    if (typeof err === "string") out.push(err);
    return out;
  }
  const record = err as Record<string, unknown>;
  for (const key of ["message", "originalMessage", "code", "originalCode"]) {
    if (typeof record[key] === "string") out.push(record[key] as string);
  }
  errorTexts(record.cause, depth + 1, out);
  const meta = record.meta as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object") errorTexts(meta.driverAdapterError, depth + 1, out);
  return out;
}

export function failurePhase(err: unknown): FailurePhase {
  const text = errorTexts(err).join("\n");
  if (!text) return null;
  if (CONNECT_FAILURE.some((re) => re.test(text))) return "connect";
  if (STALL_FAILURE.some((re) => re.test(text))) return "stall";
  return null;
}

export type RetryContext = {
  /** Prisma operation name, e.g. "findMany", "update", "$transaction". */
  operation: string;
  /** True when the call runs on an open transaction's connection. */
  inTransaction: boolean;
};

/** Retries still allowed for this failure on this call, ignoring the breaker. */
export function retryAllowance(phase: FailurePhase, ctx: RetryContext): number {
  if (phase === "connect") return MAX_CONNECT_RETRIES;
  if (phase === "stall" && !ctx.inTransaction && READ_OPERATIONS.has(ctx.operation)) {
    return MAX_STALL_RETRIES;
  }
  return 0;
}

export class CircuitBreaker {
  private failures: number[] = [];
  private openUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** False while open: callers must fail fast without retrying. */
  allowsRetry(): boolean {
    return this.now() >= this.openUntil;
  }

  recordFailure(): void {
    const t = this.now();
    this.failures = this.failures.filter((at) => t - at < BREAKER_WINDOW_MS);
    this.failures.push(t);
    if (this.failures.length >= BREAKER_THRESHOLD) {
      this.openUntil = t + BREAKER_COOLDOWN_MS;
      this.failures = [];
    }
  }
}

const sharedBreaker = new CircuitBreaker();

/** Full-jitter exponential backoff: spreads retries so isolates don't sync up. */
export function backoffMs(retry: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** retry);
  return Math.round(random() * ceiling);
}

export type RetryDeps = {
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt`, retrying only what the rules above allow. The last error is
 * rethrown untouched, so callers classify it exactly as before.
 */
export async function withDbRetry<T>(
  attempt: () => Promise<T>,
  ctx: RetryContext,
  deps: RetryDeps = {},
): Promise<T> {
  const breaker = deps.breaker ?? sharedBreaker;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const started = now();
  let retries = 0;

  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      const phase = failurePhase(err);
      if (phase === null) throw err;
      breaker.recordFailure();
      const allowance = retryAllowance(phase, ctx);
      const wait = backoffMs(retries, deps.random);
      if (
        retries >= allowance ||
        !breaker.allowsRetry() ||
        now() - started + wait > RETRY_TIME_BUDGET_MS
      ) {
        throw err;
      }
      retries += 1;
      await sleep(wait);
    }
  }
}
