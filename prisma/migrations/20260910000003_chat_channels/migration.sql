-- School chat, and a private line to the admin team.
--
-- Four new tables and two new NotificationType values. Purely additive: no
-- existing column is altered, dropped or rewritten, and no backfill runs. Every
-- existing row is untouched, so the app keeps working unchanged between this
-- being applied and the feature being deployed.
--
-- The two partial unique indexes at the bottom are the reason this file has
-- hand-written SQL at all. Prisma's schema language cannot express a uniqueness
-- that applies to only some rows, and both of these must:
--
--   * one SCHOOL channel per school, or a double-submit splits the staff room
--     into two half-conversations that each look complete;
--   * one ADMIN_DIRECT channel per member, for the same reason.
--
-- They are the same technique as Enrollment's one-ACTIVE-row-per-learner index.
-- Preserve them when editing these tables.

-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('SCHOOL', 'ADMIN_DIRECT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CHAT_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'CHAT_DIRECT_MESSAGE';

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL,
    "memberId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ChatMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRead" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("channelId","userId")
);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "channelId" TEXT;

-- CreateIndex
CREATE INDEX "ChatChannel_schoolId_kind_lastMessageAt_idx" ON "ChatChannel"("schoolId", "kind", "lastMessageAt");
CREATE INDEX "ChatChannel_memberId_idx" ON "ChatChannel"("memberId");
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");
CREATE INDEX "ChatMessage_authorId_idx" ON "ChatMessage"("authorId");
CREATE UNIQUE INDEX "ChatMention_messageId_userId_key" ON "ChatMention"("messageId", "userId");
CREATE INDEX "ChatMention_userId_idx" ON "ChatMention"("userId");
CREATE INDEX "ChatRead_userId_idx" ON "ChatRead"("userId");

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The uniqueness Prisma cannot declare. See the note at the top of this file.
CREATE UNIQUE INDEX "ChatChannel_one_school_channel"
    ON "ChatChannel"("schoolId")
    WHERE "kind" = 'SCHOOL';

CREATE UNIQUE INDEX "ChatChannel_one_direct_channel_per_member"
    ON "ChatChannel"("schoolId", "memberId")
    WHERE "kind" = 'ADMIN_DIRECT';
