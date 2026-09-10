/**
 * READ-ONLY diagnostic: "why can't this school's head sign in?"
 *
 * Cross-checks each School Head row against the Supabase auth user it points at,
 * which is what separates a genuinely broken account (missing auth user, email
 * drift, banned, unconfirmed) from a healthy one that is being refused for some
 * other reason — a rate limit, most likely. See the rate-limit section of
 * docs/runbook.md before concluding a password is wrong.
 *
 * No writes. Usage:
 *   npm run diagnose:login -- salimama kawas
 */
import { schoolHeadSyntheticEmail } from "../src/lib/auth/synthetic-email";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { connectScriptPrisma, loadEnvFile } from "./lib/script-db";

async function main() {
  loadEnvFile();
  const terms = process.argv.slice(2);
  const prisma = await connectScriptPrisma();
  const admin = createSupabaseAdminClient();

  try {
    // ---- global shape ----
    const schools = await prisma.school.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, schoolIdCode: true, isActive: true, isDemo: true },
    });
    const heads = await prisma.user.findMany({
      where: { role: "SCHOOL_HEAD", deletedAt: null },
      select: {
        id: true, schoolId: true, email: true, authId: true, isActive: true,
        passwordIsSchoolId: true, mustChangePassword: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const bySchool = new Map<string, typeof heads>();
    for (const h of heads) {
      if (!h.schoolId) continue;
      const list = bySchool.get(h.schoolId) ?? [];
      list.push(h);
      bySchool.set(h.schoolId, list);
    }

    let noHead = 0, multiHead = 0, emailMismatch = 0, suffixed = 0, placeholderish = 0, notSchoolIdPw = 0;
    const mismatchSamples: string[] = [];
    for (const s of schools) {
      const list = bySchool.get(s.id) ?? [];
      if (list.length === 0) noHead++;
      if (list.length > 1) multiHead++;
      if (/-\d+$/.test(s.schoolIdCode)) suffixed++;
      if (s.schoolIdCode.startsWith("123456")) placeholderish++;
      const expected = schoolHeadSyntheticEmail(s.schoolIdCode).toLowerCase();
      for (const h of list) {
        if (h.email.toLowerCase() !== expected) {
          emailMismatch++;
          if (mismatchSamples.length < 10) mismatchSamples.push(`${s.name} | code=${s.schoolIdCode} | stored=${h.email} | expected=${expected}`);
        }
        if (!h.passwordIsSchoolId) notSchoolIdPw++;
      }
    }

    console.log("=== GLOBAL ===");
    console.log(`schools (live):            ${schools.length}`);
    console.log(`school-head rows (live):   ${heads.length}`);
    console.log(`schools with NO head:      ${noHead}`);
    console.log(`schools with >1 head:      ${multiHead}`);
    console.log(`suffixed schoolIdCode -N:  ${suffixed}`);
    console.log(`placeholder-ish 123456*:   ${placeholderish}`);
    console.log(`stored email != synthetic: ${emailMismatch}`);
    console.log(`heads w/ passwordIsSchoolId=false: ${notSchoolIdPw}`);
    if (mismatchSamples.length) {
      console.log("\nemail-mismatch samples:");
      for (const m of mismatchSamples) console.log("  " + m);
    }

    // ---- targeted ----
    for (const term of terms) {
      console.log(`\n=== MATCH "${term}" ===`);
      const hits = schools.filter((s) => s.name.toLowerCase().includes(term.toLowerCase()));
      if (!hits.length) console.log("  (no school name matches)");
      for (const s of hits) {
        console.log(`\n  ${s.name}`);
        console.log(`    school.id        ${s.id}`);
        console.log(`    schoolIdCode     "${s.schoolIdCode}"  (len ${s.schoolIdCode.length})`);
        console.log(`    isActive         ${s.isActive}   isDemo ${s.isDemo}`);
        console.log(`    expected email   ${schoolHeadSyntheticEmail(s.schoolIdCode)}`);
        const list = bySchool.get(s.id) ?? [];
        console.log(`    head rows        ${list.length}`);
        for (const h of list) {
          console.log(`      - user.id ${h.id}`);
          console.log(`        prisma email        ${h.email}`);
          console.log(`        authId              ${h.authId}`);
          console.log(`        isActive            ${h.isActive}`);
          console.log(`        passwordIsSchoolId  ${h.passwordIsSchoolId}`);
          console.log(`        mustChangePassword  ${h.mustChangePassword}`);
          console.log(`        createdAt           ${h.createdAt.toISOString()}`);
          const { data, error } = await admin.auth.admin.getUserById(h.authId);
          if (error || !data?.user) {
            console.log(`        SUPABASE            *** MISSING (${error?.message ?? "no user"}) ***`);
          } else {
            const u = data.user;
            const same = (u.email ?? "").toLowerCase() === h.email.toLowerCase();
            console.log(`        supabase email      ${u.email}  ${same ? "(matches)" : "*** MISMATCH ***"}`);
            console.log(`        email_confirmed_at  ${u.email_confirmed_at ?? "(null)"}`);
            console.log(`        banned_until        ${(u as unknown as { banned_until?: string }).banned_until ?? "(none)"}`);
            console.log(`        app_metadata        ${JSON.stringify(u.app_metadata)}`);
            console.log(`        last_sign_in_at     ${u.last_sign_in_at ?? "(never)"}`);
            console.log(`        updated_at          ${u.updated_at ?? "?"}`);
          }
        }
        // is another auth user squatting on the expected address?
        const teachers = await prisma.user.count({ where: { schoolId: s.id, role: "TEACHER", deletedAt: null } });
        console.log(`    teacher rows     ${teachers}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
