-- Per-school term window overrides (Wave A of the terms management design).
--
-- NUMBERING
-- ---------
-- 20260911000003, after 20260911000002_release_channel, which production already
-- holds. A migration sorting behind an applied one is applied out of order.
--
-- PURELY ADDITIVE, AND DELIBERATELY NOT BACKFILLED
-- ------------------------------------------------
-- One CREATE TABLE and nothing else. No existing row is read or rewritten.
--
-- The emptiness is the design, not an omission: `getTermWindows` keeps deriving
-- three-month windows from the school year's start month, and a row here
-- OVERRIDES that derivation for one term. Seeding three rows per school year
-- would convert 126 schools from "derived, and follows the year if its dates are
-- corrected" to "frozen at whatever the derivation said on migration day".
--
-- APPLY THIS BEFORE THE CODE THAT READS IT
-- ----------------------------------------
-- Not optional, and the same hazard 20260911000002 carried.
--
-- Once `getActiveSchoolYear` and `saveTermGrades` name `termWindowOverrides` in
-- a `select`, every one of those queries asks Postgres for a table. If the code
-- ships first, the table is missing and Prisma raises P2021 — which takes down
-- the teacher grade sheet, the term export and every page reading the active
-- school year, not merely the unbuilt terms feature.
--
-- Applied FIRST it is invisible: an empty table yields `overrides: []`, which is
-- exactly `getTermWindows`'s default argument, so the running code that has
-- never heard of this table behaves precisely as it does today.
--
-- CHECK CONSTRAINTS
-- -----------------
-- The action layer validates the same rules against the EFFECTIVE three windows
-- (derived thirds with overrides applied), which is the check that catches gaps
-- and overlaps across terms. These constraints are the narrower within-a-row
-- half, enforced where no application bug can route around them — the same
-- defence-in-depth as `TermGrade`'s 60-100 score CHECK.
--
--   * the three keys are really `YYYY-MM-DD`
--   * a term does not end before it starts
--   * a deadline never falls before its own term's last day, which would be a
--     term locked before it ended
--
-- Cross-term ordering is NOT expressible here: it spans rows, and a term with no
-- row at all is still a real window. That rule lives in `validateTermWindows`.

CREATE TABLE "TermWindowOverride" (
    "id"           TEXT NOT NULL,
    "schoolId"     TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "term"         "TermPeriod" NOT NULL,
    "startKey"     TEXT NOT NULL,
    "endKey"       TEXT NOT NULL,
    "deadlineKey"  TEXT NOT NULL,
    "setById"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermWindowOverride_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "TermWindowOverride_startKey_format"
        CHECK ("startKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    CONSTRAINT "TermWindowOverride_endKey_format"
        CHECK ("endKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    CONSTRAINT "TermWindowOverride_deadlineKey_format"
        CHECK ("deadlineKey" ~ '^\d{4}-\d{2}-\d{2}$'),
    -- String comparison on YYYY-MM-DD is a total order, which is why these read
    -- as plain inequalities and need no date parsing.
    CONSTRAINT "TermWindowOverride_start_before_end"
        CHECK ("startKey" <= "endKey"),
    CONSTRAINT "TermWindowOverride_deadline_not_before_end"
        CHECK ("deadlineKey" >= "endKey")
);

CREATE UNIQUE INDEX "TermWindowOverride_schoolYearId_term_key"
    ON "TermWindowOverride"("schoolYearId", "term");

CREATE INDEX "TermWindowOverride_schoolId_idx"
    ON "TermWindowOverride"("schoolId");

CREATE INDEX "TermWindowOverride_setById_idx"
    ON "TermWindowOverride"("setById");

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_schoolYearId_fkey"
    FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TermWindowOverride"
    ADD CONSTRAINT "TermWindowOverride_setById_fkey"
    FOREIGN KEY ("setById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
