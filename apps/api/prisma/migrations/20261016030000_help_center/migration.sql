-- CreateEnum
CREATE TYPE "HelpCategory" AS ENUM ('USAGE', 'TROUBLESHOOTING', 'PROCESS', 'POLICY', 'FAQ');

-- CreateEnum
CREATE TYPE "HelpAudience" AS ENUM ('EVERYONE', 'STAFF');

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HelpCategory" NOT NULL,
    "audience" "HelpAudience" NOT NULL DEFAULT 'EVERYONE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpArticle_orgId_published_idx" ON "HelpArticle"("orgId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_orgId_slug_key" ON "HelpArticle"("orgId", "slug");

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

