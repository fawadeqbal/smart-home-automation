-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "accessDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "accessFrom" TEXT,
ADD COLUMN     "accessTo" TEXT,
ADD COLUMN     "accessUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "accessDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "accessFrom" TEXT,
ADD COLUMN     "accessTo" TEXT,
ADD COLUMN     "accessUntil" TIMESTAMP(3),
ADD COLUMN     "expiredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhoneToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "userId" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atHome" BOOLEAN,
    "reportedAt" TIMESTAMP(3),
    "since" TIMESTAMP(3),

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("userId","homeId")
);

-- CreateTable
CREATE TABLE "PresenceRule" (
    "homeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "switchOff" TEXT NOT NULL DEFAULT 'lights',
    "offDevices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "awayMode" BOOLEAN NOT NULL DEFAULT false,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "arriveSceneId" TEXT,
    "createdById" TEXT NOT NULL,
    "out" BOOLEAN NOT NULL DEFAULT false,
    "outSince" TIMESTAMP(3),
    "awayByRule" BOOLEAN NOT NULL DEFAULT false,
    "lastEvent" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceRule_pkey" PRIMARY KEY ("homeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneToken_token_key" ON "PhoneToken"("token");

-- CreateIndex
CREATE INDEX "PhoneToken_userId_idx" ON "PhoneToken"("userId");

-- CreateIndex
CREATE INDEX "Presence_homeId_idx" ON "Presence"("homeId");

-- AddForeignKey
ALTER TABLE "PhoneToken" ADD CONSTRAINT "PhoneToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceRule" ADD CONSTRAINT "PresenceRule_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
