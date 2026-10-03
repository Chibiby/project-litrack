import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Helpers for the opt-in database lane (`npm run test:db`).
 *
 * The client is built directly with the pg adapter rather than through
 * `createPrismaClient` in src/lib/prisma.ts: that module also wires Cloudflare
 * context and the per-request error-marking proxy, none of which a test needs.
 * It is the same engine ("client") and the same adapter the app uses.
 */

/**
 * The lane runs TRUNCATE ... CASCADE on every public table, so a hostname check
 * is not enough (a developer's own Postgres or an SSH tunnel is also
 * "localhost"). Require the throwaway cluster's exact host, port and database
 * AND the marker only scripts/test-db.mjs sets.
 */
export function localDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; run these tests with `npm run test:db`.");
  if (env.LITRACK_TEST_DB_LANE !== "1") {
    throw new Error(
      "Refusing to run DB tests: LITRACK_TEST_DB_LANE is not set. These tests TRUNCATE every table; run them only through `npm run test:db`.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing to run DB tests: DATABASE_URL is not a valid URL.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.port !== "54329" ||
    database !== "litrack_test"
  ) {
    throw new Error(
      `Refusing to run DB tests against "${parsed.hostname}:${parsed.port || "default"}/${database}"; only 127.0.0.1:54329/litrack_test is allowed.`,
    );
  }
  return url;
}

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: localDatabaseUrl() }),
});

/** Empties every table (migration bookkeeping excluded). Call in beforeEach. */
export async function truncateAll(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const next = () => ++counter;

export async function makeSchool(name = `School ${next()}`) {
  return db.school.create({ data: { name, schoolIdCode: String(100000 + next()) } });
}

export async function makeGrade(schoolId: string, type: "KINDER" | "G1" | "G2" = "G1") {
  return db.gradeLevel.create({ data: { schoolId, type } });
}

export async function makeYear(
  schoolId: string,
  opts: { label?: string; isActive?: boolean } = {},
) {
  return db.schoolYear.create({
    data: {
      schoolId,
      label: opts.label ?? `20${20 + next()}-20${21 + next()}`,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2027-03-31T00:00:00Z"),
      isActive: opts.isActive ?? false,
    },
  });
}

export async function makeLearner(schoolId: string, gradeLevelId: string, fullName: string) {
  return db.learner.create({
    data: {
      schoolId,
      gradeLevelId,
      firstName: fullName,
      lastName: "Test",
      fullName,
      age: 7,
      gender: "FEMALE",
      filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      parentEducation: "NO_FORMAL",
    },
  });
}

export async function makeTeacher(schoolId: string, name: string) {
  const n = next();
  return db.user.create({
    data: {
      authId: `auth-${n}`,
      email: `t${n}@test.invalid`,
      role: "TEACHER",
      schoolId,
      firstName: name,
      lastName: "Teacher",
      fullName: `${name} Teacher`,
      isActive: true,
      approvalStatus: "APPROVED",
    },
  });
}

export function enrollmentData(
  learner: { id: string; schoolId: string; gradeLevelId: string },
  schoolYearId: string,
  status: "ACTIVE" | "COMPLETED" | "TRANSFERRED" | "ARCHIVED",
) {
  return {
    learnerId: learner.id,
    schoolId: learner.schoolId,
    schoolYearId,
    gradeLevelId: learner.gradeLevelId,
    status,
  };
}
