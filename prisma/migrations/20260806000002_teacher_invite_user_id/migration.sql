-- AlterTable
ALTER TABLE "TeacherInvite" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "TeacherInvite_userId_idx" ON "TeacherInvite"("userId");

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
