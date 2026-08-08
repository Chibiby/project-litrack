-- List Prisma teachers with no usable password in Supabase Auth.
-- Run in the Supabase SQL Editor (service role / postgres).
-- Ground truth: auth.users.encrypted_password IS NULL or empty.
--
-- Does NOT delete anything. Use with:
--   npx tsx scripts/cleanup-passwordless-teachers.ts --dry-run
--   npx tsx scripts/cleanup-passwordless-teachers.ts --execute

SELECT
  u.id              AS prisma_user_id,
  u."authId"        AS auth_id,
  u.email,
  u.role,
  u."schoolId",
  u."isActive",
  u."approvalStatus",
  u."deletedAt",
  u."createdAt",
  au.email          AS auth_email,
  au.encrypted_password IS NULL OR au.encrypted_password = '' AS is_passwordless,
  (
    SELECT COALESCE(json_agg(i.provider), '[]'::json)
    FROM auth.identities i
    WHERE i.user_id = au.id
  ) AS identity_providers
FROM public."User" u
INNER JOIN auth.users au ON au.id = u."authId"::uuid
WHERE u.role = 'TEACHER'
  AND (au.encrypted_password IS NULL OR au.encrypted_password = '')
ORDER BY u."deletedAt" NULLS FIRST, u.email ASC;
