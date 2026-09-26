import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SNAPSHOT_SCOPE, WRITE_ORDER } from "@/lib/db/schema-order";
import {
  decodeBackupBytes,
  KEYSET_KEYS,
  keysetKeysFor,
  keysetOrderBy,
  keysetWhere,
  paginate,
  parseSnapshotLine,
  PartBuffer,
  readSnapshotEvents,
  sniffFormat,
  snapshotLines,
  SnapshotFormatError,
  SnapshotReader,
  splitLines,
  TEACHER_GRADES_SECTION,
  type Row,
  type SnapshotEvent,
  type SnapshotSource,
} from "@/lib/db/snapshot-format";

/**
 * The v2 backup format, end to end, with no database: pagination, the NDJSON
 * writer, gzip, the reader and its refusals. The property that matters most is
 * the last group — a file that is short, reordered or inconsistent is refused
 * rather than restored as a partial database.
 */

// ── helpers ───────────────────────────────────────────────────────────────

/** An in-memory table source that honours keyset `after` and `take`. */
function memorySource(tables: Record<string, Row[]>, links: { a: string; b: string }[] = []) {
  const calls: { model: string; take: number }[] = [];
  const source: SnapshotSource = {
    async fetchPage(model, after, take) {
      calls.push({ model, take });
      const keys = keysetKeysFor(model);
      const rows = [...(tables[model] ?? [])].sort((x, y) => cmp(x, y, keys));
      const start = after ? rows.findIndex((r) => cmp(r, after, keys) > 0) : 0;
      return start === -1 ? [] : rows.slice(start, start + take);
    },
    async fetchTeacherGrades(after, take) {
      const rows = [...links].sort((x, y) => cmp(x, y, ["a", "b"]));
      const start = after ? rows.findIndex((r) => cmp(r, after, ["a", "b"]) > 0) : 0;
      return start === -1 ? [] : rows.slice(start, start + take);
    },
  };
  return { source, calls };
}

function cmp(x: Row, y: Row, keys: readonly string[]): number {
  for (const k of keys) {
    const a = String(x[k]);
    const b = String(y[k]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

async function writeAll(source: SnapshotSource, batch = 2): Promise<string> {
  let text = "";
  for await (const chunk of snapshotLines(source, { takenAt: "2026-09-26T16:00:00.000Z", migration: "m1" }, batch)) {
    text += chunk;
  }
  return text;
}

function streamOf(...parts: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(typeof p === "string" ? enc.encode(p) : p);
      c.close();
    },
  });
}

async function gzip(text: string): Promise<Uint8Array> {
  const out = streamOf(text).pipeThrough(
    new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>
  );
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function events(text: string): Promise<{ events: SnapshotEvent[]; summary: unknown }> {
  const gen = readSnapshotEvents(chunksOf(text, 7));
  const out: SnapshotEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { events: out, summary: r.value };
    out.push(r.value);
  }
}

/** A minimal complete file: every in-scope table, the given rows in `School`. */
function sampleTables(): Record<string, Row[]> {
  return {
    School: [
      { id: "s3", name: "C" },
      { id: "s1", name: "A" },
      { id: "s2", name: "B" },
    ],
    User: [{ id: "u1", passwordVaultCipher: "secret" }],
    TeacherSection: [
      { teacherId: "t1", sectionId: "x2" },
      { teacherId: "t1", sectionId: "x1" },
      { teacherId: "t0", sectionId: "x9" },
    ],
  };
}

// ── keyset pagination ─────────────────────────────────────────────────────

describe("keyset pagination", () => {
  it("starts with no filter and continues strictly after the last row", () => {
    expect(keysetWhere(["id"], null)).toBeUndefined();
    expect(keysetWhere(["id"], { id: "abc", name: "x" })).toEqual({ id: { gt: "abc" } });
  });

  it("expands a composite key into the row-value comparison", () => {
    expect(keysetWhere(["a", "b"], { a: 1, b: 2 })).toEqual({
      OR: [{ a: { gt: 1 } }, { a: 1, b: { gt: 2 } }],
    });
    expect(keysetOrderBy(["a", "b"])).toEqual([{ a: "asc" }, { b: "asc" }]);
  });

  it("pages until a short page, never asking for more than the batch", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
    const asked: (Row | null)[] = [];
    const pages = await collect(
      paginate(async (after, take) => {
        asked.push(after);
        const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
        return rows.slice(start, start + take);
      }, 2)
    );
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(asked).toEqual([null, { id: "r1" }, { id: "r3" }]);
  });

  it("makes one query for an exactly-full last page plus the empty one after it", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    let queries = 0;
    const pages = await collect(
      paginate(async (after, take) => {
        queries++;
        const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
        return rows.slice(start, start + take);
      }, 2)
    );
    expect(pages).toHaveLength(1);
    expect(queries).toBe(2);
  });

  it("refuses a source that returns more than it was asked for", async () => {
    await expect(collect(paginate(async () => [{}, {}, {}], 2))).rejects.toThrow(/exceeds the batch size/);
  });

  it("names the real primary key of every snapshot table", () => {
    // The runtime DMMF does not say which field is the id, so KEYSET_KEYS is
    // written by hand. Paging on a column that is not the key does not fail —
    // it silently skips or repeats rows — so hold the map against the schema.
    const schema = readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
    for (const { model } of SNAPSHOT_SCOPE) {
      const body = schema.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(body, `model ${model} in schema.prisma`).toBeTruthy();
      const composite = body!.match(/@@id\(\[([^\]]+)\]\)/)?.[1];
      const expected = composite
        ? composite.split(",").map((s) => s.trim())
        : [body!.match(/^\s*(\w+)\s+\S+.*@id\b/m)?.[1]];
      expect(keysetKeysFor(model), model).toEqual(expected);
    }
    for (const model of Object.keys(KEYSET_KEYS)) {
      expect(SNAPSHOT_SCOPE.some((m) => m.model === model), `${model} is backed up`).toBe(true);
    }
  });
});

// ── writing ───────────────────────────────────────────────────────────────

describe("snapshot writer", () => {
  it("writes a header, every table in WRITE_ORDER, the join table, and a footer", async () => {
    const { source } = memorySource(sampleTables(), [{ a: "g1", b: "u1" }]);
    const lines = (await writeAll(source)).trim().split("\n").map((l) => JSON.parse(l));

    expect(lines[0]).toMatchObject({ format: "litrack-snapshot", version: 2, migration: "m1" });
    const tables = lines.filter((l) => Array.isArray(l) && l[0] === "table").map((l) => l[1]);
    expect(tables).toEqual([...WRITE_ORDER.map((m) => m.model), TEACHER_GRADES_SECTION]);
    expect(lines.at(-1)).toEqual([
      "footer",
      expect.objectContaining({ totalRows: 3 + 1 + 3 + 1 }),
    ]);
  });

  it("walks each table in key order, composite keys included", async () => {
    const { source } = memorySource(sampleTables());
    const text = await writeAll(source);
    const { events: evs } = await events(text);
    const school = evs.filter((e) => e.type === "row" && e.model === "School").map((e) => (e as { row: Row }).row.id);
    expect(school).toEqual(["s1", "s2", "s3"]);
    const ts = evs
      .filter((e) => e.type === "row" && e.model === "TeacherSection")
      .map((e) => `${(e as { row: Row }).row.teacherId}/${(e as { row: Row }).row.sectionId}`);
    expect(ts).toEqual(["t0/x9", "t1/x1", "t1/x2"]);
  });

  it("reads in pages of the batch size and yields per page, not per table", async () => {
    const { source, calls } = memorySource(sampleTables());
    const chunks = await collect(snapshotLines(source, { takenAt: "t", migration: null }, 2));
    expect(calls.every((c) => c.take === 2)).toBe(true);
    // School (3 rows, batch 2) is two pages: no chunk carries more than one page.
    const schoolChunks = chunks.filter((c) => c.includes('"s1"') || c.includes('"s3"'));
    expect(schoolChunks).toHaveLength(2);
  });

  it("applies the redaction hook before a row is written", async () => {
    const { source } = memorySource(sampleTables());
    source.redact = (model, rows) =>
      model === "User" ? rows.map((r) => ({ ...r, passwordVaultCipher: null })) : rows;
    const text = await writeAll(source);
    expect(text).not.toContain("secret");
  });
});

// ── reading ───────────────────────────────────────────────────────────────

describe("snapshot reader", () => {
  it("round-trips through gzip and back", async () => {
    const { source } = memorySource(sampleTables(), [{ a: "g1", b: "u1" }]);
    const text = await writeAll(source);
    const decoded = decodeBackupBytes(streamOf(await gzip(text)));
    const { format, chunks } = await sniffFormat(decoded);
    expect(format).toBe("v2");

    const gen = readSnapshotEvents(chunks);
    let rows = 0;
    for (;;) {
      const r = await gen.next();
      if (r.done) {
        expect(r.value.totalRows).toBe(8);
        expect(r.value.counts.School).toBe(3);
        break;
      }
      if (r.value.type === "row") rows++;
    }
    expect(rows).toBe(8);
  });

  it("reads an uncompressed file too, for an admin who unzipped it", async () => {
    const { source } = memorySource(sampleTables());
    const text = await writeAll(source);
    const joined = (await collect(decodeBackupBytes(streamOf(text)))).join("");
    expect(joined).toBe(text);
  });

  it("detects gzip even when the magic number arrives one byte at a time", async () => {
    const bytes = await gzip("hello\n");
    const parts = Array.from(bytes, (b) => new Uint8Array([b]));
    expect((await collect(decodeBackupBytes(streamOf(...parts)))).join("")).toBe("hello\n");
  });

  it("tells a v1 file from a v2 one without consuming it", async () => {
    const v1 = JSON.stringify({ meta: { version: 1 }, data: {} });
    const sniffed = await sniffFormat(chunksOf(v1, 3));
    expect(sniffed.format).toBe("legacy");
    expect((await collect(sniffed.chunks)).join("")).toBe(v1);
  });

  it("splits lines across chunk boundaries and skips blank ones", async () => {
    const lines = await collect(splitLines(chunksOf('{"a":1}\n\n["b"]\n["c"]', 3)));
    expect(lines).toEqual(['{"a":1}', '["b"]', '["c"]']);
  });

  it("refuses a line longer than any real record instead of buffering it", async () => {
    await expect(collect(splitLines(chunksOf("x".repeat(100), 10), 50))).rejects.toBeInstanceOf(SnapshotFormatError);
  });

  it("marks tables this app does not know as not restorable, and still counts them", async () => {
    const { source } = memorySource(sampleTables());
    const text = await writeAll(source);
    const withExtra = text.replace(
      '["table","School"]',
      '["table","FutureModel"]\n["row",{"id":"f1"}]\n["end","FutureModel",1]\n["table","School"]'
    ).replace(/\["footer",\{"counts":\{/, '["footer",{"counts":{"FutureModel":1,').replace(/"totalRows":(\d+)/, (_m, n) => `"totalRows":${Number(n) + 1}`);
    const { events: evs } = await events(withExtra);
    const future = evs.find((e) => e.type === "tableStart" && e.model === "FutureModel");
    expect(future).toMatchObject({ restorable: false });
  });
});

describe("snapshot reader refusals", () => {
  async function refusal(text: string): Promise<string> {
    try {
      await events(text);
    } catch (err) {
      expect(err).toBeInstanceOf(SnapshotFormatError);
      return (err as Error).message;
    }
    throw new Error("expected the reader to refuse");
  }

  async function goodFile(): Promise<string> {
    const { source } = memorySource(sampleTables(), [{ a: "g1", b: "u1" }]);
    return writeAll(source);
  }

  it("refuses a file cut off before its footer", async () => {
    const lines = (await goodFile()).trim().split("\n");
    expect(await refusal(lines.slice(0, -1).join("\n"))).toMatch(/incomplete/);
  });

  it("refuses a file cut off inside a table", async () => {
    const text = await goodFile();
    const cut = text.slice(0, text.indexOf('["end","School"'));
    expect(await refusal(cut)).toMatch(/incomplete|ends/);
  });

  it("refuses a table whose row count does not match its end marker", async () => {
    const text = (await goodFile()).replace('["end","School",3]', '["end","School",4]');
    expect(await refusal(text)).toMatch(/School/);
  });

  it("refuses a footer whose counts disagree with the file", async () => {
    const text = (await goodFile()).replace(/"totalRows":\d+/, '"totalRows":999');
    expect(await refusal(text)).toMatch(/total/);
  });

  it("refuses tables out of insert order, which would break foreign keys midway", async () => {
    const empty = memorySource({});
    const lines = (await writeAll(empty.source)).trim().split("\n");
    // Swap the first two tables' sections (each is a table line + end line when empty).
    const [header, t1, e1, t2, e2, ...rest] = lines;
    const text = [header, t2, e2, t1, e1, ...rest].join("\n");
    expect(await refusal(text)).toMatch(/out of order/);
  });

  it("refuses a file missing a table this app restores", async () => {
    const text = (await goodFile())
      .replace('["table","Learner"]\n', "")
      .replace('["end","Learner",0]\n', "")
      .replace('"Learner":0,', "");
    expect(await refusal(text)).toMatch(/missing tables.*Learner/);
  });

  it("refuses anything after the footer", async () => {
    expect(await refusal(`${await goodFile()}["row",{"id":"x"}]\n`)).toMatch(/after its end/);
  });

  it("refuses a file with no header, and a future version", async () => {
    expect(await refusal('["table","School"]\n')).toMatch(/header/);
    expect(await refusal('{"format":"litrack-snapshot","version":3,"takenAt":"t"}\n')).toMatch(/version 3/);
  });

  it("refuses lines it does not recognise", () => {
    expect(() => parseSnapshotLine("not json")).toThrow(SnapshotFormatError);
    expect(() => parseSnapshotLine('["row","not an object"]')).toThrow(SnapshotFormatError);
    expect(() => parseSnapshotLine('{"format":"something-else"}')).toThrow(SnapshotFormatError);
  });

  it("does not report completeness until the footer has been read", () => {
    const reader = new SnapshotReader();
    reader.accept(parseSnapshotLine('{"format":"litrack-snapshot","version":2,"takenAt":"t"}'));
    expect(() => reader.finish()).toThrow(/incomplete/);
  });
});

// ── upload parts ──────────────────────────────────────────────────────────

describe("part buffer", () => {
  it("holds bytes until a full part and hands them back contiguous", () => {
    const buf = new PartBuffer(4);
    buf.push(new Uint8Array([1, 2]));
    expect(buf.hasFullPart()).toBe(false);
    buf.push(new Uint8Array([3, 4, 5]));
    expect(buf.hasFullPart()).toBe(true);
    expect(Array.from(buf.take())).toEqual([1, 2, 3, 4, 5]);
    expect(buf.buffered).toBe(0);
  });

  it("ignores empty chunks and rejects a nonsensical part size", () => {
    const buf = new PartBuffer(1);
    buf.push(new Uint8Array());
    expect(buf.buffered).toBe(0);
    expect(() => new PartBuffer(0)).toThrow();
  });
});

// ── decoding failures and cleanup ─────────────────────────────────────────

describe("decoding a stored file", () => {
  it("calls corrupt gzip a damaged file, not a system failure", async () => {
    const good = await gzip("x".repeat(1000));
    const bad = good.slice();
    bad.fill(0xff, 12, 40);
    await expect(collect(decodeBackupBytes(streamOf(bad)))).rejects.toBeInstanceOf(SnapshotFormatError);
  });

  it("calls invalid UTF-8 a damaged file", async () => {
    await expect(collect(decodeBackupBytes(streamOf(new Uint8Array([0x7b, 0xff, 0xfe]))))).rejects.toBeInstanceOf(
      SnapshotFormatError
    );
  });

  it("rethrows a failure to read the bytes unchanged, gzipped or not", async () => {
    const network = new TypeError("network connection lost");
    for (const head of [await gzip("header\n"), new TextEncoder().encode("plain")]) {
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(head.slice(0, 10));
          } else {
            c.error(network);
          }
        },
      });
      await expect(collect(decodeBackupBytes(stream))).rejects.toBe(network);
    }
  });

  it("cancels the source when the reader stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // No newline: an unterminated line past the limit is what splitLines refuses.
        c.enqueue(new TextEncoder().encode("y".repeat(100)));
      },
      cancel() {
        cancelled = true;
      },
    });
    // A line longer than the limit makes splitLines throw partway through.
    await expect(collect(splitLines(decodeBackupBytes(stream), 50))).rejects.toBeInstanceOf(SnapshotFormatError);
    expect(cancelled).toBe(true);
  });

  it("cancels the source when a sniffed v2 read is refused partway", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"format":"litrack-snapshot","version":2,"takenAt":"t"}\n["bogus"]\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { chunks } = await sniffFormat(decodeBackupBytes(stream));
    await expect(collect(readSnapshotEvents(chunks))).rejects.toBeInstanceOf(SnapshotFormatError);
    expect(cancelled).toBe(true);
  });
});
