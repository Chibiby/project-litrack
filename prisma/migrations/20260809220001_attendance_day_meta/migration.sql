-- CreateTable
CREATE TABLE "AttendanceDayMeta" (
    "id" TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isHoliday" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDayMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceDayMeta_date_idx" ON "AttendanceDayMeta"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDayMeta_gradeLevelId_date_key" ON "AttendanceDayMeta"("gradeLevelId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceDayMeta" ADD CONSTRAINT "AttendanceDayMeta_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDayMeta" ADD CONSTRAINT "AttendanceDayMeta_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
