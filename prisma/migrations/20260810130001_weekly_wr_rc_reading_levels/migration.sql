-- CreateEnum
CREATE TYPE "WeeklyWordRecognitionLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_0', 'NA');

-- CreateEnum
CREATE TYPE "WeeklyReadingComprehensionLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_0', 'NA');

-- AlterTable
ALTER TABLE "ReadingLevelRecord" ADD COLUMN "wordRecognitionLevel" "WeeklyWordRecognitionLevel",
ADD COLUMN "readingComprehensionLevel" "WeeklyReadingComprehensionLevel";
