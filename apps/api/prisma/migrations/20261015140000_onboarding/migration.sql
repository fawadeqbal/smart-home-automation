-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "teamSize" TEXT;


-- Homes and companies that already exist have been in use: don't show them the first-visit tours.
UPDATE "Membership" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
UPDATE "Organization" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
