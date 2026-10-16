-- Local control without internet (firmware 2.5.0+)
ALTER TABLE "Home" ADD COLUMN "localEpoch" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Node" ADD COLUMN "localKey" TEXT;
ALTER TABLE "Node" ADD COLUMN "localKeyHome" TEXT;
ALTER TABLE "Node" ADD COLUMN "localReported" TEXT;
