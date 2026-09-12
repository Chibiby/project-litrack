/**
 * Delete named schools and everything under them. The surgical counterpart to
 * `scripts/import-schools.ts --wipe`, which is all-or-nothing and would take a pilot
 * school's learners with it.
 *
 * Usage:
 *   npx tsx scripts/delete-schools.ts --school 305402 --school 500282            # dry run (default)
 *   npx tsx scripts/delete-schools.ts --school 305402 --school 500282 --commit   # delete
 *
 * `--school` is repeatable and takes a School ID code or an exact school name. A token
 * that matches no school, or more than one, is an error — this script never guesses
 * which school you meant. Schools you did not name are never touched, and neither are
 * User rows with no schoolId (Super Admins).
 *
 * Requires DATABASE_URL or DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * read from the shell or from `.env.local`.
 *
 * DELETION IS IRREVERSIBLE. It does NOT rely on cascade: several FKs in this subtree are
 * ON DELETE RESTRICT (verified against prisma/migrations/*​/migration.sql, since Prisma
 * omits an explicit onDelete when it matches the connector default and that default
 * differs by relation optionality):
 *
 *   Enrollment.schoolId, .gradeLevelId, .schoolYearId        -> RESTRICT
 *   Learner.gradeLevelId, .teacherId                         -> RESTRICT
 *   Announcement.authorId                                    -> RESTRICT
 *   Attendance/AttendanceDayMeta/ReadingLevelRecord.recordedById -> RESTRICT
 *
 * So the delete below walks the subtree explicitly, children first, in one transaction,
 * in the order that satisfies every RESTRICT above — the same order and for the same
 * reasons as that script's Phase 4, just scoped to the named schools.
 *
 * Two scoping subtleties, both deliberate:
 *
 *  - Attendance, AttendanceDayMeta and ReadingLevelRecord carry no schoolId. They are
 *    matched by learner/gradeLevel of a doomed school OR by `recordedById` among the
 *    doomed users. Tenancy should make the second half redundant; it is there so that a
 *    single leaked cross-tenant row cannot leave a RESTRICT unsatisfied and abort the run.
 *  - `User.schoolId` is ON DELETE SET NULL, not cascade, so deleting School alone would
 *    silently orphan its accounts with schoolId nulled — indistinguishable from a Super
 *    Admin. User rows are therefore deleted explicitly, by an id list captured up front.
 */
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { connectScriptPrisma, loadEnvFile } from "./lib/script-db";

export type DeleteCliOptions = {
  schools: string[];
  commit: boolean;
};

/** A school subtree is small; the ceiling is latency, not work. */
const TX_TIMEOUT_MS = 120_000;
/** The Supabase admin API is rate-sensitive. */
const CONCURRENCY = 5;

export function parseDeleteCliArgs(argv: string[]): DeleteCliOptions {
  const schools: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--school") continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error("--school needs a School ID or name");
    schools.push(value);
    i++;
  }
  if (schools.length === 0) {
    throw new Error("Name at least one school with --school <School ID or exact name>");
  }

  const seen = new Set<string>();
  for (const s of schools) {
    const key = s.toLowerCase();
    if (seen.has(key)) throw new Error(`--school ${s} was given twice`);
    seen.add(key);
  }

  return { schools, commit: argv.includes("--commit") };
}

function heading(text: string): void {
  console.log(`\n${"=".repeat(70)}\n${text}\n${"=".repeat(70)}`);
}

/** Enough to recognize the account without printing a full address into a log. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}${email.slice(at)}`;
}

async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const opts = parseDeleteCliArgs(process.argv.slice(2));
  const envKeys = loadEnvFile();
  if (envKeys.length) console.log(`loaded .env.local (${envKeys.length} keys, values not printed)`);
  const prisma = await connectScriptPrisma();

  try {
    // ---- Phase 1: resolve the named schools --------------------------------
    heading("PHASE 1 — RESOLVE");
    const doomedSchools: { id: string; name: string; schoolIdCode: string; district: string | null }[] = [];

    for (const token of opts.schools) {
      const hits = await prisma.school.findMany({
        where: {
          OR: [{ schoolIdCode: token }, { name: { equals: token, mode: "insensitive" } }],
        },
        select: { id: true, name: true, schoolIdCode: true, district: true },
      });
      if (hits.length === 0) throw new Error(`--school ${token}: no school has that School ID or name`);
      if (hits.length > 1) {
        throw new Error(
          `--school ${token}: matches ${hits.length} schools (${hits.map((h) => h.schoolIdCode).join(", ")}) — name one exactly`,
        );
      }
      const hit = hits[0]!;
      if (doomedSchools.some((s) => s.id === hit.id)) {
        throw new Error(`--school ${token}: resolves to ${hit.name}, which was already named`);
      }
      doomedSchools.push(hit);
      console.log(`  ${hit.schoolIdCode}  ${hit.name}  (district ${hit.district ?? "—"})`);
    }

    const doomedSchoolIds = doomedSchools.map((s) => s.id);

    const survivors = await prisma.school.findMany({
      where: { id: { notIn: doomedSchoolIds } },
      select: { schoolIdCode: true, name: true },
      orderBy: { name: "asc" },
    });
    console.log(`\n  PRESERVED — ${survivors.length} school(s) not named above:`);
    for (const s of survivors) console.log(`    ${s.schoolIdCode}  ${s.name}`);

    // ---- Phase 2: blast radius ---------------------------------------------
    heading("PHASE 2 — BLAST RADIUS");

    const doomedUsers = await prisma.user.findMany({
      where: { schoolId: { in: doomedSchoolIds } },
      select: { id: true, authId: true, email: true, role: true },
    });
    const doomedUserIds = doomedUsers.map((u) => u.id);

    const doomedLearners = await prisma.learner.findMany({
      where: { schoolId: { in: doomedSchoolIds } },
      select: { id: true },
    });
    const doomedLearnerIds = doomedLearners.map((l) => l.id);

    const doomedGradeLevels = await prisma.gradeLevel.findMany({
      where: { schoolId: { in: doomedSchoolIds } },
      select: { id: true },
    });
    const doomedGradeLevelIds = doomedGradeLevels.map((g) => g.id);

    const doomedSections = await prisma.section.findMany({
      where: { schoolId: { in: doomedSchoolIds } },
      select: { id: true },
    });
    const doomedSectionIds = doomedSections.map((s) => s.id);

    // Match the delete's own where clauses exactly, so the reported radius is the
    // radius — not an approximation of it.
    const learnerOrRecorder = {
      OR: [{ learnerId: { in: doomedLearnerIds } }, { recordedById: { in: doomedUserIds } }],
    };

    const [
      attendance,
      attendanceDayMeta,
      readingLevels,
      aralProfiles,
      enrollments,
      announcements,
      schoolYears,
      teacherInvites,
      teacherSections,
    ] = await Promise.all([
      prisma.attendance.count({ where: learnerOrRecorder }),
      prisma.attendanceDayMeta.count({
        where: {
          OR: [{ gradeLevelId: { in: doomedGradeLevelIds } }, { recordedById: { in: doomedUserIds } }],
        },
      }),
      prisma.readingLevelRecord.count({ where: learnerOrRecorder }),
      prisma.aralProfile.count({ where: { learnerId: { in: doomedLearnerIds } } }),
      prisma.enrollment.count({
        where: { OR: [{ schoolId: { in: doomedSchoolIds } }, { learnerId: { in: doomedLearnerIds } }] },
      }),
      prisma.announcement.count({
        where: { OR: [{ schoolId: { in: doomedSchoolIds } }, { authorId: { in: doomedUserIds } }] },
      }),
      prisma.schoolYear.count({ where: { schoolId: { in: doomedSchoolIds } } }),
      prisma.teacherInvite.count({ where: { schoolId: { in: doomedSchoolIds } } }),
      prisma.teacherSection.count({
        where: { OR: [{ sectionId: { in: doomedSectionIds } }, { teacherId: { in: doomedUserIds } }] },
      }),
    ]);

    const rows: [string, number][] = [
      ["School", doomedSchools.length],
      ["GradeLevel", doomedGradeLevels.length],
      ["Section", doomedSections.length],
      ["SchoolYear", schoolYears],
      ["Learner", doomedLearners.length],
      ["Enrollment", enrollments],
      ["Attendance", attendance],
      ["AttendanceDayMeta", attendanceDayMeta],
      ["ReadingLevelRecord", readingLevels],
      ["AralProfile", aralProfiles],
      ["Announcement", announcements],
      ["TeacherInvite", teacherInvites],
      ["TeacherSection", teacherSections],
      ["User (school-scoped)", doomedUsers.length],
    ];
    for (const [label, value] of rows) console.log(`  ${label.padEnd(22)} ${value}`);

    console.log(`\n  Supabase auth users to delete: ${doomedUsers.length}`);
    for (const u of doomedUsers) {
      console.log(`    ${u.role.padEnd(12)} ${maskEmail(u.email)}`);
    }

    const preservedSuperAdmins = await prisma.user.count({ where: { schoolId: null } });
    const preservedUsers = await prisma.user.count({
      where: { schoolId: { notIn: doomedSchoolIds, not: null } },
    });
    console.log(`\n  PRESERVED — User with schoolId = null (Super Admin etc.): ${preservedSuperAdmins}`);
    console.log(`  PRESERVED — User in a school not named above: ${preservedUsers}`);
    console.log("  PRESERVED — AuditLog (no FK to User/School; history outlives its subjects)");

    if (!opts.commit) {
      console.log("\nDRY RUN — nothing deleted. Re-run with --commit to apply.");
      return;
    }

    // ---- Phase 3: delete the auth identities -------------------------------
    heading("PHASE 3 — DELETE SUPABASE AUTH USERS");
    const supabaseAdmin = createSupabaseAdminClient();
    let authDeleted = 0;
    const authFailures: { authId: string; message: string }[] = [];
    await inParallel(doomedUsers, CONCURRENCY, async (u) => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(u.authId);
      // Already gone counts as success — the goal is "no orphan", not "I did it".
      if (error && !/not found/i.test(error.message)) {
        authFailures.push({ authId: u.authId, message: error.message });
      } else {
        authDeleted += 1;
      }
    });
    console.log(`auth users deleted (or already absent): ${authDeleted}`);

    // A real failure means that identity is still live. Deleting its Prisma row anyway
    // would orphan it the other direction — a working login with no User/School behind
    // it. Abort before touching Prisma; re-run once Supabase is healthy.
    if (authFailures.length) {
      for (const f of authFailures) console.error(`  auth user ${f.authId}: ${f.message}`);
      throw new Error(
        `${authFailures.length} Supabase auth user(s) failed to delete — aborting before touching Prisma rows.`,
      );
    }

    // ---- Phase 4: delete the rows ------------------------------------------
    heading("PHASE 4 — DELETE ROWS");
    // One transaction: if any RESTRICT is left unsatisfied the whole thing rolls back
    // and the database is exactly as it was. Order matters — see the header comment.
    const counts = await prisma.$transaction(
      async (tx) => {
        // 1. recordedById -> User is RESTRICT. Clear before step 8.
        const attendanceDel = await tx.attendance.deleteMany({ where: learnerOrRecorder });
        const dayMetaDel = await tx.attendanceDayMeta.deleteMany({
          where: {
            OR: [{ gradeLevelId: { in: doomedGradeLevelIds } }, { recordedById: { in: doomedUserIds } }],
          },
        });
        const readingDel = await tx.readingLevelRecord.deleteMany({ where: learnerOrRecorder });
        // 2. AralProfile cascades from Learner; deleted here anyway so the tally is complete.
        const aralDel = await tx.aralProfile.deleteMany({
          where: { learnerId: { in: doomedLearnerIds } },
        });
        // 3. Enrollment.schoolId/.gradeLevelId/.schoolYearId are RESTRICT. Clear before
        //    steps 6 (GradeLevel, SchoolYear) and 7 (School).
        const enrollmentDel = await tx.enrollment.deleteMany({
          where: { OR: [{ schoolId: { in: doomedSchoolIds } }, { learnerId: { in: doomedLearnerIds } }] },
        });
        // 4. Announcement.authorId -> User is RESTRICT. Clear before step 8.
        const announcementDel = await tx.announcement.deleteMany({
          where: { OR: [{ schoolId: { in: doomedSchoolIds } }, { authorId: { in: doomedUserIds } }] },
        });
        // 5. Learner.gradeLevelId -> GradeLevel and Learner.teacherId -> User are both
        //    RESTRICT. Clear before steps 6 and 8. Everything that referenced Learner
        //    went in steps 1-3.
        const learnerDel = await tx.learner.deleteMany({ where: { schoolId: { in: doomedSchoolIds } } });
        // 6. Nothing RESTRICTs these once steps 1-5 have run. TeacherSection first: it
        //    references Section. User.advisorySectionId -> Section is SET NULL, which is
        //    harmless here because those users are deleted in step 8 regardless.
        const teacherSectionDel = await tx.teacherSection.deleteMany({
          where: { OR: [{ sectionId: { in: doomedSectionIds } }, { teacherId: { in: doomedUserIds } }] },
        });
        const sectionDel = await tx.section.deleteMany({ where: { schoolId: { in: doomedSchoolIds } } });
        const gradeLevelDel = await tx.gradeLevel.deleteMany({ where: { schoolId: { in: doomedSchoolIds } } });
        const schoolYearDel = await tx.schoolYear.deleteMany({ where: { schoolId: { in: doomedSchoolIds } } });
        const inviteDel = await tx.teacherInvite.deleteMany({ where: { schoolId: { in: doomedSchoolIds } } });
        // 7. School's only remaining RESTRICT was Enrollment.schoolId, cleared in step 3.
        const schoolDel = await tx.school.deleteMany({ where: { id: { in: doomedSchoolIds } } });
        // 8. Every RESTRICT against User was cleared in steps 1, 4 and 5. Scoped to the
        //    id list captured before step 1, so a schoolId nulled by School's SET NULL
        //    cannot widen this, and Super Admin rows are never in it.
        const userDel = await tx.user.deleteMany({ where: { id: { in: doomedUserIds } } });

        return {
          Attendance: attendanceDel.count,
          AttendanceDayMeta: dayMetaDel.count,
          ReadingLevelRecord: readingDel.count,
          AralProfile: aralDel.count,
          Enrollment: enrollmentDel.count,
          Announcement: announcementDel.count,
          Learner: learnerDel.count,
          TeacherSection: teacherSectionDel.count,
          Section: sectionDel.count,
          GradeLevel: gradeLevelDel.count,
          SchoolYear: schoolYearDel.count,
          TeacherInvite: inviteDel.count,
          School: schoolDel.count,
          User: userDel.count,
        };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 20_000 },
    );

    for (const [label, value] of Object.entries(counts)) {
      console.log(`  ${label.padEnd(22)} ${value} deleted`);
    }

    // ---- Phase 5: verify ----------------------------------------------------
    heading("PHASE 5 — VERIFY");
    const leftover = await prisma.school.count({ where: { id: { in: doomedSchoolIds } } });
    if (leftover !== 0) throw new Error(`${leftover} named school(s) still present — aborting.`);
    console.log(`named schools remaining: ${leftover}`);

    const remaining = await prisma.school.count();
    console.log(`schools still in the database: ${remaining} (expected ${survivors.length})`);
    if (remaining !== survivors.length) {
      throw new Error(`school count is ${remaining}, expected ${survivors.length} — investigate.`);
    }

    const superAdminsNow = await prisma.user.count({ where: { schoolId: null } });
    console.log(`User rows with schoolId = null: ${superAdminsNow} (expected ${preservedSuperAdmins})`);
    if (superAdminsNow !== preservedSuperAdmins) {
      throw new Error(
        `schoolId-null users changed from ${preservedSuperAdmins} to ${superAdminsNow} — a delete leaked.`,
      );
    }

    const otherUsersNow = await prisma.user.count({ where: { schoolId: { not: null } } });
    console.log(`User rows still in a school: ${otherUsersNow} (expected ${preservedUsers})`);
    if (otherUsersNow !== preservedUsers) {
      throw new Error(`school-scoped users changed from ${preservedUsers} to ${otherUsersNow} — a delete leaked.`);
    }

    console.log("\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, so the unit test can import parseDeleteCliArgs.
if (process.argv[1] && /delete-schools\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
