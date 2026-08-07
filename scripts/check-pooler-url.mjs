// Ad-hoc check for the DATABASE_URL normalization in src/lib/db-url.ts.
// Run: node scripts/check-pooler-url.mjs
function resolve(raw) {
  if (!raw) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.port !== "6543") return raw;
  if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
  const existingLimit = url.searchParams.get("connection_limit");
  if (!existingLimit || existingLimit === "1") {
    url.searchParams.set("connection_limit", "3");
  }
  return url.toString();
}

const PW = "p%40ss-w0rd%21";
const cases = [
  ["bare 6543 pooler", `postgresql://postgres.okmqgbnxdgdqhqjrkuqn:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`],
  ["6543 with existing param", `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`],
  ["6543 raises limit 1→3", `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`],
  ["6543 pgbouncer only", `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`],
  ["5432 session pooler (DIRECT_URL)", `postgresql://postgres.ref:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`],
  ["5432 direct host", `postgresql://postgres:${PW}@db.okmqgbnxdgdqhqjrkuqn.supabase.co:5432/postgres`],
  ["no port", `postgresql://postgres:${PW}@db.example.supabase.co/postgres`],
  ["undefined", undefined],
  ["empty string", ""],
  ["garbage", "not-a-url"],
];

let failures = 0;
for (const [label, input] of cases) {
  const out = resolve(input);
  const is6543 = typeof input === "string" && input.includes(":6543/");
  const okFlag = !is6543 || (out.includes("pgbouncer=true") && out.includes("connection_limit=3"));
  const okUntouched = is6543 || out === input;
  const okPw = typeof out !== "string" || !is6543 || out.includes(PW);
  const okDup = typeof out !== "string" || (out.split("pgbouncer=true").length - 1) <= 1;
  const pass = okFlag && okUntouched && okPw && okDup;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n      -> ${String(out)}`);
}
console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} case(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
