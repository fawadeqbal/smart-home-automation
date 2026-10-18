-- AlterTable
ALTER TABLE "Home" ADD COLUMN     "billWarned" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "billingDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "cutNoticeAt" TIMESTAMP(3),
ADD COLUMN     "gridLoads" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gridOffSince" TIMESTAMP(3),
ADD COLUMN     "gridRestore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gridSwitchedOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "loadShedding" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "protectedLimit" INTEGER DEFAULT 200,
ADD COLUMN     "readingReminderAt" TIMESTAMP(3),
ADD COLUMN     "tariffSlabs" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Outage" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "kwh" DOUBLE PRECISION NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "newMeter" BOOLEAN NOT NULL DEFAULT false,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeterReading_homeId_readAt_idx" ON "MeterReading"("homeId", "readAt");

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
