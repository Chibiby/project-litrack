-- PROJECT LITRACK - Supabase Storage setup for user profile photos.
-- Run this in the Supabase SQL Editor against project rnrumiejofmajgahphvt,
-- AFTER `prisma migrate deploy` has applied 20260918000001_user_avatar_path.
--
-- This is NOT a Prisma migration. The shadow database Prisma uses for
-- `migrate diff` / `migrate dev` has no `storage` schema, so
-- `storage.buckets` and `storage.objects` can never be expressed in
-- prisma/migrations/**. It lives here instead, alongside
-- prisma/rls-policies.sql, which this file follows for header and comment
-- style. A human applies it; see docs/migrate-checklist.md section (q).
--
-- Ownership and access model
-- ---------------------------
-- Bucket "avatars" is PUBLIC (readable by anyone with the object's URL, no
-- auth check, no RLS involved in a GET) -- that is how the app serves
-- avatars to <img> tags with no signed-URL plumbing. Every WRITE, however,
-- goes through the service role only: src/lib/supabase/avatar-storage.ts is
-- the one call site, using the service-role Supabase client, which bypasses
-- RLS automatically the same way Prisma's service-role Postgres connection
-- does for every other table in this schema. Nothing under `anon` or
-- `authenticated` (i.e. no client-side Supabase call, ever) is meant to
-- read, list, or write this bucket -- the app always proxies through a
-- server action.
--
-- The RESTRICTIVE policy below is defense-in-depth for that last sentence,
-- not the mechanism that makes it true today. Storage RLS defaults to
-- deny-all when no PERMISSIVE policy grants access, so `anon`/`authenticated`
-- already can't touch this bucket without it. What the policy guards
-- against is the future: if anyone ever adds a PERMISSIVE storage policy
-- naming this bucket (for a different feature, carelessly scoped, or a
-- Supabase dashboard click), this RESTRICTIVE policy still ANDs against it
-- and keeps `avatars` closed to both client roles. Restrictive policies
-- cannot be bypassed by adding a more permissive one elsewhere -- that is
-- the whole point of the restrictive/permissive split in Postgres RLS.
--
-- Public URLs bypass RLS entirely (object GET on a public bucket is served
-- by Storage directly, not through a PostgREST/RLS-checked read), so the
-- policy below constrains writes and any authenticated-role read attempt,
-- not the public GETs the app relies on for display.
--
-- cacheControl
-- ------------
-- Objects are uploaded with `cacheControl: "86400"` (src/lib/avatars/
-- limits.ts AVATAR_CACHE_CONTROL_SECONDS) -- one day, not the default one
-- year. The Free plan has no Smart CDN and cannot purge cached objects on
-- demand, so a moderated photo (School Head / Super Admin removal) must not
-- keep being served from a stale cache for a year; capping the cache header
-- itself is the only lever available on this plan.
--
-- Re-running this file is safe: `insert ... on conflict do update` and
-- `drop policy if exists` before every `create policy` make every statement
-- here idempotent.
--
-- File must stay ASCII and BOM-free -- the Supabase SQL Editor has
-- previously misread a UTF-8 BOM on the first line as part of the first
-- statement.

-- Create (or reconcile) the "avatars" bucket.
--
--   public              true -- objects are served by public URL, no signed
--                             URL / auth check on GET.
--   file_size_limit     1048576 bytes (1 MiB) -- matches
--                        AVATAR_FULL_MAX_BYTES, the largest object this
--                        feature ever uploads. This is a backstop; the real
--                        limit is enforced server-side in
--                        src/lib/avatars/validate-upload.ts before upload is
--                        even attempted.
--   allowed_mime_types  webp, jpeg, png only -- matches what
--                        src/lib/avatars/sniff.ts recognizes. Storage checks
--                        this against the upload's declared content-type,
--                        which the service-role uploader always sets from
--                        the SNIFFED mime, never the client-supplied one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Deny-all for both client roles on this bucket. Restrictive, so it ANDs
-- against any permissive policy that might later be added on
-- storage.objects and still wins. Service role bypasses RLS and is
-- unaffected by this policy, the same way it bypasses every RLS policy in
-- prisma/rls-policies.sql.
drop policy if exists "avatars_no_client_access" on storage.objects;
create policy "avatars_no_client_access"
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'avatars')
  with check (bucket_id <> 'avatars');

-- ---------------------------------------------------------------------------
-- Verification queries (run manually after applying; not part of the setup)
-- ---------------------------------------------------------------------------

-- Confirm the bucket row landed with the expected shape:
-- select id, name, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id = 'avatars';

-- Confirm the restrictive policy is registered against storage.objects:
-- select policyname, permissive, roles, cmd
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects';
