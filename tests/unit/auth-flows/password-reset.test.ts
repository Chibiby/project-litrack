import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * Reset tokens in `AuthVerification` (spec section 2, Reset; invariant I9).
 *
 * The two properties people rely on, and that Better Auth's own reset endpoints
 * do not give us, are pinned against a faithful in-memory store:
 *  - SINGLE USE: consuming deletes the row, and must delete exactly one, so a
 *    link works once and of two concurrent submits only one wins.
 *  - NEWEST ONLY: issuing a token deletes that identity's older reset rows, so
 *    only the latest email works (the behaviour people had with Supabase).
 * Plus: the database never holds a raw token, and expiry, shape and best-effort
 * cooldown behave. Offline: no database, no network.
 */

type Row = {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
};

type Where = {
  id?: string;
  value?: string;
  identifier?: string | { startsWith: string };
  expiresAt?: { gt: Date };
  createdAt?: { gt: Date };
};

let rows: Row[] = [];
let failReads = false;

function matches(row: Row, where: Where): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.value !== undefined && row.value !== where.value) return false;
  if (where.identifier !== undefined) {
    if (typeof where.identifier === "string") {
      if (row.identifier !== where.identifier) return false;
    } else if (!row.identifier.startsWith(where.identifier.startsWith)) return false;
  }
  if (where.expiresAt && !(row.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false;
  if (where.createdAt && !(row.createdAt.getTime() > where.createdAt.gt.getTime())) return false;
  return true;
}

// Each call yields to the event loop, so two concurrent consumers really do
// interleave their find and delete steps instead of running back to back.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const store = {
  async findFirst({ where }: { where: Where }) {
    await tick();
    if (failReads) throw new Error("connection terminated");
    return rows.find((r) => matches(r, where)) ?? null;
  },
  async create({ data }: { data: { id: string; identifier: string; value: string; expiresAt: Date } }) {
    await tick();
    const row: Row = { ...data, createdAt: new Date() };
    rows.push(row);
    return row;
  },
  async deleteMany({ where }: { where: Where }) {
    await tick();
    const before = rows.length;
    rows = rows.filter((r) => !matches(r, where));
    return { count: before - rows.length };
  },
};

const prismaFresh = {
  authVerification: store,
  async $transaction<T>(fn: (tx: { authVerification: typeof store }) => Promise<T>): Promise<T> {
    return fn({ authVerification: store });
  },
};

vi.mock("@/lib/prisma", () => ({
  get prismaFresh() {
    return prismaFresh;
  },
}));

import {
  RESET_TOKEN_TTL_MS,
  consumeResetToken,
  hasRecentResetToken,
  issueResetToken,
  peekResetToken,
} from "@/lib/auth/password-reset";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

async function expectExpired(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "AUTH_RESET_LINK_EXPIRED" });
}

beforeEach(() => {
  rows = [];
  failReads = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issueResetToken", () => {
  it("returns a 43-character base64url token and an expiry one hour out", async () => {
    const before = Date.now();
    const { token, expiresAt } = await issueResetToken(ALICE);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + RESET_TOKEN_TTL_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + RESET_TOKEN_TTL_MS);
  });

  it("never issues the same token twice", async () => {
    const a = await issueResetToken(ALICE);
    const b = await issueResetToken(BOB);
    expect(a.token).not.toBe(b.token);
  });

  it("stores only a sha256 of the token, never the token (a database read cannot become a working link)", async () => {
    const { token } = await issueResetToken(ALICE);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.identifier).toBe(
      `reset-password:${createHash("sha256").update(token, "utf8").digest("hex")}`
    );
    expect(row.value).toBe(ALICE);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("stores the row with the same expiry it returns", async () => {
    const { expiresAt } = await issueResetToken(ALICE);
    expect(rows[0].expiresAt.getTime()).toBe(expiresAt.getTime());
  });
});

describe("newest only", () => {
  it("kills the older link when a newer one is issued for the same identity", async () => {
    const first = await issueResetToken(ALICE);
    const second = await issueResetToken(ALICE);

    expect(await peekResetToken(first.token)).toBeNull();
    await expectExpired(consumeResetToken(first.token));

    expect(await peekResetToken(second.token)).toMatchObject({ authId: ALICE });
    await expect(consumeResetToken(second.token)).resolves.toBe(ALICE);
  });

  it("keeps exactly one live reset row per identity however many are requested", async () => {
    for (let i = 0; i < 5; i += 1) await issueResetToken(ALICE);
    expect(rows.filter((r) => r.value === ALICE)).toHaveLength(1);
  });

  it("keeps only the third of three links working", async () => {
    const tokens = [];
    for (let i = 0; i < 3; i += 1) tokens.push((await issueResetToken(ALICE)).token);
    expect(await peekResetToken(tokens[0])).toBeNull();
    expect(await peekResetToken(tokens[1])).toBeNull();
    expect(await peekResetToken(tokens[2])).not.toBeNull();
  });

  it("does not touch another identity's live link", async () => {
    const alice = await issueResetToken(ALICE);
    const bob = await issueResetToken(BOB);
    await issueResetToken(ALICE);

    expect(await peekResetToken(alice.token)).toBeNull();
    expect(await peekResetToken(bob.token)).toMatchObject({ authId: BOB });
  });

  it("does not delete other kinds of verification rows for the identity", async () => {
    rows.push({
      id: "other",
      identifier: "email-verification:abc",
      value: ALICE,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    await issueResetToken(ALICE);
    expect(rows.some((r) => r.id === "other")).toBe(true);
  });
});

describe("single use", () => {
  it("lets a token be consumed once and returns its identity", async () => {
    const { token } = await issueResetToken(ALICE);
    await expect(consumeResetToken(token)).resolves.toBe(ALICE);
    expect(rows).toHaveLength(0);
  });

  it("refuses the same token the second time", async () => {
    const { token } = await issueResetToken(ALICE);
    await consumeResetToken(token);
    await expectExpired(consumeResetToken(token));
  });

  it("stops peek from seeing a consumed token", async () => {
    const { token } = await issueResetToken(ALICE);
    await consumeResetToken(token);
    expect(await peekResetToken(token)).toBeNull();
  });

  it("peek does not use the token up, so a mail scanner's GET cannot burn the link", async () => {
    const { token } = await issueResetToken(ALICE);
    await peekResetToken(token);
    await peekResetToken(token);
    expect(rows).toHaveLength(1);
    await expect(consumeResetToken(token)).resolves.toBe(ALICE);
  });

  it("lets only one of two concurrent submits win", async () => {
    const { token } = await issueResetToken(ALICE);
    const results = await Promise.allSettled([consumeResetToken(token), consumeResetToken(token)]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "AUTH_RESET_LINK_EXPIRED" });
  });

  it("lets only one of many concurrent submits win", async () => {
    const { token } = await issueResetToken(ALICE);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeResetToken(token)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("deletes inside the caller's transaction client when one is passed", async () => {
    const { token } = await issueResetToken(ALICE);
    const tx = { authVerification: { ...store, deleteMany: vi.fn(store.deleteMany) } };
    await expect(consumeResetToken(token, tx as never)).resolves.toBe(ALICE);
    expect(tx.authVerification.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("treats a delete that removed nothing as an expired link, so the password write rolls back", async () => {
    const { token } = await issueResetToken(ALICE);
    const tx = {
      authVerification: { findFirst: store.findFirst, deleteMany: vi.fn(async () => ({ count: 0 })) },
    };
    await expectExpired(consumeResetToken(token, tx as never));
  });

  it("leaves the token usable when something after peek (the password write) fails", async () => {
    const { token } = await issueResetToken(ALICE);
    expect(await peekResetToken(token)).not.toBeNull();
    // The action's transaction rolled back, so the delete never committed.
    expect(rows).toHaveLength(1);
    await expect(consumeResetToken(token)).resolves.toBe(ALICE);
  });
});

describe("expiry", () => {
  it("refuses a token past its hour, in both peek and consume", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
    const { token } = await issueResetToken(ALICE);

    vi.setSystemTime(new Date("2026-03-01T08:59:59.000Z"));
    expect(await peekResetToken(token)).not.toBeNull();

    vi.setSystemTime(new Date("2026-03-01T09:00:01.000Z"));
    expect(await peekResetToken(token)).toBeNull();
    await expectExpired(consumeResetToken(token));
  });

  it("peek reports the remaining lifetime so the cookie can match it", async () => {
    const { token, expiresAt } = await issueResetToken(ALICE);
    const live = await peekResetToken(token);
    expect(live?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });
});

describe("malformed and unknown tokens", () => {
  const MISSING: unknown[] = [undefined, null, ""];
  const BAD_SHAPE = [
    "short",
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}!`,
    `${"a".repeat(42)} `,
    "' OR 1=1 --".padEnd(43, "a"),
  ];

  it.each([...MISSING, ...BAD_SHAPE])("peek returns null for %j", async (token) => {
    await issueResetToken(ALICE);
    expect(await peekResetToken(token as string)).toBeNull();
  });

  it.each([...MISSING, ...BAD_SHAPE])("consume throws AUTH_RESET_LINK_EXPIRED for %j", async (token) => {
    await issueResetToken(ALICE);
    await expectExpired(consumeResetToken(token as string));
    expect(rows).toHaveLength(1);
  });

  it("refuses a well-formed token nobody issued", async () => {
    await issueResetToken(ALICE);
    const stranger = "A".repeat(43);
    expect(await peekResetToken(stranger)).toBeNull();
    await expectExpired(consumeResetToken(stranger));
    expect(rows).toHaveLength(1);
  });

  it("does not accept the stored identifier (the hash) as if it were a token", async () => {
    await issueResetToken(ALICE);
    const hashPart = rows[0].identifier.replace("reset-password:", "");
    expect(await peekResetToken(hashPart)).toBeNull();
    expect(await peekResetToken(rows[0].identifier)).toBeNull();
  });

  it("gives the same answer for unknown and consumed, so the page cannot be used as an oracle", async () => {
    const { token } = await issueResetToken(ALICE);
    await consumeResetToken(token);
    const consumed = await consumeResetToken(token).catch((e) => e);
    const unknown = await consumeResetToken("B".repeat(43)).catch((e) => e);
    expect(consumed.message).toBe(unknown.message);
    expect(consumed.code).toBe(unknown.code);
  });
});

describe("hasRecentResetToken (resend cooldown)", () => {
  const TWO_MINUTES = 2 * 60 * 1000;

  it("is true when a link was issued inside the window", async () => {
    await issueResetToken(ALICE);
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(true);
  });

  it("is false when the identity has no reset link", async () => {
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(false);
  });

  it("is false when the newest link is older than the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
    await issueResetToken(ALICE);
    vi.setSystemTime(new Date("2026-03-01T08:03:00.000Z"));
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(false);
  });

  it("does not count another identity's link", async () => {
    await issueResetToken(BOB);
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(false);
  });

  it("is false once the link has been used", async () => {
    const { token } = await issueResetToken(ALICE);
    await consumeResetToken(token);
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(false);
  });

  it("is best effort: a database failure reads as 'no', never blocks a legitimate email", async () => {
    await issueResetToken(ALICE);
    failReads = true;
    await expect(hasRecentResetToken(ALICE, TWO_MINUTES)).resolves.toBe(false);
  });
});
