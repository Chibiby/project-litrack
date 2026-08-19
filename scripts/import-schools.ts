/**
 * Replace the School table from the DepEd roster workbook.
 *
 * Usage:
 *   npx tsx scripts/import-schools.ts --file "path/to/roster.xlsx"            # dry run (default)
 *   npx tsx scripts/import-schools.ts --file "..." --commit                   # import, no wipe
 *   npx tsx scripts/import-schools.ts --file "..." --commit --wipe \
 *       --i-understand-this-deletes-all-data                                  # replace everything
 *
 * Optional:
 *   --out <path>          write a schoolIdCode -> synthetic email CSV for ops
 *   --allow-row-errors    skip malformed rows instead of aborting
 *
 * Requires DIRECT_URL (preferred) or DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, read from the shell or from `.env.local`.
 *
 * WIPING IS IRREVERSIBLE. The wipe does NOT rely on cascade. Several FKs in
 * this subtree are ON DELETE RESTRICT, not CASCADE (verified against
 * prisma/migrations/*​/migration.sql, not just schema.prisma, since Prisma
 * omits an explicit onDelete when it matches the connector default and that
 * default differs by relation optionality):
 *
 *   Enrollment.schoolId, .gradeLevelId, .schoolYearId  -> RESTRICT
 *   Learner.gradeLevelId, .teacherId                   -> RESTRICT
 *   Announcement.authorId                              -> RESTRICT
 *   Attendance.recordedById                            -> RESTRICT
 *   AttendanceDayMeta.recordedById                      -> RESTRICT
 *   ReadingLevelRecord.recordedById                     -> RESTRICT
 *
 * A bare `prisma.school.deleteMany({})` throws the moment any Enrollment row
 * exists, and RESTRICT is checked immediately per-constraint — Postgres does
 * not wait for some other FK's cascade to clear it first, so even where
 * relying on cascade might happen to work, it would depend on trigger firing
 * order. So the wipe below deletes every table in this subtree explicitly,
 * children first, in one `$transaction`, in the order that satisfies every
 * RESTRICT above (see the inline comments on each step). `User.schoolId` is a
 * further special case: that FK is `ON DELETE SET NULL`, not cascade — deleting
 * School alone would merely orphan school-scoped User rows with schoolId
 * nulled, making them indistinguishable from Super Admin accounts. So User
 * rows are deleted explicitly too, by id captured before anything else runs.
 * Super Admin rows (schoolId = null) are never touched.
 */
import { writeFileSync } from "node:fs";
import { parseSchoolRoster } from "../src/lib/import/school-roster";
import { assignSchoolCredentials, type CredentialAssignment } from "../src/lib/import/school-credentials";
import { schoolHeadSyntheticEmail } from "../src/lib/auth/synthetic-email";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { connectScriptPrisma, loadEnvFile } from "./lib/script-db";

export type CliOptions = {
  file: string;
  commit: boolean;
  wipe: boolean;
  allowRowErrors: boolean;
  out?: string;
};

const ACK_FLAG = "--i-understand-this-deletes-all-data";
/** The Supabase admin API is rate-sensitive and the roster is in the hundreds. */
const CONCURRENCY = 5;

export function parseCliArgs(argv: string[]): CliOptions {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = valueOf("--file");
  if (!file) throw new Error("Pass the workbook path with --file <path>");

  const wipeFlag = argv.includes("--wipe");
  const ackFlag = argv.includes(ACK_FLAG);
  if (wipeFlag && !ackFlag) throw new Error(`--wipe also requires ${ACK_FLAG}`);
  if (ackFlag && !wipeFlag) throw new Error(`${ACK_FLAG} is only meaningful together with --wipe`);

  return {
    file,
    commit: argv.includes("--commit"),
    wipe: wipeFlag && ackFlag,
    allowRowErrors: argv.includes("--allow-row-errors"),
    out: valueOf("--out"),
  };
}

function heading(text: string): void {
  console.log(`\n${"=".repeat(70)}\n${text}\n${"=".repeat(70)}`);
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
  const opts = parseCliArgs(process.argv.slice(2));
  const envKeys = loadEnvFile();
  if (envKeys.length) console.log(`loaded .env.local (${envKeys.length} keys, values not printed)`);
  const prisma = await connectScriptPrisma();

  try {
    // ---- Phase 1: parse & report -------------------------------------------
    heading("PHASE 1 — PARSE & REPORT");
    const parsed = await parseSchoolRoster(opts.file);
    console.log(`header row: ${parsed.headerRow}`);
    console.log(`school rows: ${parsed.rows.length}`);
    console.log(`skipped (blank / banner / note rows): ${parsed.skipped}`);
    console.log(`\ndistricts (${parsed.districts.length}):`);
    for (const d of parsed.districts) console.log(`  ${String(d.count).padStart(4)}  ${d.name}`);

    if (parsed.errors.length) {
      console.log(`\nROW ERRORS (${parsed.errors.length}):`);
      for (const e of parsed.errors) console.log(`  row ${e.sourceRow}: ${e.field} — ${e.message} (${e.value})`);
      if (!opts.allowRowErrors) {
        console.error("\nRefusing to continue. Fix the sheet, or pass --allow-row-errors to skip these rows.");
        process.exitCode = 1;
        return;
      }
      console.log("--allow-row-errors set: the rows above are skipped.");
    }

    if (parsed.duplicateNames.length) {
      console.error(`\nDUPLICATE SCHOOL NAMES (${parsed.duplicateNames.length}) — School.name is @unique:`);
      for (const d of parsed.duplicateNames) console.error(`  "${d.value}" at rows ${d.sourceRows.join(", ")}`);
      console.error("\nRefusing to continue. Duplicate names need an owner decision, not a default.");
      process.exitCode = 1;
      return;
    }

    const { assignments, conflicts } = assignSchoolCredentials(parsed.rows);

    if (conflicts.length) {
      console.error(`\nUNRESOLVABLE CODE CONFLICTS (${conflicts.length}):`);
      for (const c of conflicts) console.error(`  "${c.value}" at rows ${c.sourceRows.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    // R9 forbids logging a password. These values are printed as School ID
    // identifiers — which is what they are on the sheet — and never labelled
    // as credentials, so the operator can audit the remap without the log
    // becoming a secret.
    const deviations = assignments.filter((a) => a.suffixed || a.placeholder);
    if (deviations.length) {
      console.log(`\nDEVIATIONS FROM THE PRINTED SHEET (${deviations.length}):`);
      console.log("  row   sheet ID   stored code    school");
      for (const a of deviations) {
        console.log(
          `  ${String(a.sourceRow).padStart(4)}  ${a.password.padEnd(9)}  ${a.schoolIdCode.padEnd(13)}  ${a.name}`
        );
      }
    }
    if (parsed.missingIds.length) {
      console.log(`\nNOTE: ${parsed.missingIds.length} school(s) had no usable School ID and received a shared`);
      console.log("placeholder. That credential is weak; `mustChangePassword` forces replacement at first sign-in.");
      for (const m of parsed.missingIds) console.log(`  row ${m.sourceRow}: "${m.rawValue}" — ${m.name}`);
    }

    // ---- Phase 2: inventory (blast radius) ---------------------------------
    // Mirrors every table the Phase 4 wipe actually deletes (see that phase's
    // header comment for the full RESTRICT/CASCADE audit) — an operator making
    // an irreversible decision should see the true blast radius, not a subset.
    heading("PHASE 2 — INVENTORY (what a wipe would destroy)");
    const [
      schools,
      gradeLevels,
      sections,
      schoolYears,
      learners,
      enrollments,
      attendance,
      attendanceDayMeta,
      readingLevels,
      aralProfiles,
      announcements,
      teacherInvites,
      teacherSections,
      schoolUsers,
    ] = await Promise.all([
      prisma.school.count(),
      prisma.gradeLevel.count(),
      prisma.section.count(),
      prisma.schoolYear.count(),
      prisma.learner.count(),
      prisma.enrollment.count(),
      prisma.attendance.count(),
      prisma.attendanceDayMeta.count(),
      prisma.readingLevelRecord.count(),
      prisma.aralProfile.count(),
      prisma.announcement.count(),
      prisma.teacherInvite.count(),
      prisma.teacherSection.count(),
      prisma.user.count({ where: { schoolId: { not: null } } }),
    ]);
    const superAdmins = await prisma.user.count({ where: { schoolId: null } });
    const byRole = await prisma.user.groupBy({
      by: ["role"],
      where: { schoolId: { not: null } },
      _count: { _all: true },
    });

    console.log(`  School              ${schools}`);
    console.log(`  GradeLevel          ${gradeLevels}`);
    console.log(`  Section             ${sections}`);
    console.log(`  SchoolYear          ${schoolYears}`);
    console.log(`  Learner             ${learners}`);
    console.log(`  Enrollment          ${enrollments}`);
    console.log(`  Attendance          ${attendance}`);
    console.log(`  AttendanceDayMeta   ${attendanceDayMeta}`);
    console.log(`  ReadingLevelRecord  ${readingLevels}`);
    console.log(`  AralProfile         ${aralProfiles}`);
    console.log(`  Announcement        ${announcements}`);
    console.log(`  TeacherInvite       ${teacherInvites}`);
    console.log(`  TeacherSection      ${teacherSections}`);
    console.log(`  User (school-scoped) ${schoolUsers}`);
    for (const r of byRole) console.log(`    ${r.role.padEnd(16)} ${r._count._all}`);
    console.log(`  Supabase auth users to delete: ${schoolUsers}`);
    console.log(`\n  PRESERVED — User with schoolId = null (Super Admin): ${superAdmins}`);
    console.log("  PRESERVED — AuditLog (no FK to User/School; history outlives the subjects it references)");

    // ---- Phase 3: plan & gate ----------------------------------------------
    heading("PHASE 3 — PLAN");
    console.log(`  ${assignments.length} schools to create`);
    console.log(`  ${opts.wipe ? schools : 0} schools to destroy`);

    if (!opts.commit) {
      console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
      return;
    }

    const supabaseAdmin = createSupabaseAdminClient();

    // ---- Phase 4: wipe ------------------------------------------------------
    if (opts.wipe) {
      heading("PHASE 4 — WIPE");
      const doomed = await prisma.user.findMany({
        where: { schoolId: { not: null } },
        select: { id: true, authId: true },
      });
      console.log(`deleting ${doomed.length} Supabase auth users…`);
      let authDeleted = 0;
      const authFailures: { authId: string; message: string }[] = [];
      await inParallel(doomed, CONCURRENCY, async (u) => {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(u.authId);
        // Already gone is success for our purposes — the goal is "no orphan".
        if (error && !/not found/i.test(error.message)) {
          authFailures.push({ authId: u.authId, message: error.message });
        } else {
          authDeleted += 1;
        }
      });
      console.log(`auth users deleted (or already absent): ${authDeleted}`);

      // A genuine (non "not found") Auth deletion failure means that identity is
      // still live. Deleting its Prisma row anyway would orphan it the OTHER
      // direction — a working login with no matching User/School. Abort instead
      // of racing ahead; the operator re-runs once Supabase is healthy.
      if (authFailures.length) {
        for (const f of authFailures) console.error(`  auth user ${f.authId}: ${f.message}`);
        throw new Error(
          `${authFailures.length} Supabase auth user(s) failed to delete — aborting before touching Prisma rows.`
        );
      }

      // Explicit topological delete, children first. Global deleteMany({}) is
      // correct on every table below (this is a total wipe, not a per-school
      // one) except User, which must exclude Super Admin rows — hence the
      // `doomed` id list captured above, before anything else ran. Reordering
      // this array will break it: several steps exist solely to clear an
      // ON DELETE RESTRICT that a later step's target is subject to, and
      // RESTRICT is checked immediately per-constraint — Postgres does not
      // wait for some other FK's cascade to finish first, so leaving this to
      // cascade is not an option.
      //
      // SchoolHeadProfile, TeacherProfile, and the "_TeacherGrades" join table
      // all cascade cleanly from User (ON DELETE CASCADE) — deleting User last
      // in this list disposes of them automatically; they need no step of
      // their own. AuditLog is never touched: it has no FK to User or School
      // (deliberately, so audit history outlives the subjects it references).
      const [
        removedAttendance,
        removedAttendanceDayMeta,
        removedReadingLevels,
        removedAralProfiles,
        removedEnrollments,
        removedAnnouncements,
        removedLearners,
        removedTeacherSections,
        removedSections,
        removedGradeLevels,
        removedSchoolYears,
        removedTeacherInvites,
        removedSchools,
        removedUsers,
      ] = await prisma.$transaction([
        // 1. Attendance/AttendanceDayMeta/ReadingLevelRecord.recordedById -> User
        //    is ON DELETE RESTRICT. Must be gone before step 8 (User).
        prisma.attendance.deleteMany({}),
        prisma.attendanceDayMeta.deleteMany({}),
        prisma.readingLevelRecord.deleteMany({}),
        // 2. AralProfile.learnerId -> Learner is CASCADE (no RESTRICT to clear),
        //    deleted explicitly here anyway for a fully accounted-for wipe.
        prisma.aralProfile.deleteMany({}),
        // 3. Enrollment.schoolId / .gradeLevelId / .schoolYearId -> School /
        //    GradeLevel / SchoolYear are ON DELETE RESTRICT. Must be gone
        //    before step 6 (GradeLevel, SchoolYear) and step 7 (School).
        prisma.enrollment.deleteMany({}),
        // 4. Announcement.authorId -> User is ON DELETE RESTRICT. Must be gone
        //    before step 8 (User).
        prisma.announcement.deleteMany({}),
        // 5. Learner.gradeLevelId -> GradeLevel and Learner.teacherId -> User
        //    are both ON DELETE RESTRICT. Must be gone before step 6
        //    (GradeLevel) and step 8 (User). Nothing RESTRICTs deleting
        //    Learner itself, and everything that referenced it (Enrollment,
        //    AralProfile, Attendance, ReadingLevelRecord — all CASCADE from
        //    Learner) is already gone from steps 1-3, so this is safe now.
        prisma.learner.deleteMany({}),
        // 6. No RESTRICT among these five, or pointing at them, once steps 1-5
        //    have run (TeacherSection/Section/GradeLevel/SchoolYear/TeacherInvite
        //    all reference School with CASCADE, which is moot since they're
        //    deleted explicitly here before School in step 7 anyway).
        prisma.teacherSection.deleteMany({}),
        prisma.section.deleteMany({}),
        prisma.gradeLevel.deleteMany({}),
        prisma.schoolYear.deleteMany({}),
        prisma.teacherInvite.deleteMany({}),
        // 7. Only remaining RESTRICT on School was Enrollment.schoolId,
        //    cleared in step 3.
        prisma.school.deleteMany({}),
        // 8. Every RESTRICT against User (Learner.teacherId, Announcement.authorId,
        //    Attendance/AttendanceDayMeta/ReadingLevelRecord.recordedById) was
        //    cleared in steps 1, 4, and 5. Scoped to the pre-captured id list so
        //    Super Admin rows (schoolId = null) are never touched.
        prisma.user.deleteMany({ where: { id: { in: doomed.map((u) => u.id) } } }),
      ]);
      console.log(`Attendance rows deleted: ${removedAttendance.count}`);
      console.log(`AttendanceDayMeta rows deleted: ${removedAttendanceDayMeta.count}`);
      console.log(`ReadingLevelRecord rows deleted: ${removedReadingLevels.count}`);
      console.log(`AralProfile rows deleted: ${removedAralProfiles.count}`);
      console.log(`Enrollment rows deleted: ${removedEnrollments.count}`);
      console.log(`Announcement rows deleted: ${removedAnnouncements.count}`);
      console.log(`Learner rows deleted: ${removedLearners.count}`);
      console.log(`TeacherSection rows deleted: ${removedTeacherSections.count}`);
      console.log(`Section rows deleted: ${removedSections.count}`);
      console.log(`GradeLevel rows deleted: ${removedGradeLevels.count}`);
      console.log(`SchoolYear rows deleted: ${removedSchoolYears.count}`);
      console.log(`TeacherInvite rows deleted: ${removedTeacherInvites.count}`);
      console.log(`School rows deleted: ${removedSchools.count}`);
      console.log(`User rows deleted: ${removedUsers.count} (schoolId is ON DELETE SET NULL, so deleted explicitly)`);

      const survivors = await prisma.user.count({ where: { schoolId: null } });
      console.log(`Super Admin rows still present: ${survivors}`);
      if (survivors !== superAdmins) {
        throw new Error(`Super Admin rows changed from ${superAdmins} to ${survivors} — aborting.`);
      }
    }

    // ---- Phase 5: create ----------------------------------------------------
    heading("PHASE 5 — CREATE");
    const failures: { sourceRow: number; name: string; message: string }[] = [];
    const created: { schoolIdCode: string; email: string; name: string }[] = [];

    // Fetched once rather than per row: listUsers is paginated and rate-sensitive.
    const knownAuth = new Map<string, string>();
    for (let page = 1; ; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      for (const u of data.users) {
        if (u.email) knownAuth.set(u.email.toLowerCase(), u.id);
      }
      if (data.users.length < 1000) break;
    }

    const createOne = async (a: CredentialAssignment): Promise<void> => {
      const email = schoolHeadSyntheticEmail(a.schoolIdCode);
      try {
        const existingSchool = await prisma.school.findFirst({
          where: { OR: [{ schoolIdCode: a.schoolIdCode }, { name: a.name }] },
          select: { id: true },
        });
        if (existingSchool) {
          console.log(`  = row ${a.sourceRow}: ${a.name} already present — skipped`);
          return;
        }

        // Resumable: reuse an auth identity left behind by a half-finished run.
        let authId = knownAuth.get(email.toLowerCase());
        if (authId) {
          const { error } = await supabaseAdmin.auth.admin.updateUserById(authId, {
            password: a.password,
            app_metadata: { role: "SCHOOL_HEAD" },
          });
          if (error) throw new Error(`password reset failed: ${error.message}`);
        } else {
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: a.password,
            email_confirm: true,
            app_metadata: { role: "SCHOOL_HEAD" },
            user_metadata: { role: "SCHOOL_HEAD" },
          });
          // A password-policy rejection must surface verbatim, not as a generic error.
          if (error || !data.user) throw new Error(error?.message ?? "auth user creation returned no user");
          authId = data.user.id;
        }

        const school = await prisma.$transaction(async (tx) => {
          const s = await tx.school.create({
            data: {
              name: a.name,
              schoolIdCode: a.schoolIdCode,
              address: a.address,
              region: a.region,
              division: a.division,
              district: a.district,
            },
          });
          await tx.user.create({
            data: {
              authId: authId!,
              email,
              role: "SCHOOL_HEAD",
              schoolId: s.id,
              firstName: "",
              lastName: "",
              fullName: s.name,
              isActive: true,
              mustChangePassword: true,
              profileCompleted: false,
            },
          });
          return s;
        });

        created.push({ schoolIdCode: a.schoolIdCode, email, name: a.name });

        // Best-effort metadata sync (schoolId is a mirror for ops convenience, not
        // authoritative — middleware's `enforceRolePrefix` checks only the `role`
        // claim, see src/lib/auth/roles.ts). Matches createSchool's own precedent
        // in src/lib/actions/school.ts, which doesn't check this call's error either.
        // Never let it flip a successfully-created School+User row into "failed":
        // that would make it permanently unretriable, since a resumed run's
        // `existingSchool` lookup above would find it and skip it forever.
        const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(authId!, {
          app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
        });
        if (metaErr) {
          console.warn(`  warn: row ${a.sourceRow} (${a.name}) created, but app_metadata sync failed: ${metaErr.message}`);
        }
      } catch (err) {
        failures.push({
          sourceRow: a.sourceRow,
          name: a.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await inParallel(assignments, CONCURRENCY, createOne);

    // ---- Phase 6: report ----------------------------------------------------
    heading("PHASE 6 — REPORT");
    console.log(`created: ${created.length}`);
    console.log(`skipped (already present): ${assignments.length - created.length - failures.length}`);
    console.log(`failed:  ${failures.length}`);
    for (const f of failures) console.error(`  row ${f.sourceRow} — ${f.name}: ${f.message}`);

    if (opts.out) {
      const csv = ["schoolIdCode,syntheticEmail,schoolName"]
        .concat(created.map((c) => `${c.schoolIdCode},${c.email},"${c.name.replace(/"/g, '""')}"`))
        .join("\n");
      writeFileSync(opts.out, `${csv}\n`, "utf8");
      console.log(`\nwrote ${opts.out} (no passwords — identifiers only)`);
    }

    if (failures.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, so the unit test can import parseCliArgs.
if (process.argv[1] && /import-schools\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
