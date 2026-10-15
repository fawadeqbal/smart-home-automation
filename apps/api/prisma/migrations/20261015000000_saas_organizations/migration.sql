-- SaaS: organizations (tenants), platform staff, people in several homes, board inventory.
-- Existing data is kept: every existing home moves into one organization, its owner becomes that
-- organization's super admin, and each person's home and role become a membership.

-- ---------------------------------------------------------------- enums
CREATE TYPE "StaffRole" AS ENUM ('SUPERADMIN', 'INSTALLER', 'SUPPORT');
CREATE TYPE "Plan" AS ENUM ('STARTER', 'PRO', 'BUSINESS');
CREATE TYPE "OrgStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- Board status: PENDING (found, not adopted) becomes ASSIGNED (given to the home, waiting to be adopted).
CREATE TYPE "NodeStatus_new" AS ENUM ('STOCK', 'ASSIGNED', 'ADOPTED', 'FAULTY');
ALTER TABLE "Node" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Node" ALTER COLUMN "status" TYPE "NodeStatus_new"
  USING (CASE "status"::text WHEN 'PENDING' THEN 'ASSIGNED' ELSE "status"::text END)::"NodeStatus_new";
ALTER TYPE "NodeStatus" RENAME TO "NodeStatus_old";
ALTER TYPE "NodeStatus_new" RENAME TO "NodeStatus";
DROP TYPE "NodeStatus_old";
ALTER TABLE "Node" ALTER COLUMN "status" SET DEFAULT 'STOCK';

-- ---------------------------------------------------------------- organizations
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "status" "OrgStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "billingEmail" TEXT,
    "billingName" TEXT,
    "taxId" TEXT,
    "country" TEXT,
    "selfHosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- One organization for everything that exists today (only when there is something to move).
INSERT INTO "Organization" ("id", "name", "status", "selfHosted", "billingEmail")
SELECT 'org_default',
       COALESCE((SELECT "name" FROM "Home" ORDER BY "id" LIMIT 1), 'My organization'),
       'ACTIVE',
       true,
       (SELECT "email" FROM "User" WHERE "role" = 'OWNER' ORDER BY "createdAt" LIMIT 1)
WHERE EXISTS (SELECT 1 FROM "Home");

-- ---------------------------------------------------------------- memberships (from User.homeId + User.role)
CREATE TABLE "Membership" (
    "userId" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("userId","homeId")
);
INSERT INTO "Membership" ("userId", "homeId", "role", "createdAt")
SELECT "id", "homeId", "role", "createdAt" FROM "User";

-- ---------------------------------------------------------------- users
ALTER TABLE "User" DROP CONSTRAINT "User_homeId_fkey";
ALTER TABLE "User" ADD COLUMN "lastHomeId" TEXT, ADD COLUMN "orgId" TEXT, ADD COLUMN "staffRole" "StaffRole";
UPDATE "User" SET "lastHomeId" = "homeId";
-- Whoever ran the platform keeps every power: owners become super admins of the organization.
UPDATE "User" SET "orgId" = 'org_default', "staffRole" = 'SUPERADMIN' WHERE "role" = 'OWNER';
ALTER TABLE "User" DROP COLUMN "homeId", DROP COLUMN "role";

-- ---------------------------------------------------------------- homes
ALTER TABLE "Home" ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "installerId" TEXT,
  ADD COLUMN "orgId" TEXT;
UPDATE "Home" SET "orgId" = 'org_default';
ALTER TABLE "Home" ALTER COLUMN "orgId" SET NOT NULL;

-- ---------------------------------------------------------------- boards
ALTER TABLE "Node" DROP CONSTRAINT "Node_homeId_fkey";
ALTER TABLE "Node" ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "installerId" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "orgId" TEXT,
  ALTER COLUMN "homeId" DROP NOT NULL;
UPDATE "Node" SET "orgId" = 'org_default', "assignedAt" = "createdAt";

-- ---------------------------------------------------------------- invites, audit, firmware
ALTER TABLE "Invite" ADD COLUMN "name" TEXT, ADD COLUMN "orgId" TEXT, ADD COLUMN "staffRole" "StaffRole",
  ADD COLUMN "rooms" JSONB NOT NULL DEFAULT '[]',
  ALTER COLUMN "homeId" DROP NOT NULL, ALTER COLUMN "role" DROP NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN "orgId" TEXT, ALTER COLUMN "homeId" DROP NOT NULL;
UPDATE "AuditLog" SET "orgId" = 'org_default' WHERE EXISTS (SELECT 1 FROM "Organization" WHERE "id" = 'org_default');

ALTER TABLE "FirmwareImage" ADD COLUMN "orgId" TEXT;
-- builds uploaded so far belong to the existing organization (not shared with future tenants)
UPDATE "FirmwareImage" SET "orgId" = 'org_default' WHERE EXISTS (SELECT 1 FROM "Organization" WHERE "id" = 'org_default');

-- ---------------------------------------------------------------- indexes and keys
CREATE INDEX "Membership_homeId_idx" ON "Membership"("homeId");
CREATE INDEX "AuditLog_orgId_at_idx" ON "AuditLog"("orgId", "at");

ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Home" ADD CONSTRAINT "Home_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Home" ADD CONSTRAINT "Home_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Node" ADD CONSTRAINT "Node_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Node" ADD CONSTRAINT "Node_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Node" ADD CONSTRAINT "Node_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FirmwareImage" ADD CONSTRAINT "FirmwareImage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
