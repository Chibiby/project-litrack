import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const NEWLINE = String.fromCharCode(10);
for (const line of fs.readFileSync(".env.local", "utf8").split(NEWLINE)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

function show(title: string, rows: unknown[]) {
  console.log(NEWLINE + "=== " + title + " ===");
  if (rows.length === 0) {
    console.log("  (0 rows - clean)");
  } else {
    console.log(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  }
  return rows.length;
}

async function main() {
  let blockers = 0;

  blockers += show(
    "1. Schools whose names differ only by case/spacing (BLOCKS unique index)",
    await prisma.$queryRawUnsafe(
      `SELECT lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS folded_name,
              count(*)::int AS rows, array_agg(name ORDER BY name) AS variants
       FROM "School" GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`
    )
  );

  blockers += show(
    "2. Real schools sharing a School ID case-insensitively (BLOCKS unique index)",
    await prisma.$queryRawUnsafe(
      `SELECT lower("schoolIdCode") AS folded_code, count(*)::int AS rows,
              array_agg("schoolIdCode" ORDER BY name) AS variants,
              array_agg(name ORDER BY name) AS schools
       FROM "School" WHERE "isDemo" = false GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`
    )
  );

  blockers += show(
    "3. Sections colliding within one grade (BLOCKS unique index)",
    await prisma.$queryRawUnsafe(
      `SELECT s."gradeLevelId", sc.name AS school,
              lower(regexp_replace(btrim(s.name), '[[:space:]]+', ' ', 'g')) AS folded_name,
              count(*)::int AS rows, array_agg(s.name ORDER BY s.name) AS variants
       FROM "Section" s JOIN "School" sc ON sc.id = s."schoolId"
       WHERE s."deletedAt" IS NULL
       GROUP BY s."gradeLevelId", sc.name, 3 HAVING count(*) > 1 ORDER BY sc.name, 1`
    )
  );

  show(
    "4. Account emails differing only by case (informational - NOT auto-fixed)",
    await prisma.$queryRawUnsafe(
      `SELECT lower(email) AS folded_email, count(*)::int AS rows,
              array_agg(email ORDER BY email) AS variants
       FROM "User" WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`
    )
  );

  show(
    "7. Values now too long for their column limit (informational)",
    await prisma.$queryRawUnsafe(
      `SELECT id, name, length(address) AS address_len, length(region) AS region_len,
              length(division) AS division_len, length(district) AS district_len
       FROM "School"
       WHERE length(address) > 500 OR length(region) > 100
          OR length(division) > 100 OR length(district) > 100`
    )
  );

  const counts: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM "Learner")::int       AS learners,
            (SELECT count(*) FROM "User")::int          AS users,
            (SELECT count(*) FROM "TeacherInvite")::int AS invites,
            (SELECT count(*) FROM "School")::int        AS schools,
            (SELECT count(*) FROM "Section")::int       AS sections`
  );
  console.log(NEWLINE + "=== Row counts ===");
  console.log(JSON.stringify(counts[0]));

  console.log(
    NEWLINE +
      ">>> BLOCKING ROWS (sections 1-3): " +
      blockers +
      (blockers === 0
        ? " - safe to apply both migrations"
        : " - MUST be resolved before migration 2")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
