-- CreateEnum
CREATE TYPE "RolloutStatus" AS ENUM ('RUNNING', 'PAUSED', 'HALTED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Rollout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "firmwareId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "RolloutStatus" NOT NULL DEFAULT 'RUNNING',
    "waveSize" INTEGER NOT NULL DEFAULT 5,
    "waveGapMin" INTEGER NOT NULL DEFAULT 30,
    "maxFailures" INTEGER NOT NULL DEFAULT 1,
    "daytimeOnly" BOOLEAN NOT NULL DEFAULT true,
    "skipWeak" BOOLEAN NOT NULL DEFAULT true,
    "wave" INTEGER NOT NULL DEFAULT 0,
    "nextWaveAt" TIMESTAMP(3),
    "haltReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Rollout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolloutTarget" (
    "id" TEXT NOT NULL,
    "rolloutId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "homeId" TEXT,
    "wave" INTEGER NOT NULL,
    "status" "TargetStatus" NOT NULL DEFAULT 'PENDING',
    "fromVersion" TEXT,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "RolloutTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rollout_orgId_status_idx" ON "Rollout"("orgId", "status");

-- CreateIndex
CREATE INDEX "RolloutTarget_nodeId_status_idx" ON "RolloutTarget"("nodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RolloutTarget_rolloutId_nodeId_key" ON "RolloutTarget"("rolloutId", "nodeId");

-- AddForeignKey
ALTER TABLE "Rollout" ADD CONSTRAINT "Rollout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolloutTarget" ADD CONSTRAINT "RolloutTarget_rolloutId_fkey" FOREIGN KEY ("rolloutId") REFERENCES "Rollout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
