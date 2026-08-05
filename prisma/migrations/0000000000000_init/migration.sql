-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SCHOOL_HEAD', 'TEACHER');

-- CreateEnum
CREATE TYPE "GradeLevelType" AS ENUM ('KINDER', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'FLOATING');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "ReadingProfile" AS ENUM ('NON_DECODER_LOW_EMERGENT', 'FRUSTRATION_HIGH_EMERGENT', 'INSTRUCTIONAL_DEVELOPING', 'INDEPENDENT_GRADE_READY');

-- CreateEnum
CREATE TYPE "FrustrationSubtype" AS ENUM ('DECODING', 'COMPREHENSION_ALL', 'COMPREHENSION_CRITICAL');

-- CreateEnum
CREATE TYPE "EducationalAttainment" AS ENUM ('BACHELORS', 'WITH_MASTERS_UNITS', 'MASTERS', 'WITH_DOCTORAL_UNITS', 'DOCTORAL');

-- CreateEnum
CREATE TYPE "YearsInService" AS ENUM ('Y0_3', 'Y4_10', 'Y11_20', 'Y21_PLUS');

-- CreateEnum
CREATE TYPE "TrainingLevel" AS ENUM ('INTERNATIONAL', 'NATIONAL', 'REGION', 'DIVISION', 'DISTRICT', 'SCHOOL', 'NA');

-- CreateEnum
CREATE TYPE "SchoolHeadPosition" AS ENUM ('TEACHER_I_TIC', 'TEACHER_II_TIC', 'TEACHER_III_TIC', 'TEACHER_IV_TIC', 'TEACHER_V_TIC', 'HEAD_TEACHER_I', 'HEAD_TEACHER_II', 'HEAD_TEACHER_III', 'HEAD_TEACHER_IV', 'HEAD_TEACHER_V', 'HEAD_TEACHER_VI', 'HEAD_TEACHER_VII', 'PRINCIPAL_I', 'PRINCIPAL_II', 'PRINCIPAL_III', 'PRINCIPAL_IV', 'TECHVOC_AD');

-- CreateEnum
CREATE TYPE "TeacherPosition" AS ENUM ('TEACHER_I', 'TEACHER_II', 'TEACHER_III', 'TEACHER_IV', 'TEACHER_V', 'TEACHER_VI', 'TEACHER_VII', 'MASTER_TEACHER_I', 'MASTER_TEACHER_II', 'MASTER_TEACHER_III', 'MASTER_TEACHER_IV');

-- CreateEnum
CREATE TYPE "Specialization" AS ENUM ('GENERAL_EDUCATION', 'ENGLISH', 'MATH', 'SCIENCE', 'FILIPINO', 'TLE_EPP', 'ARALPAN', 'MAPEH', 'TECHVOC', 'VALUES_ED', 'OTHERS');

-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('ENGLISH', 'MATH', 'SCIENCE', 'FILIPINO', 'TLE_EPP', 'ARALPAN', 'MAPEH', 'TECHVOC', 'VALUES_ED', 'ABM');

-- CreateEnum
CREATE TYPE "ReadingTraining" AS ENUM ('ARAL', 'TEACHING_READING', 'ELLN', 'TEACEP', 'NONE');

-- CreateEnum
CREATE TYPE "EnglishTraining" AS ENUM ('MATATAG_TRAINING', 'UPSKILLING_ENGLISH_COMPETENCE', 'NONE');

-- CreateEnum
CREATE TYPE "GovernmentBenefit" AS ENUM ('FOUR_PS', 'IPS');

-- CreateEnum
CREATE TYPE "ParentEducation" AS ENUM ('NO_FORMAL', 'ELEMENTARY_LEVEL', 'ELEMENTARY_GRADUATE', 'SECONDARY_LEVEL', 'SECONDARY_GRADUATE', 'COLLEGE_LEVEL', 'COLLEGE_GRADUATE');

-- CreateEnum
CREATE TYPE "ModeOfTransportation" AS ENUM ('WALKING', 'MOTORCYCLE', 'BUS_JEEP_CAR');

-- CreateEnum
CREATE TYPE "DistanceToSchool" AS ENUM ('LESS_THAN_1KM', 'ONE_TO_FIVE_KM', 'MORE_THAN_5KM');

-- CreateEnum
CREATE TYPE "SchoolTransfers" AS ENUM ('NONE', 'ONE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "AbsenteeismFrequency" AS ENUM ('ONE_TO_THREE_PER_MONTH', 'THREE_TO_FIVE_PER_MONTH', 'MORE_THAN_FIVE_PER_MONTH', 'WEEKLY', 'OTHER');

-- CreateEnum
CREATE TYPE "LetterRecognition" AS ENUM ('ALL_EASY', 'CONFUSES_SIMILAR', 'STRUGGLES_RECALL', 'NA');

-- CreateEnum
CREATE TYPE "LetterSoundCorrespondence" AS ENUM ('ACCURATE', 'INCONSISTENT', 'UNABLE', 'NA');

-- CreateEnum
CREATE TYPE "WordRecognition" AS ENUM ('READS_HF_FLUENT', 'GUESSES', 'OMITS_ADDS_REPLACES', 'STRUGGLES_SIGHT_WORDS', 'NA');

-- CreateEnum
CREATE TYPE "HomeLiteracyEnvironment" AS ENUM ('HAS_ACCESS', 'LIMITED', 'NONE', 'NA');

-- CreateEnum
CREATE TYPE "ParentalSupport" AS ENUM ('REGULAR', 'LIMITED', 'NONE', 'NA');

-- CreateEnum
CREATE TYPE "ClassroomEnvironment" AS ENUM ('SMALL_CLASS', 'LARGE_CLASS', 'NA');

-- CreateEnum
CREATE TYPE "LanguageConsideration" AS ENUM ('MATCHES_LOI', 'DIFFERENT_DIALECT', 'STRUGGLES_TRANSITION', 'NA');

-- CreateEnum
CREATE TYPE "Intervention" AS ENUM ('PHONEMIC_AWARENESS', 'LETTER_SOUND_DRILLS', 'SIGHT_WORD_PRACTICE', 'STRUCTURED_PHONICS', 'ONE_ON_ONE', 'HOME_READING', 'LSEN_OTHER');

-- CreateEnum
CREATE TYPE "FurtherAssessment" AS ENUM ('MFAT', 'OTHER');

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolIdCode" TEXT NOT NULL,
    "address" TEXT,
    "region" TEXT,
    "division" TEXT,
    "district" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "schoolId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolHeadProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactNumber" TEXT,
    "designation" TEXT,
    "position" "SchoolHeadPosition" NOT NULL,
    "educationalAttainment" "EducationalAttainment" NOT NULL,
    "fieldOfSpecialization" "Specialization" NOT NULL,
    "specializationOther" TEXT,
    "yearsInService" "YearsInService" NOT NULL,
    "hasReadingTraining" BOOLEAN NOT NULL,
    "readingTrainings" "ReadingTraining"[],
    "hasEnglishTraining" BOOLEAN NOT NULL,
    "englishTrainings" "EnglishTraining"[],
    "highestTrainingLevel" "TrainingLevel" NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolHeadProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactNumber" TEXT,
    "designation" TEXT,
    "position" "TeacherPosition" NOT NULL,
    "educationalAttainment" "EducationalAttainment" NOT NULL,
    "fieldOfSpecialization" "Specialization" NOT NULL,
    "specializationOther" TEXT,
    "yearsInService" "YearsInService" NOT NULL,
    "currentGradeAssignment" "GradeLevelType",
    "mostSubjectHandled" "Subject" NOT NULL,
    "hasReadingTraining" BOOLEAN NOT NULL,
    "readingTrainings" "ReadingTraining"[],
    "hasEnglishTraining" BOOLEAN NOT NULL,
    "englishTrainings" "EnglishTraining"[],
    "highestTrainingLevel" "TrainingLevel" NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherInvite" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "gradeLevelId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeLevel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "GradeLevelType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GradeLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Learner" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,
    "englishReadingProfile" "ReadingProfile" NOT NULL,
    "englishFrustrationSubtypes" "FrustrationSubtype"[],
    "filipinoReadingProfile" "ReadingProfile" NOT NULL,
    "filipinoFrustrationSubtypes" "FrustrationSubtype"[],
    "governmentBenefits" "GovernmentBenefit"[],
    "parentEducation" "ParentEducation" NOT NULL,
    "isAralLearner" BOOLEAN NOT NULL DEFAULT false,
    "aralEnrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AralProfile" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "modeOfTransportation" "ModeOfTransportation" NOT NULL,
    "distanceHomeToSchool" "DistanceToSchool" NOT NULL,
    "previousTransfers" "SchoolTransfers" NOT NULL,
    "transferDetails" TEXT,
    "absenteeismFrequency" "AbsenteeismFrequency" NOT NULL,
    "absenteeismOtherReason" TEXT,
    "letterRecognition" "LetterRecognition" NOT NULL,
    "letterSoundCorrespondence" "LetterSoundCorrespondence" NOT NULL,
    "wordRecognition" "WordRecognition" NOT NULL,
    "homeLiteracyEnvironment" "HomeLiteracyEnvironment" NOT NULL,
    "parentalSupport" "ParentalSupport" NOT NULL,
    "classroomEnvironment" "ClassroomEnvironment" NOT NULL,
    "languageConsiderations" "LanguageConsideration"[],
    "suggestedInterventions" "Intervention"[],
    "lsenObservations" TEXT,
    "furtherAssessment" "FurtherAssessment"[],
    "furtherAssessmentOther" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AralProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingLevelRecord" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "englishProfile" "ReadingProfile" NOT NULL,
    "filipinoProfile" "ReadingProfile" NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingLevelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "schoolId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TeacherGrades" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "School_name_key" ON "School"("name");

-- CreateIndex
CREATE UNIQUE INDEX "School_schoolIdCode_key" ON "School"("schoolIdCode");

-- CreateIndex
CREATE INDEX "School_deletedAt_idx" ON "School"("deletedAt");

-- CreateIndex
CREATE INDEX "School_isActive_idx" ON "School"("isActive");

-- CreateIndex
CREATE INDEX "SchoolYear_schoolId_isActive_idx" ON "SchoolYear"("schoolId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_schoolId_label_key" ON "SchoolYear"("schoolId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_schoolId_role_deletedAt_idx" ON "User"("schoolId", "role", "deletedAt");

-- CreateIndex
CREATE INDEX "User_authId_idx" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolHeadProfile_userId_key" ON "SchoolHeadProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherProfile_userId_key" ON "TeacherProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherInvite_tokenHash_key" ON "TeacherInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "TeacherInvite_schoolId_email_idx" ON "TeacherInvite"("schoolId", "email");

-- CreateIndex
CREATE INDEX "TeacherInvite_expiresAt_idx" ON "TeacherInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "GradeLevel_deletedAt_idx" ON "GradeLevel"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GradeLevel_schoolId_type_key" ON "GradeLevel"("schoolId", "type");

-- CreateIndex
CREATE INDEX "Learner_schoolId_gradeLevelId_isAralLearner_deletedAt_idx" ON "Learner"("schoolId", "gradeLevelId", "isAralLearner", "deletedAt");

-- CreateIndex
CREATE INDEX "Learner_teacherId_idx" ON "Learner"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "AralProfile_learnerId_key" ON "AralProfile"("learnerId");

-- CreateIndex
CREATE INDEX "Attendance_learnerId_weekStart_idx" ON "Attendance"("learnerId", "weekStart");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_learnerId_date_key" ON "Attendance"("learnerId", "date");

-- CreateIndex
CREATE INDEX "ReadingLevelRecord_monthYear_idx" ON "ReadingLevelRecord"("monthYear");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingLevelRecord_learnerId_monthYear_key" ON "ReadingLevelRecord"("learnerId", "monthYear");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_timestamp_idx" ON "AuditLog"("schoolId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "_TeacherGrades_AB_unique" ON "_TeacherGrades"("A", "B");

-- CreateIndex
CREATE INDEX "_TeacherGrades_B_index" ON "_TeacherGrades"("B");

-- AddForeignKey
ALTER TABLE "SchoolYear" ADD CONSTRAINT "SchoolYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolHeadProfile" ADD CONSTRAINT "SchoolHeadProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeLevel" ADD CONSTRAINT "GradeLevel_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AralProfile" ADD CONSTRAINT "AralProfile_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLevelRecord" ADD CONSTRAINT "ReadingLevelRecord_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLevelRecord" ADD CONSTRAINT "ReadingLevelRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeacherGrades" ADD CONSTRAINT "_TeacherGrades_A_fkey" FOREIGN KEY ("A") REFERENCES "GradeLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeacherGrades" ADD CONSTRAINT "_TeacherGrades_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

