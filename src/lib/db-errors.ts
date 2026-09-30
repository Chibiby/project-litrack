/**
 * Turning a caught database failure into something the person who hit it can act on.
 *
 * The distinction that earns its keep here is whether retrying can possibly
 * work. A pool timeout clears on its own; a database whose schema is behind the
 * committed migrations will reject the same write forever. Telling someone to
 * "try again" in the second case sends them into a loop that cannot succeed, so
 * the two get opposite advice and a reference code to quote onward.
 *
 * Where the signal lives (Prisma 6 client engine + @prisma/adapter-pg):
 * - The adapter turns pg failures into a `DriverAdapterError` whose `.cause`
 *   carries `kind` and, for Postgres errors, the SQLSTATE as `originalCode`.
 * - Prisma maps some kinds to P-codes (DatabaseNotReachable → P1001,
 *   TooManyConnections → P2037, …) and keeps the adapter error at
 *   `meta.driverAdapterError`. Kind "postgres" (any SQLSTATE without a
 *   dedicated kind: 57P01, 57014, 08xxx, 22P02, pooler XX000) has no P-code, so
 *   the raw `DriverAdapterError` reaches the caller.
 * - `$queryRaw` failures always become P2010 with the adapter error in meta.
 * - A pg error the adapter does not recognize ("Connection terminated
 *   unexpectedly", "timeout exceeded when trying to connect", Workers' "Network
 *   connection lost.") is rethrown as a plain Error. Only the provenance mark
 *   stamped by `markDbError` (see `@/lib/prisma`) says it came from a query.
 */

import { newReference } from "@/lib/errors/reference";

/**
 * `CONFIG`: the server's database credentials or target are wrong (bad
 * password, missing database, access denied). Retrying cannot fix that and the
 * person can't either, so it is neither "busy" nor "behind on migrations".
 */
export type DbFailureKind = "SCHEMA_OUT_OF_DATE" | "UNAVAILABLE" | "CONFIG" | "UNKNOWN";

/** Prisma codes raised when the database lacks something the client expects. */
const SCHEMA_CODES = new Set([
  "P2021", // table does not exist
  "P2022", // column does not exist
  "P2011", // null constraint violation on a column a migration should have relaxed
]);

/** Prisma codes raised when the database is reachable in principle, just not now. */
const UNAVAILABLE_CODES = new Set([
  "P2024", // timed out fetching a connection from the pool (not raised by the client engine; kept for safety)
  "P2037", // too many database connections opened (SQLSTATE 53300)
  "P1001", // can't reach database server
  "P1002", // server reached but timed out
  "P1008", // operation timed out
  "P1011", // error opening a TLS connection
  "P1017", // server closed the connection
]);

/** Prisma codes for credentials / target misconfiguration. */
const CONFIG_CODES = new Set([
  "P1000", // authentication failed
  "P1003", // database does not exist
  "P1010", // user denied access on the database
]);

const SCHEMA_KINDS = new Set(["TableDoesNotExist", "ColumnNotFound", "NullConstraintViolation"]);
const UNAVAILABLE_KINDS = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TooManyConnections",
  "TlsConnectionError",
]);
const CONFIG_KINDS = new Set(["AuthenticationFailed", "DatabaseDoesNotExist", "DatabaseAccessDenied"]);

/** Node socket codes, as they appear on an error that already came from the database. */
const SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * P2028 is Prisma's transaction-manager umbrella. Only these two are the
 * database being slow; "transaction not found" / "already committed" are ours.
 */
const TRANSACTION_TIMEOUT = /unable to start a transaction in the given time|expired transaction/i;

/**
 * Postgres signatures for the same "schema is behind" condition. Prisma passes
 * several of these through as an unknown request error, with the SQLSTATE inside
 * the message rather than on `.code`, so the message has to be read. Reading it
 * is safe — it is used to classify and then discarded, never returned.
 *
 * 22P02 is deliberately absent from the bare-SQLSTATE pattern: it is also
 * "invalid input syntax for type uuid", which is bad input, not a stale schema.
 * Only its enum phrasing counts.
 */
const SCHEMA_SIGNATURES: RegExp[] = [
  /invalid input value for enum/i, // 22P02: a value the deployed enum type lacks
  /null value in column/i, // 23502
  /violates not-null constraint/i, // 23502, alternate phrasing
  /(?:relation|column|type|constraint)\b[\s\S]*?does not exist/i, // 42P01 / 42703
  /\b(?:23502|42703|42P01)\b/, // the bare SQLSTATE, when that is all we get
];

/**
 * Outage signatures. Matched ONLY on errors already known to come from the
 * database (see `isDatabaseError`): "connection terminated" on an arbitrary
 * error could be Supabase Auth, Resend, or a fetch, and must not read as a
 * database outage.
 */
const UNAVAILABLE_SIGNATURES: RegExp[] = [
  /connection terminated/i, // pg: "Connection terminated unexpectedly" / "… due to connection timeout"
  /timeout exceeded when trying to connect/i, // pg-pool
  /too many (?:clients|connections)/i, // 53300
  /remaining connection slots/i, // 53300, reserved-slots phrasing
  /network connection lost/i, // Workers socket
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\b/,
  /can't reach database server/i, // Prisma P1001 text
  /server has closed the connection/i, // Prisma P1017 text
  /max client connections reached|max clients reached/i, // Supavisor (XX000)
  /unable to check out (?:process|connection)/i, // Supavisor pool checkout timeout
  /EDBHANDLEREXITED|DbHandler exited/i, // Supavisor lost its upstream
  /canceling statement due to statement timeout/i, // 57014
  /terminating connection due to administrator command/i, // 57P01
  /the database system is (?:starting up|shutting down|in recovery mode)/i, // 57P03
];

/** Credentials / target signatures, also database-origin only. */
const CONFIG_SIGNATURES: RegExp[] = [
  /password authentication failed/i, // 28P01
  /tenant or user not found/i, // Supavisor: unknown project ref or user
];

/** Non-enumerable provenance mark: "this was thrown by a Prisma query". */
const DB_ERROR_MARK = Symbol.for("litrack.dbError");

const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

type DriverCause = { kind?: string; sqlState?: string; message: string };

function isObject(err: unknown): err is Record<PropertyKey, unknown> {
  return typeof err === "object" && err !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorCode(err: unknown): string | undefined {
  if (!isObject(err)) return undefined;
  // PrismaClientInitializationError carries its P-code as `errorCode`.
  return str(err.code) ?? str(err.errorCode);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

function isSqlState(code: string | undefined): code is string {
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
}

/** A pg `DatabaseError` (server-reported): SQLSTATE on `.code`, plus a severity. */
function isPgDatabaseError(err: unknown): boolean {
  return isObject(err) && typeof err.severity === "string" && isSqlState(str(err.code));
}

export function isMarkedDbError(err: unknown): boolean {
  return isObject(err) && err[DB_ERROR_MARK] === true;
}

/**
 * True when the error is known to come from the database layer: a Prisma
 * error, a driver-adapter error, a pg server error, or anything thrown from a
 * query and marked by `markDbError`.
 */
export function isDatabaseError(err: unknown): boolean {
  if (!isObject(err)) return false;
  if (isMarkedDbError(err)) return true;
  const name = str(err.name);
  if (name && (PRISMA_ERROR_NAMES.has(name) || name === "DriverAdapterError")) return true;
  if (/^P\d{4}$/.test(str(err.code) ?? "")) return true;
  return isPgDatabaseError(err);
}

function toDriverCause(adapterError: unknown): DriverCause | null {
  if (!isObject(adapterError) || !isObject(adapterError.cause)) return null;
  const cause = adapterError.cause;
  const kind = str(cause.kind);
  const sqlState =
    str(cause.originalCode) ?? (kind === "postgres" ? str(cause.code) : undefined);
  const message =
    str(cause.originalMessage) ?? str(cause.message) ?? errorMessage(adapterError);
  return { kind, sqlState: isSqlState(sqlState) ? sqlState : undefined, message };
}

/** Driver-adapter causes on the error itself and in Prisma's `meta`. */
function driverCauses(err: unknown): DriverCause[] {
  if (!isObject(err)) return [];
  const out: DriverCause[] = [];
  if (err.name === "DriverAdapterError") {
    const own = toDriverCause(err);
    if (own) out.push(own);
  }
  const meta = err.meta;
  if (isObject(meta)) {
    const nested = toDriverCause(meta.driverAdapterError);
    if (nested) out.push(nested);
  }
  return out;
}

function classifySqlState(sqlState: string, message: string): DbFailureKind | null {
  if (sqlState === "22P02") {
    return /invalid input value for enum/i.test(message) ? "SCHEMA_OUT_OF_DATE" : null;
  }
  if (["42P01", "42703", "42704", "23502"].includes(sqlState)) return "SCHEMA_OUT_OF_DATE";
  if (
    sqlState.startsWith("08") || // connection exception
    sqlState.startsWith("53") || // insufficient resources (53300 too many connections)
    ["57P01", "57P02", "57P03", "57P05", "57014"].includes(sqlState) // shutdown / cannot connect now / statement timeout
  ) {
    return "UNAVAILABLE";
  }
  if (["28000", "28P01", "3D000"].includes(sqlState)) return "CONFIG";
  return null;
}

function classifyDriverCause(cause: DriverCause): DbFailureKind | null {
  if (cause.kind && SCHEMA_KINDS.has(cause.kind)) return "SCHEMA_OUT_OF_DATE";
  if (cause.kind && UNAVAILABLE_KINDS.has(cause.kind)) return "UNAVAILABLE";
  if (cause.kind && CONFIG_KINDS.has(cause.kind)) return "CONFIG";
  if (cause.sqlState) return classifySqlState(cause.sqlState, cause.message);
  return null;
}

/** Classify a caught database error without echoing any of its text. */
export function classifyDbFailure(err: unknown): DbFailureKind {
  const code = errorCode(err);
  if (code && SCHEMA_CODES.has(code)) return "SCHEMA_OUT_OF_DATE";
  if (code && UNAVAILABLE_CODES.has(code)) return "UNAVAILABLE";
  if (code && CONFIG_CODES.has(code)) return "CONFIG";
  const message = errorMessage(err);
  if (code === "P2028" && TRANSACTION_TIMEOUT.test(message)) return "UNAVAILABLE";

  let sqlStateSeen = false;
  for (const cause of driverCauses(err)) {
    const kind = classifyDriverCause(cause);
    if (kind) return kind;
    if (cause.sqlState) {
      // The server named the failure by SQLSTATE and classifySqlState left it
      // unclassified on purpose. Class 22 (data exception, e.g. 22P02 uuid) echoes
      // user-supplied text such as "does not exist", so no message pattern may
      // vote. Other unclassified states (pooler XX000) may still be read as an
      // outage below, but never as a stale schema.
      if (cause.sqlState.startsWith("22")) return "UNKNOWN";
      sqlStateSeen = true;
    }
  }

  const fromDb = isDatabaseError(err);
  if (fromDb && isPgDatabaseError(err)) {
    const kind = classifySqlState(code as string, message);
    if (kind) return kind;
  }
  if (fromDb && code && SOCKET_CODES.has(code)) return "UNAVAILABLE";

  if (!sqlStateSeen && SCHEMA_SIGNATURES.some((pattern) => pattern.test(message))) {
    return "SCHEMA_OUT_OF_DATE";
  }
  if (fromDb) {
    if (UNAVAILABLE_SIGNATURES.some((pattern) => pattern.test(message))) return "UNAVAILABLE";
    if (CONFIG_SIGNATURES.some((pattern) => pattern.test(message))) return "CONFIG";
  }
  return "UNKNOWN";
}

/**
 * The code an admin needs next to a database failure: the Prisma code, or,
 * when Prisma assigned none, the adapter's SQLSTATE or kind.
 */
export function dbFailureCode(err: unknown): string | undefined {
  const code = errorCode(err);
  if (code) return code;
  const [cause] = driverCauses(err);
  return cause?.sqlState ?? cause?.kind;
}

/** Digest prefixes the browser reads (`classifyClientFailure` in `@/lib/errors/client`). */
const DIGEST_PREFIX: Partial<Record<DbFailureKind, string>> = {
  UNAVAILABLE: "DBU-",
  SCHEMA_OUT_OF_DATE: "DBS-",
};

/**
 * Stamp a query failure so every later layer knows it came from the database.
 *
 * Also gives outage and stale-schema failures a digest, `DBU-XXXXXXXX` or
 * `DBS-XXXXXXXX` (8 Crockford base32 chars, the same body as an `E-` reference).
 * Next keeps a digest already present on a thrown error, so a page render that
 * dies on it shows the browser that string instead of an opaque hash: the
 * client reads the prefix to say "the database didn't respond" / "needs a
 * pending update", shows the whole digest as the reference, and
 * `onRequestError` files the ErrorEvent under the same string.
 *
 * Never overwrites an existing digest, never puts error text in it, and
 * returns the same object. Non-objects pass through untouched.
 */
export function markDbError<T>(err: T): T {
  if (!isObject(err)) return err;
  try {
    if (!isMarkedDbError(err)) {
      Object.defineProperty(err, DB_ERROR_MARK, {
        value: true,
        enumerable: false,
        configurable: true,
      });
    }
    const target = err as { digest?: unknown };
    if (target.digest === undefined || target.digest === null) {
      const prefix = DIGEST_PREFIX[classifyDbFailure(err)];
      if (prefix) target.digest = `${prefix}${newReference().slice(2)}`;
    }
  } catch {
    // A frozen error cannot be marked; it is still rethrown as-is.
  }
  return err;
}

/** Reference code the user quotes to whoever can act on the failure. */
const REFERENCE: Record<DbFailureKind, string> = {
  SCHEMA_OUT_OF_DATE: "DB-SCHEMA",
  UNAVAILABLE: "DB-BUSY",
  CONFIG: "DB-CONFIG",
  UNKNOWN: "DB-UNKNOWN",
};

/**
 * The raw error text is what a developer actually needs, and in development they
 * are the only audience — they can already read it in their own server console.
 * In production it must never leave the server: it names tables, columns and
 * sometimes values.
 */
function devDetail(err: unknown): string {
  if (process.env.NODE_ENV === "production") return "";
  const code = errorCode(err);
  const firstLine = errorMessage(err)
    .split("\n")
    .find((line) => line.trim()) ?? "";
  const detail = [code, firstLine.trim()].filter(Boolean).join(" ").slice(0, 300);
  return detail ? ` [dev: ${detail}]` : "";
}

/**
 * Build the client-facing message for a failed write.
 *
 * `action` completes the sentence "Couldn't …" — pass a verb phrase such as
 * "save your profile".
 */
export function describeDbFailure(err: unknown, { action }: { action: string }): string {
  const kind = classifyDbFailure(err);
  const ref = REFERENCE[kind];

  const body =
    kind === "SCHEMA_OUT_OF_DATE"
      ? `Couldn't ${action}: this school's database is missing an update that this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending database update and give them this reference: ${ref}.`
      : kind === "UNAVAILABLE"
        ? `Couldn't ${action}: the database didn't respond in time. Wait a few seconds and try again (${ref}).`
        : kind === "CONFIG"
          ? `Couldn't ${action}: LITRACK can't sign in to its database. Trying again won't help — give your administrator this reference: ${ref}.`
          : `Couldn't ${action}: the database rejected the change. Nothing you typed has been lost — try again, and if it keeps failing give your administrator this reference: ${ref}.`;

  return `${body}${devDetail(err)}`;
}
