-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "replacedAt" TIMESTAMP(3),
ADD COLUMN     "replacedById" TEXT;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "ifMissed" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "lastStatus" TEXT,
ADD COLUMN     "retryAt" TIMESTAMP(3),
ADD COLUMN     "retryState" JSONB;

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "ip" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_kind_email_at_idx" ON "LoginAttempt"("kind", "email", "at");

-- CreateIndex
CREATE INDEX "LoginAttempt_kind_ip_at_idx" ON "LoginAttempt"("kind", "ip", "at");

-- CreateIndex
CREATE INDEX "LoginAttempt_at_idx" ON "LoginAttempt"("at");

-- CreateIndex
CREATE INDEX "Schedule_retryAt_idx" ON "Schedule"("retryAt");
