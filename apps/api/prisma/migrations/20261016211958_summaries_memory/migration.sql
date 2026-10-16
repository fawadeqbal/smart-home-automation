-- AlterTable
ALTER TABLE "Home" ADD COLUMN     "summaryDayAt" TIMESTAMP(3),
ADD COLUMN     "summaryWeekAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AssistantMemory" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantMemory_userId_homeId_idx" ON "AssistantMemory"("userId", "homeId");

-- AddForeignKey
ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
