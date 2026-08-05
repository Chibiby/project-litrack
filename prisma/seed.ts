/**
 * Seed script: bootstraps a Super Admin account.
 * Run with: npm run db:seed
 *
 * Requires the following env vars:
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - SEED_SUPER_ADMIN_EMAIL
 *  - SEED_SUPER_ADMIN_PASSWORD
 *
 * Idempotent: re-running syncs the Auth password / confirmation and ensures
 * the Prisma User row exists (safe for production bootstrap).
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { PrismaClient, UserRole } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Load `.env` then `.env.local` (local wins). Does not override existing process.env. */
function loadEnvFiles() {
  const fromFiles: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fromFiles[key] = value;
    }
  }
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFiles();

const prisma = new PrismaClient();

async function findAuthUserId(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

/** Create Auth user if needed, then always sync password + email_confirm + unban. */
async function ensureAuthSuperAdmin(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "SUPER_ADMIN" },
    user_metadata: { role: "SUPER_ADMIN" },
  });

  let authId: string | undefined = created?.user?.id;

  if (!authId) {
    const already =
      createErr && /already|registered|exists/i.test(createErr.message);
    if (createErr && !already) throw createErr;

    const foundId = await findAuthUserId(admin, email);
    if (!foundId) {
      throw new Error(
        createErr?.message ??
          "Could not create or find super admin auth user"
      );
    }
    authId = foundId;
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(authId, {
    password,
    email_confirm: true,
    ban_duration: "none",
    app_metadata: { role: "SUPER_ADMIN" },
    user_metadata: { role: "SUPER_ADMIN" },
  });
  if (updateErr) throw updateErr;

  return authId;
}

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!email || !password || !supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing required env vars. See .env.example: SEED_SUPER_ADMIN_EMAIL, SEED_SUPER_ADMIN_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authId = await ensureAuthSuperAdmin(admin, email, password);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        authId,
        role: UserRole.SUPER_ADMIN,
        isActive: true,
        profileCompleted: true,
        deletedAt: null,
      },
    });
    console.log(`✓ Super admin already exists; Auth password synced: ${email}`);
    console.log(`  Login at: /admin/login`);
    return;
  }

  // Auth user exists (or was just created) but Prisma User row is missing
  await prisma.user.create({
    data: {
      authId,
      email,
      role: UserRole.SUPER_ADMIN,
      firstName: "Super",
      lastName: "Admin",
      fullName: "Super Admin",
      isActive: true,
      profileCompleted: true,
    },
  });

  console.log(`✓ Super admin created: ${email}`);
  console.log(`  Login at: /admin/login`);
  console.log(`  Password: (the one you set in SEED_SUPER_ADMIN_PASSWORD)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
