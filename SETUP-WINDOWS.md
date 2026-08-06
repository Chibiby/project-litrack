# Windows quick-start (PROJECT LITRACK)

Target machine style: Windows 10+, project under a user Desktop path (e.g. `C:\Users\PC5\Desktop\project-litrack`).

## 1. Install Node.js 20 LTS

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download from https://nodejs.org/. **Close and reopen** PowerShell so `node` / `npm` are on `PATH`.

```powershell
node --version    # expect v20.x (v22 also fine)
npm --version
```

## 2. Install Git (optional)

```powershell
winget install Git.Git
```

## 3. Open the project and install dependencies

```powershell
cd C:\Users\PC5\Desktop\project-litrack
npm install
```

Adjust the path if your clone lives elsewhere.

## 4. Supabase project

1. Create a project at https://supabase.com/
2. Copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - Transaction pooler connection → `DATABASE_URL` (port **6543**)
   - Direct/session connection → `DIRECT_URL` (port **5432**)

## 5. Environment file

```powershell
copy .env.example .env.local
notepad .env.local
```

Fill all required names from `.env.example`. Leave Resend blank in local dev if needed (invite URLs log to the console).

## 6. Prisma client, migrations, seed

```powershell
npm run prisma:generate

# Human-approved only — applies committed SQL to the database pointed at by DIRECT_URL/DATABASE_URL
npm run prisma:deploy

npm run db:seed
npm run dev
```

Open http://localhost:3000.

**Do not** run `prisma migrate dev` or `db push` against shared/remote Supabase unless you intentionally own that workflow. See `docs/migrations.md`.

Optional: paste `prisma/rls-policies.sql` into the Supabase SQL Editor after migrate.

## 7. Verify quality gates (optional)

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| IDE cannot find `next` / `react` | Run `npm install`, reload window |
| Prisma P1001 can't reach DB | Check `DATABASE_URL` / `DIRECT_URL`; unpause Supabase project |
| Missing PrismaClient exports | `npm run prisma:generate` |
| School Head login fails | Use the **activation credential** from school creation (not School ID as password) |
| Teacher invite email missing | Check server console for invite URL when Resend is unset |
| New schema features missing at runtime | Migrations likely unapplied — approve and run `npm run prisma:deploy` |
