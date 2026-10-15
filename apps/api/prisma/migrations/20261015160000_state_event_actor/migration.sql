-- Who switched a device (from the command that caused it), for the home app's activity feed.
ALTER TABLE "StateEvent" ADD COLUMN "userId" TEXT;
ALTER TABLE "StateEvent" ADD COLUMN "channel" TEXT;
