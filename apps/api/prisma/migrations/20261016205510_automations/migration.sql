-- AlterEnum
ALTER TYPE "ScheduleKind" ADD VALUE 'SUN';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "autoOffAt" TIMESTAMP(3),
ADD COLUMN     "autoOffMinutes" INTEGER,
ADD COLUMN     "childLock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Home" ADD COLUMN     "awayById" TEXT,
ADD COLUMN     "awayLights" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "awayMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "awaySince" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "offsetMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sunEvent" TEXT;

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL,
    "cooldownSec" INTEGER NOT NULL DEFAULT 120,
    "createdById" TEXT NOT NULL,
    "lastFiredAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rule_homeId_idx" ON "Rule"("homeId");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
