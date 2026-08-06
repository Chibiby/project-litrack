-- AlterTable: survey contact email distinct from User.email (login / synthetic)
ALTER TABLE "SchoolHeadProfile" ADD COLUMN "contactEmail" TEXT;

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN "contactEmail" TEXT;
