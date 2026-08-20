/**
 * Turning a caught database failure into something the person who hit it can act on.
 *
 * The distinction that earns its keep here is whether retrying can possibly
 * work. A pool timeout clears on its own; a database whose schema is behind the
 * committed migrations will reject the same write forever. Telling someone to
 * "try again" in the second case sends them into a loop that cannot succeed, so
 * the two get opposite advice and a reference code to quote onward.
 */

export type DbFailureKind = "SCHEMA_OUT_OF_DATE" | "UNAVAILABLE" | "UNKNOWN";

/** Prisma codes raised when the database lacks something the client expects. */
const SCHEMA_CODES = new Set([
  "P2021", // table does not exist
  "P2022", // column does not exist
  "P2011", // null constraint violation on a column a migration should have relaxed
]);

/** Prisma codes raised when the database is reachable in principle, just not now. */
const UNAVAILABLE_CODES = new Set([
  "P2024", // timed out fetching a connection from the pool
  "P1001", // can't reach database server
  "P1002", // server reached but timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
]);

/**
 * Postgres signatures for the same "schema is behind" condition. Prisma passes
 * several of these through as an unknown request error, with the SQLSTATE inside
 * the message rather than on `.code`, so the message has to be read. Reading it
 * is safe — it is used to classify and then discarded, never returned.
 */
const SCHEMA_SIGNATURES: RegExp[] = [
  /invalid input value for enum/i, // 22P02: a value the deployed enum type lacks
  /null value in column/i, // 23502
  /violates not-null constraint/i, // 23502, alternate phrasing
  /(?:relation|column|type|constraint)\b[\s\S]*?does not exist/i, // 42P01 / 42703
  /\b(?:22P02|23502|42703|42P01)\b/, // the bare SQLSTATE, when that is all we get
];

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/** Classify a caught database error without echoing any of its text. */
export function classifyDbFailure(err: unknown): DbFailureKind {
  const code = errorCode(err);
  if (code && SCHEMA_CODES.has(code)) return "SCHEMA_OUT_OF_DATE";
  if (code && UNAVAILABLE_CODES.has(code)) return "UNAVAILABLE";

  const message = errorMessage(err);
  if (SCHEMA_SIGNATURES.some((pattern) => pattern.test(message))) {
    return "SCHEMA_OUT_OF_DATE";
  }
  return "UNKNOWN";
}

/** Reference code the user quotes to whoever can act on the failure. */
const REFERENCE: Record<DbFailureKind, string> = {
  SCHEMA_OUT_OF_DATE: "DB-SCHEMA",
  UNAVAILABLE: "DB-BUSY",
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
        : `Couldn't ${action}: the database rejected the change. Nothing you typed has been lost — try again, and if it keeps failing give your administrator this reference: ${ref}.`;

  return `${body}${devDetail(err)}`;
}
