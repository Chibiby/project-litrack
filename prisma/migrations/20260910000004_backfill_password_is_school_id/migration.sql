-- Backfill `passwordIsSchoolId` for School Heads whose password provably still
-- is their School ID.
--
-- WHY
-- ---
-- `scripts/import-schools.ts` created every School Head with the password set to
-- the School ID but never set this flag, so all 332 imported heads carried its
-- `false` default. `src/components/admin/school-accounts-table.tsx` reads the
-- flag to decide whether the Super Admin console can show the credential, so
-- every one of those schools rendered as "Custom password — not readable, reset
-- to sign in". A school reporting that it could not log in therefore always got
-- a password reset, because the console claimed nobody knew the password. The
-- password was never unknown; the flag was wrong.
--
-- WHY NOT SIMPLY SET IT EVERYWHERE
-- --------------------------------
-- At the time of writing, 121 of 336 live heads have genuinely changed their
-- password, and 3 more hold a random regenerated credential. Flagging those
-- would make the console display a School ID that does not work — the same lie
-- in the opposite direction, and worse, because an admin would read it out to a
-- school and the sign-in would fail. So this only touches rows where "the
-- password is still the School ID" follows from what the app already recorded.
--
-- WHAT COUNTS AS PROOF
-- --------------------
-- Four writes move an account between "credential is the School ID" and "nobody
-- knows it", and each leaves an audit row:
--
--   * PASSWORD_CHANGE, reason <> 'set_password_skipped'  -> head chose their own
--     password (`updatePassword`, `changePasswordAction`, recovery reset).
--   * PASSWORD_CHANGE, reason  = 'set_password_skipped'  -> head dismissed the
--     prompt. `skipPasswordChange` deliberately leaves the password alone, so
--     this is NOT a change (see its comment in src/lib/actions/auth.ts).
--   * SCHOOL_HEAD_CREDENTIAL_REGENERATED -> random one-time credential that is
--     never stored (`regenerateSchoolHeadCredential`). Password unknowable.
--   * SCHOOL_HEAD_PASSWORD_RESET_DEFAULT -> reset back to the School ID
--     (`resetSchoolHeadPassword`), which already sets the flag itself.
--
-- Only three of those actually write a password, so only those three are ranked;
-- a skip is not an event here at all. Four live heads dismissed the prompt after
-- choosing their own password, and treating that dismissal as "the last thing
-- that happened" would call their custom password a School ID.
--
-- Among the three that do write, the most recent decides, because they overwrite
-- one another. A head who changed their password and was later regenerated is
-- unknown; a head who was regenerated and later reset to default is known.
-- Ordering is not optional here: `mustChangePassword = true` alone is NOT proof
-- of an unchanged password, because a regeneration re-arms that flag while
-- setting a random credential — one live account (sh@500648) is in exactly that
-- state, and an earlier draft of this migration would have mislabelled it.
--
-- Rows with no such event at all are the untouched import population: password
-- still the School ID, flag set true here.
--
-- Admin-initiated rows record `userId` = the acting admin and `resourceId` = the
-- head, so the correlation below is on `resourceId`. Head-initiated
-- PASSWORD_CHANGE rows set both to the head; matching either is correct for
-- those and required for these.
--
-- Idempotent, and it only ever sets the flag true — never clears one — so
-- re-running cannot revoke a credential the console is already showing. Counts
-- are indicative, from the pre-apply scan; the predicate decides, so heads who
-- change their password between authoring and applying drop out automatically.

WITH last_write AS (
  SELECT DISTINCT ON (subject_id)
         subject_id,
         action
  FROM (
    SELECT COALESCE(a."resourceId", a."userId") AS subject_id,
           a."action"                           AS action,
           a."timestamp"                        AS ts
    FROM "AuditLog" AS a
    WHERE (
        -- A head choosing their own password. Skips are excluded here, not
        -- ranked: dismissing the prompt writes no password, so it must not
        -- displace an earlier real change.
        a."action" = 'PASSWORD_CHANGE'
        AND COALESCE(a."metadata" ->> 'reason', '') <> 'set_password_skipped'
      )
      OR a."action" = 'SCHOOL_HEAD_CREDENTIAL_REGENERATED'
      OR a."action" = 'SCHOOL_HEAD_PASSWORD_RESET_DEFAULT'
  ) AS writes
  WHERE subject_id IS NOT NULL
  ORDER BY subject_id, ts DESC
)
UPDATE "User" AS u
SET "passwordIsSchoolId" = true
WHERE u."role" = 'SCHOOL_HEAD'
  AND u."deletedAt" IS NULL
  AND u."passwordIsSchoolId" = false
  AND NOT EXISTS (
    SELECT 1
    FROM last_write AS w
    WHERE w.subject_id = u."id"
      -- Unknown only when the most recent password write was a head's own
      -- choice or a regenerated one-time credential. A reset-to-default is the
      -- third possibility and means the School ID is current again.
      AND w.action IN ('PASSWORD_CHANGE', 'SCHOOL_HEAD_CREDENTIAL_REGENERATED')
  );
