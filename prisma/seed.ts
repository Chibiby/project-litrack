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
 * Optional:
 *  - SEED_SUPER_ADMIN_USERNAME (defaults to "admin") — the handle typed at
 *    /admin/login. The email above stays the account's identity and is what
 *    password recovery mails; the username is only a lookup handle.
 */
import { PrismaClient, UserRole } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const username = (process.env.SEED_SUPER_ADMIN_USERNAME || "admin").trim().toLowerCase();
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

  // Check if super admin user already exists in app DB
  const existing = await prisma.user.findFirst({
    where: { email, role: UserRole.SUPER_ADMIN },
  });
  if (existing) {
    // A deployment seeded before usernames existed has a NULL handle, which
    // leaves no way to sign in at /admin/login. Fill it in rather than bailing
    // out — that is the whole reason this branch does more than log.
    if (!existing.username) {
      await prisma.user.update({ where: { id: existing.id }, data: { username } });
      console.log(`✓ Super admin already exists: ${email}`);
      console.log(`  Username backfilled: ${username}`);
    } else {
      console.log(`✓ Super admin already exists: ${email} (username: ${existing.username})`);
    }
    return;
  }

  // Create Supabase auth user (or fetch existing)
  let authId: string;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "SUPER_ADMIN" },
  });

  if (createErr && !createErr.message.includes("already")) {
    throw createErr;
  }

  if (created?.user) {
    authId = created.user.id;
  } else {
    // user existed; look it up
    const { data: list } = await admin.auth.admin.listUsers();
    const found = list.users.find((u) => u.email === email);
    if (!found) throw new Error("Could not create or find super admin auth user");
    authId = found.id;
  }

  await prisma.user.create({
    data: {
      authId,
      email,
      username,
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
  console.log(`  Username: ${username}`);
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
