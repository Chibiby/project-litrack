import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `isAuthorized` in `/api/cron/backup` compares the `Authorization` header
 * against `Bearer $CRON_SECRET` by hashing both sides to a fixed-length
 * digest first, then `timingSafeEqual`-ing the two digests — so a
 * wrong-length secret can never take the early-return, length-mismatch path
 * `timingSafeEqual` would otherwise throw on. Every refusal path (missing
 * header, wrong secret, wrong-length secret, unset `CRON_SECRET`) has to
 * fail exactly the same way: 401, no crash. Mirrors the mocking style of
 * `tests/unit/api/route-errors.test.ts`.
 */

const purgeExpiredErrorEvents = vi.fn();
const backUpDatabase = vi.fn();
const runDailyRetention = vi.fn();

vi.mock("@/lib/errors/retention", () => ({
  get purgeExpiredErrorEvents() {
    return purgeExpiredErrorEvents;
  },
}));
vi.mock("@/lib/retention/purge", () => ({
  get runDailyRetention() {
    return runDailyRetention;
  },
}));
vi.mock("@/lib/db/snapshot", () => ({
  get backUpDatabase() {
    return backUpDatabase;
  },
}));
vi.mock("@/lib/db/backup-store", () => ({
  isBackupStoreConfigured: () => true,
  openBackupStream: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  AUDIT_ACTIONS: {
    DB_BACKUP_CREATE: "DB_BACKUP_CREATE",
    DB_BACKUP_DOWNLOAD: "DB_BACKUP_DOWNLOAD",
  },
}));

import { NextRequest } from "next/server";
import { GET as cronBackup } from "@/app/api/cron/backup/route";

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    new URL("/api/cron/backup?kind=daily", "https://litrack.example.org"),
    { headers }
  );
}

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  purgeExpiredErrorEvents.mockResolvedValue(0);
  runDailyRetention.mockResolvedValue({
    notificationsRead: { status: "disabled" },
    notifications: { status: "disabled" },
    auditLogs: { status: "disabled" },
  });
  backUpDatabase.mockResolvedValue({
    saved: { pathname: "daily/x.gz", size: 100, stamp: "2026-09-11" },
    takenAt: "2026-09-11T16:00:00.000Z",
    totalRows: 10,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cret-value";
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/backup — isAuthorized", () => {
  it("refuses a request with no Authorization header at all", async () => {
    const res = await cronBackup(request());
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("refuses the correct scheme with the wrong secret", async () => {
    const res = await cronBackup(
      request({ authorization: "Bearer not-the-secret" })
    );
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("refuses a secret of the wrong length, rather than throwing", async () => {
    // A naive `timingSafeEqual(a, b)` on unequal-length buffers throws
    // ("Input buffers must have the same byte length"). The route hashes
    // both sides to a fixed 32-byte digest first specifically so this input
    // never reaches that path — it must come back as a clean 401, not a 500
    // from an uncaught RangeError.
    const res = await cronBackup(
      request({ authorization: "Bearer short" })
    );
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("refuses a secret far longer than the real one, rather than throwing", async () => {
    const res = await cronBackup(
      request({ authorization: `Bearer ${"x".repeat(500)}` })
    );
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset, even with a plausible header", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronBackup(
      request({ authorization: "Bearer s3cret-value" })
    );
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is set to an empty string", async () => {
    process.env.CRON_SECRET = "";
    const res = await cronBackup(
      request({ authorization: "Bearer " })
    );
    expect(res.status).toBe(401);
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("accepts the exact Bearer secret", async () => {
    const res = await cronBackup(
      request({ authorization: "Bearer s3cret-value" })
    );
    expect(res.status).toBe(200);
    expect(backUpDatabase).toHaveBeenCalledTimes(1);
  });
});
