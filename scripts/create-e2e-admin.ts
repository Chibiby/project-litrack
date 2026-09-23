/**
 * Create the Super Admin account that local Playwright checks sign in with.
 *
 * Usage (run it yourself):
 *   npx tsx scripts/create-e2e-admin.ts            # dry run: report only
 *   npx tsx scripts/create-e2e-admin.ts --commit   # create it
 *
 * Reads LITRACK_E2E_USER and LITRACK_E2E_PASS from `.env.e2e` (gitignored),
 * the same file `node e2e/auth/login.mjs` reads, so the password is typed in
 * exactly one place. Database and Supabase settings come from `.env.local`,
 * like `seed-division-admins.ts`, whose creation steps this copies: the
 * username lives in Postgres but the password lives in Supabase Auth, so only
 * a service-role client can make a working account.
 *
 * Dry run is the default and prints which database and Supabase project it
 * would write to. Idempotent: an existing username or email is skipped, never
 * overwritten.
 */
import fs from "node:fs";
import path from "node:path";
import { UserRole } from "@prisma/client";
import { loadEnvFile, connectScriptPrisma } from "./lib/script-db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

function readE2eEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.resolve(__dirname, "..", ".env.e2e");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function hostOf(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const e2e = readE2eEnv();
  const username = (process.env.LITRACK_E2E_USER ?? e2e.LITRACK_E2E_USER ?? "").trim().toLowerCase();
  const password = process.env.LITRACK_E2E_PASS ?? e2e.LITRACK_E2E_PASS ?? "";
  if (!username || !password) {
    throw new Error("Set LITRACK_E2E_USER and LITRACK_E2E_PASS in .env.e2e first.");
  }
  if (password.length < 12) {
    throw new Error("Use a password of at least 12 characters: this account is a Super Admin.");
  }

  loadEnvFile();
  const email = `${username}@${DOMAIN}`;
  console.log("");
  console.log(`Database: ${hostOf(process.env.DIRECT_URL ?? process.env.DATABASE_URL)}`);
  console.log(`Supabase: ${hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  console.log(`Account:  ${username} (${email}) as SUPER_ADMIN`);
  console.log("");

  const prisma = await connectScriptPrisma();
  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { role: true },
    });
    if (existing) {
      console.log(`Already exists (${existing.role}). Nothing to do.`);
      return;
    }
    if (!commit) {
      console.log("Dry run. Check the database and Supabase hosts above, then re-run with --commit.");
      return;
    }

    const supabase = createSupabaseAdminClient();
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "SUPER_ADMIN" },
    });
    if (error) throw new Error(`Supabase rejected ${username}: ${error.message}`);
    const authId = created?.user?.id;
    if (!authId) throw new Error(`Supabase created no auth user for ${username}`);

    await prisma.user.create({
      data: {
        authId,
        email,
        username,
        role: UserRole.SUPER_ADMIN,
        firstName: "E2E",
        lastName: "Tester",
        fullName: "E2E Tester",
        isActive: true,
        profileCompleted: true,
      },
    });
    console.log(`Created ${username}. Next: node e2e/auth/login.mjs`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
