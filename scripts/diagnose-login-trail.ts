/**
 * READ-ONLY: the LOGIN_* audit trail for named schools, plus global tallies.
 *
 * Reads the story the app itself recorded. A school that signed in successfully
 * and then started failing, with no PASSWORD_CHANGE row in between, did not
 * forget its password — check the `reason` on the LOGIN_DENIED rows
 * (`rate_limited` vs `incorrect_credentials`) and the global tallies for other
 * schools failing in the same minutes. Rows written before 2026-09-10 always say
 * `incorrect_credentials`; that field could not tell the two apart yet.
 *
 * No writes. Usage:
 *   npm run diagnose:login-trail -- salimama kawas
 */
import { connectScriptPrisma, loadEnvFile } from "./lib/script-db";

async function main() {
  loadEnvFile();
  const terms = process.argv.slice(2);
  const prisma = await connectScriptPrisma();
  try {
    const schools = await prisma.school.findMany({
      where: { deletedAt: null, OR: terms.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) },
      select: { id: true, name: true, schoolIdCode: true },
    });
    for (const s of schools) {
      console.log(`\n===== ${s.name} (${s.schoolIdCode}) =====`);
      const rows = await prisma.auditLog.findMany({
        where: { schoolId: s.id },
        select: { action: true, timestamp: true, userId: true, resourceId: true, metadata: true },
        orderBy: { timestamp: "desc" },
        take: 40,
      });
      if (!rows.length) console.log("  (no audit rows)");
      for (const r of rows) {
        console.log(`  ${r.timestamp.toISOString()}  ${r.action.padEnd(34)} ${JSON.stringify(r.metadata)}`);
      }
    }

    console.log("\n===== GLOBAL login action tallies (last 7 days) =====");
    const since = new Date(Date.now() - 7 * 864e5);
    const tally = await prisma.auditLog.groupBy({
      by: ["action"],
      where: { timestamp: { gte: since }, action: { contains: "LOGIN" } },
      _count: { _all: true },
    });
    for (const t of tally) console.log(`  ${t.action.padEnd(34)} ${t._count._all}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
