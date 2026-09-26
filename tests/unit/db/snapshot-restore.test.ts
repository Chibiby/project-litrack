import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The v2 restore write path against a fake transaction: what gets inserted, in
 * which chunks, and that anything short or inconsistent rolls the whole
 * transaction back instead of committing a partial database.
 */

type Call = { op: string; model?: string; rows?: number; data?: Record<string, unknown>[]; params?: unknown[] };

const calls: Call[] = [];
let rolledBack = false;
let committed = false;
/** Rows createMany claims to have written, per call; defaults to all of them. */
let createManyCount: (n: number) => number = (n) => n;

function fakeTx() {
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$executeRawUnsafe") {
          return async (sql: string, ...params: unknown[]) => {
            if (sql.startsWith("DELETE")) {
              calls.push({ op: "rawDelete" });
              return 0;
            }
            calls.push({ op: "rawInsert", rows: params.length / 2, params });
            return params.length / 2;
          };
        }
        return {
          findMany: async () => [],
          count: async () => 0,
          deleteMany: async () => {
            calls.push({ op: "deleteMany", model: prop });
            return { count: 0 };
          },
          createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
            calls.push({ op: "createMany", model: prop, rows: data.length, data });
            return { count: createManyCount(data.length) };
          },
        };
      },
    }
  );
}

vi.mock("@/lib/prisma", () => {
  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        const out = await fn(fakeTx());
        committed = true;
        return out;
      } catch (err) {
        rolledBack = true;
        throw err;
      }
    },
  };
  return { prisma: client, prismaFresh: client };
});

const { restoreBackup } = await import("@/lib/db/snapshot");
const { snapshotLines, keysetKeysFor } = await import("@/lib/db/snapshot-format");
type Row = Record<string, unknown>;

async function fileText(tables: Record<string, Row[]>, links: { a: string; b: string }[] = []): Promise<string> {
  const page = <T extends Row>(rows: T[], after: Row | null, take: number, keys: readonly string[]) => {
    const key = (r: Row) => keys.map((k) => String(r[k])).join("\u0000");
    const sorted = [...rows].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
    const start = after ? sorted.findIndex((r) => key(r) > key(after)) : 0;
    return start === -1 ? [] : sorted.slice(start, start + take);
  };
  let text = "";
  for await (const chunk of snapshotLines(
    {
      fetchPage: async (model, after, take) => page(tables[model] ?? [], after, take, keysetKeysFor(model)),
      fetchTeacherGrades: async (after, take) => page(links, after, take, ["a", "b"]),
    },
    { takenAt: "2026-09-26T16:00:00.000Z", migration: null },
    2_000
  )) {
    text += chunk;
  }
  return text;
}

function opener(text: string) {
  return async () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
}

const INSPECTED = { ok: true as const, format: 2 as const, takenAt: "t", totalRows: 0 };

const schools = Array.from({ length: 2_500 }, (_, i) => ({
  id: `s${String(i).padStart(5, "0")}`,
  name: `School ${i}`,
  createdAt: "2026-01-01T00:00:00.000Z",
}));

beforeEach(() => {
  calls.length = 0;
  rolledBack = false;
  committed = false;
  createManyCount = (n) => n;
});

describe("v2 restore write path", () => {
  it("empties the tables, then inserts in chunks of 1,000 with the last partial chunk at the table end", async () => {
    const text = await fileText({ School: schools });
    const written = await restoreBackup(INSPECTED, opener(text));

    expect(committed).toBe(true);
    const firstInsert = calls.findIndex((c) => c.op === "createMany" || c.op === "rawInsert");
    expect(calls.slice(0, firstInsert).every((c) => c.op === "deleteMany" || c.op === "rawDelete")).toBe(true);
    expect(calls.filter((c) => c.op === "createMany" && c.model === "school").map((c) => c.rows)).toEqual([
      1_000, 1_000, 500,
    ]);
    // Empty tables issue no insert at all.
    expect(calls.filter((c) => c.op === "createMany" && c.model !== "school")).toEqual([]);
    expect(written.School).toBe(2_500);
  });

  it("revives dates and writes a null Json column as DbNull", async () => {
    const { Prisma } = await import("@prisma/client");
    const text = await fileText({
      School: schools.slice(0, 1),
      ErrorEvent: [{ id: "e1", context: null, createdAt: "2026-09-01T00:00:00.000Z" }],
    });
    await restoreBackup(INSPECTED, opener(text));

    const school = calls.find((c) => c.op === "createMany" && c.model === "school")!.data![0];
    expect(school.createdAt).toBeInstanceOf(Date);
    const event = calls.find((c) => c.op === "createMany" && c.model === "errorEvent")!.data![0];
    expect(event.context).toBe(Prisma.DbNull);
  });

  it("inserts the teacher-grade links with one raw multi-row statement", async () => {
    const text = await fileText({}, [
      { a: "g1", b: "u1" },
      { a: "g1", b: "u2" },
    ]);
    await restoreBackup(INSPECTED, opener(text));

    const raw = calls.filter((c) => c.op === "rawInsert");
    expect(raw).toHaveLength(1);
    expect(raw[0].params).toEqual(["g1", "u1", "g1", "u2"]);
  });

  it("skips sections this app has no table for", async () => {
    const text = (await fileText({}))
      .replace('["table","School"]', '["table","FutureModel"]\n["row",{"id":"f1"}]\n["end","FutureModel",1]\n["table","School"]')
      .replace('["footer",{"counts":{', '["footer",{"counts":{"FutureModel":1,')
      .replace(/"totalRows":(\d+)/, (_m, n) => `"totalRows":${Number(n) + 1}`);
    await restoreBackup(INSPECTED, opener(text));

    expect(committed).toBe(true);
    expect(calls.some((c) => c.op === "createMany")).toBe(false);
  });

  it("rolls back when the file ends before its footer, even after rows were inserted", async () => {
    const lines = (await fileText({ School: schools })).trim().split("\n");
    const truncated = lines.slice(0, -1).join("\n");

    await expect(restoreBackup(INSPECTED, opener(truncated))).rejects.toThrow(/incomplete/);
    expect(calls.some((c) => c.op === "createMany")).toBe(true);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });

  it("rolls back when the database reports fewer rows written than the file holds", async () => {
    createManyCount = (n) => n - 1;
    const text = await fileText({ School: schools.slice(0, 10) });

    await expect(restoreBackup(INSPECTED, opener(text))).rejects.toThrow(/wrote 9 of 10 School/);
    expect(rolledBack).toBe(true);
  });

  it("cancels the download when an insert fails midway", async () => {
    const text = await fileText({ School: schools });
    let cancelled = false;
    const open = async () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(text.slice(0, text.length / 2)));
        },
        cancel() {
          cancelled = true;
        },
      });
    createManyCount = () => {
      throw new Error("insert failed");
    };

    await expect(restoreBackup(INSPECTED, open)).rejects.toThrow("insert failed");
    expect(cancelled).toBe(true);
    expect(rolledBack).toBe(true);
  });
});
