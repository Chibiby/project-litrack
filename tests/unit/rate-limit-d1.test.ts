import { describe, expect, it } from "vitest";
import { d1Check, d1Peek, type D1Like } from "@/lib/rate-limit-d1";

/** A tiny stand-in for the D1 binding that understands the four statements. */
function fakeD1(rows: { key: string; ts: number }[] = []): D1Like & { rows: typeof rows } {
  type Stmt = { sql: string; args: unknown[]; bind(...v: unknown[]): Stmt };
  const prepare = (sql: string): Stmt => {
    const stmt: Stmt = {
      sql,
      args: [],
      bind(...v) {
        stmt.args = v;
        return stmt;
      },
    };
    return stmt;
  };
  const db = {
    rows,
    prepare,
    async batch(statements: Stmt[]) {
      return statements.map(({ sql, args }) => {
        if (sql.startsWith("INSERT")) {
          rows.push({ key: args[0] as string, ts: args[1] as number });
          return {};
        }
        if (sql.startsWith("DELETE FROM rl_hits WHERE key")) {
          const [key, cutoff] = args as [string, number];
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i].key === key && rows[i].ts <= cutoff) rows.splice(i, 1);
          }
          return {};
        }
        if (sql.startsWith("DELETE FROM rl_hits WHERE ts")) {
          const [cutoff] = args as [number];
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i].ts < cutoff) rows.splice(i, 1);
          }
          return {};
        }
        const mine = rows.filter((r) => r.key === args[0]);
        return {
          results: [{ c: mine.length, oldest: mine.length ? Math.min(...mine.map((r) => r.ts)) : null }],
        };
      });
    },
  };
  return db as unknown as D1Like & { rows: typeof rows };
}

const opts = { limit: 2, windowMs: 60_000 };
const never = () => 1;

describe("D1 rate limit", () => {
  it("returns null without a binding, so the caller falls back", async () => {
    expect(await d1Check("k", opts, 1000, null)).toBeNull();
    expect(await d1Peek("k", opts, 1000, null)).toBeNull();
  });

  it("allows exactly `limit` attempts, then blocks with a retry time", async () => {
    const db = fakeD1();
    expect((await d1Check("k", opts, 1000, db, never))?.ok).toBe(true);
    expect((await d1Check("k", opts, 2000, db, never))?.ok).toBe(true);
    const blocked = await d1Check("k", opts, 3000, db, never);
    expect(blocked).toEqual({ ok: false, retryAfterMs: 58_000 });
  });

  it("drops attempts that have left the window", async () => {
    const db = fakeD1([
      { key: "k", ts: 0 },
      { key: "k", ts: 1 },
    ]);
    expect((await d1Check("k", opts, 70_000, db, never))?.ok).toBe(true);
    expect(db.rows).toHaveLength(1);
  });

  it("peek does not record an attempt", async () => {
    const db = fakeD1([{ key: "k", ts: 1000 }]);
    expect(await d1Peek("k", opts, 2000, db)).toEqual({ ok: true, retryAfterMs: 0 });
    expect(db.rows).toHaveLength(1);
    db.rows.push({ key: "k", ts: 1500 });
    expect((await d1Peek("k", opts, 2000, db))?.ok).toBe(false);
  });

  it("keeps keys apart and sweeps day-old rows now and then", async () => {
    const day = 24 * 60 * 60 * 1000;
    const db = fakeD1([{ key: "other", ts: 0 }]);
    await d1Check("k", opts, day + 10, db, () => 0);
    expect(db.rows.map((r) => r.key)).toEqual(["k"]);
  });

  it("returns null when D1 throws", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Like;
    expect(await d1Check("k", opts, 1000, db, never)).toBeNull();
  });
});
