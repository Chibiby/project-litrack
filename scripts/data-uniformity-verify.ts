/**
 * Post-migration verification for the data-uniformity backfill.
 * Confirms zero rows still need normalising, the three folded unique indexes
 * exist, and reports what actually changed versus the pre-backfill snapshot.
 *
 *   npx tsx scripts/data-uniformity-verify.ts [snapshot.json]
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const NEWLINE = String.fromCharCode(10);
for (const line of fs.readFileSync(".env.local", "utf8").split(NEWLINE)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const snapshotPath = process.argv[2];

type NameRow = { id: string; firstName: string; middleName: string | null; lastName: string; fullName?: string };

async function main() {
  const remaining: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT 'Learner' AS table_name,
            count(*) FILTER (WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
                                OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName")
                                OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName"))::int AS still_unnormalised,
            count(*)::int AS total
     FROM "Learner"
     UNION ALL
     SELECT 'User',
            count(*) FILTER (WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
                                OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName")
                                OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName"))::int,
            count(*)::int
     FROM "User"
     UNION ALL
     SELECT 'TeacherInvite',
            count(*) FILTER (WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
                                OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName")
                                OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName"))::int,
            count(*)::int
     FROM "TeacherInvite"`
  );
  console.log(NEWLINE + "=== Rows still needing normalisation (must all be 0) ===");
  console.table(remaining);

  const mismatchedFullNames: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS learners_with_stale_fullname
     FROM "Learner"
     WHERE "fullName" IS DISTINCT FROM btrim(concat_ws(' ', "firstName", "middleName", "lastName"))`
  );
  console.log(NEWLINE + "=== Learner.fullName consistency (must be 0) ===");
  console.log(JSON.stringify(mismatchedFullNames[0]));

  const indexes: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('School_name_folded_key',
                         'School_schoolIdCode_real_key',
                         'Section_gradeLevelId_name_folded_key',
                         'School_name_key',
                         'Section_gradeLevelId_name_key')
     ORDER BY indexname`
  );
  console.log(NEWLINE + "=== Unique indexes (3 folded present, 2 old gone) ===");
  for (const row of indexes) console.log("  " + row.indexname + "  ::  " + row.indexdef);

  const funcs: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT proname FROM pg_proc
     WHERE proname IN ('litrack_format_person_name', 'litrack_canonical_ph_phone')
     ORDER BY proname`
  );
  console.log(NEWLINE + "=== Helper functions installed ===");
  console.log(JSON.stringify(funcs.map((f) => f.proname)));

  const samples: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT litrack_format_person_name('  juan   DELA cruz iii ') AS particles_and_suffix,
            litrack_format_person_name('MARY-JANE o''brien')      AS hyphen_and_apostrophe,
            litrack_format_person_name('MCDONALD macario')        AS mc_but_not_mac,
            litrack_canonical_ph_phone('+63 917 123 4567')        AS phone`
  );
  console.log(NEWLINE + "=== SQL rules match the TypeScript rules ===");
  console.log(JSON.stringify(samples[0], null, 2));

  if (snapshotPath && fs.existsSync(snapshotPath)) {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const nowLearners = await prisma.learner.findMany({
      select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
    });
    const nowUsers = await prisma.user.findMany({
      select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
    });

    const diff = (before: NameRow[], after: NameRow[]) => {
      const byId = new Map(before.map((r) => [r.id, r]));
      const changed: Array<{ id: string; from: string; to: string }> = [];
      for (const row of after) {
        const old = byId.get(row.id);
        if (!old) continue;
        const oldStr = [old.firstName, old.middleName, old.lastName].join("|");
        const newStr = [row.firstName, row.middleName, row.lastName].join("|");
        if (oldStr !== newStr) changed.push({ id: row.id, from: oldStr, to: newStr });
      }
      return changed;
    };

    const learnerChanges = diff(snap.learners, nowLearners);
    const userChanges = diff(snap.users, nowUsers);
    console.log(NEWLINE + "=== What actually changed vs the snapshot ===");
    console.log("  learners changed: " + learnerChanges.length + " / " + snap.learners.length);
    console.log("  users changed:    " + userChanges.length + " / " + snap.users.length);
    for (const c of [...learnerChanges, ...userChanges].slice(0, 40)) {
      console.log("    " + c.from + "   ->   " + c.to);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
