import { SNAPSHOT_SCOPE, TEACHER_GRADES_JOIN, WRITE_ORDER } from "@/lib/db/schema-order";

/**
 * The v2 snapshot file format, and every pure step of writing and reading it.
 *
 * Why a second format exists: v1 was one JSON document, so writing it meant
 * holding every row in memory and reading it meant parsing the whole file at
 * once. On Cloudflare an isolate has 128 MB and production is ~111 MB, so a v1
 * backup ended in error 1102 (`exceededMemory`). v2 is gzipped NDJSON — one JSON
 * value per line — so both sides touch one batch of rows at a time and peak
 * memory is set by the batch size, not by the database.
 *
 * Layout, one line each:
 *
 *   {"format":"litrack-snapshot","version":2,"takenAt":"…","migration":"…"}
 *   ["table","School"]
 *   ["row",{…}]                      ← one per row
 *   ["end","School",42]              ← the count this table's rows must match
 *   …every table in WRITE_ORDER, then the `_TeacherGrades` join table…
 *   ["footer",{"counts":{…},"totalRows":N}]
 *
 * The header is an object so the first bytes of a file say which format it is
 * (a v1 file starts `{"meta":`). Everything after it is a tagged array, so a row
 * whose columns happen to be called `format` or `kind` can never be mistaken for
 * a marker. The footer is written last on purpose: a file cut short by a failed
 * upload or a truncated download has no footer, and `SnapshotReader` refuses it
 * rather than restoring whatever part of the database made it into the file.
 *
 * This module has no Prisma, no I/O and no `server-only`, so the whole format —
 * pagination, line encoding, validation, part buffering — is unit-tested.
 */

export const SNAPSHOT_FORMAT = "litrack-snapshot";
export const SNAPSHOT_V2 = 2;

/** Section name the implicit m2m join table is written under. */
export const TEACHER_GRADES_SECTION: string = TEACHER_GRADES_JOIN.table;

export type Row = Record<string, unknown>;

export type SnapshotHeader = {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_V2;
  /** ISO-8601, UTC. */
  takenAt: string;
  /** Latest applied migration when taken. */
  migration: string | null;
};

export type SnapshotFooter = {
  counts: Record<string, number>;
  totalRows: number;
};

export type SnapshotLine =
  | { kind: "header"; header: SnapshotHeader }
  | { kind: "table"; model: string }
  | { kind: "row"; row: Row }
  | { kind: "end"; model: string; count: number }
  | { kind: "footer"; footer: SnapshotFooter };

/** A file that is not a well-formed v2 snapshot. `message` is safe to show an admin. */
export class SnapshotFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotFormatError";
  }
}

// ── Keyset pagination ─────────────────────────────────────────────────────

/**
 * Primary-key columns per model, for keyset pagination. Every model not named
 * here is keyed on `id`.
 *
 * Written out rather than read from the DMMF because the runtime DMMF Prisma
 * ships is trimmed and does not say which fields are the id. A test compares
 * this map with `schema.prisma`, so a new composite key cannot be paged on the
 * wrong column — which would not fail loudly, it would silently skip rows.
 */
export const KEYSET_KEYS: Readonly<Record<string, readonly string[]>> = {
  SystemSetting: ["key"],
  DistrictAdminAssignment: ["userId", "district"],
  TeacherSection: ["teacherId", "sectionId"],
  ChatRead: ["channelId", "userId"],
};

export function keysetKeysFor(model: string): readonly string[] {
  return KEYSET_KEYS[model] ?? ["id"];
}

/** `orderBy` for a stable walk over the key. */
export function keysetOrderBy(keys: readonly string[]): Record<string, "asc">[] {
  return keys.map((k) => ({ [k]: "asc" as const }));
}

/**
 * The `where` that selects rows strictly after `last` in key order, or
 * undefined for the first page.
 *
 * Keyset, not `skip`/offset: an offset scan re-reads every earlier row on each
 * page, so the last page of a big table costs as much as the whole table. For a
 * composite key `(a, b)` this is `a > last.a OR (a = last.a AND b > last.b)`,
 * which is what a row-value comparison means and what Prisma can express.
 */
export function keysetWhere(
  keys: readonly string[],
  last: Row | null
): Record<string, unknown> | undefined {
  if (!last) return undefined;
  const branches: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i++) {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[keys[j]] = last[keys[j]];
    clause[keys[i]] = { gt: last[keys[i]] };
    branches.push(clause);
  }
  return branches.length === 1 ? branches[0] : { OR: branches };
}

/**
 * Walk a table page by page. `fetchPage` receives the last row of the previous
 * page (null first) and must return at most `batchSize` rows in key order.
 *
 * Stops on a short page rather than on an empty one, which saves a query per
 * table — at `maxUses: 1` on Workers every query is a fresh connection.
 */
export async function* paginate(
  fetchPage: (after: Row | null, take: number) => Promise<Row[]>,
  batchSize: number
): AsyncGenerator<Row[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
  }
  let after: Row | null = null;
  for (;;) {
    const page = await fetchPage(after, batchSize);
    if (page.length > batchSize) {
      // A source ignoring `take` would turn "bounded by one batch" into
      // "bounded by the table" without anyone noticing.
      throw new Error(`Page of ${page.length} rows exceeds the batch size of ${batchSize}`);
    }
    if (page.length > 0) yield page;
    if (page.length < batchSize) return;
    after = page[page.length - 1];
  }
}

// ── Writing ───────────────────────────────────────────────────────────────

/** Where the writer reads rows from. The server wires this to Prisma. */
export type SnapshotSource = {
  /** One page of `model`, strictly after `after` in `keysetKeysFor(model)` order. */
  fetchPage(model: string, after: Row | null, take: number): Promise<Row[]>;
  /** One page of the join table, ordered by (a, b). */
  fetchTeacherGrades(after: { a: string; b: string } | null, take: number): Promise<{ a: string; b: string }[]>;
  /** Applied to each page before it is written — the credential redaction. */
  redact?(model: string, rows: Row[]): Row[];
};

export type SnapshotWriteResult = SnapshotFooter;

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * The snapshot as NDJSON text, one yielded string per page of rows.
 *
 * A generator so the consumer's pace drives the reads: nothing is fetched until
 * the previous chunk has been taken, and a chunk is at most one page. The
 * returned footer is the same object written as the last line.
 */
export async function* snapshotLines(
  source: SnapshotSource,
  header: Omit<SnapshotHeader, "format" | "version">,
  batchSize: number
): AsyncGenerator<string, SnapshotWriteResult> {
  const counts: Record<string, number> = {};
  yield line({ format: SNAPSHOT_FORMAT, version: SNAPSHOT_V2, ...header });

  // Sequential on purpose. Parallel reads across the tables would open that
  // many pooler connections at once against a pool floored at 3 (see
  // resolvePooledDatabaseUrl) and spend the backup queueing on P2024.
  for (const { model } of WRITE_ORDER) {
    let count = 0;
    let chunk = line(["table", model]);
    for await (const page of paginate((after, take) => source.fetchPage(model, after, take), batchSize)) {
      const rows = source.redact ? source.redact(model, page) : page;
      for (const row of rows) chunk += line(["row", row]);
      count += rows.length;
      yield chunk;
      chunk = "";
    }
    counts[model] = count;
    yield chunk + line(["end", model, count]);
  }

  let links = 0;
  let chunk = line(["table", TEACHER_GRADES_SECTION]);
  for await (const page of paginate(
    (after, take) => source.fetchTeacherGrades(after as { a: string; b: string } | null, take),
    batchSize
  )) {
    for (const link of page) chunk += line(["row", { a: link.a, b: link.b }]);
    links += page.length;
    yield chunk;
    chunk = "";
  }
  counts[TEACHER_GRADES_SECTION] = links;
  yield chunk + line(["end", TEACHER_GRADES_SECTION, links]);

  const footer: SnapshotFooter = {
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
  };
  yield line(["footer", footer]);
  return footer;
}

/**
 * Collects compressed bytes into upload parts of at least `partSize`.
 *
 * Vercel Blob's multipart API wants every part but the last to be at least
 * 5 MB. Its own `put(..., { multipart: true })` would do this for us, but it
 * reads ahead up to 8 concurrent parts × 8 MB × 2 = 128 MB — the entire
 * isolate. Buffering exactly one part here is what keeps the upload side of
 * the memory bound.
 */
export class PartBuffer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  constructor(readonly partSize: number) {
    if (!Number.isInteger(partSize) || partSize < 1) {
      throw new Error(`partSize must be a positive integer, got ${partSize}`);
    }
  }

  get buffered(): number {
    return this.size;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
  }

  hasFullPart(): boolean {
    return this.size >= this.partSize;
  }

  /** Everything buffered, as one contiguous part, and reset. */
  take(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    this.chunks = [];
    this.size = 0;
    return out;
  }
}

// ── Reading ───────────────────────────────────────────────────────────────

/**
 * Hard ceiling on one v2 line. The biggest real row is a few KB; a line past
 * this is a corrupt or hostile file, and buffering it would be the unbounded
 * read this format exists to avoid.
 */
export const MAX_LINE_CHARS = 8 * 1024 * 1024;

/** Split text chunks into lines, without ever holding more than one line. */
export async function* splitLines(
  chunks: AsyncIterable<string>,
  maxLineChars: number = MAX_LINE_CHARS
): AsyncGenerator<string> {
  let pending = "";
  for await (const chunk of chunks) {
    pending += chunk;
    let nl = pending.indexOf("\n");
    while (nl !== -1) {
      const text = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (text.trim()) yield text;
      nl = pending.indexOf("\n");
    }
    if (pending.length > maxLineChars) {
      throw new SnapshotFormatError("That backup has a line far longer than any real record; the file is damaged.");
    }
  }
  if (pending.trim()) yield pending;
}

/**
 * A failure reading the underlying bytes (the blob download dropping), carried
 * through the decompressor so it can be told apart from the decompressor
 * rejecting the bytes themselves.
 */
class SourceReadError extends Error {
  constructor(readonly original: unknown) {
    super("backup source read failed");
    this.name = "SourceReadError";
  }
}

/**
 * Bytes → text, gunzipping when the gzip magic number is there.
 *
 * Two kinds of failure, kept apart on purpose. Bytes that do not decompress or
 * are not UTF-8 are the file's fault and become a `SnapshotFormatError` — the
 * admin is told the file is damaged. A failure to *read* the bytes is ours
 * (network, storage) and is rethrown unchanged, so it is recorded as the
 * system failure it is.
 *
 * However the consumer stops — finished, broke off early, or threw — the
 * underlying stream is either drained or cancelled, never left open.
 */
export async function* decodeBackupBytes(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const head: Uint8Array[] = [];
  let headLen = 0;
  let done = false;
  try {
    // Enough bytes to see the two-byte magic; a stream may hand them over one at a time.
    while (headLen < 2 && !done) {
      const r = await reader.read();
      done = r.done;
      if (r.value) {
        head.push(r.value);
        headLen += r.value.byteLength;
      }
    }
  } catch (err) {
    await reader.cancel(err).catch(() => {});
    throw err;
  }
  const [m0, m1] = firstTwo(head);
  const isGzip = m0 === 0x1f && m1 === 0x8b;

  let bytes: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of head) controller.enqueue(c);
      if (done) controller.close();
    },
    async pull(controller) {
      try {
        const r = await reader.read();
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (err) {
        controller.error(new SourceReadError(err));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  if (isGzip) {
    bytes = bytes.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textReader = bytes.getReader();
  let finished = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      let text: string;
      try {
        chunk = await textReader.read();
        text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      } catch (err) {
        if (err instanceof SourceReadError) throw err.original;
        throw new SnapshotFormatError(
          "That backup could not be decompressed or decoded; the file is damaged."
        );
      }
      if (text) yield text;
      if (chunk.done) break;
    }
    finished = true;
  } finally {
    if (finished) textReader.releaseLock();
    // Cancelling the decoded side cancels through the decompressor to the
    // source reader, which closes the download.
    else await textReader.cancel().catch(() => {});
  }
}

function firstTwo(chunks: Uint8Array[]): [number, number] {
  const out: number[] = [];
  for (const c of chunks) {
    for (const b of c) {
      out.push(b);
      if (out.length === 2) return [out[0], out[1]];
    }
  }
  return [out[0] ?? -1, out[1] ?? -1];
}

/**
 * Which format a decoded backup is in, without consuming it: the returned
 * iterable replays what was peeked.
 *
 * v2 announces itself in its first bytes. Anything else is handed to the v1
 * path, whose own validation decides whether it is a backup at all.
 */
export async function sniffFormat(
  chunks: AsyncIterable<string>
): Promise<{ format: "v2" | "legacy"; chunks: AsyncIterable<string> }> {
  const iterator = chunks[Symbol.asyncIterator]();
  const signature = `{"format":"${SNAPSHOT_FORMAT}"`;
  let prefix = "";
  let exhausted = false;
  while (prefix.trimStart().length < signature.length && !exhausted) {
    const r = await iterator.next();
    if (r.done) exhausted = true;
    else prefix += r.value;
  }
  const format = prefix.trimStart().startsWith(signature) ? "v2" : "legacy";

  async function* replay(): AsyncGenerator<string> {
    let drained = exhausted;
    try {
      if (prefix) yield prefix;
      while (!drained) {
        const r = await iterator.next();
        if (r.done) drained = true;
        else yield r.value;
      }
    } finally {
      // A consumer that stops early (a refused line, a failed insert) must
      // close the source too, or the blob download stays open.
      if (!drained) await iterator.return?.();
    }
  }
  return { format, chunks: replay() };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One line of text → a typed line, or a `SnapshotFormatError`. */
export function parseSnapshotLine(text: string): SnapshotLine {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SnapshotFormatError("That backup has a line that is not valid JSON; the file is damaged.");
  }

  if (isPlainObject(value)) {
    if (value.format !== SNAPSHOT_FORMAT) {
      throw new SnapshotFormatError("That file is not a LITRACK backup.");
    }
    if (value.version !== SNAPSHOT_V2) {
      throw new SnapshotFormatError(
        `That backup is format version ${String(value.version)}; this app reads versions 1 and ${SNAPSHOT_V2}.`
      );
    }
    if (typeof value.takenAt !== "string") {
      throw new SnapshotFormatError("That backup's header has no date.");
    }
    return {
      kind: "header",
      header: {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_V2,
        takenAt: value.takenAt,
        migration: typeof value.migration === "string" ? value.migration : null,
      },
    };
  }

  if (Array.isArray(value)) {
    const [tag, a, b] = value;
    if (tag === "row" && isPlainObject(a)) return { kind: "row", row: a };
    if (tag === "table" && typeof a === "string") return { kind: "table", model: a };
    if (tag === "end" && typeof a === "string" && Number.isInteger(b)) {
      return { kind: "end", model: a, count: b as number };
    }
    if (
      tag === "footer" &&
      isPlainObject(a) &&
      isPlainObject(a.counts) &&
      Number.isInteger(a.totalRows)
    ) {
      return {
        kind: "footer",
        footer: { counts: a.counts as Record<string, number>, totalRows: a.totalRows as number },
      };
    }
  }
  throw new SnapshotFormatError("That backup has a line this app does not recognise; the file is damaged.");
}

/** What `SnapshotReader.accept` hands the consumer for each line. */
export type SnapshotEvent =
  | { type: "header"; header: SnapshotHeader }
  | { type: "tableStart"; model: string; restorable: boolean }
  | { type: "row"; model: string; row: Row; restorable: boolean }
  | { type: "tableEnd"; model: string; count: number; restorable: boolean }
  | { type: "footer"; footer: SnapshotFooter };

export type SnapshotSummary = {
  header: SnapshotHeader;
  counts: Record<string, number>;
  totalRows: number;
};

const WRITE_INDEX = new Map(WRITE_ORDER.map((m, i) => [m.model, i]));

/**
 * The v2 grammar, enforced one line at a time.
 *
 * Restore runs this twice: once over the whole file before anything is
 * deleted, so a bad file is refused while the database is untouched, and again
 * inside the restore transaction, where any violation throws and rolls the
 * transaction back. `finish()` is the check that the file was complete.
 *
 * A section is `restorable` when this app has a table for it. A section it does
 * not know (a table a newer version added, or one a snapshot scope has since
 * dropped) is read and counted but not written — the same thing v1 did with
 * an extra key in `data`.
 */
export class SnapshotReader {
  private header: SnapshotHeader | null = null;
  private current: { model: string; count: number; restorable: boolean } | null = null;
  private seen = new Map<string, number>();
  private lastWriteIndex = -1;
  private teacherGradesSeen = false;
  private done = false;

  accept(line: SnapshotLine): SnapshotEvent {
    if (this.done) throw new SnapshotFormatError("That backup has data after its end marker; the file is damaged.");

    if (!this.header) {
      if (line.kind !== "header") throw new SnapshotFormatError("That file is missing its backup header.");
      this.header = line.header;
      return { type: "header", header: line.header };
    }

    switch (line.kind) {
      case "header":
        throw new SnapshotFormatError("That backup has two headers; the file is damaged.");

      case "table": {
        if (this.current) throw this.damaged(`table ${line.model} starts inside ${this.current.model}`);
        if (this.seen.has(line.model)) throw this.damaged(`table ${line.model} appears twice`);
        const index = WRITE_INDEX.get(line.model);
        const isJoin = line.model === TEACHER_GRADES_SECTION;
        if (index !== undefined) {
          // Rows can only be inserted parent-first, and restore inserts in file
          // order. A file whose known tables are out of WRITE_ORDER would hit a
          // foreign key midway, so refuse it here instead.
          if (index < this.lastWriteIndex || this.teacherGradesSeen) {
            throw new SnapshotFormatError(
              `That backup lists ${line.model} out of order, so it cannot be restored safely.`
            );
          }
          this.lastWriteIndex = index;
        }
        if (isJoin) this.teacherGradesSeen = true;
        const restorable = index !== undefined || isJoin;
        this.current = { model: line.model, count: 0, restorable };
        return { type: "tableStart", model: line.model, restorable };
      }

      case "row": {
        if (!this.current) throw this.damaged("a row sits outside any table");
        this.current.count++;
        return { type: "row", model: this.current.model, row: line.row, restorable: this.current.restorable };
      }

      case "end": {
        const cur = this.current;
        if (!cur || cur.model !== line.model) throw this.damaged(`unexpected end of ${line.model}`);
        if (cur.count !== line.count) {
          throw new SnapshotFormatError(
            `That backup's ${line.model} table has ${cur.count} rows but says it should have ${line.count}; the file is damaged.`
          );
        }
        this.seen.set(cur.model, cur.count);
        this.current = null;
        return { type: "tableEnd", model: cur.model, count: cur.count, restorable: cur.restorable };
      }

      case "footer": {
        if (this.current) throw this.damaged(`the file ends inside ${this.current.model}`);
        const expected = line.footer.counts;
        const keys = new Set([...Object.keys(expected), ...this.seen.keys()]);
        for (const k of keys) {
          if ((expected[k] ?? -1) !== (this.seen.get(k) ?? -1)) {
            throw this.damaged(`the row count for ${k} does not match its summary`);
          }
        }
        const total = [...this.seen.values()].reduce((a, b) => a + b, 0);
        if (total !== line.footer.totalRows) throw this.damaged("the total row count does not match");
        this.done = true;
        return { type: "footer", footer: line.footer };
      }
    }
  }

  /** Throws unless the file was complete and carries every table this app restores. */
  finish(): SnapshotSummary {
    if (!this.header) throw new SnapshotFormatError("That file is empty or is not a LITRACK backup.");
    if (!this.done) {
      throw new SnapshotFormatError(
        "That backup ends before its end marker — the file is incomplete, so restoring it would leave the database partial."
      );
    }
    const missing = SNAPSHOT_SCOPE.filter((m) => !this.seen.has(m.model)).map((m) => m.model);
    if (missing.length > 0) {
      throw new SnapshotFormatError(
        `That backup is missing tables this app expects: ${missing.join(", ")}. Restoring it would leave the database incomplete.`
      );
    }
    const counts = Object.fromEntries(this.seen);
    return {
      header: this.header,
      counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }

  private damaged(what: string): SnapshotFormatError {
    return new SnapshotFormatError(`That backup is damaged: ${what}.`);
  }
}

/** Read a whole decoded v2 stream through the grammar, yielding each event. */
export async function* readSnapshotEvents(chunks: AsyncIterable<string>): AsyncGenerator<SnapshotEvent, SnapshotSummary> {
  const reader = new SnapshotReader();
  for await (const text of splitLines(chunks)) {
    yield reader.accept(parseSnapshotLine(text));
  }
  return reader.finish();
}
