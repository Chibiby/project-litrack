/**
 * Copy avatar objects from the public Supabase Storage bucket `avatars` to the
 * Cloudflare R2 bucket (docs/better-auth-migration.md section 5). Idempotent.
 *
 *   npx tsx scripts/copy-avatars-to-r2.ts                    # dry run (default)
 *   npx tsx scripts/copy-avatars-to-r2.ts --dry-run          # same
 *   npx tsx scripts/copy-avatars-to-r2.ts --apply            # copy
 *   ... --source-base https://<ref>.supabase.co              # instead of NEXT_PUBLIC_SUPABASE_URL
 *
 * Inputs come ONLY from explicit env vars (never an env file):
 *   SUPABASE_SOURCE_URL   Supabase Postgres; lists keys from storage.objects (read-only session).
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *                         R2 S3 API, requests signed with aws4fetch.
 *   NEXT_PUBLIC_SUPABASE_URL  public project URL (or --source-base); objects are
 *                         fetched from `<base>/storage/v1/object/public/avatars/<key>`.
 *   NEON_TARGET_URL       optional; when set, every `User.avatarPath` is checked
 *                         for both its full and `_128` object in R2.
 *
 * Behaviour:
 * - A key is skipped when R2 HEAD already shows the same size.
 * - PUT keeps the source content-type and sets `Cache-Control: public, max-age=86400`.
 * - The dry run performs only reads (SQL selects, R2 HEAD) and reports what it would copy.
 * - Supabase objects are left in place; nothing is ever written to Supabase.
 * - Never prints a connection string or a credential. Object keys and the
 *   public (credential-free) base host are the only identifiers printed.
 */
import pg from "pg";
import { AwsClient } from "aws4fetch";
import { resolvePgDriverUrl } from "../src/lib/db-url";
import { thumbPathFor } from "../src/lib/avatars/paths";

const BUCKET_ID = "avatars";
const CACHE_CONTROL = "public, max-age=86400";
const CONCURRENCY = 6;

type Mode = "dry-run" | "apply";

type Args = { mode: Mode; sourceBase: string | null };

function parseArgs(argv: readonly string[]): Args {
  let apply = false;
  let dry = false;
  let sourceBase: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dry = true;
    else if (arg === "--source-base") {
      const next = argv[i + 1];
      if (!next) throw new Error("--source-base needs a URL");
      sourceBase = next;
      i += 1;
    } else if (arg.startsWith("--source-base=")) sourceBase = arg.slice("--source-base=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (apply && dry) throw new Error("pass either --dry-run or --apply, not both");
  return { mode: apply ? "apply" : "dry-run", sourceBase };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

/** The public Supabase project origin; refuses anything carrying credentials. */
function resolveSourceBase(flag: string | null): string {
  const raw = flag ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) throw new Error("set NEXT_PUBLIC_SUPABASE_URL or pass --source-base");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("source base is not a valid URL");
  }
  if (url.username || url.password) throw new Error("source base must not contain credentials");
  if (url.protocol !== "https:") throw new Error("source base must be https");
  return url.origin;
}

function encodeKey(key: string): string {
  return key.split("/").map((s) => encodeURIComponent(s)).join("/");
}

type SourceObject = { key: string; size: number | null; mimetype: string | null };

async function listSourceKeys(sourceUrl: string): Promise<SourceObject[]> {
  const client = new pg.Client({ connectionString: resolvePgDriverUrl(sourceUrl) ?? sourceUrl });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN TRANSACTION READ ONLY");
    const res = await client.query<{ name: string; size: string | null; mimetype: string | null }>(
      `select name,
              metadata->>'size' as size,
              metadata->>'mimetype' as mimetype
         from storage.objects
        where bucket_id = $1
        order by name`,
      [BUCKET_ID],
    );
    await client.query("ROLLBACK");
    return res.rows.map((r) => ({
      key: r.name,
      size: r.size !== null && /^\d+$/.test(r.size) ? Number(r.size) : null,
      mimetype: r.mimetype,
    }));
  } finally {
    await client.end().catch(() => {});
  }
}

async function listAvatarPaths(neonUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: resolvePgDriverUrl(neonUrl) ?? neonUrl });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const res = await client.query<{ avatarPath: string }>(
      `select "avatarPath" from "User" where "avatarPath" is not null`,
    );
    return res.rows.map((r) => r.avatarPath);
  } finally {
    await client.end().catch(() => {});
  }
}

class R2 {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor() {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    const bucket = requireEnv("R2_BUCKET");
    this.client = new AwsClient({
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
    this.base = `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}`;
  }

  /** Object size in bytes, or null when the object does not exist. */
  async headSize(key: string): Promise<number | null> {
    const res = await this.client.fetch(`${this.base}/${encodeKey(key)}`, { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${key} -> HTTP ${res.status}`);
    const len = res.headers.get("content-length");
    return len !== null && /^\d+$/.test(len) ? Number(len) : -1;
  }

  async put(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
    const res = await this.client.fetch(`${this.base}/${encodeKey(key)}`, {
      method: "PUT",
      body,
      headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
    });
    if (!res.ok) throw new Error(`R2 PUT ${key} -> HTTP ${res.status}`);
    await res.body?.cancel();
  }
}

async function fetchSource(base: string, key: string): Promise<{ body: ArrayBuffer; contentType: string | null }> {
  const res = await fetch(`${base}/storage/v1/object/public/${BUCKET_ID}/${encodeKey(key)}`);
  if (!res.ok) throw new Error(`source GET ${key} -> HTTP ${res.status}`);
  return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") };
}

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function firstLine(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = requireEnv("SUPABASE_SOURCE_URL");
  const sourceBase = resolveSourceBase(args.sourceBase);
  const r2 = new R2();
  console.log(`mode: ${args.mode}`);
  console.log(`source objects: ${new URL(sourceBase).host} (public bucket "${BUCKET_ID}")`);

  const objects = await listSourceKeys(sourceUrl);
  console.log(`source keys: ${objects.length}`);

  const present = new Set<string>();
  let skipped = 0;
  let copied = 0;
  let wouldCopy = 0;
  const failures: string[] = [];

  await runPool(objects, CONCURRENCY, async (obj) => {
    try {
      const r2Size = await r2.headSize(obj.key);
      if (r2Size !== null && obj.size !== null && r2Size === obj.size) {
        skipped += 1;
        present.add(obj.key);
        return;
      }
      if (args.mode === "dry-run") {
        wouldCopy += 1;
        if (r2Size !== null) present.add(obj.key);
        return;
      }
      const { body, contentType } = await fetchSource(sourceBase, obj.key);
      if (obj.size !== null && body.byteLength !== obj.size) {
        throw new Error(`source GET ${obj.key} returned ${body.byteLength} bytes, expected ${obj.size}`);
      }
      const type = obj.mimetype ?? contentType ?? "application/octet-stream";
      await r2.put(obj.key, body, type);
      copied += 1;
      present.add(obj.key);
    } catch (err) {
      failures.push(firstLine(err));
    }
  });

  console.log("\ncopy:");
  console.log(`  skipped (same size in R2): ${skipped}`);
  if (args.mode === "dry-run") console.log(`  would copy:                ${wouldCopy}`);
  else console.log(`  copied:                    ${copied}`);
  console.log(`  failed:                    ${failures.length}`);
  for (const f of failures) console.log(`    ${f}`);

  console.log("\nverification:");
  console.log(`  source keys present in R2: ${present.size}/${objects.length}`);
  if (present.size !== objects.length) {
    console.log(`  MISMATCH: ${objects.length - present.size} source key(s) not present in R2`);
    if (args.mode === "apply") process.exitCode = 1;
  }

  const neonUrl = process.env.NEON_TARGET_URL;
  if (!neonUrl) {
    console.log("  User.avatarPath check skipped: NEON_TARGET_URL not set");
  } else {
    const paths = await listAvatarPaths(neonUrl);
    const missing: string[] = [];
    for (const full of paths) {
      for (const key of [full, thumbPathFor(full)]) {
        if (present.has(key)) continue;
        const size = await r2.headSize(key);
        if (size === null) missing.push(key);
        else present.add(key);
      }
    }
    console.log(`  Users with avatarPath: ${paths.length}; missing objects in R2: ${missing.length}  [expected 0]`);
    if (missing.length > 0) console.log(`  MISMATCH: ${missing.length} avatar object(s) missing from R2, expected 0`);
    for (const key of missing) console.log(`    missing: ${key}`);
    if (missing.length > 0 && args.mode === "apply") process.exitCode = 1;
  }

  if (failures.length > 0) process.exitCode = 1;
  if (args.mode === "dry-run") console.log("\ndry run: wrote 0 objects. Re-run with --apply to copy.");
}

main().catch((err: unknown) => {
  console.error(`copy failed: ${firstLine(err)}`);
  process.exitCode = 1;
});
