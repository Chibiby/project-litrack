-- CreateTable
CREATE TABLE "TeacherSection" (
    "teacherId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherSection_pkey" PRIMARY KEY ("teacherId","sectionId")
);

-- CreateIndex
CREATE INDEX "TeacherSection_sectionId_idx" ON "TeacherSection"("sectionId");

-- AddForeignKey
ALTER TABLE "TeacherSection" ADD CONSTRAINT "TeacherSection_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSection" ADD CONSTRAINT "TeacherSection_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
