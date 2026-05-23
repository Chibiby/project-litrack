# Windows quick-start

You don't have Node.js / Git / Python installed yet. Here's the fastest path:

## 1. Install Node.js 20 LTS (5 min)

Open PowerShell **as Administrator** and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

(or download from https://nodejs.org/ if `winget` isn't available)

**Close and reopen** any PowerShell windows so `node` and `npm` are on `PATH`.

Verify:
```powershell
node --version    # should print v20.x or v22.x
npm --version     # should print 10.x
```

## 2. Install Git (optional but recommended)

```powershell
winget install Git.Git
```

## 3. Install project dependencies

From this folder (`c:\Users\OPERATOR-PC\Desktop\test_projects`):

```powershell
npm install
```

This will take 1–2 minutes and resolve all the lint errors you currently see in the IDE (they're caused by missing `node_modules`).

## 4. Create a Supabase project (free)

1. Go to https://supabase.com/, sign up.
2. Create a new project. Wait for it to provision (~2 min).
3. In the project dashboard, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (never expose this)
4. **Settings → Database**: copy the **Connection string** (Transaction Pooler) → `DATABASE_URL`
5. Same page: copy the **Direct connection** string → `DIRECT_URL`

## 5. Set up your `.env.local`

```powershell
copy .env.example .env.local
notepad .env.local
```

Fill in all the values. Set `RESEND_API_KEY` to anything (e.g. blank) — invite emails will be logged to the console in dev.

## 6. Migrate + seed + run

```powershell
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run db:seed
npm run dev
```

Then open http://localhost:3000 and try the smoke test in `README.md`.

---

## Troubleshooting

**"Cannot find module 'next' / 'react' / etc." in IDE**
→ You haven't run `npm install` yet, or it failed. Run it again and reload VS Code.

**Prisma migrate fails with "P1001 can't reach database"**
→ Your `DATABASE_URL` / `DIRECT_URL` are wrong, or your Supabase project is paused. Verify in the Supabase dashboard.

**"Module '@prisma/client' has no exported member 'PrismaClient'"**
→ Run `npm run prisma:generate` after every `prisma/schema.prisma` change.

**Login as School Head says "Login failed"**
→ The synthetic email + password didn't match. Check that you used the exact `schoolIdCode` you set when creating the school, with the right case.

**Teacher invite email never arrives**
→ Check the server console — without a real `RESEND_API_KEY`, the invite URL is logged there. Copy/paste it into your browser.
