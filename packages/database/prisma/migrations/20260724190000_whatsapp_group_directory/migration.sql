-- CreateEnum
CREATE TYPE "WhatsAppDestinationType" AS ENUM ('INDIVIDUAL', 'GROUP');

-- AlterTable
ALTER TABLE "WhatsAppDestination"
ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "discoveredAt" TIMESTAMP(3),
ADD COLUMN "fingerprint" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "memberCount" INTEGER,
ADD COLUMN "ownerIsParticipant" BOOLEAN,
ADD COLUMN "sourceInstanceName" TEXT,
ADD COLUMN "type" "WhatsAppDestinationType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateIndex
CREATE INDEX "WhatsAppDestination_type_active_available_idx"
ON "WhatsAppDestination"("type", "active", "available");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppDestination_destination_sourceInstanceName_key"
ON "WhatsAppDestination"("destination", "sourceInstanceName");
