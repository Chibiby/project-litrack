/**
 * Mapping a P2002 on SchoolYear to the condition that caused it.
 *
 * Under engineType "client" with @prisma/adapter-pg, `meta.target` is absent:
 * the unique fields arrive at `meta.driverAdapterError.cause.constraint.fields`
 * (Postgres detail `Key ("schoolId")=...`), usually quoted. `meta.target` and the
 * message are kept as fallbacks for other runtimes.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unquote(name: string): string {
  return name.replace(/^["'`]+|["'`]+$/g, "");
}

function fromList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => unquote(String(v)));
  return typeof value === "string" ? [unquote(value)] : [];
}

/** Unique-violation fields or index name, quotes stripped; empty when none is reported. */
export function uniqueTarget(err: unknown): string[] {
  if (!isObject(err) || err.code !== "P2002") return [];
  const meta = isObject(err.meta) ? err.meta : undefined;

  const adapter = meta && isObject(meta.driverAdapterError) ? meta.driverAdapterError : undefined;
  const cause = adapter && isObject(adapter.cause) ? adapter.cause : undefined;
  const constraint = cause && isObject(cause.constraint) ? cause.constraint : undefined;
  if (constraint) {
    const fields = fromList(constraint.fields);
    if (fields.length > 0) return fields;
    const index = fromList(constraint.index);
    if (index.length > 0) return index;
  }

  return fromList(meta?.target);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "";
}

function isP2002(err: unknown): boolean {
  return isObject(err) && err.code === "P2002";
}

/** The one-active-year partial unique index: two activations raced. */
export function isActiveYearConflict(err: unknown): boolean {
  if (!isP2002(err)) return false;
  const target = uniqueTarget(err);
  if (target.length === 1 && target[0] === "schoolId") return true;
  if (target.some((t) => t.includes("school_active_unique"))) return true;
  if (target.length > 0) return false;
  const msg = message(err);
  return msg.includes("school_active_unique") || /fields: \(`?"?schoolId"?`?\)/.test(msg);
}

/** The (schoolId, label) unique, and nothing else. */
export function isLabelConflict(err: unknown): boolean {
  if (!isP2002(err)) return false;
  if (isActiveYearConflict(err)) return false;
  const target = uniqueTarget(err);
  if (target.length > 0) {
    if (target.some((t) => t.includes("schoolId_label"))) return true;
    return target.length === 2 && target.includes("schoolId") && target.includes("label");
  }
  const msg = message(err);
  return msg.includes("`label`") || msg.includes("schoolId_label");
}
