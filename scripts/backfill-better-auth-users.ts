/**
 * Copy Supabase Auth identities into Better Auth's `AuthUser` / `AuthAccount`
 * tables on Neon (docs/better-auth-migration.md section 4).
 *
 *   npx tsx scripts/backfill-better-auth-users.ts            # dry run (default)
 *   npx tsx scripts/backfill-better-auth-users.ts --dry-run  # same
 *   npx tsx scripts/backfill-better-auth-users.ts --apply    # write
 *
 * Connection strings come ONLY from two explicit env vars, never from an env
 * file (this repo has several Supabase/Neon projects in its env files):
 *   SUPABASE_SOURCE_URL  Supabase Postgres (read: auth.users). Read-only session.
 *   NEON_TARGET_URL      Neon Postgres (read "User", write "AuthUser"/"AuthAccount").
 *
 * Safety:
 * - The source session is `default_transaction_read_only = on` and every read
 *   runs inside `BEGIN READ ONLY`. Nothing is ever written to Supabase.
 * - The dry run sets the target session read-only too, so it cannot write.
 * - `--apply` writes every batch (500 rows) inside ONE transaction; any error
 *   rolls the whole run back.
 * - Newer wins: `ON CONFLICT (id) DO UPDATE ... WHERE "updatedAt" < EXCLUDED."updatedAt"`,
 *   so re-running before or after cutover never clobbers a Better Auth-era
 *   password (those are stamped `now()`, newer than any Supabase `updated_at`).
 * - Never prints a URL, a password hash, or an email list. Counts and authIds only.
 *
 * Timestamps: the Auth tables use `timestamp(3)` without time zone holding UTC
 * (Prisma's convention). Both sessions run with `TimeZone = 'UTC'`, values are
 * sent as ISO strings and converted with `AT TIME ZONE 'UTC'`, and `timestamp`
 * values read back are parsed as UTC, so this machine's UTC+8 never shifts them.
 */
import pg from "pg";
import { resolvePgDriverUrl } from "../src/lib/db-url";
import { parseAppMetadataRole } from "../src/lib/auth/roles";
import {
  chunk,
  planAuthBackfill,
  type AuthBackfillPlan,
  type BackfillWrite,
  type ExistingAuthUser,
  type SourceAuthUser,
  type TargetUser,
} from "../src/lib/auth/backfill-plan";

const BATCH_SIZE = 500;
const TIMESTAMP_OID = 1114; // timestamp without time zone

// Read `timestamp` (no zone) as UTC instead of this machine's local zone.
pg.types.setTypeParser(TIMESTAMP_OID, (value: string) => new Date(`${value.replace(" ", "T")}Z`));

type Mode = "dry-run" | "apply";

function parseMode(argv: readonly string[]): Mode {
  const apply = argv.includes("--apply");
  const dry = argv.includes("--dry-run");
  const unknown = argv.filter((a) => a !== "--apply" && a !== "--dry-run");
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(" ")}`);
  if (apply && dry) throw new Error("pass either --dry-run or --apply, not both");
  return apply ? "apply" : "dry-run";
}

function requireEnv(name: "SUPABASE_SOURCE_URL" | "NEON_TARGET_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    throw new Error("a connection string is not a valid URL");
  }
}

async function connect(label: string, raw: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: resolvePgDriverUrl(raw) ?? raw });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  console.log(`connected: ${label}`);
  return client;
}

async function readSource(source: pg.Client): Promise<SourceAuthUser[]> {
  await source.query("SET default_transaction_read_only = on");
  await source.query("BEGIN TRANSACTION READ ONLY");
  try {
    const res = await source.query<{
      id: string;
      email: string | null;
      encrypted_password: string;
      email_confirmed: boolean;
      created_at: Date;
      updated_at: Date | null;
    }>(
      `select id::text as id,
              lower(email) as email,
              encrypted_password,
              (email_confirmed_at is not null) as email_confirmed,
              created_at,
              updated_at
         from auth.users
        where encrypted_password like '$2%'`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      email: r.email,
      passwordHash: r.encrypted_password,
      emailConfirmed: r.email_confirmed,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
    }));
  } finally {
    await source.query("ROLLBACK");
  }
}

async function authTablesExist(target: pg.Client): Promise<boolean> {
  const res = await target.query<{ u: string | null; a: string | null }>(
    `select to_regclass('public."AuthUser"')::text as u, to_regclass('public."AuthAccount"')::text as a`,
  );
  return res.rows[0]?.u != null && res.rows[0]?.a != null;
}

async function readTarget(
  target: pg.Client,
  tablesExist: boolean,
): Promise<{ users: TargetUser[]; existing: ExistingAuthUser[] }> {
  const usersRes = await target.query<{
    authId: string;
    email: string;
    role: string;
    deletedAt: Date | null;
  }>(`select "authId", email, role::text as role, "deletedAt" from "User"`);

  const users: TargetUser[] = usersRes.rows.map((r) => {
    const role = parseAppMetadataRole(r.role);
    if (!role) throw new Error(`User with authId ${r.authId} has an unknown role`);
    return { authId: r.authId, email: r.email, role, deletedAt: r.deletedAt };
  });

  if (!tablesExist) return { users, existing: [] };
  const existingRes = await target.query<{ id: string; updatedAt: Date }>(
    `select id, "updatedAt" from "AuthUser"`,
  );
  return { users, existing: existingRes.rows };
}

function iso(d: Date): string {
  return d.toISOString();
}

async function writeBatch(target: pg.Client, batch: readonly BackfillWrite[]): Promise<{ users: number; accounts: number }> {
  const u = batch.map((w) => w.user);
  const userRes = await target.query(
    `insert into "AuthUser" (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
     select x.id, x.name, x.email, x.ev, x.role, x.banned,
            x.created_at at time zone 'UTC', x.updated_at at time zone 'UTC'
       from unnest($1::text[], $2::text[], $3::text[], $4::bool[], $5::text[], $6::bool[],
                   $7::timestamptz[], $8::timestamptz[])
            as x(id, name, email, ev, role, banned, created_at, updated_at)
     on conflict (id) do update
        set email = excluded.email,
            "emailVerified" = excluded."emailVerified",
            role = excluded.role,
            "updatedAt" = excluded."updatedAt"
      where "AuthUser"."updatedAt" < excluded."updatedAt"`,
    [
      u.map((r) => r.id),
      u.map((r) => r.name),
      u.map((r) => r.email),
      u.map((r) => r.emailVerified),
      u.map((r) => r.role),
      u.map((r) => r.banned),
      u.map((r) => iso(r.createdAt)),
      u.map((r) => iso(r.updatedAt)),
    ],
  );

  const a = batch.map((w) => w.account);
  const accountRes = await target.query(
    `insert into "AuthAccount" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     select x.id, x.account_id, x.provider_id, x.user_id, x.password,
            x.created_at at time zone 'UTC', x.updated_at at time zone 'UTC'
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                   $6::timestamptz[], $7::timestamptz[])
            as x(id, account_id, provider_id, user_id, password, created_at, updated_at)
     on conflict (id) do update
        set password = excluded.password,
            "updatedAt" = excluded."updatedAt"
      where "AuthAccount"."updatedAt" < excluded."updatedAt"`,
    [
      a.map((r) => r.id),
      a.map((r) => r.accountId),
      a.map((r) => r.providerId),
      a.map((r) => r.userId),
      a.map((r) => r.password),
      a.map((r) => iso(r.createdAt)),
      a.map((r) => iso(r.updatedAt)),
    ],
  );

  return { users: userRes.rowCount ?? 0, accounts: accountRes.rowCount ?? 0 };
}

const VERIFY_QUERIES: { label: string; expect: string; sql: string }[] = [
  {
    label: "live Users with no AuthUser",
    expect: "0",
    sql: `select count(*)::int as n from "User" u
           where u."deletedAt" is null
             and not exists (select 1 from "AuthUser" a where a.id = u."authId")`,
  },
  {
    label: "email or role mismatches",
    expect: "0",
    sql: `select count(*)::int as n from "User" u
            join "AuthUser" a on a.id = u."authId"
           where a.email <> u.email or a.role is distinct from u.role::text`,
  },
  {
    label: "AuthUsers with no bcrypt credential",
    expect: "0",
    sql: `select count(*)::int as n from "AuthUser" a
           where not exists (
             select 1 from "AuthAccount" c
              where c."userId" = a.id and c."providerId" = 'credential'
                and c.password like '$2_$%')`,
  },
  {
    label: "AuthUser total",
    expect: "live Users + sign-ups since",
    sql: `select count(*)::int as n from "AuthUser"`,
  },
];

async function verify(target: pg.Client, plan: AuthBackfillPlan, mode: "dry-run" | "apply"): Promise<void> {
  console.log("\nverification (Neon):");
  const results: number[] = [];
  for (const q of VERIFY_QUERIES) {
    const res = await target.query<{ n: number }>(q.sql);
    const n = res.rows[0]?.n ?? 0;
    results.push(n);
    console.log(`  ${q.label}: ${n}  [expected ${q.expect}]`);
    if (q.expect === "0" && n !== 0) {
      // A dry run has not written anything, so the target is expected to be
      // behind; only a real apply must end clean.
      console.log(`  MISMATCH: ${q.label} is ${n}, expected 0`);
      if (mode === "apply") process.exitCode = 1;
    }
  }
  const live = await target.query<{ n: number }>(
    `select count(*)::int as n from "User" where "deletedAt" is null`,
  );
  const linked = plan.counts.source - plan.counts.orphans - plan.counts.nonBcrypt;
  console.log(
    `parity: source bcrypt auth users=${plan.counts.source}, linked to a User=${linked}, ` +
      `orphans=${plan.counts.orphans}, target AuthUser=${results[3]}, live Users=${live.rows[0]?.n ?? 0}`,
  );
}

function printPlan(plan: AuthBackfillPlan): void {
  const c = plan.counts;
  console.log("\nplan:");
  console.log(`  source auth users (bcrypt): ${c.source}`);
  console.log(`  target Users:               ${c.targetUsers}`);
  console.log(`  create:                     ${c.create}`);
  console.log(`  update (source newer):      ${c.update}`);
  console.log(`  unchanged:                  ${c.unchanged}`);
  console.log(`  orphans (no User row):      ${c.orphans}`);
  console.log(`  live-without-auth:          ${c.liveWithoutAuth}`);
  console.log(`  deleted-without-auth:       ${c.deletedWithoutAuth}`);
  console.log(`  deleted-with-auth:          ${c.deletedWithAuth}`);
  console.log(`  email mismatches (User wins): ${c.emailMismatches}`);
  console.log(`  non-bcrypt (skipped):       ${c.nonBcrypt}`);
  console.log(`  duplicate planned emails:   ${plan.duplicateEmails.length}`);
  if (plan.orphanIds.length > 0) console.log(`  orphan authIds: ${plan.orphanIds.join(", ")}`);
  if (plan.liveWithoutAuthIds.length > 0) {
    console.log(`  live-without-auth authIds: ${plan.liveWithoutAuthIds.join(", ")}`);
  }
  if (plan.emailMismatchIds.length > 0) {
    console.log(`  email-mismatch authIds: ${plan.emailMismatchIds.join(", ")}`);
  }
  if (plan.nonBcryptIds.length > 0) console.log(`  non-bcrypt authIds: ${plan.nonBcryptIds.join(", ")}`);
}

function firstLine(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const sourceUrl = requireEnv("SUPABASE_SOURCE_URL");
  const targetUrl = requireEnv("NEON_TARGET_URL");
  if (hostOf(sourceUrl) === hostOf(targetUrl)) {
    throw new Error("SUPABASE_SOURCE_URL and NEON_TARGET_URL point at the same host");
  }
  console.log(`mode: ${mode}`);

  const source = await connect("source (SUPABASE_SOURCE_URL, read-only)", sourceUrl);
  let target: pg.Client | null = null;
  try {
    const sourceRows = await readSource(source);
    await source.end();

    target = await connect(`target (NEON_TARGET_URL${mode === "dry-run" ? ", read-only" : ""})`, targetUrl);
    if (mode === "dry-run") await target.query("SET default_transaction_read_only = on");

    const tablesExist = await authTablesExist(target);
    if (!tablesExist) {
      if (mode === "apply") {
        throw new Error('"AuthUser"/"AuthAccount" do not exist on the target; apply migration 20261004000001 first');
      }
      console.log('note: "AuthUser"/"AuthAccount" do not exist on the target yet; planning against an empty table');
    }

    const { users, existing } = await readTarget(target, tablesExist);
    const plan = planAuthBackfill(sourceRows, users, existing);
    printPlan(plan);

    if (mode === "dry-run") {
      console.log("\ndry run: wrote 0 rows. Re-run with --apply to write.");
      if (tablesExist) await verify(target, plan, "dry-run");
      return;
    }

    if (plan.duplicateEmails.length > 0) {
      throw new Error(`refusing to apply: ${plan.duplicateEmails.length} email(s) would be shared by two AuthUsers`);
    }

    let writtenUsers = 0;
    let writtenAccounts = 0;
    const batches = chunk(plan.writes, BATCH_SIZE);
    await target.query("BEGIN");
    try {
      for (const [i, batch] of batches.entries()) {
        const n = await writeBatch(target, batch);
        writtenUsers += n.users;
        writtenAccounts += n.accounts;
        console.log(`  batch ${i + 1}/${batches.length}: AuthUser ${n.users}, AuthAccount ${n.accounts}`);
      }
      await target.query("COMMIT");
    } catch (err) {
      await target.query("ROLLBACK").catch(() => {});
      throw err;
    }
    console.log(`\napplied: AuthUser rows written=${writtenUsers}, AuthAccount rows written=${writtenAccounts}`);
    await verify(target, plan, "apply");
  } finally {
    await source.end().catch(() => {});
    if (target) await target.end().catch(() => {});
  }
}

main().catch((err: unknown) => {
  console.error(`backfill failed: ${firstLine(err)}`);
  process.exitCode = 1;
});
