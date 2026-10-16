-- CreateTable
CREATE TABLE "InstallationReport" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installerId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signature" TEXT,
    "signedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallPhoto" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallationReport_homeId_key" ON "InstallationReport"("homeId");

-- CreateIndex
CREATE INDEX "InstallPhoto_reportId_idx" ON "InstallPhoto"("reportId");

-- AddForeignKey
ALTER TABLE "InstallationReport" ADD CONSTRAINT "InstallationReport_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallPhoto" ADD CONSTRAINT "InstallPhoto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InstallationReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
