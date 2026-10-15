-- Board connections from the broker's log: public IP, place, provider, and why each ended.
ALTER TABLE "Node" ADD COLUMN "publicIp" TEXT;
ALTER TABLE "Node" ADD COLUMN "publicPlace" TEXT;
ALTER TABLE "Node" ADD COLUMN "publicIsp" TEXT;
ALTER TABLE "Node" ADD COLUMN "publicIpAt" TIMESTAMP(3);

CREATE TABLE "NodeConnection" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "endNote" TEXT,
    "place" TEXT,
    "isp" TEXT,
    CONSTRAINT "NodeConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NodeConnection_nodeId_connectedAt_port_key" ON "NodeConnection"("nodeId", "connectedAt", "port");
CREATE INDEX "NodeConnection_nodeId_connectedAt_idx" ON "NodeConnection"("nodeId", "connectedAt");

ALTER TABLE "NodeConnection" ADD CONSTRAINT "NodeConnection_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
