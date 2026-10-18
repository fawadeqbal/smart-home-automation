-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "restoreOff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "mqttLogin" TEXT,
ADD COLUMN     "mqttLoginAt" TIMESTAMP(3),
ADD COLUMN     "mqttLoginProblem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mqttLoginUsedAt" TIMESTAMP(3),
ADD COLUMN     "mqttSecret" TEXT;
