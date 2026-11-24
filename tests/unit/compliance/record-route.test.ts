import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import type { RawComplianceRow } from "@/lib/summary/queries/compliance";

const db = vi.hoisted(() => ({
  rows: [] as RawComplianceRow[],
  schools: [] as { id: string }[],
  states: [] as Record<string, unknown>[],
  createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
  updateMany: vi.fn((args: unknown) => ({ op: "updateMany", args })),
  update: vi.fn((args: unknown) => ({ op: "update", args })),
  eventCreateMany: vi.fn((args: unknown) => ({ op: "eventCreateMany", args })),
  transaction: vi.fn(async (ops: unknown[]) => ops),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/summary/queries/compliance", async (orig) => ({
  ...(await orig<typeof import("@/lib/summary/queries/compliance")>()),
  queryComplianceRows: vi.fn(async () => db.rows),
}));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateDivisionSummary: db.revalidate }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: vi.fn(async () => db.schools) },
    schoolComplianceState: {
      findMany: vi.fn(async () => db.states),
      createMany: db.createMany,
      updateMany: db.updateMany,
      update: db.update,
    },
    schoolComplianceEvent: { createMany: db.eventCreateMany },
    $transaction: db.transaction,
  },
}));

import { GET } from "@/app/api/cron/compliance-record/route";
import { recordComplianceChanges } from "@/lib/compliance/record";

const TODAY = "2026-11-24";

function row(schoolId: string, over: Partial<RawComplianceRow> = {}): RawComplianceRow {
  return {
    school_id: schoolId,
    live: 10,
    non_archived: 10,
    pending: 0,
    grades_no_adviser: 0,
    aral: 0,
    incomplete: 0,
    enrollments: 10,
    drift: 0,
    last_attendance: null,
    reading: 0,
    last_week: 0,
    has_admin: true,
    mosy_not_updated: 0,
    mosy_for_decision: 0,
    sy_start: "2026-06-15T00:00:00.000Z",
    mosy_override_start: null,
    mosy_override_end: null,
    mosy_override_deadline: null,
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.schools = [];
  db.states = [];
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("recordComplianceChanges", () => {
  it("first run creates every state in one createMany and logs no event", async () => {
    db.rows = [row("a"), row("b", { pending: 1 })];
    db.schools = [{ id: "a" }, { id: "b" }];
    const out = await recordComplianceChanges(TODAY);
    expect(out).toEqual({ todayKey: TODAY, skipped: false, checked: 2, created: 2, changed: 0 });
    expect(db.createMany.mock.calls[0][0]).toMatchObject({ data: [{ schoolId: "a" }, { schoolId: "b" }] });
    expect(db.eventCreateMany.mock.calls[0][0]).toEqual({ data: [] });
    expect(db.revalidate).toHaveBeenCalledTimes(1);
  });

  it("an unchanged school is only touched; a changed one is updated and logged", async () => {
    db.rows = [row("a"), row("b", { incomplete: 2 })];
    db.schools = [{ id: "a" }, { id: "b" }];
    db.states = [
      { schoolId: "a", status: "COMPLIANT", compliantSince: "2026-10-01", lastCheckedOn: "2026-11-23", flags: [] },
      { schoolId: "b", status: "COMPLIANT", compliantSince: "2026-10-01", lastCheckedOn: "2026-11-23", flags: [] },
    ];
    const out = await recordComplianceChanges(TODAY);
    expect(out).toMatchObject({ created: 0, changed: 1 });
    expect(db.updateMany.mock.calls[0][0]).toEqual({
      where: { schoolId: { in: ["a"] } },
      data: { lastCheckedOn: TODAY },
    });
    expect(db.update.mock.calls[0][0]).toMatchObject({
      where: { schoolId: "b" },
      data: { status: "NON_COMPLIANT", compliantSince: null, flags: ["INCOMPLETE"] },
    });
    expect(db.eventCreateMany.mock.calls[0][0]).toMatchObject({
      data: [{ schoolId: "b", fromStatus: "COMPLIANT", toStatus: "NON_COMPLIANT" }],
    });
  });

  it("a second run the same day writes nothing", async () => {
    db.rows = [row("a")];
    db.schools = [{ id: "a" }];
    db.states = [{ schoolId: "a", status: "COMPLIANT", compliantSince: "2026-10-01", lastCheckedOn: TODAY, flags: [] }];
    expect(await recordComplianceChanges(TODAY)).toMatchObject({ skipped: true });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.revalidate).not.toHaveBeenCalled();
  });
});

function req(headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/cron/compliance-record", "https://litrack.example.org"), { headers });
}

describe("GET /api/cron/compliance-record", () => {
  it("refuses without the right secret, and when the secret is unset", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer nope" }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req({ authorization: "Bearer s3cret" }))).status).toBe(401);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("answers 200 with the counts when authorised", async () => {
    db.rows = [row("a")];
    db.schools = [{ id: "a" }];
    const res = await GET(req({ authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: false, checked: 1, created: 1 });
  });
});

describe("cron wiring", () => {
  it("worker.js and wrangler.jsonc both run it at 00:05 Manila", () => {
    const worker = readFileSync(resolve(__dirname, "../../../worker.js"), "utf8");
    const wrangler = readFileSync(resolve(__dirname, "../../../wrangler.jsonc"), "utf8");
    expect(worker).toContain(`"5 16 * * *": "/api/cron/compliance-record"`);
    expect(wrangler).toMatch(/"crons":\s*\[[^\]]*"5 16 \* \* \*"/);
  });
});
