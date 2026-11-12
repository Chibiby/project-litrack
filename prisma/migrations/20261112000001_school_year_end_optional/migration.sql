-- Additive: a School Head may leave the end month unset.
ALTER TABLE "SchoolYear" ALTER COLUMN "endDate" DROP NOT NULL;
