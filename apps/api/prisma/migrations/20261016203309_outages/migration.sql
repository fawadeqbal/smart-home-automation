-- CreateEnum
CREATE TYPE "OutageKind" AS ENUM ('POWER', 'NETWORK', 'RESTART', 'RESET', 'CRASH', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "bootedAt" TIMESTAMP(3),
ADD COLUMN     "downAlertAt" TIMESTAMP(3),
ADD COLUMN     "offlineSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Outage" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "homeId" TEXT,
    "kind" "OutageKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "reset" TEXT,
    "place" TEXT,
    "isp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Outage_homeId_startedAt_idx" ON "Outage"("homeId", "startedAt");

-- CreateIndex
CREATE INDEX "Outage_startedAt_idx" ON "Outage"("startedAt");

-- AddForeignKey
ALTER TABLE "Outage" ADD CONSTRAINT "Outage_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
