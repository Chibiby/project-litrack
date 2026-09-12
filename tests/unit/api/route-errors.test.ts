import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three API routes, through the shared wrapper.
 *
 * The cron route used to put `err.message` straight into its 500 body, which
 * could name a table or a value. It is behind CRON_SECRET, so the exposure was
 * small — but it was also the only route where the raw text bought nothing,
 * since the caller is a scheduler that reads the status code.
 */

const listSchoolsPublic = vi.fn();
const checkRateLimit = vi.fn();
const reportError = vi.fn((..._args: unknown[]) => "E-TESTREF8");
const purgeExpiredErrorEvents = vi.fn();
const createSnapshot = vi.fn();
const saveBackup = vi.fn();

vi.mock("@/lib/actions/school", () => ({
  get listSchoolsPublic() {
    return listSchoolsPublic;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  peekRateLimit: vi.fn(async () => ({ ok: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));
vi.mock("@/lib/errors/retention", () => ({
  get purgeExpiredErrorEvents() {
    return purgeExpiredErrorEvents;
  },
}));
vi.mock("@/lib/db/snapshot", () => ({
  get createSnapshot() {
    return createSnapshot;
  },
}));
vi.mock("@/lib/db/backup-store", () => ({
  isBackupStoreConfigured: () => true,
  get saveBackup() {
    return saveBackup;
  },
  readBackupBytes: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  AUDIT_ACTIONS: {
    DB_BACKUP_CREATE: "DB_BACKUP_CREATE",
    DB_BACKUP_DOWNLOAD: "DB_BACKUP_DOWNLOAD",
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

import { NextRequest } from "next/server";
import { GET as listSchools } from "@/app/api/schools/list/route";
import { GET as cronBackup } from "@/app/api/cron/backup/route";

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, "https://litrack.example.org"), { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  listSchoolsPublic.mockResolvedValue([{ id: "s1", name: "School" }]);
  purgeExpiredErrorEvents.mockResolvedValue(3);
  createSnapshot.mockResolvedValue({ meta: { totalRows: 10 } });
  saveBackup.mockResolvedValue({ pathname: "daily/x.gz", size: 100, stamp: "2026-09-11" });
  reportError.mockReturnValue("E-TESTREF8");
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/schools/list", () => {
  it("answers with the schools", async () => {
    const res = await listSchools(request("/api/schools/list"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ schools: [{ id: "s1" }] });
  });

  it("says the database is unavailable, with a reference, not 'no schools'", async () => {
    listSchoolsPublic.mockRejectedValue(
      Object.assign(new Error("pool timeout"), {
        name: "PrismaClientKnownRequestError",
        code: "P2024",
      })
    );
    const res = await listSchools(request("/api/schools/list"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ code: "DB_UNAVAILABLE", ref: "E-TESTREF8" });
    expect(body.message).not.toMatch(/prisma|pool timeout/i);
  });
});

describe("/api/cron/backup", () => {
  it("refuses a request without the shared secret", async () => {
    const res = await cronBackup(request("/api/cron/backup?kind=daily"));
    expect(res.status).toBe(401);
  });

  it("never echoes the underlying error text", async () => {
    createSnapshot.mockRejectedValue(new Error('relation "Learner" does not exist'));
    const res = await cronBackup(
      request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" })
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/relation|Learner/);
    expect(body).toHaveProperty("ref");
  });

  it("purges expired error records alongside the backup", async () => {
    const res = await cronBackup(
      request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" })
    );
    expect(res.status).toBe(200);
    expect(purgeExpiredErrorEvents).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ ok: true, errorEventsPurged: 3 });
  });

  it("still reports a successful backup when the purge fails", async () => {
    purgeExpiredErrorEvents.mockRejectedValue(new Error("delete failed"));
    const res = await cronBackup(
      request("/api/cron/backup?kind=daily", { authorization: "Bearer s3cret" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("does not purge on the weekly run", async () => {
    await cronBackup(request("/api/cron/backup?kind=weekly", { authorization: "Bearer s3cret" }));
    expect(purgeExpiredErrorEvents).not.toHaveBeenCalled();
  });
});
