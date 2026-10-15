-- CreateTable
CREATE TABLE "FirmwareImage" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "size" INTEGER NOT NULL,
    "md5" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmwareImage_pkey" PRIMARY KEY ("id")
);
