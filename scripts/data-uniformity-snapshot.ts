/**
 * Snapshot every column the data-uniformity backfill rewrites, to a local JSON
 * file, before 20260908000003_normalize_existing_data runs.
 *
 * The backfill is not reversible on its own — the original casing is not kept
 * anywhere in the database — so this file is the rollback path. Keep it until
 * the change has been verified in production.
 *
 *   npx tsx scripts/data-uniformity-snapshot.ts <output.json>
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const NEWLINE = String.fromCharCode(10);
for (const line of fs.readFileSync(".env.local", "utf8").split(NEWLINE)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const out = process.argv[2] ?? "data-uniformity-snapshot.json";

async function main() {
  const snapshot = {
    takenAt: new Date().toISOString(),
    learners: await prisma.learner.findMany({
      select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
    }),
    users: await prisma.user.findMany({
      select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
    }),
    teacherInvites: await prisma.teacherInvite.findMany({
      select: { id: true, firstName: true, middleName: true, lastName: true },
    }),
    schools: await prisma.school.findMany({
      select: {
        id: true, name: true, address: true, region: true, division: true, district: true,
      },
    }),
    sections: await prisma.section.findMany({ select: { id: true, name: true } }),
    teacherProfiles: await prisma.teacherProfile.findMany({
      select: { userId: true, contactNumber: true },
    }),
    schoolHeadProfiles: await prisma.schoolHeadProfile.findMany({
      select: { userId: true, contactNumber: true },
    }),
  };

  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log("wrote " + out);
  console.log(
    JSON.stringify({
      learners: snapshot.learners.length,
      users: snapshot.users.length,
      teacherInvites: snapshot.teacherInvites.length,
      schools: snapshot.schools.length,
      sections: snapshot.sections.length,
      teacherProfiles: snapshot.teacherProfiles.length,
      schoolHeadProfiles: snapshot.schoolHeadProfiles.length,
    })
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
