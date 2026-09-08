/**
 * Proves the Postgres litrack_format_person_name() agrees with the TypeScript
 * formatPersonName() on every case the unit tests cover, plus the live data.
 * A disagreement means a backfilled row differs from what the app would store
 * on the next save — the exact split-brain this change set removes.
 *
 *   npx tsx scripts/data-uniformity-parity.ts
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { formatPersonName } from "../src/lib/names";
import { canonicalPhPhone, isValidPhPhone } from "../src/lib/validators/phone";

const NEWLINE = String.fromCharCode(10);
for (const line of fs.readFileSync(".env.local", "utf8").split(NEWLINE)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const CASES = [
  "  ANA   marie ",
  "juan dela cruz",
  "MARIA DELOS SANTOS",
  "de guzman",
  "MARY-JANE",
  "o'brien",
  "D'SOUZA",
  "ma’am-test",
  "jose rizal iii",
  "santos iv",
  "cruz III.",
  "vi",
  "di",
  "juan santos jr.",
  "JUAN SANTOS SR",
  "MCDONALD",
  "macario",
  "d.",
  "juan.cruz",
  "JUAN   CARLOS",
  "MCES SCHOOL PRINCIPAL",
];

async function main() {
  let mismatches = 0;

  console.log(NEWLINE + "=== formatPersonName parity: TypeScript vs Postgres ===");
  for (const input of CASES) {
    const rows: Array<{ out: string }> = await prisma.$queryRawUnsafe(
      "SELECT litrack_format_person_name($1) AS out",
      input
    );
    const sql = rows[0].out;
    const ts = formatPersonName(input);
    const ok = sql === ts;
    if (!ok) mismatches++;
    console.log(
      (ok ? "  ok   " : "  DIFF ") +
        JSON.stringify(input) +
        "  ts=" + JSON.stringify(ts) +
        "  sql=" + JSON.stringify(sql)
    );
  }

  console.log(NEWLINE + "=== canonicalPhPhone parity ===");
  for (const input of ["0917 123 4567", "+639171234567", "639171234567", "(082) 234-5678", "0322345678"]) {
    const rows: Array<{ out: string }> = await prisma.$queryRawUnsafe(
      "SELECT litrack_canonical_ph_phone($1) AS out",
      input
    );
    const sql = rows[0].out;
    const ts = isValidPhPhone(input) ? canonicalPhPhone(input) : input;
    const ok = sql === ts;
    if (!ok) mismatches++;
    console.log(
      (ok ? "  ok   " : "  DIFF ") + JSON.stringify(input) + "  ts=" + ts + "  sql=" + sql
    );
  }

  console.log(NEWLINE + "=== Live rows: does the app agree with what is stored? ===");
  const learners = await prisma.learner.findMany({
    select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
  });
  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, middleName: true, lastName: true, fullName: true },
  });

  let drift = 0;
  for (const r of [...learners, ...users]) {
    const wantFirst = formatPersonName(r.firstName);
    const wantLast = formatPersonName(r.lastName);
    const wantMiddle = r.middleName ? formatPersonName(r.middleName) : r.middleName;
    if (r.firstName !== wantFirst || r.lastName !== wantLast || r.middleName !== wantMiddle) {
      drift++;
      console.log(
        "  DRIFT " + r.id + "  stored=" + [r.firstName, r.middleName, r.lastName].join("|") +
          "  app would store=" + [wantFirst, wantMiddle, wantLast].join("|")
      );
    }
  }
  console.log(
    "  " + (learners.length + users.length) + " rows checked, " + drift + " would change on next save"
  );

  console.log(
    NEWLINE +
      ">>> " +
      (mismatches === 0 && drift === 0
        ? "PARITY OK — SQL, TypeScript and stored data all agree"
        : "MISMATCHES: " + mismatches + " rule diffs, " + drift + " drifting rows")
  );
  if (mismatches > 0 || drift > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
